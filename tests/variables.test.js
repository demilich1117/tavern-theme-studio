import test from 'node:test';
import assert from 'node:assert/strict';
import { scanVariables, rewriteVariables, variableControl, validateVariableValue } from '../shared/variables.js';
import { createProject, applyCommand, validateProject, exportTheme, ProjectHistory } from '../shared/core.js';
import { diffProjects } from '../shared/diff.js';

test('reads generic declarations without matching comments, quoted text, imports or functions', () => {
  const css = '@import url("data:text/css,{};--fake:2");\n/* :root { --comment: 7px; } */\n:root { --gap: 12px; /* 间距 */ --color: #abcdef !important; --formula: calc(100% - var(--gap)); --string: "a;{b}\\\"c"; --data: url("data:image/svg+xml;<svg>{}</svg>"); content: "--not: 2px"; }\n@media (max-width: 767px) { .panel { --gap: 6px; } }';
  const vars = scanVariables(css);
  assert.deepEqual(vars.map(v => v.name), ['--gap', '--color', '--formula', '--string', '--data', '--gap']);
  assert.equal(vars[0].label, '间距'); assert.equal(vars[1].value, '#abcdef'); assert.equal(vars[1].important, true);
  assert.equal(vars[2].value, 'calc(100% - var(--gap))');
  assert.equal(vars.at(-1).context, '@media (max-width: 767px) → .panel');
  const edited = rewriteVariables(css, { [vars[0].id]: '24px', [vars.at(-1).id]: '8px', [vars[1].id]: 'rgb(0 20 30 / 0.5)' });
  assert.equal(edited, css.replace('--gap: 12px', '--gap: 24px').replace('--gap: 6px', '--gap: 8px').replace('#abcdef', 'rgb(0 20 30 / 0.5)'));
});
test('preserves comments and declaration boundaries, including nested custom-property values', () => {
  const css = ':root{--empty: ; --structure: { label: "ok;"; count: 2 }; --x: 2px /* unit */ !important /* keep */;} .card{--x:3px}';
  const vars = scanVariables(css);
  assert.equal(vars.length, 4); assert.equal(vars[1].value, '{ label: "ok;"; count: 2 }');
  assert.equal(vars[2].important, true);
  assert.equal(vars[2].value, '2px');
  assert.equal(rewriteVariables(css, { [vars[2].id]: '8px' }), css.replace('--x: 2px', '--x: 8px'));
  assert.equal(rewriteVariables(css, { [vars.at(-1).id]: '4px' }), css.replace('--x:3px', '--x:4px'));
  assert.equal(new Set(vars.map(v => v.id)).size, vars.length);
});
test('unmodified themes round-trip byte for byte across independent author styles', () => {
  const themes = [
    ':root{--x:1;--y:var(--x)}',
    '@layer colors { :root { --accent: oklch(70% .15 20); } } @supports (display:grid){.layout{--columns:1fr 2fr;}}',
    '/* no variables */ body { color: red; }',
    '.theme[data-mode="dark"] { --Font: "Some Font", serif; --radius: 1rem } @media(min-width:800px){.theme{--radius:2rem}}',
  ];
  for (const css of themes) assert.equal(exportTheme(createProject({ name: 'Independent theme', custom_css: css })).custom_css, css);
});
test('rejects declaration injection and broken expressions while allowing valid complex values', () => {
  for (const value of ['red; color:blue', 'red} body{display:none', 'var(--x', '"unfinished', 'calc(1px]', 'red !important', 'red/*']) assert.throws(() => validateVariableValue(value), value);
  for (const value of ['calc(100% - var(--gap, 12px))', 'rgba(0, 20, 40, .5)', '"a;{b}"', 'url("data:image/png;base64,abc;")', '1 / 1', 'var(--x) /* note */']) assert.equal(validateVariableValue(value), value);
  assert.equal(variableControl('1 / 1').type, 'ratio'); assert.equal(variableControl('rgba(0,0,0,.2)').type, 'color'); assert.equal(variableControl('var(--accent)').type, 'text'); assert.equal(variableControl('-2.5rem').min, -5);
});
test('v1 migration, variable undo, base replacement and snapshot comparisons preserve other work', () => {
  const base = createProject({ name: 'Theme', custom_css: ':root{--gap:12px}' });
  const legacy = { ...base, schemaVersion: 1 }; delete legacy.variableEdits;
  const migrated = validateProject(legacy); assert.equal(migrated.schemaVersion, 2); assert.deepEqual(migrated.variableEdits, {});
  const id = scanVariables(base.baseTheme.custom_css)[0].id, h = new ProjectHistory(migrated);
  h.execute({ type: 'variable', id, value: '24px' }, 0);
  assert.equal(h.project.baseTheme.custom_css, base.baseTheme.custom_css); assert.match(exportTheme(h.project).custom_css, /--gap:24px/);
  assert.equal(diffProjects(base, h.project)[0].after, '24px');
  h.execute({ type: 'undo' }, 1); assert.deepEqual(h.project, migrated);
  h.execute({ type: 'redo' }, 2); h.execute({ type: 'base-theme', theme: { name: 'Second', custom_css: ':root{--other:12px}' } }, 3); assert.deepEqual(h.project.variableEdits, {});
  assert.throws(() => applyCommand(base, { type: 'variable', id: '__proto__', value: '12px' }));
});
