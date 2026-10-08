import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, fixtureCharacter, isFixtureCharacter, FIXTURE_SCENES } from '../shared/fixture.js';
import { createFixtureHost } from '../connector/fixture-host.js';

const assetBase = 'http://127.0.0.1:8000/scripts/extensions/third-party/tavern-theme-studio-connector/connector/assets/';
function harness() {
  const writes = [], files = new Map(), cards = new Map();
  let seq = 0, intercept, blocked = false;
  const ctx = { characters: [{ avatar: 'private.png', name: 'Private' }], characterId: 0, groupId: null, chatId: 'private-chat', chatMetadata: {}, chat: [{ mes: 'PRIVATE_SENTINEL' }], extensionSettings: {}, saveSettingsDebounced() {} };
  ctx.getCharacters = async () => { for (const card of cards.values()) if (!ctx.characters.some(c => c.avatar === card.avatar)) ctx.characters.push(card); };
  ctx.selectCharacterById = async id => { ctx.characterId = id; ctx.chatId = 'blank'; ctx.chatMetadata = {}; ctx.chat = []; };
  ctx.openCharacterChat = async name => { const rows = files.get(name); ctx.chatId = name; ctx.chatMetadata = rows[0].chat_metadata; ctx.chat = rows.slice(1); };
  const host = createFixtureHost({ getContext: () => ctx, assetBase, uuid: () => String(++seq), assertIdle: async () => { if (blocked) throw new Error('draft'); }, request: async (path, body) => {
    intercept?.(path, body);
    if (path === '/api/characters/create') { writes.push({ path, body }); const avatar = 'fixture.png'; cards.set(avatar, { avatar, ...JSON.parse(body.json_data) }); return avatar; }
    if (path === '/api/characters/get') return cards.get(body.avatar_url);
    if (path === '/api/chats/get') return structuredClone(files.get(body.file_name) || []);
    if (path === '/api/chats/save') { writes.push({ path, body }); assert.equal(files.has(body.file_name), false, 'never overwrite a fixture'); files.set(body.file_name, structuredClone(body.chat)); return { ok: true }; }
    throw new Error('Unexpected path ' + path);
  } });
  return { host, ctx, writes, files, cards, setIntercept(fn) { intercept = fn; }, block() { blocked = true; } };
}
test('native fixture contains locally sourced elements, independent swipes and manual reasoning', () => {
  const rows = createFixture({ assetBase, integrity: 'test' });
  assert.equal(rows.length, 11);
  for (const scene of FIXTURE_SCENES) assert.equal(rows[scene.message + 1].extra.tts_fixture.sample, scene.message);
  assert.equal(rows[6].extra.reasoning_type, 'manual');
  assert.match(rows[5].mes, /```javascript/);
  assert.ok(rows[7].extra.media[0].url.startsWith('/scripts/extensions/third-party/'));
  const last = rows.at(-1);
  assert.equal(last.swipes[last.swipe_id], last.mes);
  assert.equal(last.swipe_info.length, 3);
  last.swipe_info[1].extra.token_count = 999;
  assert.notEqual(last.swipe_info[0].extra.token_count, 999);
  assert.equal(isFixtureCharacter(JSON.parse(fixtureCharacter().json_data)), true);
  assert.equal(isFixtureCharacter({ name: '主题工作台 · 测试角色' }), false);
});
test('open creates only synthetic data, deduplicates requests and reuses edited samples', async () => {
  const h = harness();
  const a = h.host.open(), b = h.host.open();
  assert.equal(a, b);
  await a;
  assert.equal(h.host.status().active, true);
  assert.equal(h.writes.length, 2);
  assert.equal(JSON.stringify(h.writes).includes('PRIVATE_SENTINEL'), false);
  const name = h.ctx.chatId;
  h.files.get(name)[2].mes = 'A saved test edit';
  await h.host.open();
  assert.equal(h.writes.length, 2);
  assert.equal(h.files.get(name)[2].mes, 'A saved test edit');
  await h.host.open({ fresh: true });
  assert.notEqual(h.ctx.chatId, name);
  assert.equal(h.files.get(name)[2].mes, 'A saved test edit');
  assert.equal(h.writes.length, 3);
});
test('drafts and unrelated character/chat markers prevent destructive switching', async () => {
  const h = harness(); h.block();
  await assert.rejects(h.host.open(), /draft/);
  assert.equal(h.writes.length, 0);
  const other = harness(); await other.host.open();
  other.files.get(other.ctx.chatId)[0].chat_metadata = {};
  await assert.rejects(other.host.open(), /标记不匹配/);
  assert.equal(other.writes.length, 2);
  other.cards.get('fixture.png').data.extensions = {};
  await assert.rejects(other.host.open(), /测试角色标记不匹配/);
  assert.equal(other.writes.length, 2);
});
test('chat switch during asynchronous preparation stops before selecting or writing a chat', async () => {
  const h = harness();
  h.setIntercept(path => { if (path === '/api/characters/create') h.ctx.chatId = 'different-private-chat'; });
  await assert.rejects(h.host.open(), /聊天已切换/);
  assert.equal(h.ctx.characterId, 0);
  assert.equal(h.ctx.chatId, 'different-private-chat');
  assert.equal(h.files.size, 0);
});
