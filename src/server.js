import http from 'node:http';
import { readFile, mkdir, writeFile, rename, readdir, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { ProjectHistory, createProject, exportTheme, validateTheme } from '../shared/core.js';
import { scanVariables } from '../shared/variables.js';
import { diffProjects } from '../shared/diff.js';
import { createAssetStore, MAX_ASSET_BYTES, MAX_IMPORT_BYTES } from './asset-store.js';
import { resolveAssetUrls } from '../shared/assets.js';
import { createTicketStore } from './ticket-store.js';
import { validateAnchor, ticketText } from '../shared/tickets.js';
import { migrateStorage, projectFingerprint, atomicJson } from './storage-migrations.js';
import { createBuildService, sourceFingerprint } from './build-service.js';
import { validateProject } from '../shared/core.js';
import { createHubClient } from './hub-client.js';
import { captureLocation, locationStatus } from '../shared/ticket-location.js';
import { createRunner } from './runner-service.js';
import { publicReceipt, formatAgentHandoff } from '../shared/handoff.js';
import { createExportService, referenceIndex } from './export-service.js';
import { createVariants } from './asset-variants.js';
import { acquireDataLock } from './data-lock.js';
import { readArtifact, reviewEvidence } from './ticket-review.js';
import { STUDIO_VERSION } from '../shared/version.js';
import { analyzeTheme, analysisHandoff } from './theme-analysis.js';
import { rewriteVariables } from '../shared/variables.js';
import { compileOverrides } from '../shared/core.js';
import { createArtworkService } from './artwork-service.js';
import { readManagedWork, workPointer, studioRoot } from './work-location.js';
import { createWorkLibrary } from './work-library.js';
import { starterTheme } from '../shared/starter.js';
import { registerRuntime, listRuntimes, stopRuntimes, runtimeHome as defaultRuntimeHome } from './runtime-service.js';
import { findLegacyRuntimes } from './legacy-runtime.js';

const root = studioRoot;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.zip': 'application/zip' };
export async function createServer({ dataDir = path.join(root, '.local'), port = 19321, seedPath, artworkHome, folderOpener, workHome, pointer = workPointer, runtimeHome = defaultRuntimeHome() } = {}) {
  // The one-click launcher owns this lock in the same process during startup.
  let maintenance;
  try { maintenance = JSON.parse(await readFile(path.join(root, '.local/maintenance/.studio-lock/owner.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (maintenance && maintenance.pid !== process.pid) await requireMaintenanceIdle(maintenance);
  let active, switching = false, shuttingDown = false, switchFinished = Promise.resolve();
  let runtime, app;
  const closeListeners = new Set();
  const retired = new Map();
  const server = http.createServer((req, res) => {
    if (runtime?.handle(req, res)) return;
    if (!active || shuttingDown) { res.writeHead(503); res.end('工作台正在启动或关闭'); return; }
    active.handle(req, res);
  });
  let library;
  const runtimeControl = {
    async list() {
      const instances = await listRuntimes({ home: runtimeHome });
      return { currentId: runtime?.id, instances, legacy: await findLegacyRuntimes(root, instances) };
    },
    async stop(ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) throw new Error('请选择要关闭的后台');
      const results = await stopRuntimes({ home: runtimeHome, ids, exclude: runtime.id });
      const currentStopping = ids.includes(runtime.id) && !results.some(r => r.status === 'failed');
      return { results, currentStopping };
    },
    closeCurrent() { setImmediate(() => app.close().catch(error => console.error('关闭工作台失败：', error.message))); },
  };
  const open = directory => createWorkspace({ dataDir: directory, artworkHome, folderOpener, server, listWorks: () => library.list(), switchWork, runtimeControl, isActive: workspace => active === workspace });
  async function switchWork(request, beforeSwitch) {
    if (switching || shuttingDown) throw Object.assign(new Error('正在切换作品，请稍后重试。'), { status: 409 });
    switching = true; let next, finishSwitch;
    switchFinished = new Promise(resolve => { finishSwitch = resolve; });
    try {
      const target = request.theme ? null : await library.find(request.projectId);
      if (target?.dataDir === active.dataDir) return active.view();
      // Snapshot failure must prevent creation or switching. The old draft stays in place.
      const snapshotCreated = await beforeSwitch();
      const work = target || await library.create(request.theme, { scaffold: request.scaffold });
      await retired.get(work.dataDir);
      next = await open(work.dataDir);
      await next.start(address);
      await library.remember(work);
      const previous = active; active = next; next = null;
      previous.switched(active.view());
      const closing = previous.close(); retired.set(previous.dataDir, closing);
      // Do not await the old command queue from inside its own switching command.
      closing.catch(error => console.error('旧作品关闭失败：', error.message));
      return { ...active.view(), snapshotCreated, switchedWork: { name: work.name, root: work.root } };
    } catch (e) { await next?.close(); throw e; }
    finally { switching = false; finishSwitch(); }
  }
  let address;
  try {
    active = await createWorkspace({ dataDir, seedPath, artworkHome, folderOpener, server, listWorks: () => library.list(), switchWork, runtimeControl, isActive: workspace => active === workspace });
    const work = await readManagedWork(active.dataDir);
    library = createWorkLibrary({ home: workHome || (work ? path.dirname(work.root) : path.join(path.dirname(root), 'theme-works')), pointer });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    address = `http://127.0.0.1:${server.address().port}`;
    await active.start(address);
    let closing;
    app = { server, address, onClose: listener => closeListeners.add(listener), close: () => closing ||= (async () => {
      shuttingDown = true;
      await switchFinished;
      active.stopping();
      await active.close(); await Promise.all(retired.values());
      await new Promise(resolve => server.close(resolve));
      for (const listener of closeListeners) await listener();
      await runtime?.dispose();
    })() };
    runtime = await registerRuntime({ root, address, version: STUDIO_VERSION, home: runtimeHome,
      close: () => app.close(), state: () => { const view = active.view(); return { dataDir: active.dataDir, projectId: view.projectId, name: view.project.name }; } });
    return app;
  } catch (e) {
    await active?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    throw e;
  }
}

async function requireMaintenanceIdle(owner) {
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('程序维护锁状态无效，请先检查更新或卸载窗口。');
  try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') return; throw e; }
  throw new Error('程序正在更新或卸载，请等维护窗口结束后再启动工作台。');
}

async function createWorkspace({ dataDir, seedPath, artworkHome, folderOpener, server, listWorks, switchWork, runtimeControl, isActive }) {
  const lock = await acquireDataLock(dataDir);
  dataDir = lock.dataDir;
  let builds, runner, workspace;
  try {
  if (seedPath) {
    let exists = true;
    try { await access(path.join(dataDir, 'project.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; exists = false; }
    if (!exists) {
      const seed = JSON.parse(await readFile(path.resolve(seedPath), 'utf8'));
      const project = seed.schemaVersion ? validateProject(seed) : createProject(seed);
      await atomicJson(path.join(dataDir, 'project.json'), project);
    }
  }
  const migration = await migrateStorage(dataDir);
  const managedWork = await readManagedWork(dataDir);
  if (managedWork && managedWork.projectId !== migration.project.projectId) throw new Error('作品目录与工程身份不一致，已停止载入。');
  let history = new ProjectHistory(migration.project);
  const sessionId = randomUUID();
  const view = () => ({ ...history.snapshot(), sessionId, projectId: history.project.projectId, fingerprint: projectFingerprint(history.project), dataDir, sourceBound: builds?.status().bound === true, capabilities: { projectSchema: 3, stableBindings: true, sourceBuild: 1, decorations: 1 }, migrationRecovery: migration.recovery });
  function checkBasis(input) {
    if (!isActive(workspace)) throw Object.assign(new Error('已切换作品，请重新读取当前工程。'), { status: 409 });
    if (!input.sessionId || !input.fingerprint || !input.projectId) throw Object.assign(new Error('需要 v3 会话、工程 ID 与指纹；请更新工作台/CLI 并重新读取工程。'), { status: 428 });
    if (input.sessionId !== sessionId || input.projectId !== history.project.projectId || input.fingerprint !== projectFingerprint(history.project) || input.revision !== history.revision) throw Object.assign(new Error('工程或服务会话已更新，请重新读取后核对修改。'), { status: 409 });
  }
  const assets = await createAssetStore(dataDir), tickets = await createTicketStore(dataDir);
  const hub = await createHubClient(dataDir, assets);
  const exports = createExportService(assets, hub);
  const artworks = await createArtworkService({ dataDir, studioRoot: root, home: artworkHome, exports, assets, folderOpener });
  const variants = await createVariants(dataDir, assets);
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
  let queue = Promise.resolve(), accepting = true;
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const enqueue = work => {
    if (!accepting) throw Object.assign(new Error('工作台正在关闭，请重新打开后再修改。'), { status: 503 });
    const task = queue.then(work); queue = task.catch(() => {}); return task;
  };
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
    if (managedWork && candidate.project.projectId !== managedWork.projectId) throw new Error('这是固定作品目录，不能用其他工程覆盖。请在“作品”页切换已有作品，或通过“新建作品”接入主题。');
    await atomicJson(path.join(dataDir, 'project.json'), candidate.project);
  }
  builds = await createBuildService({
    dataDir, getProjectId: () => history.project.projectId, publish: value => broadcast('build', value),
    commit: build => enqueue(async () => {
      const assertCurrent = async () => {
        if (!isActive(workspace) || !build.current() || build.projectId !== history.project.projectId || await sourceFingerprint(build.config, dataDir) !== build.fingerprint) throw Object.assign(new Error('候选对应旧源码或旧工程，已丢弃迟到结果。'), { status: 409 });
      };
      await assertCurrent();
      for (const asset of build.assets) {
        const bytes = await readFile(asset.candidatePath);
        const saved = await assets.put(bytes, asset.name);
        if (saved.id !== asset.id) throw new Error(`候选素材在提交前发生变化：${asset.name}`);
      }
      const resolved = await assets.command({ type: 'source-refresh', theme: build.theme, recipe: build.recipe }, history.project);
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
  runner = await createRunner({ dataDir, getProjectId: () => history.project.projectId, publish: value => broadcast('runner', value) });
  const handle = async (req, res) => {
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
      if (req.method === 'GET' && url.pathname === '/api/instances') return send(res, 200, await runtimeControl.list());
      if (req.method === 'POST' && url.pathname === '/api/instances/stop') {
        const input = JSON.parse((await body(req, 16384)).toString());
        const result = await runtimeControl.stop(input.ids);
        send(res, 200, result);
        if (result.currentStopping) runtimeControl.closeCurrent();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/works') return send(res, 200, { currentProjectId: history.project.projectId, works: await listWorks() });
      if (req.method === 'GET' && url.pathname === '/api/artworks') {
        const project = history.snapshot().project, fingerprint = projectFingerprint(project), build = builds.status();
        const info = await artworks.status(project.projectId, build.config?.root);
        const latest = info.versions.find(v => !v.error);
        let sourceChanged = false, sourceError = null;
        if (build.bound) {
          try { sourceChanged = !latest?.source?.included || latest.source.fingerprint !== await sourceFingerprint(build.config, dataDir); }
          catch (e) { sourceError = e.message; }
        }
        return send(res, 200, { ...info, projectId: project.projectId, name: project.name, fingerprint, latestVersionId: latest?.id || null, changedSinceLatest: latest ? fingerprint !== latest.baseline.fingerprint || sourceChanged : null, sourceError });
      }
      if (req.method === 'GET' && url.pathname === '/api/artworks/theme') {
        const checked = await artworks.verify(history.project.projectId, url.searchParams.get('id'), builds.status().config?.root);
        return send(res, 200, JSON.parse(checked.files.get('theme.json')));
      }
      if (req.method === 'POST' && url.pathname === '/api/artworks') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'JSON required' });
        const input = JSON.parse((await body(req, 32768)).toString('utf8'));
        const result = await enqueue(async () => {
          checkBasis(input);
          const build = builds.status(), projectId = history.project.projectId;
          if (input.action === 'open') return artworks.open(projectId, input.target, input.id, build.config?.root);
          if (input.action === 'configure') return artworks.configure(projectId, input.root, build.config?.root);
          if (input.action === 'save') {
            const saved = await artworks.save({ project: history.snapshot().project, baseline: basis(), build, name: input.name, note: input.note, includeSource: input.includeSource, gitCommit: input.gitCommit === true, assertCurrent: async () => { checkBasis(input); } });
            // The durable archive is already complete; snapshot failure cannot hide it.
            try { saved.snapshotCreated = await saveSnapshot(`作品存档：${saved.name}`.slice(0, 120)); }
            catch (e) { saved.warnings.push(`作品已存档，但快捷快照保存失败：${e.message}`); }
            return saved;
          }
          if (input.action === 'commit') return artworks.commit(projectId, input.id, build.config?.root);
          if (!['verify', 'restore'].includes(input.action)) throw new Error('未知作品存档操作。');
          const archived = await artworks.verify(projectId, input.id, build.config?.root);
          if (input.action === 'verify') return { id: input.id, verified: true, files: archived.manifest.files.length, source: archived.manifest.source, warnings: archived.manifest.warnings };
          for (const image of archived.images) await assets.put(image.content, image.id);
          const resolved = await assets.command({ type: 'import-project', project: archived.project }, history.project);
          const candidate = new ProjectHistory(history.project);
          candidate.past = [...history.past]; candidate.future = [...history.future]; candidate.revision = history.revision;
          candidate.execute(resolved, input.revision);
          const snapshotCreated = await saveSnapshot('作品恢复前：' + history.project.name.slice(0, 100));
          await builds.pause('已恢复作品存档，自动同步暂停。核对源码后再继续构建。');
          await persist(candidate); history = candidate;
          await runner.projectChanged(); await builds.activate();
          const result = { ...view(), snapshotCreated, restoredArtwork: input.id, sourceDirectory: archived.manifest.source.included ? path.join(archived.root, 'versions', input.id, 'source') : null };
          for (const client of events) client.write(`data: ${JSON.stringify(view())}\n\n`);
          return result;
        });
        broadcast('artworks', { changed: true }); return send(res, 200, result);
      }
      if (req.method === 'GET' && ['/api/theme-analysis', '/api/theme-analysis/source'].includes(url.pathname)) {
        const saved = url.searchParams.has('snapshot') ? await readSnapshot(url.searchParams.get('snapshot')) : null;
        const project = saved?.project || history.snapshot().project;
        const baseline = saved ? { projectId: saved.projectId, revision: saved.revision, fingerprint: saved.fingerprint, snapshotId: saved.id } : basis();
        const report = { ...analyzeTheme(project, assets.list()), baseline, sourceBound: !saved && builds.status().bound === true };
        return send(res, 200, url.pathname.endsWith('/source') ? { baseline, project, report, baseCss: project.baseTheme.custom_css || '', effectiveBaseCss: rewriteVariables(project.baseTheme.custom_css || '', project.variableEdits), generatedCss: compileOverrides({ ...project, customCss: '' }), overridesCss: project.customCss || '', compiledCss: exportTheme(project).custom_css } : report);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { version: STUDIO_VERSION, node: process.versions.node, projectSchema: 3, projectId: history.project.projectId, dataLock: true, sourceBound: builds.status().bound === true, runner: { configured: !!runner.status().config, verified: runner.status().verified }, fixture: '请在已连接的工作台查看实时 fixture 状态；HTTP 服务不读取聊天。' });
      const evidenceRoute = /^\/api\/tickets\/([a-f0-9]{32})\/(review|artifacts\/(\d+))$/.exec(url.pathname);
      if (req.method === 'GET' && evidenceRoute) {
        const ticket = tickets.list().find(t => t.id === evidenceRoute[1]);
        if (!ticket) return send(res, 404, { error: '小票不存在。' });
        if (evidenceRoute[2] === 'review') return send(res, 200, await reviewEvidence(ticket, basis(), readSnapshot, root));
        const artifact = await readArtifact(root, ticket, Number(evidenceRoute[3]), true);
        res.writeHead(200, { 'Content-Type': artifact.type, 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' });
        return res.end(artifact.content);
      }
      if (req.method === 'GET' && url.pathname === '/api/runner') return send(res, 200, runner.status());
      if (req.method === 'POST' && url.pathname === '/api/runner') {
        const input = JSON.parse((await body(req, 32768)).toString('utf8'));
        const result = await enqueue(async () => {
          checkBasis(input);
          if (input.action === 'configure') return runner.configure(input.config, input.version);
          if (input.action === 'cancel') return runner.cancel(input.id);
          if (input.action !== 'start' && input.action !== 'retry') throw new Error('未知 CLI 任务操作。');
          const previous = input.action === 'retry' ? runner.status().tasks.find(t => t.id === input.id) : null;
          if (input.action === 'retry' && !['failed', 'cancelled', 'interrupted'].includes(previous?.state)) throw new Error('只能显式重试失败、取消或中断的任务。');
          const ids = previous ? previous.input.tickets.map(t => t.id) : input.ids;
          if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length) throw new Error('明确选择 1–20 张小票。');
          const selected = ids.map(id => { const t = tickets.list().find(t => t.id === id); if (!t || t.basis.projectId !== history.project.projectId || !['open', 'working'].includes(t.state)) throw new Error('小票不存在、不属当前工程或已待验收。'); if (!locationStatus(t, history.project).valid) throw new Error('小票需要重新定位。'); return t; });
          const context = { current: basis(), address: origin, studioPath: root, projectPath: builds.status().config?.root || root, version: STUDIO_VERSION };
          return runner.enqueue({ schemaVersion: 1, projectId: history.project.projectId, basis: basis(), address: origin, tickets: selected.map(publicReceipt), handoff: formatAgentHandoff(selected, context) });
        });
        return send(res, 200, result);
      }
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
      if (req.method === 'GET' && url.pathname === '/api/export/audit') return send(res, 200, await exports.audit(history.project));
      if (req.method === 'GET' && url.pathname === '/api/export') return send(res, 200, await exports.theme(history.project, url.searchParams.get('mode')));
      if (req.method === 'GET' && url.pathname === '/api/backup/manifest') return send(res, 200, await exports.manifest(history.project));
      if (req.method === 'GET' && url.pathname === '/api/assets/references') {
        const saved = await Promise.all((await snapshots()).map(s => readSnapshot(s.id).then(s => s.project)));
        return send(res, 200, { references: referenceIndex(history.project, [...history.past, ...history.future, ...saved]), cleanup: '素材不自动删除；所有历史引用保留。' });
      }
      if (req.method === 'POST' && url.pathname === '/api/assets/archive') {
        const input = JSON.parse((await body(req, 32768)).toString('utf8'));
        const result = await enqueue(async () => {
          checkBasis(input);
          if (input.archived !== false) {
            const saved = await Promise.all((await snapshots()).map(s => readSnapshot(s.id).then(s => s.project)));
            const refs = referenceIndex(history.project, [...history.past, ...history.future, ...saved]);
            if (!Array.isArray(input.ids) || input.ids.some(id => refs.some(r => r.reference === assets.list().find(a => a.id === id)?.reference) || variants.list().some(v => v.originalId === id || v.variantId === id))) throw new Error('素材仍被工程、撤销历史、快照或变体引用，不能归档。');
          }
          return assets.archive(input.ids, input.archived !== false);
        });
        broadcast('assets', { changed: true }); return send(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/backup') return send(res, 200, await assets.portableProject(history.project));
      if (req.method === 'GET' && url.pathname === '/api/hub') return send(res, 200, { ...hub.status(), candidates: hub.candidates(history.project) });
      if (req.method === 'GET' && url.pathname === '/api/hub/lock') return send(res, 200, hub.locks(history.project));
      if (req.method === 'POST' && url.pathname === '/api/hub') {
        const input = JSON.parse((await body(req, 32768)).toString('utf8'));
        const result = await enqueue(async () => {
          checkBasis(input);
          if (input.action === 'refresh') return hub.refresh(input.source);
          if (input.action === 'cache' || input.action === 'verify') return hub.fetchAsset(input.id, input.action === 'verify');
          if (input.action === 'ingest') return hub.ingest(input.id, input.metadata, input.catalogRevision);
          throw new Error('未知素材源操作。');
        });
        broadcast('assets', { changed: true }); return send(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/assets') return send(res, 200, assets.list());
      if (req.method === 'GET' && url.pathname === '/api/assets/variants') return send(res, 200, variants.list());
      if (req.method === 'GET' && url.pathname === '/api/assets/inspect') return send(res, 200, await variants.inspect(url.searchParams.get('id')));
      if (req.method === 'POST' && url.pathname === '/api/assets/variant') {
        const bytes = await body(req, MAX_ASSET_BYTES);
        const value = await enqueue(() => variants.put(url.searchParams.get('original'), bytes, url.searchParams.get('kind')));
        broadcast('assets', { changed: true }); return send(res, 201, value);
      }
      if (req.method === 'GET' && url.pathname === '/api/tickets') return send(res, 200, tickets.list().map(t => ({ ...t, locationStatus: locationStatus(t, history.project) })));
      if (req.method === 'GET' && /^\/api\/tickets\/[a-f0-9]{32}$/.test(url.pathname)) {
        const ticket = tickets.list().find(t => t.id === url.pathname.split('/').at(-1));
        return send(res, ticket ? 200 : 404, ticket ? { ...ticket, locationStatus: locationStatus(ticket, history.project) } : { error: '小票不存在。' });
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
            input.location = captureLocation(history.project, input.location || { scope: input.scope }, input.anchor);
            const snapshot = await saveSnapshot(`标注 #${tickets.list().length + 1} · ${input.comment.slice(0, 48)}`);
            return tickets.create(input, { ...basis(), snapshotId: snapshot.id });
          }
          checkBasis(input);
          return tickets.update(url.pathname.split('/').at(-1), input, basis(), saveSnapshot);
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
        let { command, revision } = input;
        const work = async () => {
          checkBasis(input);
          if (command?.type === 'snapshot-save') {
            if (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 120) throw new Error('快照名称需为 1–120 字。');
            return { ...view(), snapshotCreated: await saveSnapshot(command.name.trim()) };
          }
          if (command?.type === 'theme-import' && command.scanFingerprint !== projectFingerprint(history.project)) throw Object.assign(new Error('主题分析基线已变化，请重新读取主题。'), { status: 409 });
          if (command?.type === 'theme-analysis-handoff') {
            const snapshotCreated = await saveSnapshot(('主题分析：' + history.project.name).slice(0, 120));
            return { ...view(), snapshotCreated, analysisHandoff: analysisHandoff({ current: basis(), address: origin, studioPath: root, projectPath: builds.status().config?.root || root, snapshotId: snapshotCreated.id }) };
          }
          if (['work-create-theme', 'work-create-blank', 'work-switch'].includes(command?.type)) {
            if (command.type === 'work-create-blank') command = { ...command, theme: starterTheme(command.name) };
            if (command.type !== 'work-switch') {
              validateTheme(command.theme);
              if (command.scanFingerprint !== projectFingerprint(history.project)) throw Object.assign(new Error('接入前工程已变化，请重新读取主题。'), { status: 409 });
            }
            return switchWork(command.type !== 'work-switch' ? { theme: command.theme, scaffold: command.type === 'work-create-blank' } : { projectId: command.projectId }, async () => {
              const snapshot = await saveSnapshot('切换作品前：' + history.project.name.slice(0, 100));
              await builds.pause('已切换作品。返回后可继续编辑，核对源码后再开启自动同步。');
              return snapshot;
            });
          }
          const restored = command?.type === 'theme-import' ? { type: 'import-theme', theme: command.theme }
            : command?.type === 'hub-apply' ? { type: 'import-project', project: await hub.apply(history.project, command) }
            : command?.type === 'hub-replace' ? { type: 'import-project', project: await hub.replace(history.project, command.ids) }
            : command?.type === 'restore-files' ? { type: 'import-project', project: command.project }
            : command?.type === 'snapshot-restore' ? { type: 'import-project', project: (await readSnapshot(command.id)).project } : command;
          const resolved = await assets.command(restored, history.project);
          const candidate = new ProjectHistory(history.project);
          candidate.past = [...history.past]; candidate.future = [...history.future]; candidate.revision = history.revision;
          candidate.execute(resolved, revision);
          if (managedWork && candidate.project.projectId !== managedWork.projectId) throw new Error('这是固定作品目录，不能用其他工程覆盖。请在“作品”页切换已有作品，或通过“新建作品”接入主题。');
          let snapshotCreated;
          const replacesProject = ['theme-import', 'import-theme', 'import-project', 'base-theme', 'restore-files', 'snapshot-restore'].includes(command.type);
          // Persist recovery before changing history or disk. A failed snapshot aborts import.
          if (replacesProject) snapshotCreated = await saveSnapshot('替换前：' + history.project.name.slice(0, 100));
          if (replacesProject || (['undo', 'redo'].includes(command.type) && history.project.baseTheme.custom_css !== candidate.project.baseTheme.custom_css)) await builds.pause();
          await persist(candidate);
          history = candidate;
          await runner.projectChanged();
          await builds.activate().catch(e => broadcast('build', { ...builds.status(), status: { state: 'failed', error: e.message } }));
          const result = { ...view(), ...(snapshotCreated && { snapshotCreated }) };
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
  };
  let closing;
  workspace = { dataDir, handle, view, stopping: () => broadcast('runtime-closing', {}),
    async start(address) {
      await atomicJson(path.join(dataDir, 'runtime.json'), { address, pid: process.pid, lockNonce: lock.owner.nonce });
      await builds.activate();
    },
    switched(next) { for (const client of events) { client.write(`data: ${JSON.stringify(next)}\n\n`); client.end(); } },
    close: () => closing ||= (async () => {
    accepting = false;
    await queue;
    await runner.close(); await builds.close(); for (const client of events) client.end();
    await unlink(path.join(dataDir, 'runtime.json')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await lock.release();
  })() };
  return workspace;
  } catch (e) {
    await runner?.close().catch(() => {}); await builds?.close().catch(() => {});
    const runtimeFile = path.join(dataDir, 'runtime.json');
    try { if (JSON.parse(await readFile(runtimeFile, 'utf8')).lockNonce === lock.owner.nonce) await unlink(runtimeFile); } catch (error) { if (error.code !== 'ENOENT') e.runtimeCleanupError = error.message; }
    await lock.release(); throw e;
  }
}
