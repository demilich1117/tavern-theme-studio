import { readFile } from 'node:fs/promises';
let text = ''; if (process.argv.includes('--input')) text = await readFile(process.argv[process.argv.indexOf('--input') + 1], 'utf8'); else for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
if (process.argv.includes('hang')) { setInterval(() => {}, 1000); }
else if (process.argv.includes('fail')) process.exit(2);
else {
  console.log(JSON.stringify({ type: 'heartbeat' }));
  console.log(JSON.stringify({ type: 'progress', message: '只验证任务协议，不改源码、不调用模型。' }));
  console.log(JSON.stringify({ type: 'result', result: { summary: '协议示例执行完成', baseline: input.basis, checks: [{ name: '协议', status: 'passed', detail: '结构化 stdin 与逐行 JSON' }], unverified: ['模型、源码修改与视觉验证未执行'], artifacts: [] } }));
}
