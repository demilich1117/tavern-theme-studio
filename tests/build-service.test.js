import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { createServer } from '../server.js';
import { scanVariables } from '../shared/variables.js';
import { buildFolio } from '../scripts/folio-build.mjs';
import { readBuildCandidate } from '../src/build-service.js';
async function temp(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-build-'));
  try { await fn(dir); } finally { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('tts-build-')); await rm(dir, { recursive: true, force: true }); }
}
async function until(fn, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await setTimeout(40); }
  throw new Error(`Timed out: ${label}`);
}
test('real build protocol shares twelve assets for inline/external candidates and leaves releases untouched', () => temp(async dir => {
  const root = path.resolve(import.meta.dirname, '..');
  const frozen = ['moonveil-covenant-2.2.4', 'moonveil-covenant-2.2.4-external'].map(name => path.join(root, 'dist', name));
  // A fresh checkout has no ignored release archives. Preserve existing bytes
  // when present, and also verify that building never creates a frozen release.
  const readBaseline = async folder => {
    try { return await readFile(path.join(folder, 'moonveil.theme.json')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const before = await Promise.all(frozen.map(readBaseline));
  await buildFolio({ outputDir: path.join(dir, 'local'), mode: 'local' });
  await buildFolio({ outputDir: path.join(dir, 'external'), mode: 'external' });
  const local = await readBuildCandidate(path.join(dir, 'local')), remote = await readBuildCandidate(path.join(dir, 'external'));
  assert.equal(local.assets.length, 12); assert.ok(local.theme.custom_css.length < 40000);
  assert.equal(remote.assets.length, 0); assert.equal(remote.assetRefs.length, 12); assert.equal(/tts-asset:|data:image/.test(remote.theme.custom_css), false);
  for (const folder of frozen) {
    await assert.rejects(() => buildFolio({ outputDir: folder }), /基线只读/);
    await assert.rejects(() => buildFolio({ outputDir: path.join(folder, 'nested') }), /基线只读/);
  }
  assert.deepEqual(await Promise.all(frozen.map(readBaseline)), before);
}));
test('watching coalesces saves, merges UI edits, keeps good output on failure, cancels and restores safely', () => temp(async dir => {
  const source = path.join(dir, 'source'), dataDir = path.join(dir, 'data'); await mkdir(source);
  const inputFile = path.join(source, 'source.json');
  const save = (css, extra = {}) => writeFile(inputFile, JSON.stringify({ css, ...extra }));
  await save(':root{--gap:12px}');
  let app = await createServer({ dataDir, port: 0 });
  const get = async route => (await fetch(app.address + route)).json();
  const post = async (route, body) => {
    const session = await get('/api/session');
    const build = await get('/api/build');
    const response = await fetch(app.address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': session.token }, body: JSON.stringify({ revision: session.revision, sessionId: session.sessionId, projectId: session.projectId, fingerprint: session.fingerprint, bindingVersion: build.version, ...body }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  };
  const command = cmd => post('/api/commands', { command: cmd });
  const waitCss = css => until(async () => { const p = await get('/api/project'), b = await get('/api/build'); return p.project.baseTheme.custom_css === css && b.status.state === 'succeeded' && p; }, css);
  try {
    await post('/api/build/configure', { config: { root: source, program: process.execPath, args: [path.join(import.meta.dirname, 'fixtures/build-adapter.mjs')], watch: ['source.json'], debounceMs: 50, timeoutMs: 5000 }, autoSync: true });
    const first = await waitCss(':root{--gap:12px}');
    await save(':root{--gap:15px}', { delayMs: 500 });
    await until(async () => (await get('/api/build')).status.state === 'running', 'running');
    await command({ type: 'set', target: 'assistant', property: 'padding', value: '27px' });
    await command({ type: 'custom-css', css: '.custom{color:red}' });
    await save(':root{--gap:16px}', { delayMs: 300 }); await save(':root{--gap:18px}');
    const latest = await waitCss(':root{--gap:18px}');
    assert.equal(latest.project.rules.base.assistant.padding, '27px'); assert.equal(latest.project.customCss, '.custom{color:red}');
    assert.equal(latest.revision, first.revision + 3, 'obsolete builds never advance project history');
    await save('body{color:red');
    const failed = await until(async () => { const b = await get('/api/build'); return b.status.state === 'failed' && b; }, 'invalid CSS');
    assert.match(failed.status.error, /CSS.*未闭合/); assert.deepEqual((await get('/api/project')).project, latest.project);
    await save(':root{--gap:20px}', { missing: true });
    const missing = await until(async () => { const b = await get('/api/build'); return b.status.state === 'failed' && b.status.error.includes('missing.png') && b; }, 'missing asset');
    assert.match(missing.status.error, /missing.png/); assert.deepEqual((await get('/api/project')).project, latest.project);
    await save(':root{--gap:18px}'); await waitCss(':root{--gap:18px}');
    const id = scanVariables(latest.project.baseTheme.custom_css)[0].id;
    await command({ type: 'variable', id, value: '24px' });
    await save(':root{--gap:2px;--gap:4px}');
    const conflict = await until(async () => { const b = await get('/api/build'); return b.status.state === 'conflict' && b; }, 'ambiguous binding');
    assert.equal(conflict.status.conflicts[0].name, '--gap'); assert.equal((await get('/api/project')).project.variableEdits[id], '24px');
    await save(':root{--gap:22px}', { delayMs: 700 });
    await until(async () => (await get('/api/build')).status.state === 'running', 'cancel run');
    await post('/api/build/control', { action: 'cancel' }); await setTimeout(200);
    assert.equal((await get('/api/build')).status.state, 'cancelled'); assert.equal((await get('/api/project')).project.baseTheme.custom_css, ':root{--gap:18px}');
    await post('/api/build/control', { action: 'build' }); await waitCss(':root{--gap:22px}');
    const snapshot = (await command({ type: 'snapshot-save', name: '可恢复' })).snapshotCreated.id;
    await command({ type: 'custom-css', css: '.later{color:blue}' }); await command({ type: 'snapshot-restore', id: snapshot });
    await save(':root{--gap:30px}'); await setTimeout(250);
    assert.equal((await get('/api/build')).paused, true); assert.equal((await get('/api/project')).project.baseTheme.custom_css, ':root{--gap:22px}');
    await post('/api/build/control', { action: 'auto', enabled: true }); const final = await waitCss(':root{--gap:30px}');
    await app.close(); app = await createServer({ dataDir, port: 0 });
    await waitCss(':root{--gap:30px}'); assert.deepEqual((await get('/api/project')).project, final.project);
  } finally { await app.close(); }
}));
test('failed disk persistence never advances memory or undo history', () => temp(async dir => {
  const app = await createServer({ dataDir: dir, port: 0 });
  try {
    const session = await (await fetch(app.address + '/api/session')).json();
    const projectFile = path.join(dir, 'project.json'); await rename(projectFile, path.join(dir, 'saved.json')); await mkdir(projectFile);
    const response = await fetch(app.address + '/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': session.token }, body: JSON.stringify({ ...session, command: { type: 'rename', name: '不能保存' } }) });
    assert.equal(response.ok, false);
    const current = await (await fetch(app.address + '/api/project')).json(); assert.equal(current.fingerprint, session.fingerprint); assert.equal(current.revision, session.revision); assert.equal(current.canUndo, false);
  } finally { await app.close(); }
}));
