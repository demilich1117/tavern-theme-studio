import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { STUDIO_VERSION } from '../shared/version.js';
import { readGeneratedZip } from './zip.js';
const root = path.resolve(import.meta.dirname, '..'), temp = await mkdtemp(path.join(os.tmpdir(), 'tts-package-'));
try {
  const zip = await readFile(path.join(root, `output/releases/tavern-theme-studio-${STUDIO_VERSION}-core.zip`));
  const files = readGeneratedZip(zip);
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
      for(const route of ['/', '/app.js', '/workflow.js', '/panels.js', '/workspace.css', '/setup.js', '/co-design.js', '/shared/co-design.js', '/theme-analysis.js', '/clipboard.js', '/api/theme-analysis', '/api/theme-analysis/source', '/api/health', '/api/build/presets', '/connector.zip']) assert.equal((await fetch(app.address+route)).status,200,route);
      const s=await(await fetch(app.address+'/api/session')).json();
      const response=await fetch(app.address+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':s.token},body:JSON.stringify({projectId:s.projectId,sessionId:s.sessionId,revision:s.revision,fingerprint:s.fingerprint,command:{type:'set',target:'assistant',property:'border-radius',value:'12px'}})});
      assert.equal(response.status,200);
      const exported=await(await fetch(app.address+'/api/export?mode=offline')).json();assert.match(exported.theme.custom_css,/12px/);
    }finally{await app.close()}
    const reopened=await createServer({port:0,seedPath:'dist/missing-old-example.json'});await reopened.close();
    console.log('Clean package startup, commands, export and restart: OK');`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd, windowsHide: true, timeout: 30000 });
  console.log(stdout.trim());
  const connector = readGeneratedZip(await readFile(path.join(cwd, 'dist/tavern-theme-studio-connector.zip')));
  for (const [filename, bytes] of connector.filter(([f]) => f.endsWith('.js'))) {
    for (const m of bytes.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(filename), m[1]));
      assert.ok(connector.some(([f]) => f === target), `Missing connector import: ${target}`);
    }
  }
  console.log(`Core ZIP ${files.length} files; connector ${connector.length} files; hashes and import graph: OK`);
} finally { assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith('tts-package-')); await rm(temp, { recursive: true, force: true }); }
