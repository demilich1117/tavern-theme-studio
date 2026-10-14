const node = (tag, text, className) => {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  return el;
};
export function attachRuntimeManager({ getToken, settled }) {
  const open = node('button', '后台管理'); open.id = 'runtime-open';
  document.querySelector('#tool-workspace').append(open);
  const dialog = node('dialog', '', 'wide-dialog'); dialog.id = 'runtime-dialog';
  const header = node('form', '', 'dialog-header'); header.method = 'dialog';
  const dismiss = node('button', '×'); dismiss.setAttribute('aria-label', '关闭后台管理');
  header.append(node('h2', '工作台后台'), dismiss);
  const body = node('div', '', 'dialog-body');
  const hint = node('p', '这里列出本机当前用户启动的工作台，包括 Agent 和命令行启动的实例。关闭会等待已接收的保存、结束后台任务并释放作品占用；酒馆本体保持运行。', 'panel-hint');
  const controls = node('div', '', 'inline-controls');
  const refresh = node('button', '刷新列表'), all = node('button', '关闭全部后台'); all.id = 'runtime-stop-all';
  controls.append(refresh, all);
  const status = node('p', '', 'panel-hint'); status.id = 'runtime-status'; status.setAttribute('role', 'status');
  const list = node('div', ''); list.id = 'runtime-list';
  body.append(hint, controls, status, list); dialog.append(header, body); document.body.append(dialog);
  let currentId, instances = [], busy = false, closing = false;
  function disabled(value) {
    busy = value;
    for (const button of body.querySelectorAll('button')) button.disabled = value || closing;
    all.disabled ||= !instances.length;
  }
  async function load() {
    disabled(true); status.textContent = '正在读取后台…';
    try {
      const response = await fetch('/api/instances');
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      currentId = data.currentId; instances = data.instances.filter(r => r.status !== 'stale'); list.replaceChildren();
      all.textContent = data.legacy.length ? '关闭全部已登记后台' : '关闭全部后台';
      status.textContent = `${instances.length} 个已登记后台${data.legacy.length ? `，另有 ${data.legacy.length} 个旧后台需要检查` : ''}。关闭全部包含当前工作台。`;
      for (const row of instances) {
        const card = node('section', '', 'runtime-card');
        card.append(node('h3', `${row.name || '无法核验的后台'}${row.id === currentId ? ' · 当前工作台' : ''}`));
        const meta = node('dl', '', 'setup-status');
        for (const [label, value] of [
          ['运行状态', ({ running: '运行中', closing: '正在关闭', unverified: '无法核验' })[row.status] || row.status],
          ['连接地址', `${row.address || '未知'} · PID ${row.pid || '?'}`], ['作品目录', row.dataDir || '无法读取'],
          ['程序目录', row.root || '无法读取'], ['启动时间', row.startedAt ? new Date(row.startedAt).toLocaleString() : '未知'],
        ]) meta.append(node('dt', label), node('dd', value));
        card.append(meta);
        if (row.error) card.append(node('p', row.error, 'panel-hint'));
        const stop = node('button', row.id === currentId ? '关闭当前后台' : '关闭此后台');
        stop.addEventListener('click', () => stopSelected([row.id])); card.append(stop); list.append(card);
      }
      for (const row of data.legacy) {
        const card = node('section', '', 'runtime-card');
        card.append(node('h3', `旧后台 · PID ${row.pid}`), node('p', `${row.address} · ${row.dataDir}`), node('p', row.error, 'panel-hint')); list.append(card);
      }
    } catch (error) { status.textContent = `无法读取：${error.message}。也可以双击程序目录的 manage.cmd 查看。`; }
    finally { disabled(false); }
  }
  async function stopSelected(ids) {
    if (busy || closing) return;
    disabled(true); status.textContent = '正在等待保存、结束后台任务并释放作品占用…';
    try {
      await settled();
      const response = await fetch('/api/instances/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': getToken() }, body: JSON.stringify({ ids }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const failures = data.results.filter(r => r.status === 'failed');
      if (data.currentStopping) stopping();
      else { await load(); status.textContent = failures.length ? failures.map(r => `${r.name || r.id}：${r.error}`).join('；') : '所选后台已关闭，作品占用已释放。'; }
    } catch (error) { status.textContent = `关闭未完成：${error.message}。请刷新，或双击 manage.cmd 检查。`; }
    finally { disabled(false); }
  }
  function stopping() {
    closing = true; disabled(true);
    if (!dialog.open) { for (const other of document.querySelectorAll('dialog:modal')) other.close(); dialog.showModal(); }
    status.textContent = '当前后台正在关闭。此页面已停止编辑；需要继续时请双击 start.cmd。可通过 manage.cmd 确认后台已结束。';
  }
  open.addEventListener('click', () => { dialog.showModal(); if (!closing) load(); });
  refresh.addEventListener('click', load);
  all.addEventListener('click', () => stopSelected(instances.map(r => r.id)));
  return { stopping };
}
