import { watch } from 'node:fs';
import { readFile, readdir, mkdir, realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { atomicJson } from './storage-migrations.js';
import { validateTheme } from './shared/core.js';
import { validateBuiltCss } from './shared/css-validation.js';
import { validateRecipe } from './shared/decorations.js';
import { MAX_ASSET_BYTES, MAX_IMPORT_BYTES } from './asset-store.js';

const excluded = new Set(['.git', '.local', 'dist', 'output', 'node_modules', '.playwright-cli', 'cache', '.cache', 'history', 'logs']);
const modes = ['local', 'embedded', 'external'];
const failure = message => Object.assign(new Error(message), { status: 400 });
function relativeFile(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\0') || value.split(/[\\/]/).includes('..')) throw failure('路径必须位于源码/候选目录内。');
  return path.posix.normalize(value.replaceAll('\\', '/'));
}
function ignored(relative) { return relative.split(/[\\/]/).some(p => excluded.has(p.toLowerCase())) || /(?:\.tmp|\.log)$/i.test(relative); }
export async function normalizeBuildConfig(value) {
  if (!value || typeof value !== 'object') throw failure('需要源码绑定配置。');
  if (typeof value.root !== 'string' || !value.root.trim()) throw failure('请填写源码根目录。');
  const root = await realpath(path.resolve(value.root));
  if (!(await stat(root)).isDirectory()) throw failure('源码根目录不存在。');
  if (typeof value.program !== 'string' || !value.program.trim() || value.program.length > 2000 || /\.(cmd|bat)$/i.test(value.program)) throw failure('请选择可执行程序；Windows npm/cmd 请改用 node.exe 与脚本参数。');
  if (!Array.isArray(value.args) || value.args.length > 100 || value.args.some(a => typeof a !== 'string' || a.length > 4000 || a.includes('\0'))) throw failure('构建参数必须是字符串数组。');
  if (!Array.isArray(value.watch) || !value.watch.length || value.watch.length > 100) throw failure('请配置需要监听的源码文件或目录。');
  const paths = [...new Set(value.watch.map(relativeFile))];
  if (paths.some(p => ignored(p))) throw failure('输出、缓存、历史与日志目录不能作为监听来源。');
  const mode = value.mode || 'local'; if (!modes.includes(mode)) throw failure('素材模式无效。');
  const debounceMs = value.debounceMs ?? 180, timeoutMs = value.timeoutMs ?? 60000;
  if (!Number.isInteger(debounceMs) || debounceMs < 50 || debounceMs > 5000 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw failure('构建防抖或超时范围无效。');
  return { root, program: value.program, args: [...value.args], watch: paths, mode, debounceMs, timeoutMs };
}

export async function sourceFiles(config, dataDir) {
  const files = new Set();
  const data = path.resolve(dataDir);
  async function collect(relative) {
    if (ignored(relative)) return;
    const file = path.resolve(config.root, relative);
    if (file === data || file.startsWith(data + path.sep)) return;
    let resolved; try { resolved = await realpath(file); } catch (e) { throw new Error(`源码缺少 ${relative}：${e.message}`); }
    if (resolved !== config.root && !resolved.startsWith(config.root + path.sep)) throw failure(`源码路径越界：${relative}`);
    if ((await stat(file)).isDirectory()) {
      for (const entry of await readdir(file, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw failure(`不跟随源码符号链接：${entry.name}`); await collect(path.join(relative, entry.name)); }
    } else files.add(relative.replaceAll('\\', '/'));
  }
  for (const relative of config.watch) await collect(relative);
  return [...files].sort();
}
export async function sourceFingerprint(config, dataDir) {
  const files = await sourceFiles(config, dataDir);
  const hash = createHash('sha256').update(JSON.stringify({ program: config.program, args: config.args, mode: config.mode }));
  for (const file of files) { hash.update(file).update('\0'); hash.update(await readFile(path.join(config.root, file))); hash.update('\0'); }
  return hash.digest('hex');
}

export async function readBuildCandidate(directory) {
  const root = await realpath(directory);
  async function file(relative, limit) {
    relative = relativeFile(relative);
    const target = await realpath(path.resolve(root, relative));
    if (!target.startsWith(root + path.sep)) throw failure(`候选输出越界：${relative}`);
    if ((await stat(target)).size > limit) throw failure(`候选文件 ${relative} 超限，请通过独立素材文件传输图片。`);
    return readFile(target);
  }
  const manifest = JSON.parse((await file('build.json', 1024 * 1024)).toString('utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 1000) throw failure('build.json 格式不受支持。');
  const theme = validateTheme(JSON.parse((await file(manifest.themeFile, MAX_IMPORT_BYTES)).toString('utf8')));
  validateBuiltCss(theme.custom_css || '');
  if (/data:image\//i.test(theme.custom_css || '')) throw failure('同步候选请使用独立素材文件，不能把图片内嵌在同步 JSON。');
  const assets = [];
  for (const item of manifest.assets) {
    const bytes = await file(item.file, MAX_ASSET_BYTES);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== item.sha256 || (item.bytes !== undefined && bytes.length !== item.bytes)) throw failure(`素材校验失败：${item.name || item.file}`);
    assets.push({ ...item, candidatePath: await realpath(path.join(root, relativeFile(item.file))) });
  }
  return { theme, assets, assetRefs: manifest.assetRefs || [], recipe: validateRecipe(manifest.recipe) };
}

export async function createBuildService({ dataDir, getProjectId, commit, publish = () => {} }) {
  const file = path.join(dataDir, 'source-bindings.json');
  let records = {};
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved.schemaVersion !== 1 || !saved.bindings || typeof saved.bindings !== 'object') throw failure('本机源码绑定格式无效。');
    records = saved.bindings;
    for (const record of Object.values(records)) {
      try { record.config = await normalizeBuildConfig(record.config); delete record.invalidConfig; }
      catch (e) { record.invalidConfig = true; record.status = { state: 'failed', error: `源码绑定不可用：${e.message}` }; }
      if (['queued', 'running'].includes(record.status?.state)) record.status = { ...record.status, state: 'interrupted', error: '上次服务中断；候选输出保留，未完成结果不会应用。' };
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let writes = Promise.resolve(), watcher, timer, child, running, closed = false, generation = 0, pending = false, forced = false, watchedProject;
  const status = (id = getProjectId()) => ({ projectId: id, bound: !!records[id], version: 0, ...(records[id] ? structuredClone(records[id]) : { autoSync: false, paused: false, status: { state: 'unbound' } }) });
  function change(id, update) {
    const task = writes.then(async () => {
      const next = structuredClone(records); if (!next[id]) return;
      update(next[id]); await atomicJson(file, { schemaVersion: 1, bindings: next }); records = next; publish(status(id));
    });
    writes = task.catch(() => {}); return task;
  }
  const setStatus = (id, state, extra = {}) => change(id, record => { record.status = { state, updatedAt: new Date().toISOString(), ...extra }; });
  function request(force = true) {
    const id = getProjectId(), record = records[id]; if (!record) throw failure('当前工程未绑定源码。');
    generation++; pending = true; forced ||= force; clearTimeout(timer);
    setStatus(id, 'queued', { generation }).catch(e => publish({ ...status(id), status: { state: 'failed', error: e.message } }));
    timer = setTimeout(() => { timer = null; start(); }, record.config.debounceMs);
    return { ...status(), requested: true };
  }
  function execute(config, directory) {
    return new Promise((resolve, reject) => {
      let output = '', error = '', timedOut = false;
      const args = config.args.map(a => a.replaceAll('{output}', directory).replaceAll('{mode}', config.mode));
      child = spawn(config.program, args, { cwd: config.root, windowsHide: true, shell: false, env: { ...process.env, STUDIO_BUILD_OUTPUT: directory, STUDIO_ASSET_MODE: config.mode }, stdio: ['ignore', 'pipe', 'pipe'] });
      const processChild = child;
      processChild.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-8000); });
      processChild.stderr.on('data', bytes => { error = (error + bytes.toString()).slice(-8000); });
      const timeout = setTimeout(() => { timedOut = true; processChild.kill(); }, config.timeoutMs);
      processChild.once('error', e => { clearTimeout(timeout); if (child === processChild) child = null; reject(e); });
      processChild.once('close', code => { clearTimeout(timeout); if (child === processChild) child = null; if (timedOut) reject(new Error(`构建超过 ${config.timeoutMs} ms，已取消。`)); else if (code !== 0) reject(new Error(`构建退出 ${code}：${error || output}`)); else resolve({ output, error }); });
    });
  }
  function start() {
    if (closed || running || !pending) return;
    const id = getProjectId(), record = records[id]; if (!record) { pending = false; return; }
    const buildGeneration = generation, config = structuredClone(record.config), force = forced;
    pending = forced = false;
    const current = () => !closed && id === getProjectId() && generation === buildGeneration && !records[id]?.paused;
    running = (async () => {
      let directory, fingerprint;
      try {
        fingerprint = await sourceFingerprint(config, dataDir);
        if (!force && fingerprint === records[id].appliedFingerprint) { await setStatus(id, 'succeeded', { unchanged: true }); return; }
        if (!current()) return;
        directory = path.join(dataDir, 'builds', id, `${Date.now()}-${randomUUID()}`);
        await mkdir(directory, { recursive: true });
        await setStatus(id, 'running', { candidateDir: directory, sourceFingerprint: fingerprint, generation: buildGeneration, startedAt: new Date().toISOString() });
        if (!current()) return;
        const logs = await execute(config, directory);
        if (!current()) return;
        if (await sourceFingerprint(config, dataDir) !== fingerprint) { if (records[id].autoSync) request(false); else await setStatus(id, 'superseded', { error: '构建中源码又有保存，请重新构建。', candidateDir: directory }); return; }
        const candidate = await readBuildCandidate(directory);
        if (!current()) return;
        const result = await commit({ ...candidate, projectId: id, fingerprint, current, config });
        await change(id, r => { r.appliedFingerprint = fingerprint; r.lastSuccessful = { sourceFingerprint: fingerprint, revision: result.revision, projectFingerprint: result.fingerprint, candidateDir: directory, completedAt: new Date().toISOString() }; r.status = { state: 'succeeded', updatedAt: new Date().toISOString(), ...logs }; });
      } catch (e) {
        if (current()) await setStatus(id, e.conflicts ? 'conflict' : 'failed', { error: e.message.slice(0, 8000), conflicts: e.conflicts || [], candidateDir: directory, sourceFingerprint: fingerprint });
      }
    })().catch(e => publish({ ...status(id), status: { state: 'failed', error: `构建状态保存失败：${e.message}` } })).finally(() => { running = null; if (pending && !timer && !closed) start(); });
  }
  async function activate() {
    const id = getProjectId(); if (watchedProject === id && watcher) return;
    watcher?.close(); watcher = null; watchedProject = id;
    generation++; pending = forced = false; clearTimeout(timer); child?.kill();
    const record = records[id]; if (!record || record.invalidConfig) return;
    watcher = watch(record.config.root, { recursive: true }, (_event, fileName) => {
      if (!fileName || closed) return;
      const relative = String(fileName).replaceAll('\\', '/');
      const dataRelative = path.relative(record.config.root, dataDir).replaceAll('\\', '/');
      if (ignored(relative) || (dataRelative && (relative === dataRelative || relative.startsWith(dataRelative + '/')))) return;
      const relevant = record.config.watch.some(p => p === '.' || relative === p || relative.startsWith(p.replace(/\/$/, '') + '/'));
      if (relevant && records[id]?.autoSync && !records[id]?.paused) request(false);
    });
    watcher.on('error', e => { setStatus(id, 'failed', { error: `源码监听失败：${e.message}` }).catch(() => {}); });
    if (record.autoSync && !record.paused) request(false);
  }
  return {
    status,
    async configure(config, autoSync = false) {
      const normalized = await normalizeBuildConfig(config), id = getProjectId();
      const task = writes.then(async () => {
        const next = structuredClone(records); next[id] = { version: (next[id]?.version || 0) + 1, config: normalized, autoSync: autoSync === true, paused: false, status: { state: 'idle', updatedAt: new Date().toISOString() } };
        await atomicJson(file, { schemaVersion: 1, bindings: next }); records = next;
      });
      writes = task.catch(() => {}); await task;
      watcher?.close(); watcher = null; watchedProject = undefined; await activate(); publish(status()); return status();
    },
    async control(action, enabled) {
      const id = getProjectId(); if (!records[id]) throw failure('当前工程未绑定源码。');
      if (records[id].invalidConfig) throw failure('源码绑定不可用，请修正目录或构建程序配置。');
      if (action === 'build') { await change(id, r => { r.version = (r.version || 0) + 1; r.paused = false; }); request(true); }
      else if (action === 'auto') { await change(id, r => { r.version = (r.version || 0) + 1; r.autoSync = enabled === true; r.paused = false; }); if (enabled) request(true); else { generation++; pending = forced = false; clearTimeout(timer); child?.kill(); await setStatus(id, 'paused'); } }
      else if (action === 'cancel') { generation++; pending = forced = false; clearTimeout(timer); child?.kill(); await change(id, r => { r.version = (r.version || 0) + 1; r.paused = true; r.status = { state: 'cancelled', updatedAt: new Date().toISOString(), error: '已取消；自动应用暂停。源码与已有候选结果保留。' }; }); }
      else throw failure('构建操作无效。');
      publish(status()); return status();
    },
    async pause(reason = '恢复历史版本，自动应用已暂停。') {
      const id = getProjectId(); generation++; pending = forced = false; clearTimeout(timer); child?.kill();
      if (records[id]) await change(id, r => { r.paused = true; r.status = { state: 'paused', error: reason, updatedAt: new Date().toISOString() }; });
    },
    activate,
    async close() { closed = true; generation++; pending = false; clearTimeout(timer); watcher?.close(); child?.kill(); await running; await writes; },
  };
}
