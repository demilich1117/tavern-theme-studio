import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyFiles, exists, digest, inspectTavern, installConnector, recoverInstalls, safeRelative } from '../src/install-service.js';
import { validateCoreZip, applyCoreUpdate, latestPackage, compareVersions } from '../src/update-service.js';
import { zipFiles } from '../scripts/zip.js';
import { manageLauncher, readLauncher, stopLauncher, requireStopped } from '../src/launcher-service.js';
import { createServer } from '../server.js';
const studioRoot = path.resolve(import.meta.dirname, '..');
async function temp(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tts-install-')));
  try { await fn(root); } finally {
    assert.equal(path.dirname(root).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(root).startsWith('tts-install-')); await rm(root, { recursive: true, force: true });
  }
}
async function put(root, name, bytes) { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); }
async function host(root) {
  await put(root, 'package.json', JSON.stringify({ name: 'sillytavern', version: '1.19.0' }));
  await put(root, 'server.js', ''); await put(root, 'public/scripts/extensions.js', '');
  await put(root, 'config.yaml', "dataRoot: './custom data' # user path\nport: 8123\n");
  await put(root, 'custom data/default-user/settings.json', '{"unchanged":true}');
  return inspectTavern(root);
}
function core(version, extra = {}) {
  const content = { 'package.json': JSON.stringify({ name: 'tavern-theme-studio', version }), 'connector/manifest.json': JSON.stringify({ version }), 'server.js': '// server', 'start.cmd': 'start', 'update.cmd': 'update', 'scripts/launcher.js': '// launch', 'scripts/windows-launcher.ps1': '# launch', 'node_modules/css-tree/package.json': '{}', ...extra };
  const files = new Map(Object.entries(content).map(([file, value]) => [file, Buffer.from(value)]));
  files.set('package-manifest.json', Buffer.from(JSON.stringify({ format: 'tavern-theme-studio-core', version, files: [...files].map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: digest(bytes) })) })));
  return { files, zip: zipFiles([...files].map(([file, bytes]) => ['tavern-theme-studio/' + file, bytes])) };
}

