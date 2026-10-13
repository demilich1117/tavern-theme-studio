import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRunner } from '../src/runner-service.js';
const wait = async (runner, state) => { for (let i = 0; i < 100; i++) { if (runner.status().tasks.at(-1)?.state === state) return; await new Promise(r => setTimeout(r, 30)); } assert.fail(JSON.stringify(runner.status())); };
test('generic CLI lifecycle uses structured input, rejects stale config, requires results, cancels and restores interruptions', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'tts-runner-')); let runner; const completed = new Set();
  const input = { projectId: 'test', basis: { projectId: 'test', revision: 0, fingerprint: 'a'.repeat(64) }, tickets: [{ comment: '$(should never execute)' }] };
  const config = { program: process.execPath, cwd: process.cwd(), args: [path.resolve('tests/fixtures/runner-adapter.mjs')], input: 'stdin', heartbeatMs: 1000, timeoutMs: 2000 };
  try {
    runner = await createRunner({ dataDir, getProjectId: () => 'test', publish: state => { const task=state.tasks.at(-1); if (task?.state === 'succeeded' && !completed.has(task.id)) { assert.equal(state.verified, true, 'success and verified status must publish atomically'); completed.add(task.id); } } });
    await assert.rejects(runner.enqueue(input), /未配置/);
    await runner.configure(config, 0); await assert.rejects(runner.configure(config, 0), /已更新/);
    await runner.enqueue(input); await wait(runner, 'succeeded'); assert.equal(runner.status().verified, true);
    await runner.configure({ ...config, args: [...config.args, 'fail'] }, 1); await runner.enqueue(input); await wait(runner, 'failed'); assert.equal(runner.status().verified, false);
    await runner.configure({ ...config, args: [...config.args, 'hang'] }, 2); await runner.enqueue(input); await runner.cancel(runner.status().tasks.at(-1).id); await wait(runner, 'cancelled');
    await runner.enqueue(input); await wait(runner, 'failed'); assert.match(runner.status().tasks.at(-1).error, /心跳|超时/);
    await runner.close();
    const state = runner.status(); state.tasks.at(-1).state = 'running'; await writeFile(path.join(dataDir, 'runner.json'), JSON.stringify(state));
    runner = await createRunner({ dataDir, getProjectId: () => 'test' }); assert.equal(runner.status().tasks.at(-1).state, 'interrupted');
    await runner.configure({ ...config, args: [...config.args, '--input', '{input}'], input: 'file' }, 3); await runner.enqueue(input); await wait(runner, 'succeeded');
  } finally { await runner?.close(); await rm(dataDir, { recursive: true, force: true }); }
});
