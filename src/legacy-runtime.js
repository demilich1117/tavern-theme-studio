import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

// Bounded discovery in this installation and its known work library. No drive
// scan, private chat reads, or process-name based termination.
export async function findLegacyRuntimes(root, registered = []) {
  root = await realpath(root);
  const directories = new Set([path.join(root, '.local'), path.join(root, '.local/native-lab')]);
  const skipped = new Set(['node_modules', 'assets', 'snapshots', 'backups', 'updates', 'connector-backups', 'compat-hosts', 'compat-sources', 'runtime']);
  let visited = 0;
  async function walk(folder, depth) {
    if (depth > 4 || visited++ > 500) return;
    let children; try { children = await readdir(folder, { withFileTypes: true }); } catch { return; }
    if (children.some(x => x.name === 'runtime.json' && x.isFile())) directories.add(folder);
    for (const child of children) if (child.isDirectory() && !skipped.has(child.name) && !child.name.startsWith('.')) await walk(path.join(folder, child.name), depth + 1);
  }
  await walk(path.join(root, '.local'), 0);
  let works = path.join(path.dirname(root), 'theme-works');
  try { const pointer = JSON.parse(await readFile(path.join(root, '.local/workspace-location.json'), 'utf8')); if (path.isAbsolute(pointer.root || '')) { directories.add(path.join(pointer.root, 'workspace')); works = path.dirname(pointer.root); } } catch {}
  try { for (const item of await readdir(works, { withFileTypes: true })) if (item.isDirectory() && !item.name.startsWith('.')) directories.add(path.join(works, item.name, 'workspace')); } catch {}
  if (process.env.STUDIO_DATA_DIR) directories.add(path.resolve(process.env.STUDIO_DATA_DIR));
  const results = [];
  for (const directory of directories) {
    try {
      const record = JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'));
      if (!Number.isSafeInteger(record.pid) || record.pid < 1 || registered.some(r => r.address === record.address)) continue;
      try { process.kill(record.pid, 0); } catch (e) { if (e.code === 'ESRCH') continue; }
      const address = new URL(record.address);
      if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port || address.pathname !== '/' || address.username || address.password || address.search || address.hash) continue;
      const dataDir = await realpath(directory);
      let actual;
      try {
        const response = await fetch(new URL('/api/project', address), { signal: AbortSignal.timeout(1500), redirect: 'error' });
        actual = response.ok ? await response.json() : null;
      } catch { /* A live owner without a response must still block uninstall. */ }
      results.push({ pid: record.pid, address: record.address, dataDir, name: actual?.project?.name,
        status: actual?.dataDir === dataDir && actual?.projectId ? 'legacy' : 'unverified',
        error: '旧后台尚未纳入新版登记。可运行 stop.cmd 尝试关闭；没有关闭接口时请退出原窗口，或按此 PID 在任务管理器核对后结束。不要结束所有 Node 进程。' });
    } catch { /* Missing or inaccessible directories are not shutdown authority. */ }
  }
  return results;
}
