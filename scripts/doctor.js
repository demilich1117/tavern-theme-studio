import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { STUDIO_VERSION } from '../shared/version.js';
const root = path.resolve(import.meta.dirname, '..'), checks = [];
checks.push({ name: 'Node.js', status: Number(process.versions.node.split('.')[0]) >= 22 ? 'passed' : 'failed', detail: process.version + '（需要 >=22）' });
try { await import('css-tree'); checks.push({ name: '运行依赖', status: 'passed', detail: '已安装' }); }
catch { checks.push({ name: '运行依赖', status: 'failed', detail: '运行 npm ci --omit=dev' }); }
try { await access(path.join(root, 'dist/tavern-theme-studio-connector.zip')); checks.push({ name: '连接器包', status: 'passed', detail: '已生成；实际安装版本请在工作台「连接诊断」查看' }); }
catch { checks.push({ name: '连接器包', status: 'optional', detail: '运行 npm run package:connector 后安装到酒馆用户扩展目录' }); }
const candidates = new Set(process.env.STUDIO_URL ? [process.env.STUDIO_URL] : []);
if (!candidates.size) for (const folder of ['.local/native-lab', '.local']) {
  try { candidates.add(JSON.parse(await readFile(path.join(root, folder, 'runtime.json'), 'utf8')).address); } catch {}
}
if (!candidates.size) candidates.add('http://127.0.0.1:19323');
for (const address of candidates) {
  try {
    const response = await fetch(new URL('/api/health', address), { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('服务未提供诊断接口，可能仍在运行旧版');
    const health = await response.json();
    checks.push({ name: '本机工作台', status: health.version === STUDIO_VERSION ? 'passed' : 'warning', detail: `${address} · ${health.version} · 工程 ${health.projectId}` });
  } catch (e) { checks.push({ name: '本机工作台', status: 'warning', detail: `${address}：${e.message}。首次使用运行 npm run lab。` }); }
}
console.log(JSON.stringify({ version: STUDIO_VERSION, checks, next: '在酒馆的专用测试标签连接工作台，点击「已连接 / 连接酒馆 → 检查连接与版本」，核对真实连接器和测试对话。Source Hub 与本机 CLI 均为可选。' }, null, 2));
if (checks.some(c => c.status === 'failed')) process.exitCode = 1;
