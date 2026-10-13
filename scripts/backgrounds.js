import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { listRuntimes, stopRuntimes } from '../src/runtime-service.js';
import { findLegacyRuntimes } from '../src/legacy-runtime.js';
import { readLauncher, stopLauncher } from '../src/launcher-service.js';
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
async function show() {
  const instances = (await listRuntimes()).filter(r => r.status !== 'stale');
  const legacy = await findLegacyRuntimes(root, instances);
  if (args.includes('--json')) { console.log(JSON.stringify({ instances, legacy }, null, 2)); return { instances, legacy }; }
  console.log('\n运行中的主题工作台（所有安装目录）');
  for (const [index, row] of instances.entries()) console.log(`${index + 1}. ${row.name || '未能核验'} · ${row.status}\n   ${row.address || ''} · PID ${row.pid || '?'}\n   作品：${row.dataDir || '无法读取'}\n   程序：${row.root || '无法读取'}\n   启动：${row.startedAt || '?'}${row.error ? '\n   '+row.error : ''}`);
  if (!instances.length) console.log('没有登记在运行的新版后台。');
  for (const row of legacy) console.log(`旧后台：${row.name || ''} · ${row.address} · PID ${row.pid}\n   ${row.dataDir}\n   ${row.error}`);
  return { instances, legacy };
}
async function stop(ids) {
  console.log('正在等待保存、结束任务并释放作品占用…');
  const results = await stopRuntimes({ ids });
  for (const row of results) console.log(`${row.name || row.id}：${row.status === 'stopped' ? '已关闭' : row.error}`);
  // 0.11 one-click starts already have an authenticated control channel.
  try { if (await readLauncher(root)) await stopLauncher(root); } catch (e) { console.error(e.message); process.exitCode = 1; }
  const remaining = await show();
  if (results.some(r => r.status === 'failed') || remaining.legacy.length || remaining.instances.length) process.exitCode = 1;
  else console.log('已关闭全部可发现的工作台后台。酒馆本体保持运行。');
}
async function main() {
  const { instances } = await show();
  if (args.includes('--json') || args.includes('--list')) return;
  if (args.includes('--stop-all')) return stop();
  if (args.includes('--stop')) {
    const id = args[args.indexOf('--stop') + 1];
    if (!instances.some(r => r.id === id)) throw new Error('后台 ID 不在当前列表中，请先 --json 查看。');
    const [result] = await stopRuntimes({ ids: [id] });
    if (result?.status !== 'stopped') throw new Error(result?.error || '未能关闭后台');
    console.log('已关闭指定后台。'); return;
  }
  if (!process.stdin.isTTY) throw new Error('使用 --list 查看，或 --stop-all 关闭全部。');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await input.question('\n输入序号关闭一个，A 关闭全部，直接回车退出：')).trim();
    if (!answer) return;
    if (answer.toLowerCase() === 'a') return await stop();
    const row = instances[Number(answer) - 1];
    if (!row) throw new Error('无效序号，未关闭任何后台。');
    const results = await stopRuntimes({ ids: [row.id] });
    for (const result of results) console.log(result.status === 'stopped' ? '已关闭。' : result.error);
    if (results.some(r => r.status === 'failed')) process.exitCode = 1;
  } finally { input.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
