import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProject, validateProject, exportTheme, applyCommand } from '../shared/core.js';
import { scanVariables } from '../shared/variables.js';
import { mergeSourceTheme } from '../shared/migrations.js';
import { migrateStorage, projectFingerprint } from '../storage-migrations.js';
import { createServer } from '../server.js';

async function temp(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-v3-'));
  try { await fn(dir); } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('tts-v3-'));
    await rm(dir, { recursive: true, force: true });
  }
}
const legacy = () => ({ schemaVersion: 2, name: '旧主题', baseTheme: { name: '旧主题', custom_css: ':root { --gap: 12px; }', nativeField: { keep: true } }, rules: { base: {}, mobile: {} }, variableEdits: { 'var-8': '24px' }, customCss: 'p{color:red}' });
test('legacy offsets migrate losslessly and stable bindings survive comments, image length and rename', () => {
  const old = legacy(), p = validateProject(old);
  assert.equal(p.schemaVersion, 3); assert.equal(exportTheme(p).custom_css, ':root { --gap: 24px; }\n\n/* Tavern Theme Studio */\np{color:red}');
  const id = Object.keys(p.variableEdits)[0]; assert.match(id, /^binding-/);
  const built = { ...p.baseTheme, custom_css: '/* longer source */ :root { /* note */ --gap: 18px; --image:url("https://example.com/long.png"); }' };
  const next = mergeSourceTheme(applyCommand(p, { type: 'rename', name: '改名' }), built);
  assert.equal(next.variableEdits[id], '24px'); assert.equal(next.projectId, p.projectId); assert.equal(next.name, '改名');
  assert.equal(next.customCss, p.customCss); assert.deepEqual(next.baseTheme.nativeField, old.baseTheme.nativeField);
  const other = createProject({ name: '改名' }); assert.notEqual(other.projectId, p.projectId);
});
test('duplicate and missing declarations preserve the last preview and report actionable conflicts', () => {
  const p = validateProject(legacy());
  for (const css of [':root{--gap:2px;--gap:4px}', ':root{--other:2px}']) {
    assert.throws(() => mergeSourceTheme(p, { name: p.name, custom_css: css }), e => e.status === 409 && e.conflicts[0].name === '--gap');
  }
  const duplicates = { ...legacy(), baseTheme: { name: '重复', custom_css: ':root{--x:1;--x:2}' }, variableEdits: { 'var-6': '3' } };
  const migrated = validateProject(duplicates);
  assert.equal(migrated.bindingConflicts.length, 1); assert.match(exportTheme(migrated).custom_css, /--x:3;--x:2/);
  assert.equal(new Set(scanVariables(duplicates.baseTheme.custom_css).map(v => v.id)).size, 2);
});
test('migration backs up exact bytes, persists identity and links tickets only to verified snapshots', () => temp(async dir => {
  const old = legacy(), text = JSON.stringify(old, null, 3), id = '1'.repeat(32), wrong = '2'.repeat(32);
  await writeFile(path.join(dir, 'project.json'), text); await mkdir(path.join(dir, 'snapshots'));
  await writeFile(path.join(dir, `snapshots/${id}.json`), JSON.stringify({ id, project: old, name: '旧快照', createdAt: '2026-10-08' }));
  await writeFile(path.join(dir, `snapshots/${wrong}.json`), JSON.stringify({ id: wrong, project: { ...old, customCss: 'body{color:blue}' }, name: '同名其他工程', createdAt: '2026-10-08' }));
  await writeFile(path.join(dir, 'tickets.json'), JSON.stringify([{ id, basis: { name: old.name, snapshotId: id, fingerprint: projectFingerprint(old) } }, { id: wrong, basis: { name: old.name, snapshotId: wrong, fingerprint: projectFingerprint({ ...old, customCss: 'body{color:blue}' }) } }]));
  const first = await migrateStorage(dir), second = await migrateStorage(dir);
  assert.equal(first.project.projectId, second.project.projectId); assert.equal(second.recovery, null);
  assert.equal(await readFile(path.join(dir, first.recovery, 'project.json'), 'utf8'), text);
  const tickets = JSON.parse(await readFile(path.join(dir, 'tickets.json')));
  assert.equal(tickets[0].basis.projectId, first.project.projectId); assert.notEqual(tickets[1].basis.projectId, first.project.projectId);
}));
test('invalid migration never replaces original project or snapshots', () => temp(async dir => {
  const text = JSON.stringify({ ...legacy(), variableEdits: { 'var-999': '24px' } });
  await writeFile(path.join(dir, 'project.json'), text);
  await assert.rejects(() => migrateStorage(dir), /原数据保留/);
  assert.equal(await readFile(path.join(dir, 'project.json'), 'utf8'), text);
  assert.deepEqual(await readdir(dir), ['project.json']);
}));
test('restart rejects old basis even with the fresh token and reset revision', () => temp(async dir => {
  let app = await createServer({ dataDir: dir, port: 0 });
  try {
    const old = await (await fetch(app.address + '/api/session')).json();
    await app.close(); app = await createServer({ dataDir: dir, port: 0 });
    const fresh = await (await fetch(app.address + '/api/session')).json();
    assert.notEqual(old.sessionId, fresh.sessionId); assert.equal(old.projectId, fresh.projectId);
    const post = body => fetch(app.address + '/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': fresh.token }, body: JSON.stringify(body) });
    assert.equal((await post({ ...old, command: { type: 'rename', name: '过期写入' } })).status, 409);
    assert.equal((await post({ revision: 0, command: { type: 'rename', name: '旧 CLI' } })).status, 428);
    assert.equal((await post({ ...fresh, command: { type: 'rename', name: '有效' } })).status, 200);
  } finally { await app.close(); }
}));
