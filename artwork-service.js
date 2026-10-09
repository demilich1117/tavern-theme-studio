import { readFile, writeFile, mkdir, readdir, realpath, lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicJson, projectFingerprint } from './storage-migrations.js';
import { sourceFiles, sourceFingerprint } from './build-service.js';
import { validateProject } from './shared/core.js';
import { STUDIO_VERSION } from './shared/version.js';
import { referenceIndex } from './export-service.js';

const exec = promisify(execFile), markerName = '.studio-artwork.json';
const idPattern = /^[a-f0-9]{32}$/;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
async function optional(file) { try { return await readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function relative(value) {
  if (typeof value !== 'string' || !value || /[\\:\0]/.test(value) || path.isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw failure('存档文件路径无效。');
  return value;
}
async function canonical(file) {
  try { return await realpath(file); }
  catch (e) { if (e.code !== 'ENOENT') throw e; if (path.dirname(file) === file) throw failure('存档目录所在磁盘不存在。'); return path.join(await canonical(path.dirname(file)), path.basename(file)); }
}
async function safeRead(root, file) {
  file = relative(file);
  let target = root;
  for (const part of file.split('/')) {
    target = path.join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw failure('存档不跟随符号链接。');
  }
  if (!inside(root, await realpath(target))) throw failure('存档文件越界。');
  if ((await lstat(target)).size > 512 * 1048576) throw failure('单个存档文件超过 512 MiB。');
  return readFile(target);
}
async function git(root, args) {
  const { stdout } = await exec('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return stdout.trim();
}

export async function createArtworkService({ dataDir, studioRoot, home = path.join(path.dirname(studioRoot), 'theme-archives'), exports, assets }) {
  const settingsFile = path.join(dataDir, 'artwork-settings.json');
  let records = json(await optional(settingsFile) || Buffer.from('{}'));
  async function location(projectId, value, sourceRoot) {
    const root = await canonical(path.resolve(value || records[projectId]?.root || path.join(home, projectId)));
    const studio = await realpath(studioRoot), data = await realpath(dataDir);
    if (inside(studio, root) || inside(root, studio) || inside(data, root) || inside(root, data)) throw failure('作品存档需放在工作台程序和运行数据目录之外。');
    if (sourceRoot && (inside(sourceRoot, root) || inside(root, sourceRoot))) throw failure('存档目录不能与绑定源码目录重叠。');
    return root;
  }
  async function managed(root, projectId, create = false) {
    const content = await optional(path.join(root, markerName));
    if (content) {
      if ((await lstat(path.join(root, markerName))).isSymbolicLink()) throw failure('存档标记不能是符号链接。');
      const marker = json(content);
      if (marker.schemaVersion !== 1 || marker.projectId !== projectId) throw failure('此目录属于另一作品，请选择空目录。');
      return;
    }
    let entries = []; try { entries = await readdir(root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (entries.length) throw failure('请选择空目录，或此工程已有的作品存档目录。');
    if (create) { await mkdir(root, { recursive: true }); await writeFile(path.join(root, markerName), JSON.stringify({ schemaVersion: 1, projectId }, null, 2) + '\n', { flag: 'wx' }); }
  }
  async function remember(projectId, root, id, receipt) {
    const next = structuredClone(records);
    next[projectId] = { ...next[projectId], root, commits: { ...next[projectId]?.commits, ...(id && { [id]: receipt }) } };
    await atomicJson(settingsFile, next); records = next;
  }
  async function status(projectId, sourceRoot) {
    const root = await location(projectId, undefined, sourceRoot);
    await managed(root, projectId);
    let entries = []; try { entries = await readdir(path.join(root, 'versions')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const versions = [];
    for (const id of entries.filter(id => idPattern.test(id))) {
      try {
        const m = json(await safeRead(root, `versions/${id}/manifest.json`));
        if (m.format !== 'tavern-theme-artwork' || m.version !== 1 || m.baseline.projectId !== projectId || m.id !== id) throw failure('存档清单身份不一致。');
        versions.push({ id, name: m.name, note: m.note, createdAt: m.createdAt, baseline: m.baseline, source: m.source, warnings: m.warnings, git: records[projectId]?.commits?.[id] || { status: 'not_requested' }, directory: path.join(root, 'versions', id) });
      } catch (e) { versions.push({ id, name: '存档清单不可读', error: e.message }); }
    }
    return { root, versions: versions.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')), sourceBound: !!sourceRoot };
  }
  async function configure(projectId, value, sourceRoot) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 2000) throw failure('请填写作品存档的绝对目录。');
    const root = await location(projectId, value, sourceRoot); await managed(root, projectId); await remember(projectId, root);
    return status(projectId, sourceRoot);
  }
  async function verify(projectId, id, sourceRoot) {
    if (!idPattern.test(id || '')) throw failure('存档编号无效。');
    const root = await location(projectId, undefined, sourceRoot); await managed(root, projectId);
    const dir = `versions/${id}`, manifest = json(await safeRead(root, `${dir}/manifest.json`));
    if (manifest.format !== 'tavern-theme-artwork' || manifest.version !== 1 || manifest.id !== id || manifest.baseline?.projectId !== projectId || !Array.isArray(manifest.files) || manifest.files.length > 5000) throw failure('存档清单身份或格式无效。');
    const files = new Map(); let total = 0;
    for (const item of manifest.files) {
      if (files.has(item.path)) throw failure('存档清单存在重复文件。');
      const bytes = await safeRead(root, `${dir}/${relative(item.path)}`);
      total += bytes.length;
      if (total > 512 * 1048576 || bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw failure(`存档文件校验失败：${item.path}`);
      files.set(item.path, bytes);
    }
    if (!files.has('project/manifest.json') || !files.has('theme.json') || !files.has('theme.css') || !files.has('notes.md')) throw failure('存档缺少工程、主题或版本说明。');
    const backup = json(files.get('project/manifest.json')), project = validateProject(backup.project);
    if (backup.format !== 'tavern-theme-studio-files' || backup.version !== 1 || project.projectId !== projectId || projectFingerprint(project) !== manifest.baseline.fingerprint || !Array.isArray(backup.assets)) throw failure('存档工程基线不一致。');
    const images = backup.assets.map(a => {
      if (!/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(a.id) || a.path !== `assets/${a.id}`) throw failure('存档素材路径无效。');
      const bytes = files.get(`project/${a.path}`);
      if (!bytes || bytes.length !== a.bytes || hash(bytes) !== a.sha256 || a.id.split('.')[0] !== a.sha256) throw failure('存档缺少素材或素材已损坏。');
      return { ...a, content: bytes };
    });
    const ids = new Set(images.map(a => a.id));
    if (ids.size !== images.length || referenceIndex(project).some(r => r.reference.startsWith('tts-asset://') && !ids.has(r.reference.slice(12)))) throw failure('存档清单有重复素材或缺少工程引用的素材。');
    return { root, manifest, project, images, files };
  }
  async function commit(projectId, id, sourceRoot) {
    const { root, manifest } = await verify(projectId, id, sourceRoot);
    let receipt;
    try {
      const metadata = await lstat(path.join(root, '.git')).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) throw failure('本地提交需要独立作品仓库，不支持关联工作树或符号链接。');
      if (!metadata) await git(root, ['init', '-b', 'main']);
      if (await canonical(await git(root, ['rev-parse', '--show-toplevel'])) !== root) throw failure('Git 根目录不是当前作品存档目录。');
      // Stage only the new version. --only leaves unrelated staged changes alone.
      const paths = [markerName, `versions/${id}`];
      await git(root, ['add', '--', ...paths]);
      const changed = await git(root, ['diff', '--cached', '--name-only', '--', ...paths]);
      if (changed) await git(root, ['commit', '--only', '-m', `archive: ${manifest.name}`, '--', ...paths]);
      const sha = await git(root, ['log', '-1', '--format=%H', '--', `versions/${id}`]);
      if (!/^[a-f0-9]{40,64}$/.test(sha)) throw failure('未找到该存档的 Git 提交。');
      receipt = { status: 'committed', commit: sha };
    } catch (e) { receipt = { status: 'failed', detail: String(e.stderr || e.message).trim().slice(0, 2000) }; }
    await remember(projectId, root, id, receipt);
    return { id, directory: path.join(root, 'versions', id), git: receipt };
  }
  async function save({ project, baseline, build, name, note = '', includeSource = !!build?.bound, gitCommit = false, assertCurrent }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\r\n\0]/.test(name)) throw failure('版本名称需为 1–120 字。');
    if (typeof note !== 'string' || note.length > 4000 || note.includes('\0')) throw failure('版本说明最多 4000 字。');
    if (typeof includeSource !== 'boolean' || typeof gitCommit !== 'boolean') throw failure('源码与 Git 选项必须是布尔值。');
    const projectId = project.projectId, root = await location(projectId, undefined, build?.config?.root);
    await managed(root, projectId);
    const files = new Map(), addJson = (file, value) => files.set(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
    const exported = await exports.theme(project, 'standard'), backup = await exports.manifest(project);
    addJson('theme.json', exported.theme); files.set('theme.css', Buffer.from(exported.theme.custom_css)); addJson('project/manifest.json', backup);
    for (const a of backup.assets) files.set(`project/${a.path}`, (await assets.read(a.id)).bytes);
    const warnings = [], source = { included: false };
    if (exported.report.remote.length || exported.report.unresolved.length) warnings.push('主题保留外部或未解析依赖；此存档不保证完全离线。');
    if (includeSource) {
      if (!build?.bound || !build.config || !build.lastSuccessful?.sourceFingerprint) throw failure('没有已成功同步的源码。请先完成源码构建，或取消包含源码。');
      const selected = new Set(await sourceFiles(build.config, dataDir));
      let sourceBytes = 0;
      for (const file of selected) sourceBytes += (await lstat(path.join(build.config.root, file))).size;
      if (selected.size > 4900 || sourceBytes > 128 * 1048576) throw failure('绑定源码超过 4900 文件或 128 MiB，请缩小监听范围或仅存档工程。');
      const fingerprint = await sourceFingerprint(build.config, dataDir);
      if (fingerprint !== build.lastSuccessful.sourceFingerprint || ['queued', 'running'].includes(build.status?.state)) throw failure('源码尚未同步到当前工程，请先完成构建后存档。', 409);
      for (const file of ['README.md', 'design-brief.md', 'studio.build.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) if (await optional(path.join(build.config.root, file))) selected.add(file);
      for (const file of [...selected].sort()) files.set(`source/${relative(file)}`, await safeRead(build.config.root, file));
      if (await sourceFingerprint(build.config, dataDir) !== fingerprint) throw failure('源码在存档时发生变化，请重新存档。', 409);
      Object.assign(source, { included: true, fingerprint, watch: build.config.watch, files: selected.size });
      warnings.push('源码保存绑定的监听文件及说明文件；外部构建工具和依赖不复制。恢复工程会暂停源码同步，源码不会被自动覆盖。');
    } else if (build?.bound) warnings.push('本版本未包含绑定源码，仅能直接恢复工程微调及主题。');
    const createdAt = new Date().toISOString(), id = randomBytes(16).toString('hex');
    files.set('notes.md', Buffer.from(`# ${name.trim()}\n\n${note.trim() || '未填写版本说明。'}\n\n保存于 ${createdAt}。\n工程：${projectId}\n工程指纹：${baseline.fingerprint}\n\n${warnings.join('\n\n')}\n`));
    const manifest = { format: 'tavern-theme-artwork', version: 1, id, name: name.trim(), note: note.trim(), createdAt, studioVersion: STUDIO_VERSION, baseline: { projectId, revision: baseline.revision, fingerprint: baseline.fingerprint }, source, warnings, files: [...files].map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: hash(bytes) })) };
    if (files.size > 5000 || [...files.values()].reduce((n, b) => n + b.length, 0) > 512 * 1048576) throw failure('存档超过 5000 文件或 512 MiB，请缩小源码监听范围。');
    await assertCurrent();
    if (source.included && await sourceFingerprint(build.config, dataDir) !== source.fingerprint) throw failure('源码在存档时发生变化，请重新存档。', 409);
    await managed(root, projectId, true);
    const versions = path.join(root, 'versions'); await mkdir(versions, { recursive: true });
    if ((await lstat(versions)).isSymbolicLink()) throw failure('版本目录不能是符号链接。');
    const staging = path.join(versions, `.pending-${id}`), directory = path.join(versions, id);
    await mkdir(staging);
    for (const [file, bytes] of files) { const target = path.join(staging, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' }); }
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await assertCurrent();
    if (source.included && await sourceFingerprint(build.config, dataDir) !== source.fingerprint) throw failure('源码在存档时发生变化；未完成目录不会列为版本。', 409);
    await rename(staging, directory);
    await remember(projectId, root);
    const receipt = gitCommit ? await commit(projectId, id, build?.config?.root) : { git: { status: 'not_requested' } };
    return { id, directory, name: manifest.name, warnings, source, baseline: manifest.baseline, git: receipt.git };
  }
  return { status, configure, save, verify, commit };
}
