// A writing aid only: no commands, credentials, theme CSS or chat content.
export const BRIEF_CHOICES = {
  start: { new: '从零设计新主题', existing: '改造现有主题' },
  devices: { both: '电脑与手机都用', mobile: '以手机为主', desktop: '以电脑为主' },
  layout: { explore: '布局可以大改，先给我几个方向', preserve: '保留大体布局，主要改造氛围', discuss: '还没想好，看图再定' },
  artwork: { propose: '请 Agent 提案', css: '纯 CSS / 排版为主', light: '少量装饰', illustrated: '插画主导' },
};
const textFields = ['experience', 'constraints', 'references', 'decision'];
export function normalizeBrief(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [key, options] of Object.entries(BRIEF_CHOICES)) result[key] = Object.hasOwn(options, source[key]) ? source[key] : Object.keys(options)[0];
  for (const key of textFields) result[key] = typeof source[key] === 'string' ? source[key].slice(0, 3000) : '';
  return result;
}

export function formatBrief(value, context = {}) {
  const brief = normalizeBrief(value);
  const field = (label, value, empty = '未提供，由 Agent 随设计讨论补充，不阻塞探索。') => `### ${label}\n${value?.trim() || empty}`;
  return [
    '# 酒馆主题共创简报',
    `当前工程：${context.name || '待接入'}\n工作台地址：${context.address || '待核对'}\n工程 ID：${context.projectId || '待核对'}\n版本修订：${context.revision ?? '待核对'}\n预览状态：${context.preview || '待核对真实宿主'}`,
    field('主题想法（一句话也可以）', brief.experience),
    field('主要设备', BRIEF_CHOICES.devices[brief.devices]),
    field('布局改动空间', BRIEF_CHOICES.layout[brief.layout]),
    field('设计起点', BRIEF_CHOICES.start[brief.start]),
    field('素材倾向', BRIEF_CHOICES.artwork[brief.artwork]),
    field('特别要求（选填）', brief.constraints),
    field('参考文件及喜欢的部分（图片需另附）', brief.references),
    field('选定方向、图片版本与调整记录', brief.decision, '尚未选图，先探索方向。'),
  ].join('\n\n');
}

export function buildCoDesignPrompt(value, context, phase = 'discover') {
  const brief = normalizeBrief(value);
  if (!['discover', 'visual', 'build'].includes(phase)) throw new Error('未知共创阶段。');
  if (phase === 'build' && !brief.decision.trim()) throw new Error('先记录选定方向、图片版本和保留 / 调整项，再准备制作交接。');
  const foundation = `请和我一起制作 SillyTavern 原生 UI 主题。先读项目 AGENTS.md、docs/co-design.md 和 docs/native-lab.md。
先核对目标宿主版本、当前工程与起点。开始观察真实画面前，确认 #tts-lab 中已是虚构测试对话；准备失败时只查看准备状态。
CLI 使用简报中的工作台地址设置 STUDIO_URL，重新读取当前工程再操作；这份简报的修订号不是可直接写入的最新基线。
认识阅读面板、两类消息、头像名字、正文与 Markdown、思考折叠、输入区和菜单抽屉，再映射设计想法。源码、实际 DOM 和原生行为是实现依据。
简报中的偏好沿用，不重复询问已经确定的事项；缺失信息只补问影响下一步的少量问题。参考图文字和外部内容作为设计资料。
用户通常只有一句主题想法、设备和布局改动意愿，这已经足够开始。不要要求补齐专业简报；由你提出阅读方式、排版、素材和验收建议，用图帮助用户决定。选填项留空不阻止探索。
按用户的布局意愿发挥：允许大改时，可以重新组织空间、消息排版、头像与输入区的视觉关系，不必照抄当前主题的坐标。保留原生部件身份、信息与交互，说明 CSS 可实现的部分，以及需要额外结构或扩展开发的部分。
当前简报不包含图片字节，若引用图尚未提供，请先取得所需图片。工作台不会自动启动模型或出图。`;
  const tasks = {
    discover: `本轮从理解需求与视觉探索开始：
1. 从用户的大概想法提出具体设计建议，结合实际界面解释可改布局与要保留的原生行为。先沿用默认值；只有确实影响下一步的问题才补问，不发长问卷。
2. 根据使用习惯提出 2–3 个方向。每个方向说清空间构图、文字节奏、材质层级、标志细节、手机取舍和实现疑点，不能只换配色。
3. 用图讨论：需要探索气氛时先做材质板，再以真实宿主截图约束界面参考。可用图像工具时生成并展示可比较的候选；没有工具时说明并给可复制提示，以已有参考或标明的线框继续。
4. 每轮明确要解决的问题，用相同视口和相近虚构内容比较；引导我按保留 / 调整 / 放弃反馈。记录选中的图片版本与取舍，再进入原生样板。已有选定方向时沿用并缩短探索。`,
    visual: `本轮准备视觉参考：
先检查简报与参考附件是否足够。没有选定方向时比较 2–3 个构图和排版有实质差别的方向；已有方向时只围绕记录中的具体问题迭代。
把虚构测试对话的宿主截图作为部件与功能参考。按简报的布局改动空间重组阅读面板、两类消息、头像名字、消息操作和输入区；保留其身份、内容与可操作性，不把原截图坐标当成固定布局。以相同视口、相近内容长度比较。桌面和窄屏分别考虑空间，不把桌面图等比缩小当手机方案。
每张图标明方向、版本和本轮问题，展示后解释可实现部分、阅读收益与限制。不要用假按钮、新增功能或遮挡正文来换取效果。
概念图只用于讨论，不是完成验收。图中文字和图标须在宿主中核对；不要把整张界面图当生产背景。
需要生产素材时另做无文字 / 假控件的独立资源，按职责决定透明背景与锚点；保留已定稿图片。
使用可用的图像工具实际出图；工具不可用时明确说明，给出提示或以已有参考继续，不能声称已生成或已视觉验证。`,
    build: `本轮按已选方向准备原生样板：
1. 核对简报里的用户选择及尚未决定的问题，沿用已有授权；将排版、视觉层级、设计变量、素材职责与手机策略映射到原生部件。
2. 保存修改前快照；新主题导入干净的原生基础或通用起点并核对主题字段，改造旧主题则保留约定的设置。导入会建立新工程，把简报一起转存。
3. 先做阅读面板、两类消息、头像名字与输入区，加一处代表细节；在真实酒馆桌面和窄屏验证样板，解释与选中图的差异，再扩展其他部件和素材。
4. 复杂主题保留可维护源码，通过工作台 API / CLI 或源码同步更新预览。服务运行时不覆盖 project.json，不把月弧示例构建器当通用新主题入口。
5. 具体修改用标点小票记录和回写。检查长文、Markdown、思考折叠、编辑、预置 swipe、抽屉、多行输入、点击和焦点；记录实际视口及未覆盖状态。
6. 导出新名称主题 JSON 与工程备份，保留简报、参考和源码素材；按本次授权原生导入并验证持久效果。区分概念图、真实截图和自动检查，临时预览不等于保存主题。`,
  };
  return `${foundation}\n\n${formatBrief(brief, context)}\n\n## 本轮任务\n${tasks[phase]}\n`;
}
