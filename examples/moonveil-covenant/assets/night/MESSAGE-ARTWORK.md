# 2.1.0 消息装饰

2026-10-05 使用内置 Image Gen 生成概念，再依据概念分别生成三个透明装饰。没有使用 CLI/API，也没有重绘用户定稿的银龙、背景、头像环或外框。

## 提示词与文件

| 用途 | 原图 | 生产资源 | 提示词 |
| --- | --- | --- | --- |
| 角色消息银鳞典籍框 | `codex-message-frame.original.png`，1254×1254 | `codex-message-frame.webp`，640×640，53,252 bytes | `codex-message-frame.prompt.txt` |
| 用户信笺紫月印玺 | `lunar-wax-seal.original.png`，1024×1536 | `lunar-wax-seal.webp`，144×219，14,070 bytes | `lunar-wax-seal.prompt.txt` |
| 思考标题月相封缄 | `moon-phase-clasp.original.png`，1774×887 | `moon-phase-clasp.webp`，420×70，13,230 bytes | `moon-phase-clasp.prompt.txt` |

概念图及完整概念提示词在源工程 `concepts/message-design-2.1/`。本文件与三个生产素材、完整提示词均进入2.1.0分发包；原始PNG和改版前截图保存在源工程。

所有素材带真实alpha。原图完全透明像素比例分别约84.70%、65.12%、89.42%；典籍框中央40%区域的alpha最大为1/255，没有不透明的中心底板。检查记录见 `message-encoding.json`。源图细节原样保留，印玺与月相仅去除透明边距，等比例缩放为WebP。

## CSS使用

典籍框按25%九宫格切片；桌面角饰56px，手机34px。底边中央的翼月纹章不参与拉伸：边框装饰层在底部中央留空，另一个伪元素按固定比例显示同一原图的底部。底线由卡片自己的双层内框补齐。正文中心不放插图。

印玺桌面宽48px、手机36px，位于信笺右上缘。首段为印玺留出右侧空间，下一段恢复整行宽度；没有段落标签的消息保留右侧安全距离。短句也能避免与绸带重叠。

月相装饰位于原生 `.mes_reasoning_header_block`，与标题、箭头、操作按钮在不同的flex区域；手机宽66px。没有覆盖思考块、思考正文和操作按钮的原生隐藏规则。所有装饰均不接收指针事件。

新增素材共80,552 bytes；当前7张内嵌主题图像总计324,604 bytes。桌面和手机使用同一组素材，没有外部图片服务依赖。

重新编码：`node scripts/prepare-message-art.cjs <本机sharp模块路径>`。该脚本仅执行透明边距清理、等比例缩放、编码和alpha检查。
