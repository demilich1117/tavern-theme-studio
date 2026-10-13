import { mkdir, readdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createProject, validateProject } from '../shared/core.js';
import { atomicJson } from './storage-migrations.js';
import { createAssetStore } from './asset-store.js';
import { readManagedWork, inside, studioRoot } from './work-location.js';

export function createWorkLibrary({ home, pointer }) {
  async function list() {
    let entries;
    try { entries = await readdir(home, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const works = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      try {
        const work = await readManagedWork(path.join(home, entry.name, 'workspace'));
        if (!work || path.dirname(work.root) !== await realpath(home)) continue;
        const project = validateProject(JSON.parse(await readFile(path.join(work.dataDir, 'project.json'), 'utf8')));
        if (project.projectId === work.projectId) works.push({ projectId: work.projectId, name: project.name, root: work.root, dataDir: work.dataDir });
      } catch { /* Incomplete or damaged folders are never offered as switch targets. */ }
    }
    return works.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  async function find(projectId) {
    const matches = (await list()).filter(work => work.projectId === projectId);
    if (matches.length !== 1) throw new Error('作品不存在或身份重复，请检查作品目录。');
    return matches[0];
  }
  async function remember(work) {
    if (pointer) await atomicJson(pointer, { version: 1, root: work.root, projectId: work.projectId });
  }
  async function create(theme, { scaffold = false } = {}) {
    const initial = createProject(theme);
    await mkdir(home, { recursive: true });
    const parent = await realpath(home), tool = await realpath(studioRoot);
    if (inside(tool, parent) || inside(parent, tool)) throw new Error('作品目录需要与工作台程序分开。');
    const slug = theme.name.normalize('NFKC').replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 48).replace(/^-+|-+$/g, '') || 'theme';
    const root = path.join(parent, `work-${slug}-${initial.projectId.slice(0, 8)}`);
    const staging = path.join(parent, `.pending-${initial.projectId}`), dataDir = path.join(staging, 'workspace');
    await mkdir(staging); await mkdir(dataDir);
    const assets = await createAssetStore(dataDir);
    const { project } = await assets.command({ type: 'import-project', project: initial }, initial);
    await atomicJson(path.join(dataDir, 'project.json'), validateProject(project));
    await atomicJson(path.join(staging, '.studio-artwork.json'), { schemaVersion: 1, projectId: project.projectId });
    await atomicJson(path.join(staging, 'artwork.json'), { format: 'tavern-theme-work', version: 1, name: project.name, projectId: project.projectId, workspace: 'workspace', createdAt: new Date().toISOString() });
    for (const name of ['source', 'references', 'previews', 'versions']) await mkdir(path.join(staging, name));
    if (scaffold) {
      const { custom_css = '', ...fields } = theme;
      await writeFile(path.join(staging, 'source/theme.css'), custom_css);
      await atomicJson(path.join(staging, 'source/theme-fields.json'), fields);
      await atomicJson(path.join(staging, 'source/assets.manifest.json'), { version: 1, assets: [] });
      await atomicJson(path.join(staging, 'source/studio.recipe.json'), { schemaVersion: 1, id: 'work-' + project.projectId, name: project.name, version: '1', slots: [], variables: [] });
      await mkdir(path.join(staging, 'source/assets'));
      await atomicJson(path.join(dataDir, 'source-bindings.json'), { schemaVersion: 1, bindings: { [project.projectId]: {
        version: 1, config: { root: path.join(root, 'source'), program: '$STUDIO_THEME', args: [], watch: ['theme.css', 'theme-fields.json', 'assets.manifest.json', 'studio.recipe.json', 'assets'], mode: 'local', debounceMs: 180, timeoutMs: 60000 },
        autoSync: true, paused: false, status: { state: 'idle' }
      } } });
    }
    await atomicJson(path.join(staging, 'references/imported.theme.json'), theme);
    await writeFile(path.join(staging, 'README.md'), `# ${project.name}\n\n在工作台「作品 → 切换作品」中继续编辑。\n\n- workspace/：自动保存的工程、微调、素材、快照和修改意见。\n- versions/：保存定稿后的独立版本。\n- references/imported.theme.json：接入时的原始主题。\n- source/：${scaffold ? '可维护源码，已自动连接实时同步。' : '留给后续可维护源码；尚未绑定构建。'}\n- previews/：验收记录。\n\n运行时请通过工作台修改工程，不直接覆盖 workspace/project.json。\n`);
    if (scaffold) await writeFile(path.join(staging, 'source/README.md'), '# 主题源码\n\n已自动连接工作台。修改 theme.css 或 theme-fields.json 后保存即可预览。素材放入 assets/ 并在 assets.manifest.json 声明；可调装饰和中文变量写入 studio.recipe.json，保持已有 ID 稳定。用户在工作台的微调会在源码同步时保留。\n');
    await rename(staging, root);
    return { root, dataDir: path.join(root, 'workspace'), projectId: project.projectId, name: project.name };
  }
  return { list, find, create, remember };
}
