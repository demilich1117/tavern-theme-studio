import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateProject, exportTheme, applyCommand, MAX_THEME_CSS_LENGTH } from '../shared/core.js';
import { scanVariables } from '../shared/variables.js';

test('illustrated example is self contained, importable, editable, and uses native rgba export colors', async () => {
  const root = new URL('../examples/moonveil-covenant/', import.meta.url);
  const theme = JSON.parse(await readFile(new URL('moonveil.theme.json', root)));
  const project = validateProject(JSON.parse(await readFile(new URL('moonveil.studio.json', root))));
  assert.deepEqual(exportTheme(project), theme);
  assert.ok(theme.custom_css.length <= MAX_THEME_CSS_LENGTH);
  assert.equal((theme.custom_css.match(/data:image\/webp;base64,/g) || []).length, 7);
  assert.ok(!theme.custom_css.includes('data:image/svg+xml;base64,'));
  assert.doesNotMatch(theme.custom_css, /__\w+_ART__|https?:\/\/|@import|file:\/\/|127\.0\.0\.1/);
  for (const [key, value] of Object.entries(theme)) if (key.endsWith('_color')) assert.match(value, /^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
  const variable = scanVariables(theme.custom_css).find(v => v.name === '--cc-ornament-opacity');
  const changed = applyCommand(project, { type: 'variable', id: variable.id, value: '.5' });
  const changedTheme = exportTheme(changed);
  assert.ok(changedTheme.custom_css.includes('--cc-ornament-opacity: .5;'));
  assert.equal(changedTheme.custom_css.match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/)[0], theme.custom_css.match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/)[0]);
});
