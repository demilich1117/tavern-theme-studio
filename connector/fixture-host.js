import { createFixture, fixtureCharacter, isFixtureCharacter, isFixtureChat, FIXTURE_SCENES } from '../shared/fixture.js';

const KEY = 'tts_native_fixture';
const identity = context => JSON.stringify([context.groupId ?? null, context.characters[context.characterId]?.avatar ?? null, context.chatId ?? null]);

// All persistent writes target a marked fixture character and a fresh/reused
// fixture chat. No current-chat contents are copied into requests or reports.
export function createFixtureHost({ getContext, request, assertIdle, assetBase, uuid = () => crypto.randomUUID() }) {
  let running;
  function status() {
    const ctx = getContext();
    return { supported: true, active: !ctx.groupId && isFixtureCharacter(ctx.characters[ctx.characterId]) && isFixtureChat(ctx.chatMetadata), scenes: FIXTURE_SCENES };
  }
  async function prepare({ fresh = false } = {}) {
    await assertIdle();
    const start = identity(getContext());
    const check = async () => {
      await assertIdle();
      if (identity(getContext()) !== start) throw new Error('聊天已切换，已停止打开测试对话。请在当前页面重试。');
    };
    let record = getContext().extensionSettings[KEY];
    // Read only the previously registered fixture card; a display name is never
    // sufficient proof that a user's character belongs to this feature.
    if (record?.avatar) {
      const card = await request('/api/characters/get', { avatar_url: record.avatar });
      await check();
      if (!isFixtureCharacter(card)) throw new Error('测试角色标记不匹配，已停止操作。请先检查连接器记录。');
    } else {
      const avatar = await request('/api/characters/create', fixtureCharacter(), 'text');
      if (typeof avatar !== 'string' || !avatar.endsWith('.png') || /[\\/]/.test(avatar)) throw new Error('酒馆没有返回有效的测试角色文件。');
      record = { avatar };
      getContext().extensionSettings[KEY] = record;
      getContext().saveSettingsDebounced();
      await check();
    }
    let fileName = fresh ? null : record.chat;
    if (fileName) {
      const rows = await request('/api/chats/get', { avatar_url: record.avatar, file_name: fileName });
      await check();
      if (rows.length && !isFixtureChat(rows[0]?.chat_metadata)) throw new Error('测试对话标记不匹配，原文件保持不变。');
      if (!rows.length) fileName = null;
    }
    if (!fileName) {
      fileName = `TTS-Fixture-v1-${uuid()}`;
      // Always create a new file. A fresh copy never overwrites edited samples.
      await request('/api/chats/save', { avatar_url: record.avatar, file_name: fileName, chat: createFixture({ assetBase, integrity: uuid() }) });
      record = { ...record, chat: fileName };
      getContext().extensionSettings[KEY] = record;
      getContext().saveSettingsDebounced();
      await check();
    }
    if (!getContext().characters.some(c => c.avatar === record.avatar)) { await getContext().getCharacters(); await check(); }
    const id = getContext().characters.findIndex(c => c.avatar === record.avatar);
    if (id < 0) throw new Error('测试角色已创建，但酒馆角色列表未更新。请刷新后重试。');
    await getContext().selectCharacterById(id, { switchMenu: false });
    await assertIdle();
    const ctx = getContext();
    if (ctx.groupId || ctx.characters[ctx.characterId]?.avatar !== record.avatar) throw new Error('酒馆未切换到测试角色；请等待保存完成后重试。');
    if (ctx.chatId !== fileName) await ctx.openCharacterChat(fileName);
    if (!status().active || getContext().chatId !== fileName) throw new Error('测试对话未完成载入，请重试。');
    return status();
  }
  return { status, open(options) {
    if (!running) running = prepare(options).finally(() => { running = undefined; });
    return running;
  } };
}

export function nativeFixtureHost() {
  const getContext = () => SillyTavern.getContext();
  return createFixtureHost({
    getContext, assetBase: new URL('./assets/', import.meta.url).href,
    async assertIdle() {
      // Verified against SillyTavern 1.19.0. Keep private module access here.
      const { isGenerating } = await import('/script.js');
      if (isGenerating()) throw new Error('请等待当前生成结束后再打开测试对话。');
      if (document.querySelector('#send_textarea')?.value?.trim() || document.querySelector('.edit_textarea, .reasoning_edit_textarea')) throw new Error('当前有未提交的输入或编辑，请先完成，或在新标签打开测试工作台。');
    },
    async request(path, body, format = 'json') {
      const response = await fetch(path, { method: 'POST', headers: getContext().getRequestHeaders(), body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`测试对话操作失败（${response.status}）。已有内容保持原样，可重试。`);
      return format === 'text' ? response.text() : response.json();
    },
  });
}

export function focusFixtureScene(host, sceneId) {
  if (!host.status().active) throw new Error('请先打开工作台测试对话。');
  const scene = FIXTURE_SCENES.find(s => s.id === sceneId);
  if (!scene) throw new Error('未知测试场景。');
  const ctx = SillyTavern.getContext();
  const index = ctx.chat.findIndex(m => m.extra?.tts_fixture?.sample === scene.message);
  const message = index < 0 ? null : document.querySelector(`#chat .mes[mesid="${index}"]`);
  if (!message) throw new Error('这个样本已修改或尚未载入。请在聊天中查看，或新建测试副本。');
  message.scrollIntoView({ block: 'start', behavior: 'instant' });
}
