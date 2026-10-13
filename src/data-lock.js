import { mkdir, readFile, writeFile, realpath, rename, unlink, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
};
const locked = detail => Object.assign(new Error(`数据目录已被占用或锁状态无法确认：${detail}。请关闭对应工作台；不要让两个服务写入同一目录。`), { code: 'STUDIO_DATA_LOCKED' });

// A directory lock precedes migrations, runners and all other persistent writes.
// PID reuse / unreadable owners fail closed. A dead owner can be reclaimed by
// one reaper; rereading under that guard prevents deleting a newly acquired lock.
export async function acquireDataLock(directory) {
  await mkdir(directory, { recursive: true });
  const dataDir = await realpath(directory), dir = path.join(dataDir, '.studio-lock');
  const owner = { pid: process.pid, nonce: randomUUID(), startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await mkdir(dir); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let old;
      try { old = JSON.parse(await readFile(path.join(dir, 'owner.json'), 'utf8')); }
      catch { throw locked('owner.json 未完成或损坏，先检查服务进程'); }
      if (alive(old.pid)) throw locked(`PID ${old.pid}`);
      const guard = path.join(dir, 'reaping');
      try { await writeFile(guard, JSON.stringify(owner), { flag: 'wx' }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw locked('另一个进程正在恢复锁'); }
      let moved = false;
      try {
        const current = JSON.parse(await readFile(path.join(dir, 'owner.json'), 'utf8'));
        if (current.nonce !== old.nonce || alive(current.pid)) throw locked(`PID ${current.pid}`);
        const abandoned = `${dir}.stale-${owner.nonce}`;
        await rename(dir, abandoned); moved = true;
        await unlink(path.join(abandoned, 'owner.json'));
        await unlink(path.join(abandoned, 'reaping'));
        await rmdir(abandoned);
      } finally { if (!moved) await unlink(guard).catch(() => {}); }
      continue;
    }
    try { await writeFile(path.join(dir, 'owner.json'), JSON.stringify(owner), { flag: 'wx' }); }
    catch (e) { await rmdir(dir).catch(() => {}); throw e; }
    // Pre-lock releases still leave runtime.json. Refuse an in-place upgrade
    // while that process is alive, even when it has no .studio-lock directory.
    try {
      let legacy;
      try { legacy = JSON.parse(await readFile(path.join(dataDir, 'runtime.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (legacy && alive(legacy.pid)) throw locked(`runtime.json 对应 PID ${legacy.pid} 仍存在`);
    } catch (e) { await unlink(path.join(dir, 'owner.json')); await rmdir(dir); throw e; }
    let released = false;
    return { dataDir, owner, async release() {
      if (released) return;
      const current = JSON.parse(await readFile(path.join(dir, 'owner.json'), 'utf8'));
      if (current.nonce !== owner.nonce) throw locked('锁的所有者发生变化');
      await unlink(path.join(dir, 'owner.json')); await rmdir(dir); released = true;
    } };
  }
  throw locked('恢复竞争，请稍后重试');
}
