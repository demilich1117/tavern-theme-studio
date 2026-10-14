// Shared by the launcher and connector so every entry opens the same workspace.
export function workspaceUrl(hostAddress, studioAddress, pageAddress) {
  const host = new URL(hostAddress), studio = new URL(studioAddress);
  if (!['http:', 'https:'].includes(host.protocol) || host.username || host.password) throw new Error('酒馆地址无效。');
  if (studio.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(studio.hostname) || studio.username || studio.password) throw new Error('请使用本机 HTTP 工作台地址。');
  const page = new URL(pageAddress || '/scripts/extensions/third-party/tavern-theme-studio-connector/connector/responsive.html', host);
  if (page.origin !== host.origin || !page.pathname.endsWith('/connector/responsive.html')) throw new Error('设计工作台必须使用当前酒馆。');
  page.search = '';
  page.hash = new URLSearchParams({ studio: studio.origin, host: host.pathname }).toString();
  return page.href;
}
