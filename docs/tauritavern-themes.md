# SillyTavern 与 TauriTavern 主题适配

层级适配还需[控件命中与状态验收](control-validation.md)：TT 强制 fixed 的顶栏可能建立新的堆叠上下文，几何正确并不代表抽屉可点。核对实际遮挡和焦点，不把某个主题的 z-index 数值复制为通用修复。

后续美化默认尽量兼顾两个宿主，保留用户选定的设计。版本依据、静态核对、浏览器复现和实机结果分开记录；未拿到 TT 实机时继续可验证的工作，不宣称全面兼容。

## 对照目标宿主

2026-10-17 参考：TT 2.3.0，提交 `f6126b4fc9243eb3990f2c0bad86e2afcb502f22`，README 声明兼容 ST 1.18.0。该记录不是用户安装版本或最新发布版。

- [固定提交源码](https://github.com/Darkatse/TauriTavern/tree/f6126b4fc9243eb3990f2c0bad86e2afcb502f22)：核对 `src/index.html`、`src/style.css`、`src/css/mobile-styles.css`、`src/scripts/power-user.js`。运行时资源仍在 `/scripts/...`，不带 `/src/`。
- [布局契约](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/docs/API/Layout.md)：safe-area、surface-local IME 与弹窗接入。
- 移动端还会安装 `src/tauri/main/compat/mobile/mobile-geometry-firewall.js`，并保持其样式在最后。只比较静态 mobile CSS 会漏掉实际优先级。
- 在完整酒馆插件工作区，另读 `skills/sillytavern-extension/references/tauritavern-host.md` 及其锁定快照；工作台独立分发时使用上面的固定提交链接。

## 主题与配套扩展

1. TT 的 1000px 移动断点与工作台默认 767px 不同。侧栏主题要处理 768–1000px 的宿主全宽导航，不让纵向按钮轨变成横跨屏幕的遮罩。更宽的移动 WebView 也可能有安全区和软键盘。
2. 调整顶部菜单高度时，让 `--topBarBlockSize` 与实际占位一致。保留宿主对 `#sheld`、抽屉和输入区的几何管理；不要追加更强的高度 `!important` 去压制 TT。打开折叠菜单后也要核对抽屉相对定位与全局坐标的区别。
3. 优先消费 `--tt-inset-*`，普通 ST 可回退到 `env(safe-area-inset-*, 0px)`。需要稳定高度时用 `--tt-base-viewport-height` 的回退值。不要覆写宿主这些变量，也不要同时给聊天容器减键盘高度、又保留宿主 IME spacer，造成双重避让。
4. 自有全屏面板可声明 `data-tt-mobile-surface="fullscreen-window"`；键盘变量作用于活动 surface，不保证在根节点变化。普通 ST 不应静态导入 TT 专属模块。宿主识别和必要动态行为放在配套扩展，移除时清理自己的标记、订阅与监听。
5. TT 消息可以虚拟化。样式只装饰 `.mes`，不改变 spacer、顺序或隐藏历史；需检查长消息离屏返回。纯主题不扫描 DOM 推断聊天数据，也不关闭虚拟化来掩盖问题。
6. `minimum_client_version` 比较的是兼容 ST 版本。先核实实际接口，再填写门槛；不要把 TT 版本填入，也不要仅为通过检查盲目降低。共用设置继续使用 context 与原生保存函数。

## 验证与交付

至少核对窄手机、767/768、1000/1001 两侧和桌面：菜单开合、抽屉滚动、输入区、长文与推理栏。TT 另查非零安全区、键盘显示/收起、输入焦点从聊天切到抽屉/配套面板，以及消息虚拟化。

浏览器加载固定 TT CSS 和宿主布局模块，可用于复现优先级、几何与表面变量；这不等于运行完整 TT WebView、原生键盘或 Rust 后端。没有实机时在发布说明标注这条边界。

主题 JSON、可读 CSS、工作台工程和配套扩展由同一最新工程生成，保留用户覆盖。新适配需要新版配套扩展时，明确告诉用户同时更新。主题指南的双宿主目标也不表示工作台的 ST 自动安装器、连接器和测试聊天写入流程已在 TT 验证；未经核验不得把 TT 当作 Node 服务端来启动或安装。
