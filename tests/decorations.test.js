import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProject, applyCommand, exportTheme, validateProject, ProjectHistory } from '../shared/core.js';
import { decorationDiagnostics, layerAsset, compileDecorations } from '../shared/decorations.js';
import { buildFolio } from '../scripts/folio-build.mjs';
import { readBuildCandidate } from '../build-service.js';
import { createAssetStore, mapProjectCss } from '../asset-store.js';
const recipe = { schemaVersion: 1, id: 'test', name: '测试配方', version: '1', slots: [{ id: 'owned', name: '声明的装饰', selector: 'body', pseudo: '::after', method: 'background', sourceOwned: true, assetVariable: '--art', position: 'fixed' }] };
const theme = { name: '测试', custom_css: ':root { --art: url("https://example.org/one.png"); } body::after { content:""; position:fixed; width:100px; height:80px; background:var(--art) center/contain no-repeat; }' };
const project = () => applyCommand(createProject(theme), { type: 'recipe', recipe });
test('declared recipes leave native CSS unchanged until edited; layers compile and survive portable roundtrip', () => {
  let p = project(); assert.equal(exportTheme(p).custom_css, theme.custom_css); assert.deepEqual(decorationDiagnostics(p), []);
  assert.equal(layerAsset(p, p.decorations[0]), 'https://example.org/one.png');
  p = applyCommand(p, { type: 'decoration-update', id: p.decorations[0].id, patch: { asset: 'https://example.org/two.png', props: { x: 12, y: -8, scale: 1.2, rotation: 15, opacity: 0.5, order: 3, anchor: { containerX: 1, containerY: 1, imageX: 1, imageY: 1 } } } });
  assert.match(exportTheme(p).custom_css, /background-image: url\("https:\/\/example.org\/two.png"\)/); assert.match(exportTheme(p).custom_css, /pointer-events: none !important/); assert.match(exportTheme(p).custom_css, /rotate: 15deg/);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  assert.equal(exportTheme(createProject(exportTheme(p))).custom_css, exportTheme(p).custom_css);
  const refreshed = applyCommand(p, { type: 'source-refresh', theme: { ...theme, custom_css: '\n/* insert */\n' + theme.custom_css }, recipe });
  assert.deepEqual(refreshed.decorations, p.decorations);
});
test('occupied/changed pseudo slots and duplicates report conflicts without overwriting source; remove, lock and undo are safe', () => {
  const h = new ProjectHistory(project()), id = h.project.decorations[0].id;
  h.execute({ type: 'decoration-update', id, patch: { locked: true } }, 0);
  assert.throws(() => h.execute({ type: 'decoration-update', id, patch: { props: { x: 2 } } }, 1), /锁定/);
  h.execute({ type: 'undo' }, 1); assert.equal(h.project.decorations[0].locked, false);
  let p = applyCommand(h.project, { type: 'decoration-duplicate', id }); assert.equal(decorationDiagnostics(p).filter(d => d.level === 'error').length, 2); assert.equal(compileDecorations(p), '');
  p = applyCommand(p, { type: 'decoration-remove', id: p.decorations[1].id });
  p = applyCommand(p, { type: 'decoration-add', target: 'global', pseudo: '::after', asset: 'https://example.org/test.png' });
  assert(decorationDiagnostics(p).some(d => d.layerId === p.decorations.at(-1).id && /占用/.test(d.message)));
  p = applyCommand(project(), { type: 'decoration-remove', id }); assert.equal(p.decorations.length, 0); assert.match(compileDecorations(p), /background-image: none/);
  p = applyCommand(p, { type: 'source-refresh', theme, recipe }); assert.equal(p.decorations.length, 0); assert.equal(p.recipe.hiddenSlots[0], 'owned');
  const broken = applyCommand(project(), { type: 'source-refresh', theme: { ...theme, custom_css: ':root{--art:url("https://example.org/one.png")}body::after{content:"OTHER"}' }, recipe });
  assert.match(decorationDiagnostics(broken)[0].message, /源码已改变/); assert.equal(compileDecorations(broken), '');
  assert.throws(() => applyCommand(project(), { type: 'decoration-update', id, patch: { props: { scale: 99 } } }), /超出/);
  for (const [css, conflict] of [['body::before { content: none !important; }', false], ['body::before { content: "{ preserve }"; }', true]]) {
    const free = applyCommand(createProject({ name: '任意主题', custom_css: css }), { type: 'decoration-add', target: 'global', pseudo: '::before' });
    assert.equal(decorationDiagnostics(free).some(d => d.level === 'error'), conflict);
  }
  assert.throws(() => applyCommand(project(), { type: 'set', target: 'assistant', property: 'padding', value: '20px', scope: '__proto__' }), /范围/);
  assert.equal(Object.prototype.assistant, undefined);
});
test('folio has twelve Chinese slots, correct 1000px variants and nine-slice use; shared candidates remain native CSS equivalent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-recipe-'));
  try {
    await buildFolio({ outputDir: dir, mode: 'local' });
    const candidate = await readBuildCandidate(dir), p = applyCommand(createProject(candidate.theme), { type: 'recipe', recipe: candidate.recipe });
    assert.equal(p.decorations.length, 12); assert.deepEqual(decorationDiagnostics(p), []); assert.equal(exportTheme(p).custom_css, candidate.theme.custom_css);
    assert.equal(p.recipe.slots.find(s => s.id === 'baby-dragon').condition, '(max-width: 1000px)');
    const slip = p.decorations.find(l => l.slotId === 'violet-slip');
    const edit = applyCommand(p, { type: 'decoration-update', id: slip.id, patch: { props: { slice: '35% 7.2% 25% 7.2% fill', edgeWidth: '30px 44px 23px 44px' } } });
    assert.match(exportTheme(edit).custom_css, /border-image-slice: 35%/);
    assert.equal((await readFile(path.join(dir, 'moonveil.studio.json'), 'utf8')).includes('D:\\RUA'), false);
    const store = await createAssetStore(dir);
    for (const asset of candidate.assets) await store.put(await readFile(asset.candidatePath), asset.name);
    const dragon = p.decorations.find(l => l.slotId === 'silver-dragon');
    const edited = applyCommand(p, { type: 'decoration-update', id: dragon.id, patch: { asset: layerAsset(p, p.decorations.find(l => l.slotId === 'baby-dragon')) } });
    const portable = await store.portableProject(edited);
    assert(!JSON.stringify(portable).includes('tts-asset://'));
    const restored = validateProject(await mapProjectCss(portable, store.extract));
    assert.equal(exportTheme(restored).custom_css, exportTheme(edited).custom_css);
  } finally { assert(dir.startsWith(path.join(os.tmpdir(), 'tts-recipe-'))); await rm(dir, { recursive: true, force: true }); }
});
