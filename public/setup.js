const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
export function attachSetup(getConnection) {
  const open = node('button', '连接诊断'); open.id = 'setup-open';
  open.addEventListener('click', () => document.querySelector('#connect-dialog').showModal());
  document.querySelector('.studio-tools').append(open);
  const button = node('button', '检查连接与版本'); button.id = 'setup-check';
  const result = node('div', ''); result.id = 'setup-result'; result.setAttribute('aria-live', 'polite');
  document.querySelector('#connect-dialog .dialog-body').append(button, result);
  button.addEventListener('click', async () => {
    button.disabled = true; result.textContent = '正在检查…';
    try {
      const response = await fetch('/api/health'); if (!response.ok) throw new Error('本机服务不可用，请运行 npm run doctor 检查。');
      const service = await response.json(), connection = getConnection();
      const rows = [
        ['本机服务', `${service.version} · Node ${service.node} · 数据目录已独占`],
        ['真实酒馆', connection.ready && connection.live ? '已连接' : '未连接；请在酒馆扩展中打开工作台'],
        ['连接器', connection.ready && connection.live ? `${connection.capabilities?.connectorVersion || '旧版未报告版本'} · 工程协议 v${connection.capabilities?.projectSchema || '?'}` : '尚未检测'],
        ['画布功能', !connection.ready ? '等待预览连接' : connection.capabilities?.canvasEditor === 1 && connection.capabilities?.canvasWorkflow === 1 ? '已加载' : '当前标签尚未加载，请更新连接器并刷新整个酒馆标签'],
        ['测试对话', connection.fixture],
        ['源码同步', service.sourceBound ? '已绑定；详见源码面板' : '可选：尚未绑定'],
        ['本机 CLI', service.runner.configured ? '已配置；实际验证状态见小票中的 CLI 面板' : '可选：未配置。复制交接仍可直接使用'],
      ];
      const list = node('dl', ''); list.className = 'setup-status';
      for (const [label, value] of rows) list.append(node('dt', label), node('dd', value)); result.replaceChildren(list);
    } catch (e) { result.textContent = e.message; }
    finally { button.disabled = false; }
  });
}
