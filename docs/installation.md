# 酒馆主题工作台 · 核心安装包

本地可视化美化工具。需要 **Node.js 22+** 与 SillyTavern。运行依赖已经随包提供；不需要先生成大型主题样本，也不需要配置模型 CLI 或 Source Hub。

1. 将本包解压到独立目录，打开终端，运行 `npm run lab`。
2. 解压 `dist/tavern-theme-studio-connector.zip`，将其中整个文件夹放到酒馆 `data/<用户名>/extensions/`；安装后直接包含 manifest.json、connector/、shared/。刷新酒馆。
3. 打开终端打印的 `#tts-lab` 链接。默认酒馆地址 8000、工作台 19323；等工作台明确显示「当前为虚构测试对话」后开始制作。
4. 选部件、改属性、换素材或标点评论，观察真实酒馆预览。小票可简明或完整复制到已打开项目的 Agent 对话，由 Agent 领取、修改并提交待验收，再由你验收。
5. 导出主题 JSON，在酒馆原生 UI Theme 中导入并选择，才完成持久化应用。

已有工程保存在 `.local/native-lab/`，重启和升级保留。`npm start` 是普通工作台（19321，数据 `.local/`）。首次可用 `npm run lab -- examples/starter.theme.json` 选择通用起点；不要把已有工程作为新的种子反复导入。

连接问题先用 `npm run doctor`。真实连接器版本与 fixture 状态在侧栏「连接诊断 → 检查连接与版本」。`STUDIO_PORT`、`STUDIO_DATA_DIR`、`TAVERN_URL` 分别设置端口、数据目录与酒馆地址。同一数据目录只允许一个实例。

代码使用 [MIT](LICENSE)，运行依赖与素材范围见 [第三方声明](THIRD-PARTY-NOTICES.md)。本核心包不包含大型月誓主题示例或维护测试；package.json 中开发/样本打包命令须在完整源码仓库中运行。

- [真实酒馆与测试对话](docs/native-lab.md)
- [小票交接](docs/annotations-assets.md)
- [CLI 与 HTTP](docs/api.md)
- [资源与可选 CLI 适配](docs/resources-and-runner.md)
- [图层](docs/decorations.md) / [布局与断点](docs/layouts-and-geometry.md)
- [备份、升级与恢复](docs/release.md)

当前实测宿主为 SillyTavern 1.19.0。实体手机、群聊、真实流式与各厂商 CLI 仅在实际验证后记录为可用；复制交接始终独立于自动启动适配器。
