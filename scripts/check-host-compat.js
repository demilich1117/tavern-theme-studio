// Run against trusted, matching official source trees (not a running user data
// directory): node scripts/check-host-compat.js <host-source> [<host-source>...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { LEGACY_THEME_FIELDS, createHostAdapter } from '../connector/host-adapter.js';

if (!process.argv[2]) throw new Error('Pass at least one official SillyTavern source directory.');
for (const directory of process.argv.slice(2)) {
  const read = file => readFile(path.join(directory, file), 'utf8');
  const [pkg, context, power, core, groups, events, emitter, html, extensions, characters, chats, reasoning] = await Promise.all([
    'package.json', 'public/scripts/st-context.js', 'public/scripts/power-user.js', 'public/script.js',
    'public/scripts/group-chats.js', 'public/scripts/events.js', 'public/lib/eventemitter.js',
    'public/index.html', 'public/scripts/extensions.js', 'src/endpoints/characters.js',
    'src/endpoints/chats.js', 'public/scripts/reasoning.js',
  ].map(read));
  const version = JSON.parse(pkg).version;
  for (const member of ['getRequestHeaders', 'getCharacters', 'selectCharacterById', 'openCharacterChat',
    'extensionSettings', 'saveSettingsDebounced', 'powerUserSettings', 'chatMetadata', 'chatId', 'event_types']) {
    assert.match(context, new RegExp(`\\b${member}\\b`), `${version}: context.${member}`);
  }
  const themeFunction = power.match(/(?:export )?function getThemeObject\(name\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(themeFunction, `${version}: theme snapshot contract`);
  const nativeTheme = themeFunction.startsWith('export ');
  const fields = [...themeFunction.matchAll(/(\w+): power_user\.(\w+)/g)];
  if (!nativeTheme) {
    assert.deepEqual(fields.map(m => m[1]).sort(), [...LEGACY_THEME_FIELDS].sort(), `${version}: legacy field allowlist drift`);
    // Compare with the actual host function, preserving values and excluding
    // unrelated power_user fields. No full host initialization or network.
    const settings = Object.fromEntries(fields.map(m => [m[2], `value:${m[2]}`]));
    settings.custom_css = '.mes { color: red }'; settings.theme = 'Contract test'; settings.private_setting = 'never export';
    const expected = vm.runInNewContext(`${themeFunction}; getThemeObject('Contract test')`, { power_user: settings });
    const adapter = createHostAdapter({ getContext: () => ({ powerUserSettings: settings }), loadModule: async () => ({}) });
    assert.deepEqual(await adapter.readTheme(), JSON.parse(JSON.stringify(expected)), `${version}: theme data parity`);
  }
  const nativeGeneration = /export const isGenerating\s*=/.test(core);
  if (!nativeGeneration) {
    assert.match(core, /export let is_send_press\s*=\s*false/);
    assert.match(groups, /export \{[^}]*\bis_group_generating\b/s);
  }
  assert.match(events, /APP_READY:\s*'app_ready'/);
  assert.match(events, /new EventEmitter\(\[event_types.APP_READY/);
  assert.match(emitter, /autoFireLastArgs/);
  for (const id of ['ui_preset_import_file', 'themes', 'extensions_settings', 'chat', 'sheld', 'send_form', 'send_textarea']) {
    assert.ok(html.includes(`id="${id}"`), `${version}: #${id}`);
  }
  assert.match(power, /inputElement\.value = null/);
  assert.match(power, /\$\('#themes'\)\.on\('change'/);
  assert.match(extensions, /minimum_client_version/);
  for (const route of ['/create', '/get']) assert.ok(characters.includes(`router.post('${route}'`), `${version}: characters${route}`);
  for (const route of ['/save', '/get']) assert.ok(chats.includes(`router.post('${route}'`), `${version}: chats${route}`);
  assert.ok(core.includes('mes.extra.media'), `${version}: native media array`);
  assert.ok(core.includes('mes.extra.files'), `${version}: native file array`);
  assert.match(reasoning, /reasoning_type/);
  console.log(`${version}: contracts OK; theme=${nativeTheme ? 'native' : 'legacy'}, generation=${nativeGeneration ? 'native' : 'legacy flags'}`);
}
