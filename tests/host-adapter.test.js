import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostAdapter } from '../connector/host-adapter.js';
import { createFixtureHost } from '../connector/fixture-host.js';

test('1.14–1.16 theme snapshot preserves unsaved CSS and appearance without leaking other settings', async () => {
  const settings = { theme: 'Draft', custom_css: '.mes { color: red }', chat_width: 72, font_scale: 1.2,
    compact_input_area: false, media_display: 'gallery', persona_description: 'PRIVATE', unknown_future_setting: 'PRIVATE' };
  const adapter = createHostAdapter({ getContext: () => ({ powerUserSettings: settings }), loadModule: async () => ({}) });
  const theme = await adapter.readTheme();
  assert.deepEqual(theme, { name: 'Draft', custom_css: settings.custom_css, chat_width: 72, font_scale: 1.2, compact_input_area: false, media_display: 'gallery' });
  theme.custom_css = 'changed';
  assert.equal(settings.custom_css, '.mes { color: red }');
  settings.custom_css = '.mes { color: blue }';
  assert.equal((await adapter.readTheme()).custom_css, settings.custom_css);
});

test('modern host owns the theme schema, including future theme fields', async () => {
  let settings = { theme: 'Original', custom_css: '' };
  const theme = { name: 'Latest', custom_css: '', future_theme_field: { enabled: true } };
  const adapter = createHostAdapter({ getContext: () => ({ powerUserSettings: settings }), loadModule: async () => {
    settings = { theme: 'Latest', custom_css: '' };
    return { getThemeObject(name) { assert.equal(name, 'Latest'); return theme; } };
  } });
  const snapshot = await adapter.readTheme();
  assert.deepEqual(snapshot, theme);
  snapshot.future_theme_field.enabled = false;
  assert.equal(theme.future_theme_field.enabled, true);
});

test('unavailable theme settings and failed imports do not return an empty replacement theme', async () => {
  const adapter = createHostAdapter({ getContext: () => ({}), loadModule: async () => ({}) });
  await assert.rejects(adapter.readTheme(), /尚未就绪/);
  const failing = createHostAdapter({ getContext: () => ({}), loadModule: async () => { throw new Error('load failed'); } });
  await assert.rejects(failing.readTheme(), /load failed/);
});

test('1.14 generation flags are live, cover groups and reject unknown host contracts', async () => {
  const core = { is_send_press: false }, groups = { is_group_generating: false };
  const adapter = createHostAdapter({ getContext: () => ({}), loadModule: async path => path === '/script.js' ? core : groups });
  assert.equal(await adapter.isGenerating(), false);
  core.is_send_press = true;
  assert.equal(await adapter.isGenerating(), true);
  core.is_send_press = false; groups.is_group_generating = true;
  assert.equal(await adapter.isGenerating(), true);
  delete groups.is_group_generating;
  await assert.rejects(adapter.isGenerating(), /无法确认/);
});

test('legacy flag is read after asynchronous group import, before any fixture writes', async () => {
  const core = { is_send_press: false };
  const adapter = createHostAdapter({ getContext: () => ({}), loadModule: async path => {
    if (path === '/script.js') return core;
    core.is_send_press = true;
    return { is_group_generating: false };
  } });
  let writes = 0;
  const fixture = createFixtureHost({ getContext: () => ({}), assetBase: 'https://example.test/',
    request: async () => { writes++; }, assertIdle: async () => { if (await adapter.isGenerating()) throw new Error('busy'); } });
  await assert.rejects(fixture.open(), /busy/);
  assert.equal(writes, 0);
});

test('1.15+ uses native generation status without loading the legacy group module', async () => {
  let busy = false;
  const adapter = createHostAdapter({ getContext: () => ({}), loadModule: async path => {
    assert.equal(path, '/script.js'); return { isGenerating: () => busy };
  } });
  assert.equal(await adapter.isGenerating(), false);
  busy = true;
  assert.equal(await adapter.isGenerating(), true);
});
