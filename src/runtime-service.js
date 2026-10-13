import { mkdir, readFile, writeFile, readdir, unlink, realpath, lstat } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const runtimeHome = () => process.env.STUDIO_RUNTIME_HOME || path.join(os.homedir(), '.tavern-theme-studio', 'runtimes');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const idPattern = /^[a-f0-9-]{36}$/;
function validate(record) {
  if (record?.format !== 'tts-runtime-v1' || !idPattern.test(record.id) || !path.isAbsolute(record.root || '') ||
    !Number.isSafeInteger(record.pid) || record.pid < 1 || !/^[a-f0-9]{64}$/.test(record.token || '')) throw new Error('后台记录格式无效');
  const url = new URL(record.address);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('后台地址无效');
  return record;
}
const publicRecord = ({ token, ...record }) => record;
async function readRecord(home, id) {
  if (!idPattern.test(id || '')) throw new Error('后台 ID 无效');
  const file = path.join(home, `${id}.json`);
  if ((await lstat(file)).isSymbolicLink()) throw new Error('后台记录不能是链接');
  const record = validate(JSON.parse(await readFile(file, 'utf8')));
  if (record.id !== id) throw new Error('后台记录身份不匹配');
  return record;
}
async function probe(record) {
  const response = await fetch(new URL('/__tts_runtime/status', record.address), {
    headers: { 'X-Studio-Runtime': record.token }, signal: AbortSignal.timeout(2000), redirect: 'error',
  });
  if (!response.ok) throw new Error('后台没有通过身份核验');
  const actual = await response.json();
  if (actual.id !== record.id || actual.pid !== record.pid || actual.root !== record.root) throw new Error('后台身份已变化');
  return { ...publicRecord(record), ...actual, status: actual.closing ? 'closing' : 'running' };
}

// All createServer callers register here, including CLI and Agent test scripts.
// The registry spans copies of the program; control tokens never go to the UI.
export async function registerRuntime({ root, address, version, state, close, home = runtimeHome() }) {
  root = await realpath(root);
  await mkdir(home, { recursive: true, mode: 0o700 });
  if ((await lstat(home)).isSymbolicLink()) throw new Error('后台登记目录不能是链接');
  const record = { format: 'tts-runtime-v1', id: randomUUID(), root, pid: process.pid, address,
    version, startedAt: new Date().toISOString(), token: randomBytes(32).toString('hex') };
  const file = path.join(home, `${record.id}.json`);
  await writeFile(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  let closing = false;
  return {
    id: record.id,
    handle(req, res) {
      if (!req.url?.startsWith('/__tts_runtime/')) return false;
      const supplied = Buffer.from(String(req.headers['x-studio-runtime'] || ''));
      if (req.headers.origin || req.headers.host !== new URL(address).host || supplied.length !== record.token.length || !timingSafeEqual(supplied, Buffer.from(record.token))) {
        res.writeHead(403); res.end(); return true;
      }
      if (req.method === 'GET' && req.url === '/__tts_runtime/status') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...publicRecord(record), ...state(), closing }));
      } else if (req.method === 'POST' && req.url === '/__tts_runtime/stop') {
        closing = true; res.end('正在保存并关闭');
        setImmediate(() => close().catch(error => { closing = false; console.error('关闭工作台失败：', error.message); }));
      } else { res.writeHead(404); res.end(); }
      return true;
    },
    async dispose() {
      try { if ((await readRecord(home, record.id)).token === record.token) await unlink(file); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    },
  };
}

export async function listRuntimes({ home = runtimeHome(), root } = {}) {
  let files;
  try { files = await readdir(home, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const results = await Promise.all(files.filter(f => f.isFile() && idPattern.test(f.name.slice(0, -5)) && f.name.endsWith('.json')).map(async file => {
    let record;
    try {
      record = await readRecord(home, file.name.slice(0, -5));
      if (root && record.root !== root) return null;
      return await probe(record);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      if (!record) return { id: file.name.slice(0, -5), status: 'unverified', error: e.message };
      return { ...publicRecord(record), status: alive(record.pid) ? 'unverified' : 'stale', error: e.message };
    }
  }));
  return results.filter(Boolean).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

export async function stopRuntime(id, { home = runtimeHome(), timeoutMs = 30000 } = {}) {
  let record;
  try { record = await readRecord(home, id); } catch (e) { if (e.code === 'ENOENT') return { id, status: 'stopped' }; throw e; }
  await probe(record); // Never use a PID as authority to kill a process.
  const response = await fetch(new URL('/__tts_runtime/stop', record.address), { method: 'POST',
    headers: { 'X-Studio-Runtime': record.token }, signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('后台拒绝关闭请求');
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { await readRecord(home, id); } catch (e) { if (e.code === 'ENOENT') return { id, status: 'stopped' }; throw e; }
    if (Date.now() >= deadline) throw new Error('后台仍在保存或结束任务，请稍后刷新状态；没有强制终止进程');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function stopRuntimes({ home = runtimeHome(), root, ids, exclude } = {}) {
  const records = await listRuntimes({ home, root });
  const selected = records.filter(r => r.id !== exclude && (!ids || ids.includes(r.id)) && r.status !== 'stale');
  return Promise.all(selected.map(async record => {
    try { return { ...record, ...await stopRuntime(record.id, { home }) }; }
    catch (e) { return { ...record, status: 'failed', error: e.message }; }
  }));
}
