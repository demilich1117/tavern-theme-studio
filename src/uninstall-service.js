import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { applyFiles, exists, safeTarget, safeRelative, digest } from './install-service.js';
import { connectorFiles } from '../scripts/connector-files.js';
import { listRuntimes, stopRuntimes } from './runtime-service.js';
import { findLegacyRuntimes } from './legacy-runtime.js';
import { stopLauncher, requireStopped } from './launcher-service.js';

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const allowedProgram = file => /^(?:[\w-]+\.js$|package(?:-lock|-manifest)?\.json$|(?:start|update|manage|stop|uninstall)\.cmd$|README\.md$|AGENTS\.md$|LICENSE$|THIRD-PARTY-NOTICES\.md$|(?:src|public|shared|connector|scripts|skills|docs|node_modules)\/|examples\/starter\.theme\.json$|dist\/tavern-theme-studio-connector\.zip$)/.test(file);

export async function prepareUninstall(directory) {
  const root = await realpath(directory);
  if ((await readJson(path.join(root, 'package.json'))).name !== 'tavern-theme-studio') throw new Error('不是主题工作台程序目录。');
  const targets = new Map(), receiptHome = path.join(root, '.local/connector-installs');
  if (await exists(receiptHome)) {
    for (const item of await readdir(receiptHome, { withFileTypes: true })) if (item.isFile() && /^[a-f0-9]{64}\.json$/.test(item.name)) {
      const receipt = await readJson(await safeTarget(root, `.local/connector-installs/${item.name}`));
      if (receipt.format !== 'tts-connector-install-v1' || !Array.isArray(receipt.files)) throw new Error('连接器安装记录损坏，请先检查。');
      targets.set(receipt.target, receipt);
    }
  }
  const installation = path.join(root, '.local/installation.json');
  if (await exists(installation)) {
    const saved = await readJson(installation);
    if (typeof saved.dataRoot !== 'string' || !path.isAbsolute(saved.dataRoot) || typeof saved.profile !== 'string') throw new Error('酒馆安装位置记录无效。');
    const target = path.join(saved.dataRoot, saved.profile, 'extensions/tavern-theme-studio-connector');
    if (!targets.has(target)) targets.set(target, { ...saved, target, files: [] });
  }
  const connectors = [];
  for (const record of targets.values()) {
    if (!path.isAbsolute(record.dataRoot || '') || !path.isAbsolute(record.target || '') || typeof record.profile !== 'string' || record.profile.includes('/') || record.profile.includes('\\')) throw new Error('连接器位置记录无效。');
    const target = await safeTarget(record.dataRoot, `${record.profile}/extensions/tavern-theme-studio-connector`);
    if (path.resolve(target) !== path.resolve(record.target)) throw new Error('连接器位置与安装记录不匹配。');
    const manifestFile = await safeTarget(target, 'manifest.json');
    if (!await exists(manifestFile)) continue;
    const manifest = await readJson(manifestFile);
    if (manifest.author !== 'Tavern Theme Studio' || manifest.js !== 'connector/index.js') throw new Error(`连接器目录中是其他内容，未卸载：${target}`);
    const hashes = new Map(record.files.map(x => [x.file, x.sha256]));
    const remove = [], retained = [];
    for (const file of Object.keys(connectorFiles)) {
      const destination = await safeTarget(target, file);
      if (!await exists(destination)) continue;
      const bytes = await readFile(destination);
      // Disabling the verified manifest also covers legacy installations that
      // never recorded hashes. Modified and unknown files remain recoverable.
      if (file === 'manifest.json' || hashes.get(file) === digest(bytes)) remove.push({ file, sha256: digest(bytes) });
      else retained.push(file);
    }
    connectors.push({ target, remove, retained });
  }
  const manifestPath = path.join(root, 'package-manifest.json');
  const source = await exists(path.join(root, '.git')) || !await exists(manifestPath);
  const program = [], retained = [];
  if (!source) {
    const manifest = await readJson(manifestPath);
    if (manifest.format !== 'tavern-theme-studio-core' || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('程序安装清单无效，未卸载。');
    const seen = new Set();
    for (const item of manifest.files) {
      safeRelative(item.path);
      if (item.path === 'package-manifest.json' || !allowedProgram(item.path) || item.path.split('/').some(p => p.startsWith('.')) || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || seen.has(item.path.toLowerCase())) throw new Error('程序安装清单包含不允许的路径或重复项。');
      seen.add(item.path.toLowerCase());
      const file = await safeTarget(root, item.path);
      if (!await exists(file)) continue;
      if (!(await lstat(file)).isFile()) throw new Error(`程序文件变为目录：${file}`);
      const actual = digest(await readFile(file));
      if (actual === item.sha256) program.push({ file: item.path, sha256: actual }); else retained.push(item.path);
    }
    program.push({ file: 'package-manifest.json', sha256: digest(await readFile(manifestPath)) });
  }
  return { root, source, connectors, program, retained };
}

export async function uninstallStudio(plan, { runtimeHome } = {}) {
  await safeTarget(plan.root, '.local/uninstall-backups');
  async function verifyPlan() {
    for (const group of [...plan.connectors, { target: plan.root, remove: plan.program }]) {
      for (const item of group.remove) if (digest(await readFile(await safeTarget(group.target, item.file))) !== item.sha256) throw new Error('文件在预览后被修改，请重新运行卸载检查。');
    }
  }
  await verifyPlan();
  const stopped = await stopRuntimes({ home: runtimeHome, root: plan.root });
  if (stopped.some(r => r.status !== 'stopped')) throw new Error('仍有后台无法安全关闭，程序文件已保留；请先打开 manage.cmd 检查。');
  await stopLauncher(plan.root);
  const registered = await listRuntimes({ home: runtimeHome });
  if (registered.some(r => r.root === plan.root && r.status !== 'stale')) throw new Error('卸载期间又启动了工作台，请关闭后重试。');
  const remaining = await findLegacyRuntimes(plan.root, registered);
  if (remaining.length) throw new Error(`发现旧后台仍占用作品（PID ${remaining.map(r => r.pid).join(', ')}），请关闭后重试；未移除任何文件。`);
  await requireStopped([path.join(plan.root, '.local'), path.join(plan.root, '.local/native-lab')]);
  await verifyPlan();
  const backups = [];
  for (const connector of plan.connectors) {
    const result = await applyFiles({ root: connector.target, files: [], remove: connector.remove.map(x => x.file), backupHome: path.join(plan.root, '.local/uninstall-backups/connectors') });
    if (result.backup) backups.push(result.backup);
  }
  if (plan.program.length) {
    const result = await applyFiles({ root: plan.root, files: [], remove: plan.program.map(x => x.file), backupHome: path.join(plan.root, '.local/uninstall-backups/program') });
    if (result.backup) backups.push(result.backup);
  }
  return { backups, source: plan.source, removedProgramFiles: plan.program.length, connectors: plan.connectors.length, retained: plan.retained };
}
