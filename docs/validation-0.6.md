# 0.6 装饰配方实施与验证

日期：2026-10-09（Asia/Shanghai）。工作台/连接器 0.6.0；真实宿主 SillyTavern 1.19.0 / 06bde939f，8000；工作台 19323。先确认虚构测试状态，再操作或截图。Source Hub 未修改，未推送。

自动检查：`npm test` 36 项通过；`npm run check` 与连接器打包通过。新增覆盖默认配方原 CSS 等价、同配方刷新保留参数、插槽冲突、显隐/锁定/移除/撤销、无效与原型范围拒绝、九切片、实际十二素材候选和携图备份重新提取后 CSS 一致。沙箱临时目录 realpath/原子 rename 限制导致的环境失败，在获准本地环境重跑全部通过。

真实检查：

- 十二个中文用途均实际搜索、选中、通过 UI 换图并恢复，桌面 1440px、幼龙变体 900px。背景/九切片用宿主计算样式确认；滚动条检查生成 CSS，未宣称滚动条绘制视觉已验收。
- 银龙偏移 -16px、缩放 1.1、隐藏/显示、锁定/解锁与恢复当前参数通过。[图层窗口](../output/playwright/phase3-layers.png)。
- 复制产生第十三图层并报告同一插槽冲突；移除、撤销、重做通过。新增 body::before 报告原主题占用；撤销后完整工程逐字等于测试前。证据：[副本冲突](../output/playwright/phase3-duplicate-conflict.png)、[源码冲突](../output/playwright/phase3-source-conflict.png)。
- 临时模拟宿主其他规则占用银龙伪元素，提示并阻止参数覆盖，保留原内容；移除测试样式并还原参数。[宿主占用](../output/playwright/phase3-host-conflict.png)。
- 390×852px 图层对话框没有横向溢出；恢复 1440×900px。[手机窗口](../output/playwright/phase3-mobile.png)。
- 关闭工作台后，临时将导出 CSS 应用在宿主原样式节点，银龙 x=-22px、opacity=.45、内嵌图片仍生效；随后恢复该节点原文与 disabled 状态并清理工程临时参数。这是 CSS 独立性验证，未调用原生主题 JSON 导入器或持久化用户设置。[脱离工作台](../output/playwright/phase3-native-without-workbench.png)。

恢复点：阶段 1–2 本地提交 `5c5188b`；阶段 3 前命名快照 `703cd097e0cc46fb1fe08128b325c4e2`；原恢复副本继续保留。十二默认图层未改参数时原生 CSS 等于冻结 2.2.4；发行包与安装连接器哈希核对见 [最终报告](../output/playwright/phase3-final-report.json)。

未完成/未验证：真实拖动与几何、完整自定义断点 UI、Source Hub、图层小票关联、CLI 启动器、优化/分文件备份、完整原生 JSON 导入与最终场景回归。首次点击诊断检查到早期一次没有 DOM 点击事件；更新安装后实际生命周期流程通过，未把此现象解释为已证明的业务逻辑错误。复杂嵌套 CSS、实体触摸、真实流式、群聊及第三方组件另验。
