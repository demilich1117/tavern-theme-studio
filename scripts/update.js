import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireDataLock } from '../src/data-lock.js';
import { exists, recoverInstalls } from '../src/install-service.js';
import { latestPackage, applyCoreUpdate } from '../src/update-service.js';
import { stopLauncher, requireStopped } from '../src/launcher-service.js';
import { resolveDataDirectory } from '../src/work-location.js';
import { stopRuntimes } from '../src/runtime-service.js';
import { findLegacyRuntimes } from '../src/legacy-runtime.js';
import { realpath } from 'node:fs/promises';

const root = path.resolve(import.meta.dirname, '..');
const run = promisify(execFile);
const git = async args => (await run('git', args, { cwd: root, windowsHide: true, timeout: 120000 })).stdout.trim();
async function stop() {
  const results = await stopRuntimes({ root: await realpath(root) });
  if (results.some(r => r.status !== 'stopped')) throw new Error('部分后台无法安全关闭，请先通过 manage.cmd 检查。');
  await stopLauncher(root);
  if ((await findLegacyRuntimes(root)).length) throw new Error('仍有旧后台占用作品，请通过 manage.cmd 查看后关闭。');
  await requireStopped([await resolveDataDirectory(), path.join(root, '.local'), path.join(root, '.local/native-lab')]);
}
async function main() {
  const maintenance = await acquireDataLock(path.join(root, '.local/maintenance'));
  try {
    await recoverInstalls(path.join(root, '.local/updates'), root);
    if (await exists(path.join(root, '.git'))) {
      if (await git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('程序源码有未提交修改，已保留。请先保存这些修改，再点击更新。');
      if (await git(['branch', '--show-current']) !== 'master') throw new Error('当前不是 master 分支，已保留开发分支；请在 Git 中更新该分支。');
      const remote = await git(['remote', 'get-url', 'origin']);
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)demilich1117\/tavern-theme-studio(?:\.git)?$/.test(remote)) throw new Error('当前是自定义源码仓库，请用 Git 更新；没有更改远端设置。');
      console.log('正在检查源码更新…'); await git(['fetch', '--no-tags', 'origin', 'master']);
      const previous = await git(['rev-parse', 'HEAD']), next = await git(['rev-parse', 'origin/master']);
      if (previous === next) { console.log('源码已是最新版本，正在重新同步并启动。'); await stop(); return; }
      await git(['merge-base', '--is-ancestor', 'HEAD', 'origin/master']);
      await stop();
      await git(['merge', '--ff-only', 'origin/master']);
      console.log(`源码已更新。原版本 ${previous.slice(0, 8)} 可从 Git 历史找回。`);
    } else {
      console.log('正在检查正式安装包更新…');
      const current = JSON.parse(await readFile(path.join(root, 'package.json'))).version;
      const candidate = await latestPackage(current);
      if (candidate.current) { console.log(`当前 ${current} 已不低于最新发行版 ${candidate.version}，正在重新同步并启动。`); await stop(); return; }
      console.log(`新版 ${candidate.version} 已下载并校验，正在保存并关闭工作台…`);
      await stop();
      const result = await applyCoreUpdate(root, candidate.files);
      console.log(`工作台已更新到 ${candidate.version}。原程序备份：${result.backup}`);
    }
  } finally { await maintenance.release(); }
}
main().catch(e => { console.error(`\n更新未完成：${e.message}\n已有作品和本地配置会保留。`); process.exitCode = 1; });
