# 酒馆版本兼容

工作台 0.12.0 起，连接器最低版本为 **SillyTavern 1.14.0**，不再要求 1.19。工作台自身的 Node.js 要求仍为 22+，它与酒馆版本是两回事。

## 适配方式

- 1.14–1.16 的 `getThemeObject` 是内部函数，没有导出。连接器从当前 `powerUserSettings` 中只读取官方主题字段，保留未保存的 CSS 和外观微调，不复制其他个人设置。1.17 起使用原生导出的快照函数。
- 1.14 没有 `isGenerating()`；连接器读取 `script.js` 的 `is_send_press` 和 `group-chats.js` 的 `is_group_generating` 两个实时状态。1.15 起使用原生函数。无法确认状态时停止切换测试对话，不把未知状态当成空闲。
- 原生主题导入、APP_READY、测试角色与聊天接口、媒体和思考栏仍使用宿主能力。不存在原生导入控件或浏览器不支持文件传递时，保留下载 JSON 后手动导入的入口。
- 内部模块访问集中于 `connector/host-adapter.js`；按能力选择路径，不依赖版本字符串猜测分支。连接器 ZIP 和自动安装器均包含该文件。

## 核对矩阵

2026-10-13，从本机官方 SillyTavern Git 仓库的对应标签只读导出源码，未使用用户聊天或角色作为样本。

| 官方版本 | 标签对应提交 | 主题读取 | 生成状态 | 验证层级 |
| --- | --- | --- | --- | --- |
| 1.14.0 | `9c9be90821ffd6132b40b5f04982522a61d7ad30` | 主题字段快照 | 两个实时标志 | 源码契约 + 独立真实宿主 |
| 1.15.0 | `1c0e7ea9556afcc3ae55c888287dff67a6aa42fc` | 主题字段快照 | 原生函数 | 源码契约 |
| 1.16.0 | `e3b866b5d2bcc7fbaa889bb926fbb567cd1ed25b` | 主题字段快照 | 原生函数 | 源码契约 |
| 1.17.0 | `e3f41666c69db032e17e079fcddcf40cf47e8593` | 原生函数 | 原生函数 | 源码契约 |
| 1.18.0 | `51ad27fb86d39a3daca3adaa970375c9670c12df` | 原生函数 | 原生函数 | 源码契约 |
| 1.19.0 | `7e8663cd9c184a550b37238218bdd32c6efc68e9` | 原生函数 | 原生函数 | 源码契约 + 独立真实宿主 |

官方依据：[1.14 context](https://github.com/SillyTavern/SillyTavern/blob/1.14.0/public/scripts/st-context.js)、[1.14 主题实现](https://github.com/SillyTavern/SillyTavern/blob/1.14.0/public/scripts/power-user.js)、[1.14 生成状态](https://github.com/SillyTavern/SillyTavern/blob/1.14.0/public/script.js)、[1.14 群聊状态](https://github.com/SillyTavern/SillyTavern/blob/1.14.0/public/scripts/group-chats.js)、[1.17 主题导出](https://github.com/SillyTavern/SillyTavern/blob/1.17.0/public/scripts/power-user.js)。

源码核对覆盖：context 成员、主题字段完全一致性、生成状态导出、APP_READY 重放、主题导入控件与清理、版本门槛识别、角色 / 聊天路由、媒体 / 附件数组与思考数据。源码核对不能代替逐版本浏览器实测。

## 本地验证

环境：Windows、Node 22.19.0、Chrome / Playwright。1.14 和 1.19 均由正式标签完整导出，安装各自锁文件依赖，使用独立的配置、数据目录和本机端口。工作台使用独立测试工程与空作品库。Git archive 副本的宿主版本横幅可能显示外层工具仓库的分支 / 提交；本表提交以原始标签解析结果为准。

- `npm run release:check`：93 项测试通过，语法、版本一致性、连接器引用、安装包哈希和全新目录启动 / 导出 / 重启检查通过。
- 6 个正式标签的 `scripts/check-host-compat.js` 均通过；1.14–1.16 使用官方函数进行主题快照对照，排除无关设置。
- 独立宿主检查：自动准备 10 条虚构消息，实时修改字号，查看原样并恢复宿主样式，通过“应用到酒馆”原生导入主题，刷新后保留主题与 CSS，连接器和停靠面板各挂载一次。
- 桌面和 390×844 浏览器窄屏检查；窄屏停靠面板宽 390 px，页面横向溢出为 0。截图保存在本地 `output/playwright/compat-1.14-*.png` 和 `compat-1.19-*.png`。
- 旧版回归覆盖单人 / 群聊生成标志、异步载入期间状态变化、未知状态拒绝切换、未保存 CSS、主题快照独立性，以及新宿主优先使用原生函数。

未覆盖：1.15–1.18 的完整浏览器流程、实体手机、真实模型生成 / 流式、群聊端到端流程、第三方扩展冲突和未来版本改动。工作台能连接不等于所有主题 CSS 都跨版本通用；导出作品仍需在目标酒馆检查实际布局。

## 更新与复查

本次是 **0.12.0 发行候选**，核心安装包尚未正式发布。已有 0.11.1 用户需要同时更新工作台和连接器，不能只改旧包的最低版本号。使用候选核心包并保留原 `.local/` 和作品目录，双击 `start.cmd` 会同步连接器；手动安装使用包内 `dist/tavern-theme-studio-connector.zip`，更新后新开或刷新专用测试标签。

开发者可对可信的官方源码副本运行：

```powershell
node scripts/check-host-compat.js <1.14源码目录> <1.15源码目录> <其他版本源码目录>
node --test tests/host-adapter.test.js tests/fixture.test.js
npm run release:check
```

接口检查脚本不会修改源码或访问用户数据；它会在隔离的 JavaScript 上下文中执行传入源码里的主题快照函数，因此只对可信官方源码使用。
