import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { STUDIO_VERSION } from '../shared/version.js';
import { readGeneratedZip } from './zip.js';
import { validateCoreZip } from '../src/update-service.js';
// Hosted Windows runners may expose TEMP through an 8.3 alias. Compare the
// canonical paths reported by the data lock, not the spelling of that alias.
const root = path.resolve(import.meta.dirname, '..'), temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tts-package-')));
const testEnv = { ...process.env, STUDIO_RUNTIME_HOME: path.join(temp, 'runtime-registry') };
try {
  const zip = await readFile(path.join(root, `output/releases/tavern-theme-studio-${STUDIO_VERSION}-core.zip`));
  const files = readGeneratedZip(zip);
  assert.equal(validateCoreZip(zip, STUDIO_VERSION).size, files.length, 'Release updater accepts the exact built package');
  // Co-design must remain usable without the author's parent workspace skills.
  for (const file of ['AGENTS.md', 'skills/tavern-theme-studio/SKILL.md', 'docs/co-design.md', 'docs/control-validation.md', 'connector/visual-checks.js', 'connector/control-states.js', 'docs/host-reference.md', 'docs/co-design-brief.template.md', 'docs/native-lab.md', 'docs/canvas-mode.md', 'docs/validation-0.13.md', 'connector/responsive.html', 'connector/responsive.js', 'connector/blueprint-editor.js', 'shared/blueprint.js', 'shared/workspace.js', 'manage.cmd', 'stop.cmd', 'uninstall.cmd', 'scripts/backgrounds.js', 'scripts/uninstall.js', 'docs/backgrounds-uninstall.md']) {
    assert.ok(files.some(([name]) => name === `tavern-theme-studio/${file}`), `Missing co-design resource: ${file}`);
  }
  for (const [name, bytes] of files) {
    assert.ok(name.startsWith('tavern-theme-studio/') && !name.split('/').includes('..') && !/\/(?:\.local|\.git|output)\//.test(name));
    assert.ok(!name.includes('/folio-art/') && !name.includes('/moonveil'));
    const file = path.join(temp, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
  }
  const cwd = path.join(temp, 'tavern-theme-studio'), manifest = JSON.parse(await readFile(path.join(cwd, 'package-manifest.json')));
  for (const item of manifest.files) assert.equal(createHash('sha256').update(await readFile(path.join(cwd, item.path))).digest('hex'), item.sha256, item.path);
  // A child whose cwd is outside this checkout proves imports don't accidentally
  // resolve through the developer's node_modules or depend on ignored dist data.
  const script = `
    import assert from 'node:assert/strict';
    import {createServer} from './server.js';
    let app;
    // An OS-assigned ephemeral port can occasionally be on fetch's blocked-port list.
    // Retry only that allocation error, never a failed application response.
    for(let attempt=0;attempt<5;attempt++){
      app=await createServer({port:0});
      try { await fetch(app.address+'/api/health'); break; }
      catch(error){ await app.close(); if(error.cause?.message!=='bad port'||attempt===4)throw error; }
    }
    try {
      for(const route of ['/', '/app.js', '/workflow.js', '/panels.js', '/workspace.css', '/setup.js', '/co-design.js', '/shared/co-design.js', '/theme-analysis.js', '/clipboard.js', '/artworks.js', '/work-import.js', '/api/works', '/api/artworks', '/api/theme-analysis', '/api/theme-analysis/source', '/api/health', '/api/build/presets', '/connector.zip']) assert.equal((await fetch(app.address+route)).status,200,route);
      const s=await(await fetch(app.address+'/api/session')).json();
      const response=await fetch(app.address+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':s.token},body:JSON.stringify({projectId:s.projectId,sessionId:s.sessionId,revision:s.revision,fingerprint:s.fingerprint,command:{type:'set',target:'assistant',property:'border-radius',value:'12px'}})});
      assert.equal(response.status,200);
      const exported=await(await fetch(app.address+'/api/export?mode=offline')).json();assert.match(exported.theme.custom_css,/12px/);
      const current=await(await fetch(app.address+'/api/session')).json();
      const artwork=await fetch(app.address+'/api/artworks',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':current.token},body:JSON.stringify({projectId:current.projectId,sessionId:current.sessionId,revision:current.revision,fingerprint:current.fingerprint,action:'save',name:'Package validation'})});
      assert.equal(artwork.status,200);const saved=await artwork.json();assert.equal(saved.baseline.fingerprint,current.fingerprint);
    }finally{await app.close()}
    const reopened=await createServer({port:0,seedPath:'dist/missing-old-example.json'});await reopened.close();
    console.log('Clean package startup, commands, export and restart: OK');`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd, env: testEnv, windowsHide: true, timeout: 30000 });
  console.log(stdout.trim());
  // Exercise the shipped launcher in isolation, not the developer checkout or
  // an installed personal host. The fake host only supplies installation paths.
  const host = path.join(temp, 'Silly Tavern'), dataDir = path.join(temp, 'launcher-data');
  for (const [file, text] of Object.entries({
    'package.json': JSON.stringify({ name: 'sillytavern', version: '1.19.0' }),
    'server.js': '', 'public/scripts/extensions.js': '',
    'config.yaml': 'dataRoot: ./data\nport: 8000\n',
    'data/default-user/settings.json': '{"keep":"host settings"}',
    'data/default-user/extensions/other-extension/manifest.json': '{"keep":true}',
  })) { const target = path.join(host, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); }
  const env = { ...testEnv, STUDIO_PORT: '0', STUDIO_DATA_DIR: dataDir, STUDIO_TAVERN_DIR: host, STUDIO_TAVERN_DATA_DIR: '', STUDIO_NO_BROWSER: '1' };
  const setupArgs = ['scripts/launcher.js', '--tavern', host, '--profile', 'default-user', '--setup-only', '--no-browser'];
  await promisify(execFile)(process.execPath, setupArgs, { cwd, env, windowsHide: true, timeout: 30000 });
  const repeat = await promisify(execFile)(process.execPath, setupArgs, { cwd, env, windowsHide: true, timeout: 30000 });
  assert.match(repeat.stdout, /连接器已就绪/);
  const { readLauncher, stopLauncher } = await import('../src/launcher-service.js');
  const child = process.platform === 'win32'
    ? execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(cwd, 'scripts/windows-launcher.ps1'), '-Mode', 'start'], { cwd, env, windowsHide: true })
    : execFile(process.execPath, ['scripts/launcher.js', '--no-browser'], { cwd, env, windowsHide: true });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const closed = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    let running;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Packaged launcher stopped: ' + stderr);
      running = await readLauncher(cwd); if (running) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(running, 'Packaged launcher becomes ready');
    const reused = await promisify(execFile)(process.execPath, ['scripts/launcher.js', '--no-browser'], { cwd, env, windowsHide: true, timeout: 10000 });
    assert.match(reused.stdout, /已在运行/);
    const list = await promisify(execFile)(process.execPath, ['scripts/backgrounds.js', '--json'], { cwd, env, windowsHide: true, timeout: 10000 });
    const instances = JSON.parse(list.stdout).instances;
    const canonicalData = await realpath(dataDir);
    assert.ok(instances.some(r => r.pid === running.pid && r.dataDir === canonicalData), JSON.stringify({ expectedPid: running.pid, expectedDataDir: canonicalData, instances }));
    const stopArgs = process.platform === 'win32' ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(cwd, 'scripts/windows-launcher.ps1'), '-Mode', 'stop'] : ['scripts/backgrounds.js', '--stop-all'];
    const stopped = await promisify(execFile)(process.platform === 'win32' ? 'powershell.exe' : process.execPath, stopArgs, { cwd, env, windowsHide: true, timeout: 45000 });
    assert.match(stopped.stdout, /已关闭全部/);
    assert.equal((await closed).code, 0);
    assert.equal(await readFile(path.join(host, 'data/default-user/settings.json'), 'utf8'), '{"keep":"host settings"}');
    assert.equal(await readFile(path.join(host, 'data/default-user/extensions/other-extension/manifest.json'), 'utf8'), '{"keep":true}');
    const installedManifest = JSON.parse(await readFile(path.join(host, 'data/default-user/extensions/tavern-theme-studio-connector/manifest.json')));
    assert.equal(installedManifest.version, STUDIO_VERSION);
    console.log('Clean package one-click setup, repeat launch, remembered host and managed shutdown: OK');
  } finally {
    if (child.exitCode === null) { await stopLauncher(cwd).catch(() => {}); child.kill(); await closed; }
  }
  const connector = readGeneratedZip(await readFile(path.join(cwd, 'dist/tavern-theme-studio-connector.zip')));
  for (const [filename, bytes] of connector.filter(([f]) => f.endsWith('.js'))) {
    for (const m of bytes.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(filename), m[1]));
      assert.ok(connector.some(([f]) => f === target), `Missing connector import: ${target}`);
    }
  }
  console.log(`Core ZIP ${files.length} files; connector ${connector.length} files; hashes and import graph: OK`);
  // Exercise uninstall from its extracted package, including deleting its own
  // loaded modules. Only the throwaway host and package are within this scope.
  await writeFile(path.join(cwd, 'personal-note.txt'), 'keep');
  const manual = execFile(process.execPath, ['server.js'], { cwd, env, windowsHide: true });
  const manualClosed = new Promise(resolve => manual.once('exit', code => resolve(code)));
  try {
  const { listRuntimes } = await import('../src/runtime-service.js');
  let active;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (manual.exitCode !== null) throw new Error('Manual package start failed');
    active = (await listRuntimes({ home: testEnv.STUDIO_RUNTIME_HOME })).find(r => r.pid === manual.pid && r.status === 'running');
    if (active) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(active, 'Uninstall test starts with a live manual background');
  const preview = await promisify(execFile)(process.execPath, ['scripts/uninstall.js', '--dry-run'], { cwd, env, windowsHide: true, timeout: 30000 });
  assert.match(preview.stdout, /原版文件/);
  assert.ok(await readFile(path.join(cwd, 'server.js')));
  const removed = await promisify(execFile)(process.execPath, ['scripts/uninstall.js', '--yes'], { cwd, env, windowsHide: true, timeout: 45000 });
  assert.match(removed.stdout, /已移除 1 处连接器/);
  assert.equal(await manualClosed, 0);
  await assert.rejects(readFile(path.join(cwd, 'server.js')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(host, 'data/default-user/extensions/tavern-theme-studio-connector/manifest.json')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(cwd, 'personal-note.txt'), 'utf8'), 'keep');
  assert.ok(await readFile(path.join(dataDir, 'project.json')));
  assert.equal(await readFile(path.join(host, 'data/default-user/settings.json'), 'utf8'), '{"keep":"host settings"}');
  assert.equal(await readFile(path.join(host, 'data/default-user/extensions/other-extension/manifest.json'), 'utf8'), '{"keep":true}');
  console.log('Clean package uninstall preview, removal, backups and user-data preservation: OK');
  } finally { if (manual.exitCode === null) { manual.kill(); await manualClosed; } }
} finally { assert.equal(path.dirname(temp), await realpath(os.tmpdir())); assert.ok(path.basename(temp).startsWith('tts-package-')); await rm(temp, { recursive: true, force: true }); }
