# 构建与验证入口

源项目入口：`examples/moonveil-crescent-folio/theme.css` 和 `preview.template.html`；推理编辑焦点行为位于 `companion/index.js`。

项目内构建：

```text
node scripts/build-moonveil-crescent.js
node scripts/package-moonveil-crescent.js
node scripts/verify-folio-release.js
```

生产图片已经编码，日常布局调整无需重新生成。基础装饰的裁切脚本为 `prepare-folio-art.cjs`；2.2.2 睡龙和书签使用 `prepare-sleeping-dragon-art.cjs`，均需提供 Sharp 路径。每次重新生成插画保留 ImageGen 原始提示词与 PNG。焦点扩展修改后须在真实酒馆验证启用、停用和非本主题状态。

独立本机演示：`node scripts/start-folio-preview.js`，仅绑定回环端口 19322。真实酒馆使用已安装的工作台连接器。`stage-folio-live-preview.js` 仅为旧连接器容量限制生成私有的本机素材预览工程，不是发行入口。

发行包也可独立维护：编辑 `source/theme.template.css` 后执行 `node source/build.mjs`。该脚本仅使用 Node 内置模块。

验证分层：构建检查所有图片内嵌、占位符清除、颜色原生 RGBA 与工作台往返；独立演示检查可控状态；真实宿主检查原生结构、控件和第三方浮层。禁止通过真实发送或模型调用验证主题。

临时预览结束恢复宿主外观、宽度、草稿、滚动位置与连接器地址。用户真实聊天截图不得放入发行目录；最终视觉记录见 `validation/design-qa.md`。
