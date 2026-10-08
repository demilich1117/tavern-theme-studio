// Fictional fixtures for the real SillyTavern renderer. Never derived from chats.
export const FIXTURE_ID = 'tavern-theme-studio/native-fixture';
export const FIXTURE_VERSION = 1;
export const FIXTURE_NAME = '主题工作台 · 测试角色';
export const FIXTURE_SCENES = [
  { id: 'chat', label: '普通对话', message: 1 },
  { id: 'rich', label: '引用与排版', message: 3 },
  { id: 'code', label: '代码与表格', message: 4 },
  { id: 'reasoning', label: '思考折叠', message: 5 },
  { id: 'media', label: '图片与附件', message: 6 },
  { id: 'long', label: '长文滚动', message: 7 },
  { id: 'swipes', label: '候选回复与编辑', message: 9 },
];
export function isFixtureMarker(value) { return value?.id === FIXTURE_ID && value?.version === FIXTURE_VERSION; }
export function isFixtureCharacter(character) { return isFixtureMarker(character?.data?.extensions?.tts_fixture); }
export function isFixtureChat(metadata) { return isFixtureMarker(metadata?.tts_fixture); }
export function fixtureCharacter() {
  return {
    ch_name: FIXTURE_NAME,
    description: '专用于主题排版检查的虚构角色。所有对话为人工编写的测试样本。',
    first_mes: '这是主题工作台测试角色。请用连接器打开完整测试对话，无需请求模型。',
    creator: 'Tavern Theme Studio', character_version: String(FIXTURE_VERSION),
    creator_notes: '可保留测试编辑，或从工作台新建一份测试副本。',
    json_data: JSON.stringify({ data: { extensions: { tts_fixture: { id: FIXTURE_ID, version: FIXTURE_VERSION } } } }),
  };
}
export function createFixture({ assetBase, integrity }) {
  const base = new URL(assetBase);
  const asset = name => new URL(name, base).pathname;
  const marker = { id: FIXTURE_ID, version: FIXTURE_VERSION };
  const attachmentText = '这是一份本地虚构附件，仅用于主题测试。路线：旧桥 → 河岸 → 灯塔。\n';
  const stamp = index => new Date(Date.UTC(2026, 0, 1, 12, index)).toISOString();
  const message = (index, mes, is_user = false, extra = {}) => ({
    name: is_user ? '测试访客' : FIXTURE_NAME, is_user, is_system: false,
    send_date: stamp(index), mes, force_avatar: asset(is_user ? 'fixture-user.svg' : 'fixture-guide.svg'),
    ...(!is_user ? { gen_started: stamp(index), gen_finished: new Date(Date.parse(stamp(index)) + 4200).toISOString() } : {}),
    extra: { tts_fixture: { ...marker, sample: index }, ...extra },
  });
  const messages = [
    message(0, '【主题工作台测试说明】\n\n这里的角色、消息、思考区和附件都是虚构样本。可以检查原生编辑、折叠、复制和已有候选回复。测试不需要发送消息或调用模型。', false, { type: 'generic' }),
    message(1, '晚上好。我们沿着河岸走一小段，看看灯塔和桥边的树，好吗？\n\n这是第二个段落，用于查看用户消息的行距。', true),
    message(2, '“当然。”向导合起地图，**点亮手中的灯**。\n\n*风把树叶吹得轻轻作响。* 小路从旧桥旁延伸出去，远处的灯塔亮着暖光。中文 English 12345，标点「」《》与 emoji 🌙 都应清楚可读。'),
    message(3, '## 河岸手记\n\n> 走得慢一点，才看得清沿途的风景。\n>\n> 这是跨段引用，用来检查边框、底色和留白。\n\n- **灯笼**：照亮脚下\n- *地图*：辨认方向\n  - 桥边有一个路标\n\n1. 经过石桥\n2. 在灯塔前休息\n\n~~旧路线~~ 已划去，`river_path` 是行内代码。\n\n---\n\n[虚构路线链接](#tts-fixture-note)；这段文字用于检查链接和换行。'),
    message(4, '### 代码与表格\n\n```javascript\nconst route = {\n  start: "旧桥",\n  finish: "灯塔",\n  note: "This deliberately long unbroken code line tests horizontal scrolling inside the native code block without widening the entire conversation."\n};\n```\n\n| 地点 | 路线说明 | 时间 |\n| --- | --- | ---: |\n| 旧桥 | 沿着河岸的小路前行 | 15 分钟 |\n| 灯塔 | 经过树林与观景平台，再沿台阶上行 | 40 分钟 |\n\n表格后的正文也应留有间距。'),
    message(5, '路线已经记在地图上。我们先过桥，再到灯塔下休息。\n\n请展开上面的原生思考栏，检查标题、正文、折叠和编辑控件。', false, {
      reasoning: '这是人工编写的思考区占位文本，并非模型内部推理。\n\n第一段用于检查正文行高。\n\n第二段包含 **粗体**、`行内代码` 和较长句子，便于观察展开时的留白与折叠后的高度。',
      reasoning_type: 'manual', reasoning_duration: 1800, token_count: 128,
    }),
    message(6, '### 旅途明信片\n\n下面是随连接器提供的本地示意图与文本附件，用于检查原生媒体和附件区域。', false, {
      media: [{ type: 'image', url: asset('fixture-landscape.svg'), title: '虚构河岸示意图' }],
      files: [{ url: asset('fixture-note.txt'), name: '虚构路线说明.txt', size: new TextEncoder().encode(attachmentText).length, text: attachmentText }],
    }),
    message(7, '## 长文滚动样本\n\n' + Array.from({ length: 14 }, (_, i) => `第 ${i + 1} 段 · 河水缓缓流向远处，灯影在水面上排成细碎的光点。旅人停在桥上，望着对岸安静的树林。夜风带来草木的气息，纸页在指间轻轻翻动。这里使用连续长段落检查阅读宽度、段间距、装饰覆盖和滚动条，所有内容都是虚构的。`).join('\n\n')),
    message(8, '我准备好了。最后再检查一下回复切换和消息编辑吧。', true),
    message(9, '候选回复 A · 我们从桥边出发。可以点击左／右箭头在已有的三条回复之间切换，也可以编辑这条测试消息。'),
  ];
  messages[0].is_system = true;
  const last = messages.at(-1);
  last.swipe_id = 0;
  last.swipes = [last.mes, '候选回复 B · 先坐在长椅上整理地图，然后沿河岸走向灯塔。\n\n第二个段落用于检查切换后消息高度变化。', '候选回复 C · 到灯塔前见。'];
  last.swipe_info = last.swipes.map((_, i) => ({ send_date: stamp(9), gen_started: last.gen_started, gen_finished: last.gen_finished, extra: { ...structuredClone(last.extra), token_count: 48 + i * 16 } }));
  return [{ user_name: '测试访客', character_name: FIXTURE_NAME, create_date: stamp(0), chat_metadata: { integrity, tts_fixture: marker } }, ...messages];
}
