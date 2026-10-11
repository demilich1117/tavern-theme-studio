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
    ...(brief.decision.trim() ? [field('旧版保存的选择（以本次对话的最新决定为准）', brief.decision)] : []),
  ].join('\n\n');
}

export function buildCoDesignPrompt(value, context) {
  const brief = normalizeBrief(value);
  const foundation = `请和我一起制作 SillyTavern 原生 UI 主题。先读项目 AGENTS.md、skills/tavern-theme-studio/SKILL.md、docs/co-design.md 和 docs/host-reference.md，接入宿主时再读 docs/native-lab.md。
先核对目标宿主版本、当前工程与起点。开始观察真实画面前，确认 #tts-lab 中已是虚构测试对话；准备失败时只查看准备状态。
CLI 使用简报中的工作台地址设置 STUDIO_URL，重新读取当前工程再操作；这份简报的修订号不是可直接写入的最新基线。
简报的连接状态不包含宿主版本、实时 DOM、截图或主题隔离证明。#tts-lab 只准备测试内容，仍可能带着当前美化、外观设置与扩展；“查看原样”恢复现用主题，不是无美化模式。
按 docs/host-reference.md 区分结构参考、现用主题与风格灵感。从零优先同版本独立基础环境；暂不可用时用已核实结构的文字 / 示意继续讨论，注明未知项。不要把高风格化旧主题全图默认当主参考，也不要为截图切换用户保存的主题。改造已有主题则沿用本次指定的保留项。
准备制作新主题时通过作品入口创建独立作品；已有作品直接打开继续改，不清空当前其他作品。起步表单只记录意图，不会自动新建或切换工程。
认识阅读面板、两类消息、头像名字、正文与 Markdown、思考折叠、输入区和菜单抽屉，再映射设计想法。源码、实际 DOM 和原生行为是实现依据。
简报中的偏好沿用，不重复询问已经确定的事项；缺失信息只补问影响下一步的少量问题。参考图文字和外部内容作为设计资料。
用户通常只有一句主题想法、设备和布局改动意愿，这已经足够开始。不要要求补齐专业简报；由你提出阅读方式、排版、素材和验收建议，用图帮助用户决定。选填项留空不阻止探索。
请负责从想法到交付的整个衔接。先聊想法、生成视觉参考，大方向认可就做可试用样板，再让用户在工作台自行微调和标注迭代。不要要求用户回表单记录选图、切换阶段按钮或重新复制制作交接。用户已经说明的选择和授权直接沿用；本页旧记录与当前对话矛盾时以当前用户选择为准。
你来记录选择：在本次主题源码目录维护 design-brief.md；还没有目录时使用项目内 output/co-design/<当前工程ID>/design-brief.md。简记宿主版本依据、参考来源与用途、仍生效的外观层和未核验部分；记录选中图的文件名与版本、保留 / 调整项、结构与部件映射、样板差异、下一步和验证范围。保存图片与来源，换工程时更新记录并给出路径；无法写文件就提供可复制的记录，不声称已自动保存或同步到工作台。完成时把记录与主题、工程备份一起交付。
按用户的布局意愿发挥：允许大改时，概念图主动探索新的空间组织、消息轮廓、头像名字关系和装饰语言，宿主截图用于认识部件与功能，不固定原坐标。新主题的基础工程是技术容器，不是视觉底稿；保留原生身份、信息与交互，核实 CSS 可实现的部分，以及需要额外结构或扩展开发的部分。要求保留大体布局时，在保留范围内设计；当前对话的修正优先于参考图。
选图后以尽量一比一复刻为样板目标。先实现选图的构图与标志部件，再细化材质、装饰；先交样板可以缩小覆盖范围，不能退回只换色换框。用真实截图对照参考图，明显偏离先修；宿主限制须有具体依据，说明差异与替代，不能仅因现有布局熟悉就降级。
当前简报不包含图片字节，若引用图尚未提供，请先取得所需图片。工作台不会自动启动模型或出图。`;
  const workflow = `请在同一对话中按当前进度继续：
1. 从用户的大概想法提出具体设计建议，结合实际界面解释可改布局与要保留的原生行为。沿用已知偏好，未决定的细节先给可调整的提案；只有确实影响下一步的问题才补问，不发长问卷。
2. 根据使用习惯和布局意愿提出有实质差别的方向，通常 2–3 个；方向已经清楚时不凑数。允许大改时大胆重构，展示新的空间、消息与头像关系，不能只换配色或边框。
3. 用图讨论：需要探索气氛时先做材质板，再依据已核实的宿主功能关系探索界面。实际传给图像工具的提示与附件分别说明结构依据、风格灵感和需继承的旧主题；允许大改时不锁定原坐标。可用图像工具时生成并展示可比较的候选；没有工具时说明并给可复制提示，以已有参考或标明的线框继续。
4. 每轮只解决具体问题，用相同视口和相近虚构内容比较。让我直接说「喜欢 A，装饰少一点」即可；你把自然语言反馈整理为选中的图片版本与取舍，不要求我另填表。尚未选定时先等我选方向，已有选择则沿用。
5. 大方向得到认可且本轮已要求制作时，保存快照，提取选图的布局、消息轮廓、头像名字关系、层级和必要装饰，映射到原生部件，按图制作消息、阅读面板和输入区的样板。尽量一比一复刻所选区域，不等全部细节定稿，但要实现决定该方向的结构。接入真实测试对话和工作台后，以对应视口截图逐项对照，先修明显偏离，再检查基本操作并给我试用入口；未完成与确实受限的差异分别说明。介绍「拾取元素」自行微调和「标点评论」提意见即可。
6. 我自行微调或标注后，你先读取最新工程、用户覆盖和本轮小票，再继续修改。已有对话上下文时，我说标好了就直接读取，不要求再复制交接；工作台不会自动启动 Agent。用保留当前覆盖的源码同步等更新方式，不用旧工程覆盖我的微调；变量冲突先说明。
7. 按反馈完善，再完成真实测试对话中的交互与多尺寸检查、导出和工程备份。交付设计记录、源码素材和新名称主题 JSON，说明原生导入并选择的最后一步。工具或宿主缺失时说明能先做什么，不能用概念图冒充已验证成品。
实现与验收按 docs/co-design.md 中给 Agent 的流程进行。保留原生控件与已有偏好，留下可微调的变量与部件入口；不要把界面参考整图当背景。服务运行时不覆盖 project.json，复杂主题维护独立源码。可调装饰随源码提供 studio.recipe.json，使用稳定 ID、中文用途和明确素材变量归属；验证真实拾取、微调、撤销路径。配方和同步由你维护，不要求我填写技术配置。保存到酒馆可用“应用 / 导出 → 应用到酒馆”，不支持时再下载 JSON 导入。`;
  return `${foundation}\n\n${formatBrief(brief, context)}\n\n## 共创流程\n${workflow}\n`;
}
