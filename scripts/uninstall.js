import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { prepareUninstall, uninstallStudio } from '../src/uninstall-service.js';
import { acquireDataLock } from '../src/data-lock.js';
const root = path.resolve(import.meta.dirname, '..');
async function main() {
  const maintenance = await acquireDataLock(path.join(root, '.local/maintenance'));
  try {
    const plan = await prepareUninstall(root);
    console.log(`\n卸载主题工作台\n程序：${plan.root}\n连接器：${plan.connectors.length} 处\n程序文件：${plan.source ? '源码目录，保留源码，只移除连接器' : plan.program.length + ' 个原版文件'}\n保留：作品、.local、备份、已应用的主题、测试聊天与自定义文件。`);
    for (const connector of plan.connectors) console.log(`连接器位置：${connector.target}${connector.retained.length ? `（${connector.retained.length} 个修改过或旧版文件将保留）` : ''}`);
    if (plan.retained.length) console.log(`另保留 ${plan.retained.length} 个修改过的程序文件。`);
    if (process.argv.includes('--dry-run')) return;
    if (!process.argv.includes('--yes')) {
      if (!process.stdin.isTTY) throw new Error('请交互运行卸载，或先 --dry-run 查看后再传 --yes。');
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try { if ((await input.question('确认卸载？输入 Y 继续，其余退出：')).trim().toLowerCase() !== 'y') { console.log('已取消。'); return; } }
      finally { input.close(); }
    }
    const result = await uninstallStudio(plan);
    console.log(`已移除 ${result.connectors} 处连接器的加载入口、${result.removedProgramFiles} 个程序文件。`);
    for (const backup of result.backups) console.log('卸载备份：' + backup);
    console.log('请刷新酒馆标签，让连接器停止加载。作品与数据仍在原位置。');
    if (result.source) console.log('当前是源码目录，Git 仓库与开发文件完整保留。');
    else console.log('程序目录中留下的 .local、空文件夹和修改过的文件可按需保留；其中包含恢复所需的备份。');
  } finally { await maintenance.release(); }
}
main().catch(e => { console.error('卸载未完成：' + e.message); process.exitCode = 1; });
