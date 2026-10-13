import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { colorParts, colorValue, paddingSides, activeRules, supportsField, sameValue } from '../shared/editing.js';
import { createProject, applyCommand, exportTheme, ProjectHistory } from '../shared/core.js';
import { pickCandidates } from '../connector/picking.js';
import { createServer } from '../server.js';
import { buildThemeSource } from '../src/theme-builder.js';
import { sourceFingerprint } from '../src/build-service.js';

test('color edits preserve alpha; four-side padding remains one reversible edit', () => {
  const { hex, alpha } = colorParts('rgba(34, 51, 68, 0.25)');
  assert.equal(hex, '#223344'); assert.equal(colorValue('#112233', alpha), '#11223340');
  assert.equal(colorValue(colorParts('transparent').hex, colorParts('transparent').alpha), '#00000000');
  assert(sameValue('background-color', '#11223340', 'rgba(17, 34, 51, 0.251)'));
  assert.deepEqual(paddingSides('10px 20px 30px'), [10, 20, 30, 20]);
  const history = new ProjectHistory(createProject());
  history.execute({ type: 'set', target: 'message-text', property: 'padding', value: '10px 20px 30px 40px' }, 0);
  assert.match(exportTheme(history.project).custom_css, /padding: 10px 20px 30px 40px/);
  history.execute({ type: 'undo' }, 1); assert.equal(history.project.rules.base['message-text'], undefined);
  assert.throws(() => applyCommand(history.project, { type: 'set', target: 'avatar', property: 'padding', value: '2px calc(1px)' }));
  assert(!supportsField('timestamp', 'width')); assert(supportsField('timestamp', 'font-size'));
});
test('picking never falls back to global on unrelated controls; nested targets retain their hierarchy', () => {
  const body = { matches: s => s === 'body', closest: s => s === 'body' ? body : null };
  const unknown = { matches: () => false, closest: s => s === 'body' ? body : null };
  assert.deepEqual(pickCandidates(unknown), []); assert.equal(pickCandidates(body)[0].target.id, 'global');
  const quote = { matches: () => false, closest: s => ['#chat .mes .mes_text blockquote', '#chat .mes .mes_text', '#chat .mes[is_user="false"]', '#chat', 'body'].includes(s) ? body : null };
  assert.deepEqual(pickCandidates(quote).map(h => h.target.id), ['quote', 'message-text', 'assistant', 'chat']);
});
test('diagnosis uses the same ordered breakpoints as the generated stylesheet', () => {
  let p = applyCommand(createProject(), { type: 'breakpoints', breakpoints: [{ id: 'mobile', name: '手机', condition: '(max-width: 767px)' }, { id: 'tablet', name: '平板', condition: '(max-width: 1000px)' }] });
  for (const [scope, value] of [['base', '10px'], ['mobile', '20px'], ['tablet', '30px']]) p = applyCommand(p, { type: 'set', target: 'chat', scope, property: 'padding', value });
  assert.equal(activeRules(p, 'chat', 390).padding, '30px'); assert.equal(activeRules(p, 'chat', 900).padding, '30px'); assert.equal(activeRules(p, 'chat', 1200).padding, '10px');
});
test('blank work automatically binds portable source; recipe-only rebuild preserves user layer and property edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-editing-')); let app;
  try {
    app = await createServer({ dataDir: path.join(root, 'initial'), workHome: path.join(root, 'works'), pointer: path.join(root, 'pointer.json'), port: 0 });
    const read = async route => { const response = await fetch(app.address + route); assert(response.ok); return response.json(); };
    const command = async command => { const s = await read('/api/session'); const response = await fetch(app.address + '/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': s.token }, body: JSON.stringify({ ...s, command: { scanFingerprint: s.fingerprint, ...command } }) }); const data = await response.json(); assert.equal(response.status, 200, data.error); return data; };
    await command({ type: 'work-create-blank', name: '空白测试' });
    const deadline = Date.now() + 15000;
    while ((await read('/api/build')).status.state !== 'succeeded') { assert(Date.now() < deadline); await new Promise(r => setTimeout(r, 50)); }
    const binding = await read('/api/build'); assert(binding.bound); assert(binding.autoSync);
    const source = binding.config.root;
    await command({ type: 'set', target: 'message-text', property: 'padding', value: '12px 20px' });
    await writeFile(path.join(source, 'theme.css'), ':root{--art:url("https://example.org/a.png")}body::after{content:"";position:fixed;width:10px;height:10px;background-image:var(--art)}');
    const recipeFile = path.join(source, 'studio.recipe.json'), recipe = JSON.parse(await readFile(recipeFile));
    recipe.slots = [{ id: 'art', name: '角落装饰', group: '角落', selector: 'body', pseudo: '::after', method: 'background', sourceOwned: true, assetVariable: '--art' }];
    await writeFile(recipeFile, JSON.stringify(recipe));
    while (!(await read('/api/project')).project.decorations.length) { assert(Date.now() < deadline); await new Promise(r => setTimeout(r, 100)); }
    await command({ type: 'decoration-update', id: 'layer-art', patch: { props: { x: 17 } } });
    const minimalConfig = { ...binding.config, watch: ['theme.css', 'theme-fields.json', 'assets.manifest.json'] };
    const before = await sourceFingerprint(minimalConfig, path.join(root, 'ignored'));
    recipe.slots[0].note = '调整后的说明'; await writeFile(recipeFile, JSON.stringify(recipe));
    assert.notEqual(await sourceFingerprint(minimalConfig, path.join(root, 'ignored')), before);
    while ((await read('/api/project')).project.recipe.slots[0].note !== '调整后的说明') { assert(Date.now() < deadline); await new Promise(r => setTimeout(r, 100)); }
    const p = (await read('/api/project')).project;
    assert.equal(p.decorations[0].props.x, 17); assert.equal(p.rules.base['message-text'].padding, '12px 20px');
    await writeFile(recipeFile, '{invalid');
    await assert.rejects(buildThemeSource(source, path.join(root, 'invalid-build')));
  } finally { await app?.close(); assert.equal(path.dirname(root), os.tmpdir()); assert(path.basename(root).startsWith('tts-editing-')); await rm(root, { recursive: true, force: true }); }
});
