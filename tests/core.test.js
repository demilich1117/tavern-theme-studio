import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyCommand, compileOverrides, exportTheme, validateProject, ProjectHistory } from '../shared/core.js';

test('export preserves original theme fields and CSS; reimport retains rendered CSS', () => {
  const base = { name: '原主题', custom_css: '.existing { color: red; }', font_scale: 1.2, unknownFutureField: { nested: true } };
  const original = createProject(base);
  const edited = applyCommand(original, { type: 'set', target: 'assistant', property: 'padding', value: '24px' });
  const exported = exportTheme(edited);
  assert.deepEqual(exported.unknownFutureField, base.unknownFutureField);
  assert.equal(exported.font_scale, 1.2);
  assert.ok(exported.custom_css.startsWith(base.custom_css));
  assert.match(exported.custom_css, /padding: 24px !important/);
  assert.equal(exportTheme(createProject(exported)).custom_css, exported.custom_css);
  assert.deepEqual(original, createProject(base));
});
test('mobile overrides follow base rules and removing an override restores inheritance', () => {
  let p = createProject();
  p = applyCommand(p, { type: 'set', target: 'assistant', property: 'padding', value: 24 });
  p = applyCommand(p, { type: 'set', target: 'assistant', property: 'padding', value: 12, scope: 'mobile' });
  const css = compileOverrides(p);
  assert.ok(css.indexOf('24px') < css.indexOf('@media (max-width: 767px)'));
  assert.ok(css.indexOf('12px') > css.indexOf('@media (max-width: 767px)'));
  p = applyCommand(p, { type: 'set', target: 'assistant', property: 'padding', value: null, scope: 'mobile' });
  assert.ok(!compileOverrides(p).includes('@media'));
  assert.equal(p.rules.base.assistant.padding, '24px');
});
test('undo, redo, divergent edits, stale revisions, and failed edits are safe', () => {
  const h = new ProjectHistory();
  h.execute({ type: 'rename', name: '一' }, 0);
  h.execute({ type: 'rename', name: '二' }, 1);
  h.execute({ type: 'undo' }, 2); assert.equal(h.project.name, '一');
  h.execute({ type: 'redo' }, 3); assert.equal(h.project.name, '二');
  h.execute({ type: 'undo' }, 4);
  h.execute({ type: 'rename', name: '三' }, 5); assert.equal(h.future.length, 0);
  const before = h.snapshot();
  assert.throws(() => h.execute({ type: 'rename', name: 'stale' }, 5), /另一处/);
  assert.throws(() => h.execute({ type: 'set', target: 'assistant', property: 'padding', value: '1px; } body { display:none' }, 6));
  assert.deepEqual(h.snapshot(), before);
});
test('project imports reject unknown selectors, invalid units, out-of-range numbers and formats', () => {
  const p = createProject();
  for (const value of ['red', 'url(https://example.com)', '#000;display:none']) assert.throws(() => applyCommand(p, { type: 'set', target: 'global', property: 'color', value }));
  for (const value of ['900px', '-1px', '12em', '', 'NaN']) assert.throws(() => applyCommand(p, { type: 'set', target: 'input', property: 'padding', value }));
  assert.throws(() => validateProject({ ...p, schemaVersion: 99 }));
  assert.throws(() => validateProject({ ...p, rules: { base: { arbitrarySelector: {} }, mobile: {} } }));
  assert.throws(() => applyCommand(p, { type: 'set', target: 'global', property: 'display', value: 'none' }));
});
test('replacing a base theme preserves structured work; import is undoable', () => {
  const h = new ProjectHistory();
  h.execute({ type: 'set', target: 'input', property: 'border-radius', value: '16px' }, 0);
  h.execute({ type: 'base-theme', theme: { name: '酒馆原样', custom_css: 'p { color: blue; }' } }, 1);
  assert.equal(h.project.rules.base.input['border-radius'], '16px');
  const previous = h.snapshot().project;
  h.execute({ type: 'import-theme', theme: { name: '导入主题' } }, 2);
  assert.deepEqual(h.project.rules.base, {});
  h.execute({ type: 'undo' }, 3); assert.deepEqual(h.project, previous);
});
