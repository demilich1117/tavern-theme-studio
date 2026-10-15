# 核心发行包与发布检查

源代码使用 MIT；见 LICENSE 和 THIRD-PARTY-NOTICES.md。核心 ZIP 不包含大体积主题样本、用户数据或未确认再分发范围的素材。

源码在 [demilich1117/tavern-theme-studio](https://github.com/demilich1117/tavern-theme-studio)，安装包在 [GitHub Releases](https://github.com/demilich1117/tavern-theme-studio/releases)。普通用户下载 `tavern-theme-studio-<version>-core.zip`；同名 `.sha256` 用于校验。GitHub 自动生成的 Source code 压缩包需要自行安装依赖，不能替代核心包。

源码维护者运行 `npm ci`，再运行 `npm run release:check`。它检查语法和版本、执行测试、打包连接器和核心 ZIP、在全新临时目录验证启动 / 命令 / 离线导出 / 重启及连接器依赖完整性。只生成本地候选文件，不上传、不推送、不创建 Release。

候选位于 `output/releases/tavern-theme-studio-<version>-core.zip`，有同名 `.sha256`；包内 `package-manifest.json` 列出每个文件的哈希。包中包含固定版本运行依赖及其原许可证。Windows 用户解压后双击 `start.cmd`，缺少 Node 时会自动准备；其他平台准备 Node.js 22+ 后使用 `npm run setup`。无需下载素材样本或配置 Source Hub / 模型 CLI。

完整仓库用于开发、运行测试及制作大型主题样本。核心包用于运行工作台；其中不提供开发测试和大型样本构建脚本所需的素材。大型示例按独立发行物管理，不能把整个仓库 ZIP 当作日常安装包。

## 数据与恢复

Windows 安装与更新入口分别是 `start.cmd` 和 `update.cmd`。安装包更新只采用已发布且高于当前版本的正式核心包，校验后备份程序文件，保留 `.local/` 与作品目录；源码目录走 Git 快进更新。连接器同步和受启动器管理的服务重启自动完成。首次从旧版迁入、失败恢复和特殊位置见 [一键安装与更新](install-update.md)。

升级到 0.14.0 时，工作台与酒馆中的连接器需要同步更新。停止工作台、备份并保留下述数据后更新程序；源码安装重新安装依赖并打包连接器，核心包使用包内连接器。将连接器文件更新到酒馆原安装目录，再启动工作台并刷新专用测试标签。只更新程序会触发连接器升级提示。交互变化见 [直接编辑指南](direct-editing.md) 和 [画布指南](canvas-mode.md)，本地验证见 [0.14 验证记录](validation-0.14.md)。未保存蓝图只在标签内存中，刷新前先保存小票。

已整理的作品使用独立目录里的 `workspace/` 自动保存，升级时保留整个作品目录和工具的 `.local/workspace-location.json` 位置记录。位置记录丢失可用 `node scripts/migrate-work.js select <作品目录>` 重新选择，详见 [固定作品目录](work-folders.md)。下面的旧默认路径适用于未迁移的工程。

更新前保存分文件工程备份，停止工作台后保留整个实际数据目录（默认 `.local/native-lab/`，高级独立模式 `.local/`）。更新程序文件时不要覆盖数据。首次种子文件只在目录没有工程时读取，旧种子文件丢失不影响已有工程重新启动。

0.8.1 在迁移前取得 `.studio-lock/owner.json`，同一目录只能有一个服务写入。进程正常关闭后释放锁；进程确实已退出时可自动回收旧锁。PID 仍存在、锁损坏或回收中断时拒绝启动，避免误判 PID 复用。异常恢复须先对照 runtime.json、锁 owner.json 和系统进程确认所有相关服务均已停止；备份后将 `.studio-lock` 改名保留，再启动。不要在服务运行中删锁。

恢复旧版程序时仍保留实际数据与不可变素材。0.8.1 没有升级工程 schema（仍 v3），领取/提交快照和验收信息是小票的附加字段。旧版不会提供数据目录独占与新的验收保护；同一数据目录仍只能运行一个实例。

## 已自动化与待验证

`.github/workflows/ci.yml` 配置 Windows / Linux、Node 22 / 24 的相同发布检查。配置存在不代表远端已通过；具体提交结果见 [GitHub Actions](https://github.com/demilich1117/tavern-theme-studio/actions/workflows/ci.yml)，本地证据见对应 validation 文档。发布时先让候选提交通过检查，再创建对应版本的 Release 并上传核心 ZIP 和校验文件。

真实酒馆的虚构 fixture、原生编辑/取消与候选 JSON 导入仍需人工或真实浏览器验证。实体手机、群聊、真实流式、第三方扩展及厂商 CLI 没有实测时必须保留未验证标记。
