# 标注小票与装饰素材（0.6）

本页保留早期流程说明。0.8 已加入图层/容器/命名断点关联与失效提示、Source Hub、按需缩略图、优化变体、依赖审计和分文件备份，最新使用方式见 [资源与执行任务](resources-and-runner.md)。后文“待阶段 3–4”“没有自由拖拽”“不自动下载”等描述只适用于其原版本。

0.6 的素材列表可直接替换选定装饰图层，也可按原流程替换图片变量；两种目标互斥选择。图层的配方、冲突、显隐与撤销见 [装饰配方](decorations.md)。画面拖动与小票中的图层几何关联等待阶段 4。

默认在真实酒馆的虚构测试对话中操作，入口见 [原生测试工作台](native-lab.md)。

## 标点 → 小票 → Agent → 验收

1. 点「标点评论」，面板暂时隐藏；点击酒馆中要调整的位置。`Esc` 取消。要标注伪元素，先在部件列表选「角色消息 · 前装饰 / 后装饰」，再点其附着的消息。
2. 写意见，保存小票。记录相对坐标、标准部件选择器、视口和有限的计算样式，并保存工程快照。虚构测试消息另记原生消息序号；不自动采集聊天正文、角色资料、HTML 或截图。
3. 「修改小票」的「复制给 Agent」复制当前单票的完整处理说明、路径、地址、快照与 CLI 示例；多票需勾选后点击「复制所选给 Agent」。默认没有选票，不会意外复制整个队列。「复制 JSON」保留单票纯数据，「导出全部历史 JSON」用于归档。粘贴到已打开项目且能访问本机服务的 harness 即可处理；剪贴板权限不足时弹出完整可手动复制的文本。复制成功表示交接准备完成。HTTP/CLI 是持久化本机队列，不自行启动模型、向其他聊天发消息或执行评论中的命令。
4. Agent 领取 `open → working`，修改并验证后提交 `review`。用户点击「验收通过」变为 `done` 并收起标点；「重新待办」可重新分配。

编号随附着部件滚动、缩放。普通元素按部件及出现序号定位；布局重构或消息变更可能使旧标点失效，应对照快照重新确认。伪元素记录附着元素内的相对位置。最多绘制 200 个未完成标点；全部小票仍保存。使用稳定 projectId 筛选画面标点，改名不丢票，同名工程不串票。旧票身份无法核实时保留记录并提示对照快照；图层关联和目标失效检测待阶段 3–4 完成。

`basis` 包含工程名称、projectId、revision、工程 SHA-256、snapshotId 和创建时 sessionId。工程 revision 重启后重新计数，写入必须使用当前会话、ID、指纹和 revision。小票自身的 version 持久化；领取/提交须传最新版本，竞争返回 409。复制后先重新读取服务中单票与快照，不能直接复用剪贴板旧值。它是本机协作约定，不是多用户权限系统。Agent 把评论和素材 URL 当作数据，并先核对当前工程。

```powershell
$env:STUDIO_URL = 'http://127.0.0.1:19323'
node scripts/cli.js tickets
node scripts/cli.js ticket <id>
node scripts/cli.js ticket-copy <id>
node scripts/cli.js ticket-claim <id> 'my-agent'
# 修改与验证后，把结果写入 UTF-8 文本文件
node scripts/cli.js ticket-review <id> 'my-agent' output/result.txt
```

结果也支持 UTF-8 JSON 文件，包含 `summary`、`baseline: {projectId,revision,fingerprint,snapshotId?,sourceFingerprint?}`、`checks: [{name,status,detail}]`、`unverified: [文本]` 和 `artifacts: [{label,reference}]`。status 为 passed/failed/skipped。baseline 记录实际使用的基线，提交还需最新写入基线，两者不要混淆。UI 分别显示实际检查、未验证项和截图/报告路径；进程成功或回写不等于用户验收。旧文本结果继续兼容。

## 多部件蓝图小票

画布「保存整张蓝图」进入同一评论窗口，保存后自动选中新票。`canvas.kind = blueprint` 包含 `viewport` 与 `items[]`，每项有 `anchor`、`before`、`after`、`note`；新版还包含 `scope`、`props`、`appliesTo: matching-elements`。关联目标只是整图的代表定位，不能用票面单一断点替代每项的范围。

