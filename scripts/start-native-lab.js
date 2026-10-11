import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from '../server.js';
import { resolveDataDirectory } from '../work-location.js';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = await resolveDataDirectory();
const seedPath = process.argv[2];
let app;
try { app = await createServer({ dataDir, seedPath, port: Number(process.env.STUDIO_PORT || 19323) }); }
catch (error) {
  if (error.code !== 'STUDIO_DATA_LOCKED') throw error;
  try {
    const runtime = JSON.parse(await readFile(path.join(dataDir, 'runtime.json'), 'utf8'));
    const owner = JSON.parse(await readFile(path.join(dataDir, '.studio-lock/owner.json'), 'utf8'));
    if (runtime.pid !== owner.pid || runtime.lockNonce !== owner.nonce) throw error;
    const address = new URL(runtime.address);
    if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.pathname !== '/') throw error;
    const response = await fetch(new URL('/api/project', address), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw error;
    const current = await response.json();
    if (!current.projectId || current.dataDir !== await realpath(dataDir)) throw error;
    app = { address: runtime.address, close: async () => {} };
    console.log('已有工作台正在运行，继续使用同一个工程。需要升级服务时，请先关闭旧进程再启动。');
  } catch { throw error; }
}
const host = new URL(process.env.TAVERN_URL || 'http://127.0.0.1:8000');
host.hash = new URLSearchParams({ 'tts-lab': '', studio: app.address }).toString();
console.log(`Native test workbench: ${host.href}\nStudio API: ${app.address}\nProject: ${dataDir}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
