import { readFile, writeFile, mkdir, readdir, lstat, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { connectorFiles } from '../scripts/connector-files.js';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function exists(file) { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export function safeRelative(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.startsWith('/') || /[:\x00-\x1f]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error(`无效的安装文件路径：${file}`);
  return file;
}
export async function safeTarget(root, relative) {
  safeRelative(relative);
  let current = root;
  // Reject links even when their apparent destination is inside the installation.
  for (const part of ['', ...relative.split('/')]) {
    if (part) current = path.join(current, part);
    if (await exists(current)) {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`安装路径不能经过链接：${current}`);
    }
  }
  return current;
}
async function atomicBytes(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tts-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try { await rename(temporary, file); } catch (e) { await unlink(temporary).catch(() => {}); throw e; }
}
const json = (file, value) => atomicBytes(file, JSON.stringify(value, null, 2));

// Back up every changed file before touching the installation. Unlisted files,
// user data and locally added files are left alone. Journals survive interruption.
export async function applyFiles({ root, files, remove = [], backupHome, beforeWrite = async () => {} }) {
  root = await realpath(root);
  const entries = [], seen = new Set();
  for (const [file, bytes] of [...files, ...remove.map(file => [file, null])]) {
    safeRelative(file); const key = file.toLowerCase();
    if (seen.has(key)) throw new Error(`安装清单有重复路径：${file}`); seen.add(key);
    const target = await safeTarget(root, file);
    let previous = null;
    if (await exists(target)) {
      if (!(await lstat(target)).isFile()) throw new Error(`文件位置被目录占用：${target}`);
      previous = await readFile(target);
    }
    if (bytes === null && previous === null || bytes !== null && previous?.equals(bytes)) continue;
    entries.push({ file, bytes, previous });
  }
  if (!entries.length) return { changed: 0 };
  const backup = path.join(backupHome, `${Date.now()}-${randomUUID()}`);
  await mkdir(backup, { recursive: true });
  for (const entry of entries) if (entry.previous !== null) {
    const file = path.join(backup, 'files', entry.file); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, entry.previous);
  }
  const journal = { format: 'tts-install-transaction', version: 1, root, status: 'prepared', entries: entries.map(e => ({ file: e.file, existed: e.previous !== null, before: e.previous === null ? null : digest(e.previous), after: e.bytes === null ? null : digest(e.bytes) })) };
  const journalPath = path.join(backup, 'transaction.json'); await json(journalPath, journal);
  journal.status = 'applying'; await json(journalPath, journal);
  try {
    for (const entry of entries) {
      const target = await safeTarget(root, entry.file);
      await beforeWrite(entry.file);
      if (entry.bytes === null) await unlink(target); else await atomicBytes(target, entry.bytes);
    }
    journal.status = 'complete'; await json(journalPath, journal);
  } catch (e) {
    await restoreTransaction(backup, root);
    throw new Error(`安装未完成，已恢复原文件：${e.message}`, { cause: e });
  }
  return { changed: entries.length, backup };
}
export async function restoreTransaction(backup, expectedRoot) {
  const file = path.join(backup, 'transaction.json'), journal = JSON.parse(await readFile(file, 'utf8'));
  if (journal.format !== 'tts-install-transaction' || journal.version !== 1 || journal.root !== await realpath(expectedRoot) || !Array.isArray(journal.entries)) throw new Error('安装备份与当前目录不匹配。');
  if (journal.status !== 'applying') return;
  // Verify all backups and current files before restoring any of them.
  const restores = [];
  for (const entry of journal.entries) {
    const target = await safeTarget(journal.root, entry.file), present = await exists(target) ? await readFile(target) : null;
    const hash = present === null ? null : digest(present);
    if (hash !== entry.before && hash !== entry.after) throw new Error(`更新中断后文件又被修改，已保留现场：${entry.file}；备份：${backup}`);
    const bytes = entry.existed ? await readFile(await safeTarget(backup, `files/${entry.file}`)) : null;
    if (bytes !== null && digest(bytes) !== entry.before) throw new Error('安装备份校验失败，已保留现场。');
    restores.push({ target, bytes });
  }
  for (const { target, bytes } of restores.reverse()) {
    if (bytes !== null) await atomicBytes(target, bytes); else if (await exists(target)) await unlink(target);
  }
  journal.status = 'restored'; await json(file, journal);
}
export async function recoverInstalls(backupHome, root) {
  if (!await exists(backupHome)) return;
  for (const entry of await readdir(backupHome, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const backup = path.join(backupHome, entry.name), file = path.join(backup, 'transaction.json');
    if (!await exists(file)) continue;
    const journal = JSON.parse(await readFile(file, 'utf8'));
    if (journal.status === 'applying' && journal.root === await realpath(root)) await restoreTransaction(backup, root);
  }
}

// Read only the few scalar host settings needed for installation, never users'
// settings or chats. Complex YAML is not guessed; the folder can be specified.
export function configScalar(text, name, fallback) {
  const match = text.match(new RegExp(`^${name}:\\s*(.*?)\\s*$`, 'm'));
  if (!match) return fallback;
  const raw = match[1].replace(/\s+#.*$/, '').trim();
  if (raw.startsWith('"')) { try { return JSON.parse(raw); } catch { throw new Error(`酒馆 ${name} 配置无法识别。`); } }
  if (raw.startsWith("'")) { if (!raw.endsWith("'")) throw new Error(`酒馆 ${name} 配置无法识别。`); return raw.slice(1, -1).replaceAll("''", "'"); }
  if (!raw || /^[!&*[{>|]/.test(raw)) throw new Error(`酒馆 ${name} 使用复杂配置，请指定实际目录或地址。`);
  return raw;
}
export async function inspectTavern(directory, { dataRoot, url } = {}) {
  const root = await realpath(directory), pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'sillytavern' || !await exists(path.join(root, 'server.js')) || !await exists(path.join(root, 'public/scripts/extensions.js'))) throw new Error('请选择 SillyTavern 文件夹（含 server.js 和 package.json）。');
  let config = ''; try { config = await readFile(path.join(root, 'config.yaml'), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const data = await realpath(path.resolve(root, dataRoot || configScalar(config, 'dataRoot', './data'))).catch(() => { throw new Error('尚未找到酒馆数据目录，请先启动一次酒馆；自定义位置可用 --data-root 指定。'); });
  const profiles = [];
  for (const item of await readdir(data, { withFileTypes: true })) if (item.isDirectory() && !item.isSymbolicLink() && (await exists(path.join(data, item.name, 'settings.json')) || await exists(path.join(data, item.name, 'extensions')))) profiles.push(item.name);
  if (!profiles.length) throw new Error('尚未找到酒馆用户，请先启动并登录一次酒馆。');
  const host = new URL(url || `http://127.0.0.1:${configScalar(config, 'port', '8000')}`);
  if (!['http:', 'https:'].includes(host.protocol) || host.username || host.password) throw new Error('酒馆地址必须是 HTTP(S) 地址。');
  host.hash = '';
  return { root, dataRoot: data, profiles: profiles.sort(), url: host.href };
}
export async function installConnector({ studioRoot, tavern, profile, backupHome, receiptHome = path.join(studioRoot, '.local/connector-installs') }) {
  if (!tavern.profiles.includes(profile)) throw new Error('请选择酒馆中已有的用户。');
  const relative = `${profile}/extensions/tavern-theme-studio-connector`;
  const target = await safeTarget(tavern.dataRoot, relative);
  const manifestPath = path.join(target, 'manifest.json');
  if (await exists(manifestPath)) {
    const installed = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (installed.js !== 'connector/index.js' || installed.author !== 'Tavern Theme Studio') throw new Error('连接器目录中是其他内容，已保留，请选择正确的酒馆位置。');
  }
  await mkdir(target, { recursive: true });
  await recoverInstalls(backupHome, target);
  const files = await Promise.all(Object.entries(connectorFiles).map(async ([destination, source]) => [destination, await readFile(path.join(studioRoot, source))]));
  const result = await applyFiles({ root: target, files, backupHome });
  // Keep every configured host/profile, not only the most recent selection.
  await mkdir(receiptHome, { recursive: true });
  await json(path.join(receiptHome, digest(Buffer.from(await realpath(target))) + '.json'), {
    format: 'tts-connector-install-v1', tavernRoot: tavern.root, dataRoot: tavern.dataRoot, profile, target: await realpath(target),
    files: files.map(([file, bytes]) => ({ file, sha256: digest(bytes) })),
  });
  return { ...result, target };
}