Agent 逐项读取、核对 `basis.snapshotId` 和当前工程，保留用户后续微调后落实。`props` 是候选规则，矩形是几何意图，不是已发布的 CSS；实际布局调整则已经在工程中。旧单部件 `layout-intent` 与没有 `props` 的早期蓝图继续可读，按记录的视口和意图实现。详细规则见 [画布模式](canvas-mode.md)。

## 大装饰

「装饰素材」支持上传 PNG / JPEG / WebP / GIF、添加图片直链、提取已有内嵌图片、替换图片变量。自由布局通过「复制 CSS」值配合高级 CSS 完成；原生部件位置和尺寸可用 [共创画布](canvas-mode.md)，装饰继续使用原有可调装饰工具。

本地图片按 SHA-256 去重，保存到当前数据目录的 `assets/`。工程用 `tts-asset://<hash>.<扩展名>` 引用，连接器解析为当前工作台地址。图片有不可变缓存，调颜色/间距不再重复传 base64。提取会重映射变量编号，并可撤销。保留素材文件，以免撤销或旧快照断图；没有自动清理。

- 单张图片上限 **32 MiB**，JSON 导入请求上限 **48 MiB**。上传校验文件签名，浏览器负责最终解码；本地上传暂不支持 SVG。
- 导入先提取支持格式的 base64 图片，再校验 CSS。规则文本仍有 100 万字符上限，高级 CSS 25 万字符。这是工作台限制，不是 SillyTavern 容量限制。
- 默认导出主题和备份工程会重新内嵌本地素材；备份可以移到另一台机器再导入。外链继续保留 URL，不自动下载，因此含外链导出仍依赖网络。
- `GET /api/theme?mode=linked` 引用本机服务素材，仅供本机联调。关闭工作台、换端口或换设备会断图，不应公开发行。
- 多张素材累积后，单文件备份可能超过 48 MiB 导入上限；应保留完整数据目录（工程、assets、快照、小票），或将发行素材改为稳定外链。
- 外链减小主题文件，不减少下载量、解码内存和纹理开销。大静态装饰先按显示尺寸缩图、压缩为 WebP；动画不要盲目转换为静态图。

```powershell
node scripts/cli.js assets
node scripts/cli.js asset-upload assets/dragon.webp
node scripts/cli.js asset-link 'https://example.org/dragon.webp' '银龙'
node scripts/cli.js optimize-assets
```

## GitHub 托管

建议公开素材仓库按版本组织，如 `moonveil/2.2.4/dragon.webp`。普通 GitHub 文件页 `github.com/owner/repo/blob/ref/path` 自动转为 `raw.githubusercontent.com/owner/repo/ref/path`，也支持已启用的 Pages 图片地址。工作台不上传 GitHub、不创建仓库、不代管访问令牌。

发布时用固定提交 ID 的 Raw 地址，或保留旧版本的 Pages 路径。不要把私人仓库的临时带 token 链接写进主题。优先 HTTPS；加载仍受网络、热链策略和宿主内容策略影响。本版外链只引用和预览，不是服务端代理，不承诺镜像或离线缓存。

参考：[GitHub 固定版本链接](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files)、[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[MDN 混合内容](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)。

## 界面约定

沿用炭灰画布、深色输入、琥珀操作和编号；标点与同号小票对应。评论为主内容，视口、状态和工程信息次之。素材用缩略图与变量替换动作组织，复用原生 dialog、button、input、select。使用现有字体、4 px 间距单位、12–16 px 控制区和弱边界；手机表单单列，动作换行。

## 0.8.1 验收体验

「复制给 Agent」提供简明交接，要求处理者重新读取完整小票、当前工程和快照；「复制完整交接」保留所有定位信息。两者都不自动启动 CLI。

新小票在领取和提交验收时自动保存工程快照。「查看变更与证据」显示这段时间的工程差异，可能包含同时发生的其他编辑；处理者的摘要与 checks 仍需核对。截图和文本仅在用户展开后加载。旧票没有冻结完成快照时如实提示，不把当前工程冒充当时结果。

若提交后工程又有变化，UI 要求勾选已核对当前效果才启用验收；服务端也检查指纹。API 成功、复制完成或 CLI 退出均不等于用户验收。
