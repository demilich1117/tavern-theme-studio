# 月誓 · 阅读细节 1.0.0

配合月誓 2.2.2 及后续兼容主题：从推理块的小铅笔进入编辑时，光标和编辑框滚动位置回到开头，推理工具栏保持可见。酒馆 1.19.0 原生代码会主动把光标放在文末；纯 CSS 主题不能改变光标。

只响应本主题下对 `.mes_reasoning_edit` 的点击，不改聊天内容、不保存消息、不调用模型、不改酒馆核心、不处理普通正文编辑的原生光标策略。重复启用会清理旧监听；停用即恢复原生行为。

把此目录复制为酒馆当前用户的 `data/<用户>/extensions/moonveil-reading-companion/`，或开发安装目录 `public/scripts/extensions/third-party/moonveil-reading-companion/`，保存正在编辑的内容后刷新酒馆即可。工具栏位置修复和全部装饰在主题 JSON 内，独立于此配套扩展。
