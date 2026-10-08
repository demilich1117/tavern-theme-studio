export function attachRunner({ api, getIds, reportError }) {
  const node = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  const panel = node('details'); panel.append(node('summary', '通用本机 CLI · 可选自动启动'));
  const state = node('p'), config = node('textarea'), save = node('button', '保存本机配置'), start = node('button', '启动处理所选小票'), refresh = node('button', '刷新执行状态'), list = node('div');
  config.rows = 8; config.setAttribute('aria-label', 'CLI JSON 配置'); config.placeholder = '{"program":"程序绝对路径","cwd":"项目绝对路径","args":[],"input":"stdin","timeoutMs":1800000,"heartbeatMs":120000}';
  panel.append(state, node('p', '复制交接始终可用。CLI 需实现文档中的 JSON 输入和逐行输出协议。成功退出不代表小票已验收；源码修改沿用自动构建。'), config, save, start, refresh, list);
  document.querySelector('#tickets-dialog .dialog-body').prepend(panel);
  let info;
  const run = fn => async () => { try { await fn(); } catch (e) { reportError(e); } };
  async function load() { info = await api('/api/runner'); render(); }
  async function write(body) { await api('/api/runner', body); await load(); }
  function render() {
    state.textContent = !info.config ? '未配置 CLI；请继续使用复制给 Agent。' : info.verified ? '此配置已完成协议任务；模型能力与视觉验证以任务结果为准。' : '已配置，尚未通过实际协议任务验证。';
    if (document.activeElement !== config) config.value = JSON.stringify(info.config, null, 2);
    list.replaceChildren();
    for (const t of info.tasks.toReversed()) { const row = node('article'); row.append(node('b', `${t.state} · ${t.id}`), node('p', t.error || t.result?.summary || ''), node('pre', info.activeProgress?.id === t.id ? info.activeProgress.log : t.log || ''));
      if (t.state !== 'succeeded') { const button = node('button', ['queued', 'running'].includes(t.state) ? '取消任务' : '核对后重试'); button.onclick = run(() => write({ action: ['queued', 'running'].includes(t.state) ? 'cancel' : 'retry', id: t.id })); row.append(button); } list.append(row); }
  }
  save.onclick = run(() => write({ action: 'configure', version: info.version, config: JSON.parse(config.value) }));
  start.onclick = run(() => write({ action: 'start', ids: getIds() })); refresh.onclick = run(load);
  panel.addEventListener('toggle', () => { if (panel.open) load().catch(reportError); });
  setInterval(() => { if (panel.open && document.querySelector('#tickets-dialog').open) load().catch(reportError); }, 3000);
}
