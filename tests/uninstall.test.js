import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareUninstall, uninstallStudio } from '../src/uninstall-service.js';
import { digest, exists, installConnector, inspectTavern } from '../src/install-service.js';
const studioRoot = path.resolve(import.meta.dirname, '..');
async function temp(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tts-uninstall-')));
  try { await fn(root); } finally {
    assert.equal(path.dirname(root).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(root).startsWith('tts-uninstall-')); await rm(root, { recursive: true, force: true });
  }
}
async function put(root, file, text) { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); }
async function program(root) {
  const files = { 'package.json': '{"name":"tavern-theme-studio"}', 'server.js': '// original', 'start.cmd': '@echo off', 'scripts/uninstall.js': '// original uninstall' };
  for (const [file, bytes] of Object.entries(files)) await put(root, file, bytes);
  await put(root, 'package-manifest.json', JSON.stringify({ format: 'tavern-theme-studio-core', files: Object.entries(files).map(([file, text]) => ({ path: file, sha256: digest(Buffer.from(text)) })) }));
}

test('uninstall backs up manifest-owned files, retains modifications, works, private data and other extensions', () => temp(async root => {
  const app = path.join(root, 'studio'), host = path.join(root, 'host'); await program(app);
  for (const [file, text] of Object.entries({ 'package.json': '{"name":"sillytavern"}', 'server.js': '', 'public/scripts/extensions.js': '', 'data/default-user/settings.json': 'private', 'data/default-user/extensions/other/manifest.json': 'other' })) await put(host, file, text);
  const tavern = await inspectTavern(host);
  const installed = await installConnector({ studioRoot, tavern, profile: 'default-user', backupHome: path.join(app, '.local/connector-backups'), receiptHome: path.join(app, '.local/connector-installs') });
  await put(app, '.local/installation.json', JSON.stringify({ dataRoot: tavern.dataRoot, profile: 'default-user' }));
  await put(app, '.local/project.json', 'work draft'); await put(app, 'my-work.txt', 'personal'); await put(app, 'server.js', '// custom edit');
  await put(installed.target, 'connector/bridge.js', 'my custom connector code'); await put(installed.target, 'note.txt', 'my note');
  const plan = await prepareUninstall(app);
  assert.equal(plan.connectors.length, 1); assert.deepEqual(plan.retained, ['server.js']);
  const result = await uninstallStudio(plan, { runtimeHome: path.join(root, 'registry') });
  assert.equal(result.backups.length, 2);
  assert.equal(await exists(path.join(app, 'package.json')), false); assert.equal(await exists(path.join(installed.target, 'manifest.json')), false);
  for (const [file, value] of [[path.join(app, '.local/project.json'), 'work draft'], [path.join(app, 'my-work.txt'), 'personal'], [path.join(app, 'server.js'), '// custom edit'], [path.join(installed.target, 'connector/bridge.js'), 'my custom connector code'], [path.join(installed.target, 'note.txt'), 'my note'], [path.join(host, 'data/default-user/settings.json'), 'private'], [path.join(host, 'data/default-user/extensions/other/manifest.json'), 'other']]) assert.equal(await readFile(file, 'utf8'), value);
  assert.equal(await readFile(path.join(result.backups[1], 'files/package.json'), 'utf8'), '{"name":"tavern-theme-studio"}');
  assert.match(await readFile(path.join(result.backups[0], 'files/manifest.json'), 'utf8'), /Tavern Theme Studio/);
}));

test('source uninstall retains tracked and untracked code; legacy connector disables only its verified manifest', () => temp(async root => {
  await program(root); await mkdir(path.join(root, '.git'));
  const dataRoot = path.join(root, 'host-data'), target = path.join(dataRoot, 'default-user/extensions/tavern-theme-studio-connector');
  await put(target, 'manifest.json', '{"author":"Tavern Theme Studio","js":"connector/index.js"}');
  await put(target, 'connector/index.js', '// old connector');
  await put(root, '.local/installation.json', JSON.stringify({ dataRoot, profile: 'default-user' }));
  const plan = await prepareUninstall(root); assert.equal(plan.source, true); assert.equal(plan.program.length, 0);
  await uninstallStudio(plan, { runtimeHome: path.join(root, 'registry') });
  assert.equal(await exists(path.join(target, 'manifest.json')), false);
  assert.equal(await readFile(path.join(target, 'connector/index.js'), 'utf8'), '// old connector');
  assert.equal(await readFile(path.join(root, 'server.js'), 'utf8'), '// original');
}));

test('uninstall rejects traversal, symlink targets, live legacy owners and changes after preview before removing files', () => temp(async root => {
  await program(root);
  const plan = await prepareUninstall(root);
  await put(root, 'server.js', '// changed after preview');
  await assert.rejects(uninstallStudio(plan, { runtimeHome: path.join(root, 'registry') }), /预览后被修改/);
  assert.equal(await exists(path.join(root, 'package.json')), true);
  await put(root, '.local/runtime.json', JSON.stringify({ pid: process.pid, address: 'http://127.0.0.1:1' }));
  await assert.rejects(uninstallStudio(await prepareUninstall(root), { runtimeHome: path.join(root, 'registry') }), /旧后台仍占用/);
  assert.equal(await exists(path.join(root, 'start.cmd')), true);
  const manifest = JSON.parse(await readFile(path.join(root, 'package-manifest.json')));
  manifest.files.push({ path: '../outside.js', sha256: 'a'.repeat(64) });
  await put(root, 'package-manifest.json', JSON.stringify(manifest));
  await assert.rejects(prepareUninstall(root), /无效/);
  manifest.files.pop(); manifest.files.push({ path: '.local/project.json', sha256: 'a'.repeat(64) });
  await put(root, 'package-manifest.json', JSON.stringify(manifest));
  await assert.rejects(prepareUninstall(root), /不允许/);
  manifest.files.pop(); manifest.files.push({ path: 'public/index.html', sha256: 'a'.repeat(64) });
  await put(root, 'package-manifest.json', JSON.stringify(manifest));
  const outside = path.join(root, 'untouched'); await mkdir(outside);
  await symlink(outside, path.join(root, 'public'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareUninstall(root), /链接/);
}));
