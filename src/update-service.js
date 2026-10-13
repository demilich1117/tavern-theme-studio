import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { crc32 } from '../scripts/zip.js';
import { applyFiles, digest, exists, safeRelative } from './install-service.js';

const repository = 'demilich1117/tavern-theme-studio';
const maxDownload = 128 * 1024 * 1024;
export function compareVersions(a, b) {
  const parse = value => { if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('无效的发行版本。'); return value.split('.').map(Number); };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export async function download(url, limit = maxDownload, fetcher = fetch) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'Tavern-Theme-Studio-Updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）。请检查网络后重试，当前程序未替换。`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('下载文件超过允许大小。');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('下载文件超过允许大小。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function latestPackage(currentVersion, fetcher = fetch) {
  const release = JSON.parse(await download(`https://api.github.com/repos/${repository}/releases/latest`, 2 * 1024 * 1024, fetcher));
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (release.draft || release.prerelease) throw new Error('更新接口没有返回正式发行版。');
  if (compareVersions(version, currentVersion) <= 0) return { version, current: true };
  const name = `tavern-theme-studio-${version}-core.zip`, base = `https://github.com/${repository}/releases/download/${encodeURIComponent(release.tag_name)}/`;
  const asset = release.assets?.find(a => a.name === name), checksum = release.assets?.find(a => a.name === name + '.sha256');
  if (asset?.browser_download_url !== base + name || checksum?.browser_download_url !== base + name + '.sha256') throw new Error('新版核心包或校验文件尚未发布完整，请稍后重试。');
  const sum = (await download(checksum.browser_download_url, 1024, fetcher)).toString().trim().split(/\s+/);
  if (sum.length !== 2 || !/^[a-f0-9]{64}$/i.test(sum[0]) || sum[1] !== name) throw new Error('发行包校验文件无效。');
  const bytes = await download(asset.browser_download_url, maxDownload, fetcher);
  if (digest(bytes) !== sum[0].toLowerCase()) throw new Error('下载校验未通过，当前程序未替换。');
  return { version, files: validateCoreZip(bytes, version) };
}

// Only the plain, single-volume ZIP layout emitted by our own packager is
// accepted. Validate bounds, central records, CRC, totals and manifest first.
export function readReleaseZip(zip) {
  if (zip.length < 22 || zip.length > maxDownload) throw new Error('安装包大小无效。');
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 20) !== 0 || zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0) throw new Error('安装包 ZIP 格式无效。');
  const count = zip.readUInt16LE(end + 10), directory = zip.readUInt32LE(end + 16);
  if (!count || count > 10000 || count !== zip.readUInt16LE(end + 8) || directory + zip.readUInt32LE(end + 12) !== end) throw new Error('安装包 ZIP 目录无效。');
  const files = new Map(), names = new Set(); let offset = 0, central = directory, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 30 > directory || central + 46 > end || zip.readUInt32LE(offset) !== 0x04034b50 || zip.readUInt32LE(central) !== 0x02014b50) throw new Error('安装包文件记录不完整。');
    const flags = zip.readUInt16LE(offset + 6), method = zip.readUInt16LE(offset + 8), crc = zip.readUInt32LE(offset + 14), size = zip.readUInt32LE(offset + 18), unpacked = zip.readUInt32LE(offset + 22), length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const cLength = zip.readUInt16LE(central + 28), cExtra = zip.readUInt16LE(central + 30), comment = zip.readUInt16LE(central + 32), start = offset + 30 + length + extra;
    if (flags !== 0x800 || ![0, 8].includes(method) || extra || cExtra || comment || start + size > directory || central + 46 + cLength > end || unpacked > 64 * 1024 * 1024 || (total += unpacked) > 512 * 1024 * 1024) throw new Error('安装包含不支持或过大的文件。');
    const name = zip.toString('utf8', offset + 30, offset + 30 + length);
    safeRelative(name);
    if (names.has(name.toLowerCase())) throw new Error('安装包包含重复文件。'); names.add(name.toLowerCase());
    if (zip.toString('utf8', central + 46, central + 46 + cLength) !== name || zip.readUInt32LE(central + 42) !== offset || zip.readUInt16LE(central + 8) !== flags || zip.readUInt16LE(central + 10) !== method || zip.readUInt32LE(central + 16) !== crc || zip.readUInt32LE(central + 20) !== size || zip.readUInt32LE(central + 24) !== unpacked || zip.readUInt32LE(central + 38) !== 0) throw new Error('安装包目录与内容不一致。');
    const packed = zip.subarray(start, start + size), bytes = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: 64 * 1024 * 1024 });
    if (bytes.length !== unpacked || crc32(bytes) !== crc) throw new Error('安装包文件校验失败。');
    files.set(name, bytes); offset = start + size; central += 46 + cLength;
  }
  if (offset !== directory || central !== end) throw new Error('安装包有未声明的内容。');
  return files;
}
function programPath(file) {
  safeRelative(file);
  if (file.split('/').some(part => part.startsWith('.')) || /^(?:output|theme-works|theme-archives)\//i.test(file) || /^(?:project|runtime|workspace-location)\.json$/i.test(file)) throw new Error(`发行包不能写入用户数据：${file}`);
  return file;
}
export function validateCoreZip(zip, version) {
  const archived = readReleaseZip(zip), prefix = 'tavern-theme-studio/', manifestBytes = archived.get(prefix + 'package-manifest.json');
  if (!manifestBytes) throw new Error('安装包缺少文件清单。');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.format !== 'tavern-theme-studio-core' || manifest.version !== version || !Array.isArray(manifest.files)) throw new Error('安装包版本或类型不匹配。');
  const files = new Map(), seen = new Set();
  for (const item of manifest.files) {
    const file = programPath(item.path), bytes = archived.get(prefix + file), key = file.toLowerCase();
    if (seen.has(key) || file === 'package-manifest.json' || !bytes || item.bytes !== bytes.length || item.sha256 !== digest(bytes)) throw new Error(`安装包清单校验失败：${file}`);
    seen.add(key); files.set(file, bytes);
  }
  if (archived.size !== files.size + 1 || JSON.parse(files.get('package.json') || '{}').name !== 'tavern-theme-studio' || JSON.parse(files.get('package.json') || '{}').version !== version || JSON.parse(files.get('connector/manifest.json') || '{}').version !== version) throw new Error('安装包文件或版本不完整。');
  for (const file of ['server.js', 'start.cmd', 'update.cmd', 'scripts/launcher.js', 'scripts/windows-launcher.ps1', 'node_modules/css-tree/package.json']) if (!files.has(file)) throw new Error(`安装包缺少必需文件：${file}`);
  files.set('package-manifest.json', manifestBytes);
  return files;
}
export async function applyCoreUpdate(root, files, options = {}) {
  if (await exists(path.join(root, '.git'))) throw new Error('源码目录需要通过 Git 更新，不能覆盖为发行包。');
  const oldPath = path.join(root, 'package-manifest.json');
  if (!await exists(oldPath)) throw new Error('当前目录缺少安装包清单，已停止覆盖；源码目录请使用 Git。');
  const old = JSON.parse(await readFile(oldPath, 'utf8'));
  if (old.format !== 'tavern-theme-studio-core' || !Array.isArray(old.files)) throw new Error('当前安装包清单无效。');
  // Do not discard local edits. A new download into a separate folder is still
  // available when a user intentionally customizes their installed program.
  for (const item of old.files) {
    programPath(item.path); const target = path.join(root, item.path);
    if (!await exists(target) || (await lstat(target)).isSymbolicLink() || digest(await readFile(target)) !== item.sha256) throw new Error(`程序文件有本地改动，已保留：${item.path}。请先另存改动再更新。`);
  }
  for (const file of files.keys()) programPath(file);
  const oldNames = new Set(old.files.map(item => item.path));
  for (const file of files.keys()) if (file !== 'package-manifest.json' && !oldNames.has(file) && await exists(path.join(root, file))) throw new Error(`新版本文件与本地文件重名，已保留：${file}`);
  return applyFiles({ root, files: [...files], remove: old.files.map(item => item.path).filter(file => !files.has(file)), backupHome: path.join(root, '.local/updates'), ...options });
}
