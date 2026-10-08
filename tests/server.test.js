import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../server.js';

test('HTTP editing persists, rejects forged requests, handles conflicts and survives restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-test-'));
  let app;
  try {
    app = await createServer({ dataDir: dir, port: 0 });
    const get = async p => (await fetch(app.address + p)).json();
    const session = await get('/api/session');
    const post = (command, revision, headers = {}) => fetch(app.address + '/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': session.token, ...headers }, body: JSON.stringify({ command, revision }) });
    assert.equal((await post({ type: 'rename', name: 'forged' }, 0, { 'X-Studio-Token': 'invalid' })).status, 403);
    assert.equal((await post({ type: 'rename', name: 'forged' }, 0, { Origin: 'https://example.com' })).status, 403);
    const forgedHostStatus = await new Promise((resolve, reject) => {
      const request = http.get(app.address + '/api/session', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal((await post({ type: 'set', target: 'assistant', property: 'padding', value: '24px' }, 0)).status, 200);
    assert.equal((await post({ type: 'rename', name: 'stale' }, 0)).status, 409);
    assert.equal((await get('/api/project')).revision, 1);
    const simultaneous = await Promise.all([post({ type: 'rename', name: '甲' }, 1), post({ type: 'rename', name: '乙' }, 1)]);
    assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
    assert.match((await get('/api/theme')).custom_css, /padding: 24px/);
    const saved = JSON.parse(await readFile(path.join(dir, 'project.json'), 'utf8'));
    assert.equal(saved.rules.base.assistant.padding, '24px');
    assert.equal((await post({ type: 'snapshot-save', name: '旧版本' }, 0)).status, 409);
    assert.equal((await post({ type: 'snapshot-save', name: '' }, 2)).status, 400);
    assert.equal((await post({ type: 'snapshot-save', name: 'forged' }, 2, { 'X-Studio-Token': 'invalid' })).status, 403);
    const snapshotResponse = await post({ type: 'snapshot-save', name: '排版完成' }, 2);
    assert.equal(snapshotResponse.status, 200);
    const snapshotId = (await snapshotResponse.json()).snapshotCreated.id;
    assert.equal((await get('/api/snapshots')).length, 1);
    assert.equal((await post({ type: 'set', target: 'message-text', property: 'padding', value: '8px' }, 2)).status, 200);
    const difference = await get(`/api/snapshots/${snapshotId}`);
    assert.ok(difference.changes.some(c => c.path === 'base/message-text/padding' && c.after === '8px'));
    assert.equal((await post({ type: 'snapshot-restore', id: '../project' }, 3)).status, 400);
    assert.equal((await post({ type: 'snapshot-restore', id: snapshotId }, 3)).status, 200);
    assert.deepEqual((await get('/api/project')).project, saved);
    assert.equal((await post({ type: 'undo' }, 4)).status, 200);
    assert.equal((await get('/api/project')).project.rules.base['message-text'].padding, '8px');
    assert.equal((await post({ type: 'redo' }, 5)).status, 200);
    await app.close(); app = await createServer({ dataDir: dir, port: 0 });
    assert.deepEqual((await get('/api/project')).project, saved);
    assert.equal((await get('/api/snapshots'))[0].name, '排版完成');
    assert.equal((await get(`/api/snapshots/${snapshotId}`)).changes.length, 0);
    assert.equal((await fetch(app.address + '/.local/project.json')).status, 404);
  } finally {
    await app?.close();
    // This test owns only the mkdtemp-created directory with this exact prefix.
    const resolved = path.resolve(dir), temp = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith('tts-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
