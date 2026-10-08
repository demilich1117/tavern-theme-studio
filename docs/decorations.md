# 装饰配方与图层（0.6）

配方声明可编辑关系，不自动猜测任意 CSS。工程 v3 的 `recipe` 可为空；无配方时原有 CSS 和编辑保持。月弧浮页的 `studio.recipe.json` 声明十二张素材的中文用途、插槽、素材变量、实际 1000px 条件与边框用法；源码候选的 `build.json` 可携带 `recipe`，同配方身份刷新保留图层与已移除插槽。

在「装饰图层」搜索中文用途，选择图层，再换图或修改参数。所有尺寸与命名断点分别编辑；锁定禁止修改，解锁后可操作。复制会产生新 ID 并提示插槽冲突，需要选择空闲插槽。移除源码装饰保留隐藏插槽声明，后续自动构建不会重加它。每项操作可撤销。0.7 已提供 [真实画面定位与拖动](layouts-and-geometry.md)。

配方 `schemaVersion:1` 含 `id/name/version/slots/variables/hiddenSlots`。插槽字段包括 `id/name/group/selector/pseudo/method/sourceOwned/assetVariable/assetContext/geometry/position/condition/aspectRatio/exclude/note`；`method` 为 background 或 nine-slice，条件目前支持单一 min/max-width。已有源码插槽必须声明唯一素材变量及实际规则使用。原生控件直接边框与滚动条只允许声明的换图，禁止变换整个控件。

图层含 `id/slotId/name/asset/visible/locked/preserveRatio/props/overrides`。`asset:null` 沿用源码变量。参数支持 x/y、scale、rotation、opacity、order、width/height、容器与图片 anchor、背景 fit 或九切片 slice/edgeWidth。锚点各轴 0–1；尺寸支持正数 px/%/vw/vh。默认图层没有覆盖 CSS，沿用原主题；修改后编译为 CSS 伪元素，原生导出不包含配方或工程元数据。

命令均使用现有完整写入基线：

```json
{"type":"decoration-update","id":"layer-silver-dragon","scope":"base","patch":{"props":{"x":-16,"scale":1.1}}}
```

`patch.props` 替换该尺寸的参数对象；部分修改应先读取最新对象再合并。命令还支持 `recipe`（明确替换，可撤销）、`decoration-add`（标准 target、pseudo、method）、`decoration-duplicate` 和 `decoration-remove`。CLI 可通过 `command <json文件>` 使用。

冲突包括插槽重复、源码变量失去唯一绑定、源码已占用新伪元素、绘制参数不匹配与真实宿主异物。错误阻止对应覆盖并保留源效果；高级 CSS 同插槽显示提示。复杂嵌套 CSS/重叠但不同媒体条件不是完整通用解析器覆盖范围，须对照宿主诊断。宿主不可见目标提示展开控件；不把不可见假称删除。

内嵌导出与工程备份转换图层素材、资产引用及 CSS 引用。换图后的导出可脱离工作台使用；完整原生 JSON 导入回归留在阶段 8，当前已验证关闭工作台后将导出 CSS 应用于真实宿主。
