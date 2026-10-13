import path from 'node:path';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { exists, inspectTavern, installConnector, recoverInstalls } from '../src/install-service.js';
import { readLauncher, manageLauncher } from '../src/launcher-service.js';
import { acquireDataLock } from '../src/data-lock.js';
import { openFolder } from '../src/open-folder.js';

const root = path.resolve(import.meta.dirname, '..'), settingsFile = path.join(root, '.local/installation.json');
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const quietBrowser = args.includes('--no-browser') || process.env.STUDIO_NO_BROWSER === '1';
async function ask(question) {
  if (!process.stdin.isTTY) throw new Error('首次安装请双击 start.cmd 选择酒馆目录，或传入 --tavern <目录> 和 --profile <用户>。');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(question)).trim(); } finally { input.close(); }
}
async function pickTavern() {
  console.log('首次使用：请选择酒馆的 SillyTavern 文件夹，之后会记住位置。');
  if (process.platform === 'win32') {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/select-tavern.ps1')], { windowsHide: true, encoding: 'utf8' });
    const selected = stdout.replace(/^\uFEFF/, '').trim(); if (!selected) throw new Error('已取消选择，没有更改酒馆。'); return selected;
  }
  return ask('酒馆文件夹路径：');
}
async function main() {
  const running = await readLauncher(root);
  if (running && !args.includes('--configure')) {
    console.log('工作台已在运行，正在打开测试页。'); if (!quietBrowser) await openFolder(running.url); return;
  }
  const maintenance = await acquireDataLock(path.join(root, '.local/maintenance'));
  let app, manager;
  try {
    await recoverInstalls(path.join(root, '.local/updates'), root);
    let saved = {};
    if (await exists(settingsFile)) saved = JSON.parse(await readFile(settingsFile, 'utf8'));
    let directory = option('--tavern') || process.env.STUDIO_TAVERN_DIR || saved.tavernRoot;
    if (!directory || !await exists(directory)) directory = await pickTavern();
    const tavern = await inspectTavern(directory, { dataRoot: option('--data-root') || process.env.STUDIO_TAVERN_DATA_DIR || (directory === saved.tavernRoot ? saved.dataRoot : undefined), url: option('--url') || process.env.TAVERN_URL || (directory === saved.tavernRoot ? saved.url : undefined) });
    let profile = option('--profile') || (directory === saved.tavernRoot ? saved.profile : undefined);
    if (!tavern.profiles.includes(profile)) {
      if (tavern.profiles.length === 1) profile = tavern.profiles[0];
      else { console.log('这个酒馆有多个用户，请选择你使用的一个：'); tavern.profiles.forEach((name, i) => console.log(`  ${i + 1}. ${name}`)); profile = tavern.profiles[Number(await ask('用户序号：')) - 1]; }
    }
    const installed = await installConnector({ studioRoot: root, tavern, profile, backupHome: path.join(root, '.local/connector-backups') });
    if (!await exists(path.join(root, 'package-manifest.json'))) await promisify(execFile)(process.execPath, [path.join(root, 'scripts/package-connector.js')], { cwd: root, windowsHide: true });
    await mkdir(path.dirname(settingsFile), { recursive: true });
    const temporary = settingsFile + '.' + process.pid + '.tmp';
    await writeFile(temporary, JSON.stringify({ version: 1, tavernRoot: tavern.root, dataRoot: tavern.dataRoot, profile, url: tavern.url }, null, 2));
    await rename(temporary, settingsFile);
    console.log(installed.changed ? '酒馆连接器已安装 / 更新。' : '酒馆连接器已就绪。');
    if (args.includes('--setup-only')) return;
    process.env.TAVERN_URL = tavern.url;
    const { startNativeLab } = await import('./start-native-lab.js');
    app = await startNativeLab();
    if (!app.reused) manager = await manageLauncher({ root, app, url: app.url, version: JSON.parse(await readFile(path.join(root, 'package.json'))).version });
    console.log('工作台已打开。日常双击 start.cmd，更新双击 update.cmd。');
    if (!quietBrowser) await openFolder(app.url).catch(() => console.log(`请在浏览器打开：${app.url}`));
    if (manager) for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => manager.close().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exitCode = 1; }));
  } catch (e) { await manager?.close(); if (!manager && app && !app.reused) await app.close(); throw e; }
  finally { await maintenance.release(); }
}
main().catch(e => { console.error(`\n${e.message}\n解决后再次双击即可；已有作品会保留。`); process.exitCode = 1; });
