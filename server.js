import http from 'node:http';
import { readFile, mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { ProjectHistory, createProject, exportTheme } from './shared/core.js';
import { scanVariables } from './shared/variables.js';
import { diffProjects } from './shared/diff.js';
import { createAssetStore, MAX_ASSET_BYTES, MAX_IMPORT_BYTES } from './asset-store.js';
import { resolveAssetUrls } from './shared/assets.js';
import { createTicketStore } from './ticket-store.js';
import { validateAnchor, ticketText } from './shared/tickets.js';
import { migrateStorage, projectFingerprint, atomicJson } from './storage-migrations.js';
import { createBuildService, sourceFingerprint } from './build-service.js';
import { validateProject } from './shared/core.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.zip': 'application/zip' };
export async function createServer({ dataDir = path.join(root, '.local'), port = 19321 } = {}) {
  await mkdir(dataDir, { recursive: true });
  const migration = await migrateStorage(dataDir);
  let history = new ProjectHistory(migration.project);
  const sessionId = randomUUID();
  let builds;
  const view = () => ({ ...history.snapshot(), sessionId, projectId: history.project.projectId, fingerprint: projectFingerprint(history.project), sourceBound: builds?.status().bound === true, capabilities: { projectSchema: 3, stableBindings: true, sourceBuild: 1 }, migrationRecovery: migration.recovery });
  function checkBasis(input) {
    if (!input.sessionId || !input.fingerprint || !input.projectId) throw Object.assign(new Error('需要 v3 会话、工程 ID 与指纹；请更新工作台/CLI 并重新读取工程。'), { status: 428 });
    if (input.sessionId !== sessionId || input.projectId !== history.project.projectId || input.fingerprint !== projectFingerprint(history.project) || input.revision !== history.revision) throw Object.assign(new Error('工程或服务会话已更新，请重新读取后核对修改。'), { status: 409 });
  }
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
  const basis = () => ({ name: history.project.name, projectId: history.project.projectId, sessionId, revision: history.revision, fingerprint: projectFingerprint(history.project) });
  const broadcast = (name, value) => { for (const client of events) client.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`); };
  async function body(req, max) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > max) throw Object.assign(new Error(`请求超过 ${max / 1024 / 1024} MiB 上限。请拆分素材或使用图片直链。`), { status: 413 }); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function saveSnapshot(name) {
    const id = randomBytes(16).toString('hex');
    const saved = { id, name, createdAt: new Date().toISOString(), ...basis(), project: history.snapshot().project };
    saved.name = name;
    await mkdir(snapshotDir, { recursive: true });
    const file = path.join(snapshotDir, `${id}.json`);
    await writeFile(file + '.tmp', JSON.stringify(saved, null, 2)); await rename(file + '.tmp', file);
    return { id, name, createdAt: saved.createdAt };
  }
  async function persist(candidate) {
    await atomicJson(path.join(dataDir, 'project.json'), candidate.project);
  }
  builds = await createBuildService({
    dataDir, getProjectId: () => history.project.projectId, publish: value => broadcast('build', value),
    commit: build => enqueue(async () => {
      const assertCurrent = async () => {
        if (!build.current() || build.projectId !== history.project.projectId || await sourceFingerprint(build.config, dataDir) !== build.fingerprint) throw Object.assign(new Error('候选对应旧源码或旧工程，已丢弃迟到结果。'), { status: 409 });
      };
      await assertCurrent();
      for (const asset of build.assets) {
        const bytes = await readFile(asset.candidatePath);
        const saved = await assets.put(bytes, asset.name);
        if (saved.id !== asset.id) throw new Error(`候选素材在提交前发生变化：${asset.name}`);
      }
      const resolved = await assets.command({ type: 'source-refresh', theme: build.theme }, history.project);
      const candidate = new ProjectHistory(history.project);
      candidate.past = [...history.past]; candidate.future = [...history.future]; candidate.revision = history.revision;
      candidate.execute(resolved, history.revision);
      candidate.project.assetRefs = [...new Map([...history.project.assetRefs, ...build.assetRefs].map(a => [a.reference, structuredClone(a)])).values()];
      candidate.project = validateProject(candidate.project);
      // A changed manifest also forms one undo entry, even if authored CSS is identical.
      if (candidate.revision === history.revision && JSON.stringify(candidate.project) !== JSON.stringify(history.project)) {
        candidate.past.push(history.project); candidate.future = []; candidate.revision++;
      }
      await assertCurrent(); await persist(candidate); history = candidate;
      const result = view(); for (const client of events) client.write(`data: ${JSON.stringify(result)}\n\n`);
      broadcast('assets', { changed: true }); return result;
    }),
  });
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
      if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { token, ...view() });
      if (req.method === 'GET' && url.pathname === '/api/project') return send(res, 200, view());
      if (req.method === 'GET' && url.pathname === '/api/handoff-context') return send(res, 200, { current: basis(), address: origin, studioPath: root, projectPath: builds.status().config?.root || root, version: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version });
      if (req.method === 'GET' && url.pathname === '/api/build') return send(res, 200, builds.status());
      if (req.method === 'GET' && url.pathname === '/api/build/presets') {
        const presets = [];
        for (const entry of await readdir(path.join(root, 'examples'), { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          try {
            const preset = JSON.parse(await readFile(path.join(root, 'examples', entry.name, 'studio.build.json'), 'utf8'));
            if (preset.schemaVersion === 1) presets.push({ name: preset.name, config: { ...preset.config, root: path.resolve(root, preset.config.root), program: preset.config.program === '$NODE' ? process.execPath : preset.config.program } });
          } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
        return send(res, 200, presets);
      }
      if (req.method === 'POST' && ['/api/build/configure', '/api/build/control'].includes(url.pathname)) {
        if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
        const input = JSON.parse((await body(req, 32 * 1024)).toString('utf8'));
        return send(res, 200, await enqueue(async () => {
          checkBasis(input);
          if (input.bindingVersion !== builds.status().version) throw Object.assign(new Error('源码绑定已更新，请重新读取构建状态。'), { status: 409 });
          return url.pathname === '/api/build/configure' ? builds.configure(input.config, input.autoSync) : builds.control(input.action, input.enabled);
        }));
      }
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
            checkBasis(input);
            validateAnchor(input.anchor); ticketText(input.comment, 4000, '修改意见');
            const snapshot = await saveSnapshot(`标注 #${tickets.list().length + 1} · ${input.comment.slice(0, 48)}`);
            return tickets.create(input, { ...basis(), snapshotId: snapshot.id });
          }
          checkBasis(input);
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
        res.write(`data: ${JSON.stringify(view())}\n\n`);
        events.add(res);
        req.on('close', () => events.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/commands') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
        const input = JSON.parse((await body(req, MAX_IMPORT_BYTES)).toString('utf8'));
        const { command, revision } = input;
        const work = async () => {
          checkBasis(input);
          if (command?.type === 'snapshot-save') {
            if (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 120) throw new Error('快照名称需为 1–120 字。');
            return { ...view(), snapshotCreated: await saveSnapshot(command.name.trim()) };
          }
          const restored = command?.type === 'snapshot-restore' ? { type: 'import-project', project: (await readSnapshot(command.id)).project } : command;
          const resolved = await assets.command(restored, history.project);
          const candidate = new ProjectHistory(history.project);
          candidate.past = [...history.past]; candidate.future = [...history.future]; candidate.revision = history.revision;
          candidate.execute(resolved, revision);
          if (command.type === 'snapshot-restore' || (['undo', 'redo'].includes(command.type) && history.project.baseTheme.custom_css !== candidate.project.baseTheme.custom_css)) await builds.pause();
          await persist(candidate);
          history = candidate;
          await builds.activate().catch(e => broadcast('build', { ...builds.status(), status: { state: 'failed', error: e.message } }));
          const result = view();
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
    } catch (e) { if (!res.headersSent) send(res, e.status || (e.code === 'ENOENT' ? 404 : 400), { error: e.message, ...(e.conflicts && { conflicts: e.conflicts }) }); else res.end(); }
  });
  server.on('close', () => { for (const client of events) client.end(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  await writeFile(path.join(dataDir, 'runtime.json'), JSON.stringify({ address, pid: process.pid }));
  await builds.activate();
  return { server, address, close: async () => { await builds.close(); for (const client of events) client.end(); return new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createServer({ port: Number(process.env.STUDIO_PORT || 19321) });
  console.log(`Tavern Theme Studio: ${app.address}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