test('one-time host selection respects custom data root, user accounts and existing connector data', () => temp(async root => {
  const tavern = await host(path.join(root, 'Silly Tavern'));
  assert.equal(tavern.url, 'http://127.0.0.1:8123/'); assert.deepEqual(tavern.profiles, ['default-user']);
  const options = { studioRoot, tavern, profile: 'default-user', backupHome: path.join(root, 'backups'), receiptHome: path.join(root, 'receipts') };
  const first = await installConnector(options); assert.equal(first.changed, 27);
  await put(first.target, 'personal-note.txt', 'keep');
  const second = await installConnector(options); assert.equal(second.changed, 0);
  await put(first.target, 'connector/index.js', '// old connector');
  const updated = await installConnector(options); assert.equal(updated.changed, 1);
  assert.equal(await readFile(path.join(updated.backup, 'files/connector/index.js'), 'utf8'), '// old connector');
  assert.equal(await readFile(path.join(first.target, 'personal-note.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(path.join(tavern.dataRoot, 'default-user/settings.json'), 'utf8'), '{"unchanged":true}');
  await assert.rejects(installConnector({ ...options, profile: '../other' }), /已有的用户/);
  await put(tavern.dataRoot, 'another-user/settings.json', '{}');
  assert.equal((await inspectTavern(tavern.root)).profiles.length, 2);
  await put(first.target, 'manifest.json', '{"js":"something-else.js"}');
  await assert.rejects(installConnector(options), /其他内容/);
}));

test('interrupted installation rolls back complete files and preserves unrelated files', () => temp(async root => {
  const program = path.join(root, 'program'); await mkdir(program);
  await put(program, 'existing.js', 'old'); await put(program, '.local/project.json', 'draft');
  await assert.rejects(applyFiles({ root: program, files: [['existing.js', Buffer.from('new')], ['new.js', Buffer.from('new')]], backupHome: path.join(root, 'backups'), beforeWrite: file => { if (file === 'new.js') throw new Error('disk failure'); } }), /已恢复原文件/);
  assert.equal(await readFile(path.join(program, 'existing.js'), 'utf8'), 'old'); assert.equal(await exists(path.join(program, 'new.js')), false);
  assert.equal(await readFile(path.join(program, '.local/project.json'), 'utf8'), 'draft');
  const result = await applyFiles({ root: program, files: [['existing.js', Buffer.from('new')]], backupHome: path.join(root, 'backups') });
  const journalPath = path.join(result.backup, 'transaction.json'), journal = JSON.parse(await readFile(journalPath));
  journal.status = 'applying'; await writeFile(journalPath, JSON.stringify(journal));
  await recoverInstalls(path.join(root, 'backups'), program);
  assert.equal(await readFile(path.join(program, 'existing.js'), 'utf8'), 'old');
  journal.status = 'applying'; await writeFile(journalPath, JSON.stringify(journal)); await put(program, 'existing.js', 'user edited after interruption');
  await assert.rejects(recoverInstalls(path.join(root, 'backups'), program), /又被修改/);
  assert.equal(await readFile(path.join(program, 'existing.js'), 'utf8'), 'user edited after interruption');
}));

test('installer rejects traversal, duplicate file names and directory links before overwriting', () => temp(async root => {
  for (const bad of ['../x', '/x', 'C:/x', 'a\\b', 'AUX.txt', 'a/../b', 'a./b']) assert.throws(() => safeRelative(bad));
  const program = path.join(root, 'program'), outside = path.join(root, 'outside'); await mkdir(program); await mkdir(outside);
  await symlink(outside, path.join(program, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(applyFiles({ root: program, files: [['linked/test.txt', Buffer.from('x')]], backupHome: path.join(root, 'backups') }), /链接/);
  assert.equal(await exists(path.join(outside, 'test.txt')), false);
  await assert.rejects(applyFiles({ root: program, files: [['A.js', Buffer.from('x')], ['a.js', Buffer.from('x')]], backupHome: path.join(root, 'backups') }), /重复/);
}));

test('release update verifies every member, preserves data, removes only obsolete program files and refuses local edits', () => temp(async root => {
  const old = core('0.11.0', { 'obsolete.js': 'old' }), next = core('0.12.0', { 'new.js': 'new' });
  for (const [file, bytes] of old.files) await put(root, file, bytes);
  await put(root, '.local/workspace-location.json', 'saved location'); await put(root, 'my-note.txt', 'keep');
  const files = validateCoreZip(next.zip, '0.12.0');
  await applyCoreUpdate(root, files);
  assert.equal(await readFile(path.join(root, '.local/workspace-location.json'), 'utf8'), 'saved location');
  assert.equal(await readFile(path.join(root, 'my-note.txt'), 'utf8'), 'keep');
  assert.equal(await exists(path.join(root, 'obsolete.js')), false); assert.equal(await readFile(path.join(root, 'new.js'), 'utf8'), 'new');
  await put(root, 'server.js', '// user edit'); await assert.rejects(applyCoreUpdate(root, files), /本地改动/);
  const corrupted = Buffer.from(next.zip); corrupted[corrupted.length - 1] = 1;
  assert.throws(() => validateCoreZip(corrupted, '0.12.0'), /ZIP/);
  assert.throws(() => validateCoreZip(core('0.12.0', { '.local/project.json': '{}' }).zip, '0.12.0'), /用户数据/);
  assert.throws(() => validateCoreZip(next.zip, '0.13.0'), /版本/);
}));

test('updater uses complete official release assets, rejects tampering and never downgrades', async () => {
  const candidate = core('0.12.0'), name = 'tavern-theme-studio-0.12.0-core.zip', base = 'https://github.com/demilich1117/tavern-theme-studio/releases/download/v0.12.0/';
  const release = { tag_name: 'v0.12.0', assets: [{ name, browser_download_url: base + name }, { name: name + '.sha256', browser_download_url: base + name + '.sha256' }] };
  let badHash = false; const requests = [];
  const fakeFetch = async url => {
    requests.push(url);
    return new Response(url.endsWith('/latest') ? JSON.stringify(release) : url.endsWith('.sha256') ? `${badHash ? '0'.repeat(64) : digest(candidate.zip)}  ${name}\n` : candidate.zip);
  };
  assert.ok((await latestPackage('0.11.0', fakeFetch)).files.has('server.js'));
  requests.length = 0; assert.equal((await latestPackage('0.13.0', fakeFetch)).current, true); assert.equal(requests.length, 1);
  badHash = true; await assert.rejects(latestPackage('0.11.0', fakeFetch), /校验未通过/);
  assert.equal(compareVersions('0.10.0', '0.9.2'), 1);
  release.assets[0].browser_download_url = 'https://example.invalid/payload'; await assert.rejects(latestPackage('0.11.0', fakeFetch), /尚未发布完整/);
});

test('managed restart authenticates control, waits for saved work and releases locks; legacy sessions are left alone', () => temp(async root => {
  const dataDir = path.join(root, 'workspace');
  const app = await createServer({ dataDir, port: 0, pointer: path.join(root, 'pointer.json'), workHome: path.join(root, 'works') });
  let manager;
  try {
    manager = await manageLauncher({ root, app, url: 'http://127.0.0.1:8000/#tts-lab', version: '0.11.0' });
    assert.equal((await fetch(new URL('/stop', manager.record.address), { method: 'POST' })).status, 403);
    assert.equal((await readLauncher(root)).version, '0.11.0');
    const state = await (await fetch(app.address + '/api/session')).json();
    const result = await fetch(app.address + '/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': state.token }, body: JSON.stringify({ ...state, command: { type: 'set', target: 'assistant', property: 'padding', value: '23px' } }) });
    assert.equal(result.status, 200);
    await assert.rejects(requireStopped([dataDir]), /原工作台窗口/);
    assert.equal(await stopLauncher(root), true);
    assert.equal(await exists(path.join(dataDir, '.studio-lock')), false);
    assert.match(await readFile(path.join(dataDir, 'project.json'), 'utf8'), /23px/);
    assert.equal(await readLauncher(root), null);
  } finally { if (manager) await manager.close(); else await app.close(); }
}));

test('Windows PowerShell 5.1 bootstraps and reuses a portable runtime, rejecting a damaged download', { skip: process.platform !== 'win32' }, () => temp(async root => {
  const fixtureZip = path.join(root, 'node-fixture.zip');
  await writeFile(fixtureZip, zipFiles([['node-v22.0.0-win-x64/node.exe', await readFile(process.execPath)]]));
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'windows-bootstrap.ps1'), '-Launcher', path.join(studioRoot, 'scripts/windows-launcher.ps1'), '-TestRoot', path.join(root, 'program'), '-FixtureZip', fixtureZip], { windowsHide: true, timeout: 60000 });
  assert.match(stdout, /Windows PowerShell bootstrap download, checksum, extraction and reuse: OK/);
}));
