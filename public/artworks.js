import { copyClipboard } from '/clipboard.js';
import { openStudioPanel, showEditor } from '/panels.js';
const $ = s => document.querySelector(s);
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };

export function attachArtworks({ getState, getToken, settled, toast, command, newWork }) {
  let info, busy = false, currentProject, loadedFingerprint, refreshTimer, loadGeneration = 0;
  const open = node('button', '作品'); open.id = 'artworks-button'; open.dataset.view = 'artwork'; open.setAttribute('aria-pressed', 'false');
  $('#workbench-nav').prepend(open);
  const legacy = node('button', undefined, 'file-action'); legacy.append(node('b', '我的作品与定稿'), node('span', '继续制作、保存版本或打开文件夹'));
  $('#files-dialog .dialog-body').prepend(legacy);
  const dialog = node('dialog', undefined, 'wide-dialog'); dialog.id = 'artworks-dialog';
  dialog.innerHTML = `<form method="dialog" class="dialog-header"><h2>我的作品</h2><button aria-label="关闭作品">×</button></form>
    <div class="dialog-body"><div class="work-library"><form id="work-switch-form"><label for="work-selector">切换已有作品</label><div class="work-switch-controls"><select id="work-selector"></select><button id="work-switch" type="submit">打开作品</button></div></form><button id="work-new" type="button">＋ 新建作品</button></div>
    <section class="artwork-overview" aria-label="当前作品"><p class="artwork-eyebrow">当前作品</p><h3 id="artwork-title">正在读取作品…</h3>
    <p id="artwork-draft-status" role="status">正在检查保存状态…</p><p id="artwork-latest" class="panel-hint"></p>
    <div class="artwork-primary-actions"><button id="artwork-edit" class="primary">继续编辑</button><button id="artwork-finalize">保存定稿</button><button id="artwork-open">打开文件夹</button></div>
    <p class="panel-hint">平时自动保存草稿。满意后留一个定稿版本，继续修改时旧版仍然保留。</p></section>
    <p id="artwork-result" role="status" aria-live="polite"></p>
    <details id="artwork-save-details"><summary>保存一个定稿版本</summary>
    <form id="artwork-form" class="artwork-form"><label for="artwork-name">版本名称</label><input id="artwork-name" required maxlength="120" placeholder="例如：桌面与手机排版定稿">
    <label for="artwork-note">这次改了什么（选填）</label><textarea id="artwork-note" rows="3" maxlength="4000" placeholder="方便以后认出这一版"></textarea>
    <details><summary>保存选项</summary><label class="artwork-option"><input id="artwork-source" type="checkbox">包含已绑定的源码与设计记录</label>
    <label class="artwork-option"><input id="artwork-git" type="checkbox">同时提交到此作品的本地 Git 仓库</label>
    <p class="panel-hint">本地 Git 提交不需要 GitHub，不会自动推送。</p></details><button class="primary" type="submit">保存此定稿</button></form></details>
    <section class="artwork-history"><div class="artwork-history-heading"><h3>版本记录</h3><button id="artwork-snapshots">自动恢复与临时快照</button></div><p class="panel-hint">每版包含当时的工程、微调、素材和主题；已绑定的源码默认一起保存。</p><div id="artwork-list"></div></section>
    <details class="artwork-locations"><summary>文件位置与维护</summary><p id="artwork-directory" class="panel-hint"></p><p id="artwork-workspace" class="panel-hint"></p><p id="artwork-source-directory" class="panel-hint"></p><button id="artwork-open-source">打开源码文件夹</button><button id="artwork-copy-location">复制作品路径</button>
    <details id="artwork-change-location"><summary>更改旧存档目录</summary><form id="artwork-root-form" class="artwork-form"><label for="artwork-root">作品存档目录</label><input id="artwork-root" placeholder="选择空目录的绝对路径" required><button type="submit">使用此目录</button></form><p class="panel-hint">此项只改变后续存档位置。整理完整作品请停止服务后使用迁移工具，原件会保留。</p></details></details></div>`;
  document.body.append(dialog);
  async function api(body) {
    await settled();
    const state = getState(), response = await fetch('/api/artworks', body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': getToken() }, body: JSON.stringify({ sessionId: state.sessionId, projectId: state.projectId, revision: state.revision, fingerprint: state.fingerprint, ...body }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }
  function result(text, failed = false) { $('#artwork-result').textContent = text; $('#artwork-result').classList.toggle('workflow-error', failed); }
  const run = action => async e => {
    e?.preventDefault(); if (busy) return; busy = true;
    const controls = [...dialog.querySelectorAll('input,textarea,select,button:not([aria-label])')], disabled = controls.map(e => e.disabled); controls.forEach(e => e.disabled = true);
    try { await action(); } catch (e) { result(e.message, true); toast(e.message, true); }
    finally { busy = false; controls.forEach((e, i) => e.disabled = disabled[i]); updateSwitch(); $('#artwork-source').disabled = !info?.sourceBound; $('#artwork-open-source').disabled = !info?.sourceBound; $('#artwork-open').disabled = !info || (!info.managed && !info.versions.length); if (loadedFingerprint !== getState().fingerprint) refresh(); }
  };
  function updateSwitch() { $('#work-switch').disabled = busy || !$('#work-selector').value || $('#work-selector').value === getState().projectId; }
  async function load() {
    const generation = ++loadGeneration, next = await api();
    if (generation !== loadGeneration || next.projectId !== getState().projectId) return;
    const changedProject = currentProject !== next.projectId, wasBound = info?.sourceBound;
    info = next; currentProject = info.projectId; loadedFingerprint = info.fingerprint;
    const libraryResponse = await fetch('/api/works'), library = await libraryResponse.json();
    if (!libraryResponse.ok) throw new Error(library.error);
    if (generation !== loadGeneration || currentProject !== getState().projectId) return;
    const selector = $('#work-selector'); selector.replaceChildren();
    if (!library.works.some(work => work.projectId === currentProject)) selector.append(new Option(info.name + '（当前工程）', currentProject));
    for (const work of library.works) selector.append(new Option(work.name + (work.projectId === currentProject ? '（当前）' : ''), work.projectId));
    selector.value = currentProject; updateSwitch();
    if (changedProject) { $('#artwork-name').value = ''; $('#artwork-note').value = ''; $('#artwork-save-details').open = false; }
    $('#artwork-title').textContent = info.name;
    $('#artwork-draft-status').textContent = info.sourceError ? '草稿已保存 · 源码状态需检查' : info.changedSinceLatest === null ? '草稿已自动保存 · 尚未定稿' : info.changedSinceLatest ? '草稿已自动保存 · 有定稿后的修改' : '草稿已自动保存 · 与最近定稿一致';
    const latest = info.versions.find(v => v.id === info.latestVersionId);
    $('#artwork-latest').textContent = latest ? `最近定稿：${latest.name} · ${new Date(latest.createdAt).toLocaleString('zh-CN')}` : '保存第一版后，就可以随时找到成品或回看当时的制作状态。';
    $('#artwork-directory').textContent = `${info.managed ? '作品目录' : '旧存档目录'}：${info.root}`; $('#artwork-root').value = info.root;
    $('#artwork-workspace').textContent = `自动保存：${info.workspace}`;
    $('#artwork-source-directory').textContent = info.sourceError || (info.sourceDirectory ? `源码：${info.sourceDirectory}` : '尚未绑定源码；定稿仍会保存工程、微调、素材和主题。');
    $('#artwork-change-location').hidden = info.managed;
    $('#artwork-open-source').disabled = !info.sourceBound;
    $('#artwork-open').disabled = !info.managed && !info.versions.length;
    $('#artwork-source').disabled = !info.sourceBound;
    if (changedProject || wasBound !== info.sourceBound) $('#artwork-source').checked = info.sourceBound;
    const list = $('#artwork-list'); list.replaceChildren();
    if (!info.versions.length) list.append(node('p', '还没有定稿。点击上方“保存定稿”，为当前阶段留个名字。', 'empty-state'));
    for (const version of info.versions) {
      const row = node('article', undefined, 'artwork-version'); row.append(node('b', version.name));
      if (version.error) { row.append(node('p', version.error, 'workflow-error')); list.append(row); continue; }
      row.append(node('p', `${new Date(version.createdAt).toLocaleString('zh-CN')} · ${version.source.included ? '含源码' : '工程与主题'}${version.git.status === 'committed' ? ` · Git ${version.git.commit.slice(0, 8)}` : ''}`, 'panel-hint'));
      if (version.note) row.append(node('p', version.note));
      if (version.git.status === 'failed') row.append(node('p', `文件已存档；本地 Git 提交失败：${version.git.detail}`, 'workflow-error'));
      const actions = node('div', undefined, 'ticket-actions');
      const folder = node('button', '打开此版文件夹'); folder.addEventListener('click', run(async () => { const opened = await api({ action: 'open', target: 'version', id: version.id }); result(`已请求打开：${opened.directory}`); }));
      const download = node('button', '下载此版主题'); download.addEventListener('click', run(async () => {
        const response = await fetch(`/api/artworks/theme?id=${encodeURIComponent(version.id)}`), theme = await response.json(); if (!response.ok) throw new Error(theme.error);
        const url = URL.createObjectURL(new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' })), link = node('a');
        link.href = url; link.download = version.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.theme.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        result(`已下载“${version.name}”的主题。到酒馆中导入并选择；如遇同名主题，请先另存原主题或修改导入名称。`);
      }));
      const verify = node('button', '核验文件'); verify.addEventListener('click', run(async () => { const checked = await api({ action: 'verify', id: version.id }); result(`“${version.name}”核验通过，共 ${checked.files} 个文件。`); }));
      const confirmation = node('div', undefined, 'artwork-restore-confirm'); confirmation.hidden = true;
      confirmation.append(node('p', `恢复“${version.name}”前会保存当前工程快照，并暂停源码自动同步。`));
      const confirm = node('button', '确认恢复此版本', 'primary'), cancel = node('button', '暂不恢复');
      confirmation.append(confirm, cancel);
      const restore = node('button', '恢复工程'); restore.addEventListener('click', () => { if (!busy) { confirmation.hidden = false; confirm.focus(); } });
      cancel.addEventListener('click', () => { confirmation.hidden = true; restore.focus(); });
      confirm.addEventListener('click', run(async () => {
        await api({ action: 'restore', id: version.id }); result(`已恢复“${version.name}”。核对源码后，再开启自动同步。`); await load();
      }));
      const commit = node('button', version.git.status === 'committed' ? '已本地提交' : version.git.status === 'failed' ? '重试本地 Git 提交' : '本地 Git 提交'); commit.disabled = version.git.status === 'committed'; commit.addEventListener('click', run(async () => {
        result('正在提交到本地作品仓库…'); const saved = await api({ action: 'commit', id: version.id }); await load();
        result(saved.git.status === 'committed' ? `已本地提交 ${saved.git.commit.slice(0, 8)}` : `存档文件已保留，Git 提交失败：${saved.git.detail}`, saved.git.status === 'failed');
      }));
      actions.append(folder, download);
      const maintenance = node('details'), summary = node('summary', '核验与恢复'); maintenance.append(summary);
      const maintenanceActions = node('div', undefined, 'ticket-actions'); maintenanceActions.append(verify, restore, commit);
      if (version.source.included) {
        const copy = node('button', '复制完整恢复给 Agent'); copy.addEventListener('click', run(async () => {
          await copyClipboard(`请恢复此美化作品版本的工程与源码。工作台地址：${location.origin}；工程 ID：${currentProject}；存档 ID：${version.id}；存档目录：${version.directory}。先重新读取 /api/artworks 和当前工程，使用 verify 核验存档。保留当前工程快照和源码恢复副本，再恢复工程，并对照该版本 source 目录恢复本作品源码。核对源码绑定和外部构建依赖，不能直接覆盖运行中的 project.json。保持自动同步暂停，直到工程覆盖、源码与候选构建已核对；真实宿主只使用专用虚构测试对话。`, toast, '完整恢复说明已复制，粘贴到此项目的 Agent 对话。');
        })); maintenanceActions.append(copy);
      }
      maintenance.append(maintenanceActions, confirmation); row.append(actions, maintenance); list.append(row);
    }
  }
  open.addEventListener('click', run(async () => { $('#files-dialog').close(); result(''); openStudioPanel('artworks-dialog'); await load(); }));
  legacy.addEventListener('click', () => open.click());
  $('#work-selector').addEventListener('change', updateSwitch);
  $('#work-new').addEventListener('click', () => newWork());
  $('#work-switch-form').addEventListener('submit', run(async () => {
    const switched = await command({ type: 'work-switch', projectId: $('#work-selector').value });
    await load(); showEditor(); toast(`已打开“${switched.project.name}”，可以接着编辑。`);
  }));
  $('#save-final').addEventListener('click', run(async () => { openStudioPanel('artworks-dialog'); await load(); $('#artwork-save-details').open = true; $('#artwork-name').focus(); }));
  $('#artwork-edit').addEventListener('click', () => { showEditor(); $('#edit-view').focus(); });
  $('#artwork-finalize').addEventListener('click', () => { $('#artwork-save-details').open = true; $('#artwork-name').focus(); });
  $('#artwork-snapshots').addEventListener('click', () => $('#snapshots-button').click());
  $('#artwork-open').addEventListener('click', run(async () => { const opened = await api({ action: 'open', target: 'work' }); result(`已请求打开：${opened.directory}`); }));
  $('#artwork-open-source').addEventListener('click', run(async () => { const opened = await api({ action: 'open', target: 'source' }); result(`已请求打开：${opened.directory}`); }));
  $('#artwork-copy-location').addEventListener('click', () => info && copyClipboard(info.root, toast, '作品路径已复制。'));
  $('#artwork-form').addEventListener('submit', run(async () => {
    result('正在保存定稿：工程、主题、素材与已选择的源码…');
    const saved = await api({ action: 'save', name: $('#artwork-name').value, note: $('#artwork-note').value, includeSource: $('#artwork-source').checked, gitCommit: $('#artwork-git').checked });
    await load(); $('#artwork-name').value = ''; $('#artwork-note').value = '';
    $('#artwork-save-details').open = false;
    result(`已保存定稿“${saved.name}”。可以继续编辑，或在版本记录里打开成品。${saved.git.status === 'committed' ? `本地 Git 提交 ${saved.git.commit.slice(0, 8)}。` : saved.git.status === 'failed' ? `文件已保存，但 Git 提交失败：${saved.git.detail}` : ''}${saved.warnings.length ? '\n' + saved.warnings.join('\n') : ''}`, saved.git.status === 'failed');
  }));
  $('#artwork-root-form').addEventListener('submit', run(async () => { await api({ action: 'configure', root: $('#artwork-root').value }); await load(); result('已设置本作品的存档目录。'); }));
  function refresh() { clearTimeout(refreshTimer); if (dialog.open && !busy) refreshTimer = setTimeout(() => load().catch(e => result(e.message, true)), 180); }
  return { events(events) { events.addEventListener('artworks', refresh); events.addEventListener('build', refresh); }, render() { if (loadedFingerprint !== getState().fingerprint) refresh(); } };
}
