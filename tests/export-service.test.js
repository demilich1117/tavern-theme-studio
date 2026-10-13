import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../shared/core.js';
import { createAssetStore } from '../src/asset-store.js';
import { createExportService, referenceIndex } from '../src/export-service.js';
import { captureLocation, locationStatus } from '../shared/ticket-location.js';
test('strict offline export rejects missing network dependencies and file backup preserves immutable bytes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-export-'));
  try {
    const assets = await createAssetStore(dir), service = createExportService(assets, { status: () => ({ assets: [] }) });
    const a = await assets.put(await readFile(new URL('../public/folio-art/nav-pendant.webp', import.meta.url)));
    const p = createProject({ name: '测试', custom_css: `body { background: url("${a.reference}"); }` });
    const result = await service.theme(p, 'offline'); assert.ok(result.theme.custom_css.includes('data:image/webp;base64,')); assert.ok(!result.theme.custom_css.includes('tts-asset://'));
    assert.equal((await service.manifest(p)).assets[0].bytes, a.size);
    assert.equal(referenceIndex(p, [p])[0].locations.length, 2);
    await assert.rejects(service.theme(p, 'external'), /未验证/);
    p.customCss = '@import "https://example.com/font.css";'; await assert.rejects(service.theme(p, 'offline'), /缺少依赖/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ticket container and named breakpoint identities detect deletion and condition changes', () => {
  const project = createProject(), anchor = { target: 'chat' };
  project.breakpoints.push({ id: 'tablet', name: '平板', condition: '(max-width: 1000px)' });
  const location = captureLocation(project, { kind: 'container', id: 'chat', scope: 'tablet' }, anchor);
  const ticket = { location, anchor, basis: { projectId: project.projectId } };
  assert.equal(locationStatus(ticket, project).valid, true);
  project.breakpoints.at(-1).condition = '(max-width: 999px)'; assert.equal(locationStatus(ticket, project).valid, false);
  project.breakpoints.pop(); assert.equal(locationStatus(ticket, project).valid, false);
});
test('ordinary native export embeds local images, preserves public imports and keeps strict modes strict',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'tts-standard-export-'));
  try{
    const assets=await createAssetStore(dir),service=createExportService(assets,{status:()=>({assets:[]})});
    const a=await assets.put(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));
    const p=createProject({name:'陌生主题',custom_css:`@import "https://example.org/font.css";body{background:url("${a.reference}"),url("https://example.org/art.png")}`});
    const result=await service.theme(p,'standard');assert(result.theme.custom_css.includes('data:image/gif;base64,'));assert(!result.theme.custom_css.includes('tts-asset://'));
    assert(result.theme.custom_css.includes('https://example.org/font.css'));assert(result.theme.custom_css.includes('https://example.org/art.png'));
    assert.equal(result.report.remote.length,2);await assert.rejects(service.theme(p,'offline'),/缺少依赖/);await assert.rejects(service.theme(p,'external'),/未验证/);
    p.customCss='body{background:url("http://127.0.0.1:19323/api/assets/local.png")}';await assert.rejects(service.theme(p,'standard'),/本机地址/);
  }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('tts-standard-export-'));await rm(dir,{recursive:true,force:true});}
});
