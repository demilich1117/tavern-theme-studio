import { copyClipboard } from '/clipboard.js';
const $ = s => document.querySelector(s);
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };

export function attachArtworks({ getState, getToken, settled, toast }) {
  let info, busy = false, currentProject;
  const open = node('button', undefined, 'file-action'); open.id = 'artworks-button';
  open.append(node('b', '作品存档与回溯'), node('span', '保存一份完整版本，可选本地 Git 提交'));
  $('#files-dialog .dialog-body').prepend(open);
  const dialog = node('dialog', undefined, 'wide-dialog'); dialog.id = 'artworks-dialog';
  dialog.innerHTML = `<form method="dialog" class="dialog-header"><h2>作品存档与回溯</h2><button aria-label="关闭作品存档">×</button></form>
    <div class="dialog-body"><p>微调会自动保存在本机。满意一个阶段后，在这里保存工程、主题、素材和源码，留下可回溯的完整版本。</p>
    <p id="artwork-directory" class="panel-hint"></p>
    <form id="artwork-form" class="artwork-form"><label for="artwork-name">版本名称</label><input id="artwork-name" required maxlength="120" placeholder="例如：阅读布局定稿">
    <label for="artwork-note">这次改了什么（选填）</label><textarea id="artwork-note" rows="3" maxlength="4000" placeholder="方便以后认出这一版"></textarea>
    <label class="artwork-option"><input id="artwork-source" type="checkbox">包含已绑定的源码与设计记录</label>
    <label class="artwork-option"><input id="artwork-git" type="checkbox">同时提交到此作品的本地 Git 仓库</label>
    <p class="panel-hint">存档放在工作台仓库之外。本地 Git 提交不需要 GitHub，不会自动推送。</p><button class="primary" type="submit">保存作品版本</button></form>
    <p id="artwork-result" role="status" aria-live="polite"></p>
    <details><summary>更改存档目录</summary><form id="artwork-root-form" class="artwork-form"><label for="artwork-root">作品存档目录</label><input id="artwork-root" placeholder="选择空目录的绝对路径" required><button type="submit">使用此目录</button></form></details>
    <h3>已存档版本</h3><p class="panel-hint">恢复工程前会保存当前快照，并暂停源码自动同步。完整恢复源码时，可复制给 Agent 处理；每个版本中的 source 目录保留当时源码。</p><div id="artwork-list"></div></div>`;
  document.body.append(dialog);
  async function api(body) {
    await settled();
    const state = getState(), response = await fetch('/api/artworks', body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': getToken() }, body: JSON.stringify({ sessionId: state.sessionId, projectId: state.projectId, revision: state.revision, fingerprint: state.fingerprint, ...body }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }
  function result(text, failed = false) { $('#artwork-result').textContent = text; $('#artwork-result').classList.toggle('workflow-error', failed); }
  const run = action => async e => {
    e?.preventDefault(); if (busy) return; busy = true;
    const controls = [...dialog.querySelectorAll('input,textarea,button:not([aria-label])')], disabled = controls.map(e => e.disabled); controls.forEach(e => e.disabled = true);
    try { await action(); } catch (e) { result(e.message, true); toast(e.message, true); }
    finally { busy = false; controls.forEach((e, i) => e.disabled = disabled[i]); $('#artwork-source').disabled = !info?.sourceBound; }
  };
  async function load() {
    info = await api(); currentProject = getState().projectId;
    $('#artwork-directory').textContent = `存档位置：${info.root}`; $('#artwork-root').value = info.root;
    $('#artwork-source').disabled = !info.sourceBound; $('#artwork-source').checked = info.sourceBound;
    const list = $('#artwork-list'); list.replaceChildren();
    if (!info.versions.length) list.append(node('p', '还没有作品版本。日常撤回小改动仍可使用“保存 / 恢复版本”中的快照。', 'empty-state'));
    for (const version of info.versions) {
      const row = node('article', undefined, 'artwork-version'); row.append(node('b', version.name));
      if (version.error) { row.append(node('p', version.error, 'workflow-error')); list.append(row); continue; }
      row.append(node('p', `${new Date(version.createdAt).toLocaleString()} · ${version.source.included ? '含源码' : '工程与主题'}${version.git.status === 'committed' ? ` · Git ${version.git.commit.slice(0, 8)}` : ''}`, 'panel-hint'));
      if (version.note) row.append(node('p', version.note));
      if (version.git.status === 'failed') row.append(node('p', `文件已存档；本地 Git 提交失败：${version.git.detail}`, 'workflow-error'));
      const actions = node('div', undefined, 'ticket-actions');
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
      actions.append(verify, restore, commit);
      if (version.source.included) {
        const copy = node('button', '复制完整恢复给 Agent'); copy.addEventListener('click', run(async () => {
          await copyClipboard(`请恢复此美化作品版本的工程与源码。工作台地址：${location.origin}；工程 ID：${currentProject}；存档 ID：${version.id}；存档目录：${version.directory}。先重新读取 /api/artworks 和当前工程，使用 verify 核验存档。保留当前工程快照和源码恢复副本，再恢复工程，并对照该版本 source 目录恢复本作品源码。核对源码绑定和外部构建依赖，不能直接覆盖运行中的 project.json。保持自动同步暂停，直到工程覆盖、源码与候选构建已核对；真实宿主只使用专用虚构测试对话。`, toast, '完整恢复说明已复制，粘贴到此项目的 Agent 对话。');
        })); actions.append(copy);
      }
      row.append(actions, confirmation); list.append(row);
    }
  }
  open.addEventListener('click', run(async () => { $('#files-dialog').close(); result(''); await load(); dialog.showModal(); $('#artwork-name').focus(); }));
  $('#artwork-form').addEventListener('submit', run(async () => {
    result('正在保存完整作品版本…');
    const saved = await api({ action: 'save', name: $('#artwork-name').value, note: $('#artwork-note').value, includeSource: $('#artwork-source').checked, gitCommit: $('#artwork-git').checked });
    await load(); $('#artwork-name').value = ''; $('#artwork-note').value = '';
    result(`已存档“${saved.name}”。${saved.git.status === 'committed' ? `本地 Git 提交 ${saved.git.commit.slice(0, 8)}。` : saved.git.status === 'failed' ? `文件已保存，但 Git 提交失败：${saved.git.detail}` : ''}${saved.warnings.length ? '\n' + saved.warnings.join('\n') : ''}`, saved.git.status === 'failed');
  }));
  $('#artwork-root-form').addEventListener('submit', run(async () => { await api({ action: 'configure', root: $('#artwork-root').value }); await load(); result('已设置本作品的存档目录。'); }));
  return { events(events) { events.addEventListener('artworks', () => { if (dialog.open && !busy) load().catch(e => result(e.message, true)); }); }, render() { if (dialog.open && !busy && currentProject && currentProject !== getState().projectId) load().catch(e => result(e.message, true)); } };
}
