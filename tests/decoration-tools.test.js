import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, applyCommand, exportTheme, ProjectHistory, validateProject } from '../shared/core.js';
import { compileDecorations, decorationDiagnostics, validateLayerProps } from '../shared/decorations.js';
import { edgePlacement, edgeDistances, sliceSides, mergeLayerProps } from '../shared/decoration-tools.js';
import { scopeExplanation, sameValue } from '../shared/editing.js';

test('scope explanations follow matching breakpoint order and keep user and character overrides separate', () => {
  let p = createProject({ name: '范围测试', custom_css: '' });
  for (const [target, scope, value] of [['user-avatar', 'base', '48px'], ['user-avatar', 'mobile', '36px'], ['assistant-avatar', 'mobile', '60px']]) p = applyCommand(p, { type: 'set', target, scope, property: 'width', value });
  const phone = scopeExplanation(p, 'user-avatar', 'base', 390);
  assert.equal(phone.effective.width, '36px'); assert.equal(phone.sources.width, p.breakpoints[0].name); assert.equal(phone.base.width, '48px');
  const desktop = scopeExplanation(p, 'user-avatar', 'mobile', 1200);
  assert.equal(desktop.active, false); assert.equal(desktop.effective.width, '48px'); assert.equal(desktop.own.width, '36px');
  assert.equal(scopeExplanation(p, 'assistant-avatar', 'base', 390).effective.width, '60px');
  assert.equal(sameValue('width', '48px', '48%'), false);
  const h = new ProjectHistory(p); h.execute({ type: 'reset-target', scope: 'mobile', target: 'user-avatar' }, 0);
  assert.equal(scopeExplanation(h.project, 'user-avatar', 'mobile', 390).effective.width, '48px');
  assert.equal(h.project.rules.mobile['assistant-avatar'].width, '60px'); h.execute({ type: 'undo' }, 1); assert.deepEqual(h.project, p);
});

test('nine edge anchors use inward distances, reject invalid input and preserve unrelated scope props', () => {
  for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) {
    const p = edgePlacement(x, y, 12, -8); assert.deepEqual(edgeDistances(p), { x, y, horizontal: 12, vertical: -8 });
    assert.equal(p.x, x === 1 ? -12 : 12); assert.equal(p.y, y === 1 ? 8 : -8);
  }
  assert.equal(edgeDistances({ anchor: { containerX: 1, containerY: 0, imageX: .5, imageY: 0 } }), null);
  for (const value of [NaN, Infinity, 10001]) assert.throws(() => edgePlacement(1, 0, value, 0));
  const layer = { props: { rotation: 12, x: 20 }, overrides: { mobile: { opacity: .5, x: 4 } } };
  const merged = mergeLayerProps(layer, 'mobile', { ...edgePlacement(1, 1, 8, 9), opacity: undefined });
  assert.equal(merged.x, -8); assert.equal(merged.y, -9); assert.equal(merged.rotation, undefined); assert.equal(merged.opacity, undefined); assert.equal(layer.props.x, 20);
  assert.deepEqual(sliceSides('10% 20% 30% fill'), { sides: ['10%', '20%', '30%', '20%'], fill: true });
  assert.equal(sliceSides('bad'), null);
});

test('long-message frame stretches only its pseudo, keeps corners, roundtrips, and undoes in one step', () => {
  let p = applyCommand(createProject({ name: '长文', custom_css: '' }), { type: 'decoration-add', target: 'user', pseudo: '::after', method: 'nine-slice', asset: 'https://example.org/frame.png', props: { width: '90px', scale: 2, opacity: .7 } });
  const id = p.decorations[0].id, h = new ProjectHistory(p);
  h.execute({ type: 'decoration-update', id, scope: 'mobile', patch: { props: { frame: 'container', slice: '12 24 12 24', edgeWidth: '16px', repeat: 'round' } } }, 0);
  const css = compileDecorations(h.project);
  assert.ok(css.indexOf('border-image-source:') > css.indexOf('border: 12px'), 'default border shorthand must not erase the frame image');
  assert.match(css, /is_user="true"[^{}]*::after/); assert.doesNotMatch(css, /is_user="false"/);
  assert.match(css, /@media \(max-width: 767px\)/); assert.match(css, /inset: 0 !important/); assert.match(css, /height: auto !important/); assert.match(css, /scale: none !important/); assert.match(css, /border-image-repeat: round/);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(h.project))), h.project);
  assert.equal(exportTheme(createProject(exportTheme(h.project))).custom_css, exportTheme(h.project).custom_css);
  assert.deepEqual(h.project.decorations[0].props, p.decorations[0].props);
  h.execute({ type: 'undo' }, 1); assert.deepEqual(h.project, p);
  assert.throws(() => validateLayerProps({ repeat: 'invalid' })); assert.throws(() => validateLayerProps({ frame: true }));
  p = applyCommand(p, { type: 'decoration-update', id, patch: { locked: true } });
  assert.throws(() => applyCommand(p, { type: 'decoration-update', id, patch: { props: { frame: 'container' } } }), /锁定/);
});

test('frame settings cannot turn fixed artwork, native controls or background images into message borders', () => {
  for (const [target, method] of [['global', 'nine-slice'], ['user', 'background']]) {
    const p = applyCommand(createProject({ name: '限制', custom_css: '' }), { type: 'decoration-add', target, pseudo: '::after', method, props: { frame: 'container' } });
    assert.ok(decorationDiagnostics(p).some(d => d.level === 'error')); assert.equal(compileDecorations(p), '');
  }
});
