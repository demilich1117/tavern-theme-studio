import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';

export const studioRoot = path.resolve(import.meta.dirname, '..');
export const workPointer = path.join(studioRoot, '.local', 'workspace-location.json');
export const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

export async function readManagedWork(dataDir) {
  const data = await realpath(dataDir), root = path.dirname(data);
  if (path.basename(data) !== 'workspace') return null;
  const file = path.join(root, 'artwork.json');
  let bytes;
  try { bytes = await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if ((await lstat(file)).isSymbolicLink()) throw new Error('作品说明不能是符号链接。');
  const work = JSON.parse(bytes);
  if (work.format !== 'tavern-theme-work' || work.version !== 1 || typeof work.projectId !== 'string' || !work.projectId || work.workspace !== 'workspace') throw new Error('作品目录说明无效，请保留原目录并检查 artwork.json。');
  if (inside(await realpath(studioRoot), root)) throw new Error('作品目录必须位于工作台程序之外。');
  return { ...work, root, dataDir: data };
}

export async function resolveDataDirectory(fallback = '.local/native-lab', { pointer = workPointer, directory = process.env.STUDIO_DATA_DIR } = {}) {
  if (directory) return path.resolve(directory);
  let saved;
  try { saved = JSON.parse(await readFile(pointer, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return path.join(studioRoot, fallback); throw e; }
  if (saved.version !== 1 || typeof saved.root !== 'string' || !path.isAbsolute(saved.root)) throw new Error('作品位置记录无效，请检查 workspace-location.json。');
  const dataDir = path.join(saved.root, 'workspace'), work = await readManagedWork(dataDir);
  if (!work || work.projectId !== saved.projectId) throw new Error('找不到原作品目录或作品身份不一致；不会创建空工程覆盖它。');
  return work.dataDir;
}
