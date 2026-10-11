const $ = s => document.querySelector(s);
const stateNames = { unbound: '未绑定源码', idle: '等待构建', queued: '合并连续保存，准备构建', running: '正在构建候选', succeeded: '已同步工程与真实预览', failed: '构建失败，保留上次预览', conflict: '变量绑定冲突，保留上次预览', paused: '自动应用已暂停', cancelled: '构建已取消', interrupted: '上次构建中断', superseded: '旧候选已丢弃' };
export function attachSource({ getState, getToken, toast }) {
  let info, projectId, presets = [], busy = false;
  const button = document.createElement('button'); button.id = 'source-button'; button.textContent = '↻ 源码同步';
  const badge = document.createElement('small'); badge.id = 'source-badge'; button.append(badge); $('.studio-tools').append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'source-dialog'; dialog.className = 'wide-dialog';
  // All markup is static. Source paths, logs and preset names use value/textContent.
  dialog.innerHTML = `<form method="dialog" class="dialog-header"><h2>源码构建与同步</h2><button aria-label="关闭源码同步">×</button></form>
  <div class="dialog-body"><p>源码生成基础主题，界面修改单独保留。构建失败会保留上次成功预览。</p>
  <p id="source-status" role="status"></p><pre id="source-error" class="workflow-error" role="alert" hidden></pre><small id="source-last"></small>
  <div class="inline-controls"><button id="source-build" class="primary">立即构建</button><button id="source-cancel">取消构建</button><label><input id="source-auto" type="checkbox">保存源码自动同步</label></div>
  <details><summary>本机源码绑定</summary><select id="source-preset" aria-label="源码配方"></select>
  <form id="source-form" class="workflow-form"><label for="source-root">源码根目录</label><input id="source-root" required>
  <label for="source-program">构建程序</label><input id="source-program" required placeholder="node.exe 的完整路径">
  <label for="source-args">参数（每行一个，通用构建器留空）</label><textarea id="source-args" rows="5"></textarea>
  <label for="source-watch">监听文件或目录（相对于源码根目录，每行一个）</label><textarea id="source-watch" rows="5" required></textarea>
  <label for="source-mode">素材模式</label><select id="source-mode"><option value="local">本机制作 · 独立素材文件</option><option value="embedded">内嵌发行候选</option><option value="external">固定外链候选</option></select>
  <button type="submit">保存绑定</button></form><p class="panel-hint">本机路径与执行配置独立保存，不进入分享工程。输出、缓存和历史目录不参与监听。</p></details></div>`;
  document.body.append(dialog);
  async function load() {
    const response = await fetch('/api/build'), data = await response.json(); if (!response.ok) throw new Error(data.error);
    if (data.projectId !== getState().projectId) return;
    info = data; renderStatus();
  }
  async function write(route, body) {
    if (busy) return;
    busy = true; renderStatus();
    try {
      const state = getState();
      const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': getToken() }, body: JSON.stringify({ sessionId: state.sessionId, projectId: state.projectId, fingerprint: state.fingerprint, revision: state.revision, bindingVersion: info?.version || 0, ...body }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      info = data; renderStatus(); return data;
    } catch (e) { toast(e.message, true); await load(); throw e; }
    finally { busy = false; renderStatus(); }
  }
  function fill(config) {
    $('#source-root').value = config.root; $('#source-program').value = config.program;
    $('#source-args').value = config.args.join('\n'); $('#source-watch').value = config.watch.join('\n'); $('#source-mode').value = config.mode || 'local';
  }
  function renderStatus() {
    if (!dialog.isConnected) return;
    const status = info?.status || { state: 'unbound' };
    $('#source-status').textContent = stateNames[status.state] || status.state;
    $('#source-badge').textContent = ['failed', 'conflict', 'interrupted'].includes(status.state) ? '!' : status.state === 'running' ? '…' : '';
    $('#source-error').textContent = [status.error, ...(status.conflicts || []).map(c => `${c.name} · ${c.context}：${c.reason}`)].filter(Boolean).join('\n'); $('#source-error').hidden = !$('#source-error').textContent;
    $('#source-last').textContent = info?.lastSuccessful ? `上次成功：${new Date(info.lastSuccessful.completedAt).toLocaleString('zh-CN')} · revision ${info.lastSuccessful.revision}` : '尚无成功构建。';
    if (!busy) $('#source-auto').checked = info?.autoSync === true && !info?.paused;
    $('#source-auto').disabled = !info?.bound || busy; $('#source-build').disabled = !info?.bound || busy;
    $('#source-cancel').disabled = !info?.bound || busy || !['running', 'queued'].includes(status.state); $('#source-form button[type=submit]').disabled = busy;
  }
  button.addEventListener('click', async () => {
    try {
      await load(); if (info?.config) fill(info.config);
      presets = await (await fetch('/api/build/presets')).json();
      const select = $('#source-preset'); select.replaceChildren(new Option('选择源码配方填入配置', ''));
      for (const [i, preset] of presets.entries()) select.add(new Option(preset.name, String(i)));
      dialog.showModal();
    } catch (e) { toast(e.message, true); }
  });
  $('#source-preset').addEventListener('change', () => { const preset = presets[$('#source-preset').value]; if (preset) fill(preset.config); });
  $('#source-form').addEventListener('submit', e => {
    e.preventDefault(); const lines = selector => $(selector).value.split(/\r?\n/).filter(line => line.trim());
    write('/api/build/configure', { config: { root: $('#source-root').value, program: $('#source-program').value, args: lines('#source-args'), watch: lines('#source-watch'), mode: $('#source-mode').value }, autoSync: false }).then(() => toast('绑定已保存。可立即构建或打开自动同步。')).catch(() => {});
  });
  $('#source-build').addEventListener('click', () => write('/api/build/control', { action: 'build' }).catch(() => {}));
  $('#source-cancel').addEventListener('click', () => write('/api/build/control', { action: 'cancel' }).catch(() => {}));
  $('#source-auto').addEventListener('change', () => write('/api/build/control', { action: 'auto', enabled: $('#source-auto').checked }).catch(() => {}));
  return {
    render() { if (projectId !== getState().projectId) { projectId = getState().projectId; info = null; load().catch(e => toast(e.message, true)); } },
    events(events) { events.addEventListener('build', e => { const data = JSON.parse(e.data); if (data.projectId === getState().projectId) { info = data; renderStatus(); } }); events.addEventListener('open', () => load().catch(() => {})); },
  };
}
