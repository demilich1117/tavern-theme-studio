import http from 'node:http';
import { readFile, writeFile, mkdir, unlink, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { exists } from './install-service.js';

const recordPath = root => path.join(root, '.local/launcher.json');
export async function readLauncher(root) {
  if (!await exists(recordPath(root))) return null;
  const saved = JSON.parse(await readFile(recordPath(root), 'utf8'));
  if (saved.root !== await realpath(root) || !Number.isSafeInteger(saved.pid) || saved.pid < 1 || !/^[a-f0-9]{64}$/.test(saved.token || '')) throw new Error('启动记录与程序目录不匹配。');
  const address = new URL(saved.address);
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.pathname !== '/' || address.username || address.password || address.search || address.hash) throw new Error('启动记录地址无效。');
  try {
    const response = await fetch(new URL('/status', address), { headers: { 'X-Studio-Launcher': saved.token }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('启动记录与正在运行的服务不匹配。');
    const actual = await response.json();
    if (actual.pid !== saved.pid || actual.root !== saved.root) throw new Error('启动记录与正在运行的服务不匹配。');
    return { ...saved, ...actual };
  } catch (e) {
    try { process.kill(saved.pid, 0); } catch (processError) { if (processError.code === 'ESRCH') return null; }
    throw new Error(`无法核对已有工作台，请关闭它的启动窗口后重试：${e.message}`);
  }
}
export async function stopLauncher(root) {
  const saved = await readLauncher(root); if (!saved) return false;
  const response = await fetch(new URL('/stop', saved.address), { method: 'POST', headers: { 'X-Studio-Launcher': saved.token }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('工作台未接受停止请求，未替换文件。');
  const deadline = Date.now() + 30000;
  while (await exists(recordPath(root))) {
    if (Date.now() > deadline) throw new Error('工作台仍在保存或结束任务，稍后再点更新；未替换文件。');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return true;
}
export async function manageLauncher({ root, app, url, version }) {
  root = await realpath(root);
  const token = randomBytes(32).toString('hex'); let closing, cleanupPromise;
  const info = { root, pid: process.pid, url, version };
  const server = http.createServer((req, res) => {
    const supplied = Buffer.from(String(req.headers['x-studio-launcher'] || ''));
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${server.address().port}` || supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) { res.writeHead(403); res.end(); return; }
    if (req.method === 'GET' && req.url === '/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(info)); return; }
    if (req.method === 'POST' && req.url === '/stop') { res.end('正在保存并关闭'); setImmediate(() => close().catch(error => console.error(error.message))); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const record = { ...info, token, address: `http://127.0.0.1:${server.address().port}` };
  try {
    await mkdir(path.dirname(recordPath(root)), { recursive: true });
    const temporary = recordPath(root) + '.' + token + '.tmp';
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    await rename(temporary, recordPath(root));
  } catch (e) { await new Promise(resolve => server.close(resolve)); throw e; }
  function cleanup() { return cleanupPromise ||= (async () => {
    await new Promise(resolve => server.close(resolve));
    try { if (JSON.parse(await readFile(recordPath(root), 'utf8')).token === token) await unlink(recordPath(root)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  })(); }
  app.onClose?.(cleanup);
  function close() { return closing ||= (async () => { await app.close(); await cleanup(); })(); }
  return { close, record };
}

// Legacy manual starts have no launcher control channel. Never terminate an
// arbitrary PID or overwrite modules still in use by such an instance.
export async function requireStopped(directories) {
  for (const directory of new Set(directories)) {
    let file = path.join(directory, '.studio-lock/owner.json');
    if (!await exists(file)) file = path.join(directory, 'runtime.json');
    if (!await exists(file)) continue;
    const owner = JSON.parse(await readFile(file, 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('工作台运行记录异常，请先检查原启动窗口。');
    try { process.kill(owner.pid, 0); }
    catch (e) { if (e.code === 'ESRCH') continue; throw e; }
    throw new Error('这次运行由旧版或命令行启动，请先关闭原工作台窗口，再双击更新。以后通过 start.cmd 启动即可自动重启。');
  }
}
