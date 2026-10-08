import http from 'node:http';
import { readFile, mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { ProjectHistory, createProject, exportTheme } from './shared/core.js';
import { scanVariables } from './shared/variables.js';
import { diffProjects } from './shared/diff.js';
import { createAssetStore, MAX_ASSET_BYTES, MAX_IMPORT_BYTES } from './asset-store.js';
import { resolveAssetUrls } from './shared/assets.js';
import { createTicketStore } from './ticket-store.js';
import { validateAnchor, ticketText } from './shared/tickets.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.zip': 'application/zip' };
export async function createServer({ dataDir = path.join(root, '.local'), port = 19321 } = {}) {
  await mkdir(dataDir, { recursive: true });
  let initial = createProject();
  try { initial = JSON.parse(await readFile(path.join(dataDir, 'project.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`工程读取失败；原文件已保留：${e.message}`); }
  let history = new ProjectHistory(initial);
  const assets = await createAssetStore(dataDir), tickets = await createTicketStore(dataDir);
  const snapshotDir = path.join(dataDir, 'snapshots');
  const snapshotPattern = /^[a-f0-9]{32}$/;
  async function readSnapshot(id) {
    if (typeof id !== 'string' || !snapshotPattern.test(id)) throw new Error('快照编号无效。');
    return JSON.parse(await readFile(path.join(snapshotDir, `${id}.json`), 'utf8'));
  }
  async function snapshots() {
    let files; try { files = await readdir(snapshotDir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const items = await Promise.all(files.filter(f => /^[a-f0-9]{32}\.json$/.test(f)).map(async f => {
      const { id, name, createdAt, revision } = await readSnapshot(f.slice(0, -5)); return { id, name, createdAt, revision };
    }));
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const token = randomBytes(32).toString('hex');
  const events = new Set();
  let queue = Promise.resolve();
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const enqueue = work => { const task = queue.then(work); queue = task.catch(() => {}); return task; };
  const basis = () => ({ name: history.project.name, revision: history.revision, fingerprint: createHash('sha256').update(JSON.stringify(history.project)).digest('hex') });
  const broadcast = (name, value) => { for (const client of events) client.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`); };
  async function body(req, max) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > max) throw Object.assign(new Error(`请求超过 ${max / 1024 / 1024} MiB 上限。请拆分素材或使用图片直链。`), { status: 413 }); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function saveSnapshot(name) {
    const id = randomBytes(16).toString('hex');
    const saved = { id, name, createdAt: new Date().toISOString(), revision: history.revision, project: history.snapshot().project };
    await mkdir(snapshotDir, { recursive: true });
    const file = path.join(snapshotDir, `${id}.json`);
    await writeFile(file + '.tmp', JSON.stringify(saved, null, 2)); await rename(file + '.tmp', file);
    return { id, name, createdAt: saved.createdAt };
  }
  async function persist(candidate) {
    const file = path.join(dataDir, 'project.json');
    await writeFile(file + '.tmp', JSON.stringify(candidate.project, null, 2));
    await rename(file + '.tmp', file);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const allowed = new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);
      if (!allowed.has(req.headers.host)) return send(res, 403, { error: 'Host rejected' });
      const origin = `http://${req.headers.host}`;
      const publicImage = req.method === 'GET' && /^\/assets\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(req.url);
      if (!publicImage && req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: 'Origin rejected' });
      if (req.headers['sec-fetch-site'] === 'cross-site' && req.url.startsWith('/api/')) return send(res, 403, { error: 'Cross-site request rejected' });
      const url = new URL(req.url, origin);
      if (req.method === 'POST') {
        const supplied = Buffer.from(String(req.headers['x-studio-token'] || ''));
        if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return send(res, 403, { error: 'Token rejected' });
      }
      if (publicImage) {
        const asset = await assets.read(url.pathname.slice('/assets/'.length));
        res.writeHead(200, { 'Content-Type': asset.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' });
        return res.end(asset.bytes);
      }
      if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { token, ...history.snapshot() });
      if (req.method === 'GET' && url.pathname === '/api/project') return send(res, 200, history.snapshot());
      if (req.method === 'GET' && url.pathname === '/api/theme') {
        const theme = exportTheme(history.project);
        theme.custom_css = url.searchParams.get('mode') === 'linked' ? resolveAssetUrls(theme.custom_css, origin) : await assets.embed(theme.custom_css);
        return send(res, 200, theme);
      }
      if (req.method === 'GET' && url.pathname === '/api/backup') return send(res, 200, await assets.portableProject(history.project));
      if (req.method === 'GET' && url.pathname === '/api/assets') return send(res, 200, assets.list());
      if (req.method === 'GET' && url.pathname === '/api/tickets') return send(res, 200, tickets.list());
      if (req.method === 'GET' && /^\/api\/tickets\/[a-f0-9]{32}$/.test(url.pathname)) {
        const ticket = tickets.list().find(t => t.id === url.pathname.split('/').at(-1));
        return send(res, ticket ? 200 : 404, ticket || { error: '小票不存在。' });
      }
      if (req.method === 'POST' && url.pathname === '/api/assets') {
        const bytes = await body(req, MAX_ASSET_BYTES);
        const asset = await enqueue(() => assets.put(bytes, url.searchParams.get('name') || '上传的装饰'));
        broadcast('assets', { changed: true }); return send(res, 201, asset);
      }
      if (req.method === 'POST' && (url.pathname === '/api/assets/link' || url.pathname === '/api/tickets' || /^\/api\/tickets\/[a-f0-9]{32}$/.test(url.pathname))) {
        if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
        const input = JSON.parse((await body(req, 32 * 1024)).toString('utf8'));
        const result = await enqueue(async () => {
          if (url.pathname === '/api/assets/link') return assets.external(input.url, input.name);
          if (url.pathname === '/api/tickets') {
            if (input.revision !== history.revision) throw Object.assign(new Error('工程已更新，请重新标注。'), { status: 409 });
            validateAnchor(input.anchor); ticketText(input.comment, 4000, '修改意见');
            const snapshot = await saveSnapshot(`标注 #${tickets.list().length + 1} · ${input.comment.slice(0, 48)}`);
            return tickets.create(input, { ...basis(), snapshotId: snapshot.id });
          }
          return tickets.update(url.pathname.split('/').at(-1), input, basis());
        });
        broadcast(url.pathname.startsWith('/api/tickets') ? 'tickets' : 'assets', { changed: true });
        return send(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/variables') return send(res, 200, scanVariables(history.project.baseTheme.custom_css || '').map(v => ({ ...v, current: history.project.variableEdits[v.id] ?? v.value })));
      if (req.method === 'GET' && url.pathname === '/api/snapshots') return send(res, 200, await snapshots());
      if (req.method === 'GET' && url.pathname.startsWith('/api/snapshots/')) {
        const saved = await readSnapshot(url.pathname.slice('/api/snapshots/'.length));
        return send(res, 200, { ...saved, changes: diffProjects(saved.project, history.project) });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(history.snapshot())}\n\n`);
        events.add(res);
        req.on('close', () => events.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/commands') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
        const { command, revision } = JSON.parse((await body(req, MAX_IMPORT_BYTES)).toString('utf8'));
        const work = async () => {
          if (revision !== history.revision) { const e = new Error('工程已被另一处更新，请刷新后重试。'); e.status = 409; throw e; }
          if (command?.type === 'snapshot-save') {
            if (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 120) throw new Error('快照名称需为 1–120 字。');
            return { ...history.snapshot(), snapshotCreated: await saveSnapshot(command.name.trim()) };
          }
          const restored = command?.type === 'snapshot-restore' ? { type: 'import-project', project: (await readSnapshot(command.id)).project } : command;
          const resolved = await assets.command(restored, history.project);
          const candidate = new ProjectHistory(history.project);
          candidate.past = [...history.past]; candidate.future = [...history.future]; candidate.revision = history.revision;
          const result = candidate.execute(resolved, revision);
          await persist(candidate);
          history = candidate;
          for (const client of events) client.write(`data: ${JSON.stringify(result)}\n\n`);
          return result;
        };
        return send(res, 200, await enqueue(work));
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      let relative;
      if (url.pathname.startsWith('/shared/')) relative = url.pathname.slice(1);
      else if (url.pathname.startsWith('/connector/')) relative = url.pathname.slice(1);
      else if (url.pathname === '/connector.zip') relative = 'dist/tavern-theme-studio-connector.zip';
      else relative = 'public/' + (url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
      const file = path.resolve(root, relative);
      const safe = ['public', 'shared', 'connector', 'dist'].some(dir => file.startsWith(path.join(root, dir) + path.sep));
      if (!safe || !types[path.extname(file)]) return send(res, 404, { error: 'Not found' });
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] }); res.end(content);
    } catch (e) { if (!res.headersSent) send(res, e.status || (e.code === 'ENOENT' ? 404 : 400), { error: e.message }); else res.end(); }
  });
  server.on('close', () => { for (const client of events) client.end(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  await writeFile(path.join(dataDir, 'runtime.json'), JSON.stringify({ address, pid: process.pid }));
  return { server, address, close: () => { for (const client of events) client.end(); return new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createServer({ port: Number(process.env.STUDIO_PORT || 19321) });
  console.log(`Tavern Theme Studio: ${app.address}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
