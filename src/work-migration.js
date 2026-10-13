import { readFile, writeFile, mkdir, readdir, realpath, lstat, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { acquireDataLock } from './data-lock.js';
import { atomicJson, projectFingerprint } from './storage-migrations.js';
import { validateProject } from '../shared/core.js';
import { createArtworkService } from './artwork-service.js';
import { createAssetStore } from './asset-store.js';
import { createExportService } from './export-service.js';
import { inside, studioRoot, workPointer, readManagedWork } from './work-location.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function optionalJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }

// Copy, never move. Refuse links; verify both the destination and the original
// again before publishing. Caller holds the old workspace lock throughout.
export async function copyVerifiedTree(from, to, { skip = () => false, entries = [], prefix = '' } = {}) {
  const sources = [];
  async function visit(relative = '') {
    const file = path.join(from, relative), meta = await lstat(file);
    if (meta.isSymbolicLink()) throw new Error(`迁移不跟随符号链接：${file}`);
    if (meta.isDirectory()) {
      await mkdir(path.join(to, relative), { recursive: true });
      for (const name of await readdir(file)) { const child = path.join(relative, name); if (!skip(child)) await visit(child); }
    } else if (meta.isFile()) {
      const bytes = await readFile(file), sha256 = digest(bytes), target = path.join(to, relative);
      await writeFile(target, bytes, { flag: 'wx' });
      if (digest(await readFile(target)) !== sha256) throw new Error(`迁移副本校验失败：${file}`);
      sources.push({ file, sha256 }); entries.push({ path: path.join(prefix, relative).replaceAll('\\', '/'), bytes: bytes.length, sha256 });
    } else throw new Error(`迁移只接受普通文件与目录：${file}`);
  }
  await visit();
  for (const item of sources) if (digest(await readFile(item.file)) !== item.sha256) throw new Error(`复制期间原文件发生变化：${item.file}`);
  return entries;
}

export async function migrateWork({ dataDir, destination, pointer = workPointer, copySource = true, toolRoot = studioRoot }) {
  if (!path.isAbsolute(destination || '')) throw new Error('作品目录必须是绝对路径。');
  const parent = await realpath(path.dirname(destination)), root = path.join(parent, path.basename(destination));
  const tool = await realpath(toolRoot), original = await realpath(dataDir);
  if (inside(tool, root) || inside(root, tool) || inside(original, root) || inside(root, original)) throw new Error('新作品目录必须与原工作台和数据目录分开。');
  try { await lstat(root); throw new Error('目标目录已存在；迁移只写入全新目录，不覆盖原件。'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const lock = await acquireDataLock(original);
  let staging;
  try {
    const project = validateProject(await optionalJson(path.join(original, 'project.json'), null));
    const settings = await optionalJson(path.join(original, 'artwork-settings.json'), {});
    const bindings = await optionalJson(path.join(original, 'source-bindings.json'), { schemaVersion: 1, bindings: {} });
    const binding = bindings.bindings[project.projectId];
    const archive = settings[project.projectId]?.root || path.join(path.dirname(tool), 'theme-archives', project.projectId);
    let hasArchive = false;
    try { await lstat(archive); hasArchive = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (hasArchive && (inside(await realpath(archive), root) || inside(root, await realpath(archive)))) throw new Error('新作品目录不能与原存档重叠。');
    const assets = await createAssetStore(original), exports = createExportService(assets, { status: () => ({ assets: [] }) });
    const archives = await createArtworkService({ dataDir: original, studioRoot: tool, exports, assets });
    const previous = await archives.status(project.projectId, binding?.config?.root);
    for (const version of previous.versions) await archives.verify(project.projectId, version.id, binding?.config?.root);
    staging = root + '.pending-' + randomUUID(); await mkdir(staging);
    const entries = [];
    if (hasArchive) await copyVerifiedTree(archive, staging, { entries });
    await copyVerifiedTree(original, path.join(staging, 'workspace'), { entries, prefix: 'workspace', skip: rel => rel === 'runtime.json' || rel.split(path.sep)[0] === '.studio-lock' });
    let sourceOriginal = null;
    if (copySource && binding?.config) {
      sourceOriginal = await realpath(binding.config.root);
      if (inside(sourceOriginal, tool) || inside(sourceOriginal, original) || inside(sourceOriginal, root) || inside(root, sourceOriginal)) throw new Error('源码根目录范围过大或与目标重叠；请先整理独立源码目录。');
      await copyVerifiedTree(sourceOriginal, path.join(staging, 'source'), { entries, prefix: 'source' });
      binding.config.root = path.join(root, 'source');
      binding.paused = true;
      binding.status = { state: 'paused', error: '作品目录已迁移，核对构建配置后继续同步。', updatedAt: new Date().toISOString() };
    }
    settings[project.projectId] = { ...settings[project.projectId], root };
    await atomicJson(path.join(staging, 'workspace/artwork-settings.json'), settings);
    await atomicJson(path.join(staging, 'workspace/source-bindings.json'), bindings);
    await atomicJson(path.join(staging, '.studio-artwork.json'), { schemaVersion: 1, projectId: project.projectId });
    const work = { format: 'tavern-theme-work', version: 1, name: project.name, projectId: project.projectId, workspace: 'workspace', createdAt: new Date().toISOString(), migratedFrom: { dataDir: original, archive: hasArchive ? archive : null, source: sourceOriginal } };
    await atomicJson(path.join(staging, 'artwork.json'), work);
    await mkdir(path.join(staging, 'references'), { recursive: true }); await mkdir(path.join(staging, 'previews'), { recursive: true });
    await writeFile(path.join(staging, 'README.md'), `# ${project.name}\n\n工作台中的「作品」是日常入口。\n\n- source/：可维护源码与素材。\n- workspace/：自动保存的当前工程、面板微调、修改意见与历史快照；运行时不要手工替换。\n- versions/：不可变的定稿，每版含 theme.json、工程、素材及已绑定源码。\n- references/、previews/：参考和验收图。\n- migration-report.json：迁移前文件的哈希记录；原目录完整保留。\n\n继续编辑：在工作台目录运行 npm start。源码迁移后先核对依赖并完成一次构建。\n`);
    const copied = validateProject(await optionalJson(path.join(staging, 'workspace/project.json'), null));
    if (projectFingerprint(copied) !== projectFingerprint(project)) throw new Error('迁移后的工程与原工程不一致。');
    const report = { version: 1, ...work.migratedFrom, destination: root, createdAt: work.createdAt, projectId: project.projectId, projectFingerprint: projectFingerprint(project), versions: previous.versions.map(v => v.id), files: entries, note: '文件列表记录复制时原始字节；新目录中的位置配置已单独更新。原目录未删除。' };
    await atomicJson(path.join(staging, 'migration-report.json'), report);
    await rename(staging, root); staging = null;
    // The durable copy exists before changing the launch pointer. On failure,
    // the old location remains usable and the new copy can be selected later.
    await selectWork(root, pointer);
    return { root, dataDir: path.join(root, 'workspace'), projectId: project.projectId, fingerprint: report.projectFingerprint, files: entries.length, versions: report.versions, original, sourcePaused: !!sourceOriginal };
  } catch (e) { if (staging) e.message += `（未完成副本保留在 ${staging}；原目录未删除）`; throw e; }
  finally { await lock.release(); }
}

export async function selectWork(root, pointer = workPointer) {
  const work = await readManagedWork(path.join(root, 'workspace'));
  if (!work) throw new Error('不是固定作品目录。');
  const project = validateProject(JSON.parse(await readFile(path.join(work.dataDir, 'project.json'), 'utf8')));
  if (project.projectId !== work.projectId) throw new Error('作品与当前工程身份不一致。');
  await atomicJson(pointer, { version: 1, root: work.root, projectId: work.projectId });
  return work;
}
