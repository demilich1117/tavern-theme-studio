import path from 'node:path';
import { migrateWork, selectWork } from '../src/work-migration.js';
const [action, ...args] = process.argv.slice(2);
try {
  if (action === 'copy' && args.length === 2) console.log(JSON.stringify(await migrateWork({ dataDir: path.resolve(args[0]), destination: path.resolve(args[1]) }), null, 2));
  else if (action === 'select' && args.length === 1) console.log(JSON.stringify(await selectWork(path.resolve(args[0])), null, 2));
  else throw new Error('停止工作台后使用：node scripts/migrate-work.js copy <原数据目录> <新的作品目录>；或 select <已有作品目录>。原件与历史会保留。');
} catch (e) { console.error(e.message); process.exitCode = 1; }
