# 文件夹与常用入口

日常使用只需根目录的五个脚本：

| 文件 | 用途 |
| --- | --- |
| `start.cmd` | 安装 / 打开工作台 |
| `manage.cmd` | 查看后台、按实例关闭 |
| `stop.cmd` | 关闭全部可管理的工作台后台 |
| `update.cmd` | 更新程序和连接器，再启动 |
| `uninstall.cmd` | 卸载当前安装，保留作品、备份和本地改动 |

其余内容按职责归类，通常无需手动打开或整理：

| 目录 / 文件 | 内容 |
| --- | --- |
| `src/` | 工作台服务、保存、构建、安装、更新及后台管理模块 |
| `public/` | 工作台网页与样式 |
| `shared/` | 工作台与连接器共用的工程格式和逻辑 |
| `connector/` | 酒馆连接器源码 |
| `scripts/` | 常用入口调用的脚本及开发命令 |
| `docs/` | 使用指南、兼容与验收记录；历史文档在 `docs/archives/` |
| `skills/` | 随工作台提供的 Agent 共创指南 |
| `tests/`、`.github/` | 开发测试与自动检查，核心安装包不含这些目录 |
| `examples/` | 示例主题源码；核心包仅带轻量起始主题 |
| `dist/` | 已打包的连接器等可分发文件 |
| `output/` | 开发时生成的候选包、截图与检查报告，不随核心包分发 |
| `.local/` | 本机配置、后台记录、便携 Node、备份及旧默认工程，**不要当缓存整目录删除** |
| `.playwright-cli/` | 浏览器验收的开发记录，不随核心包分发 |
| `node_modules/` | 程序运行依赖；核心包已包含 |
| `.git/`、`.gitignore` | 源码仓库的版本记录和忽略规则 |
| `package.json`、`package-lock.json` | 版本、运行命令和依赖锁定 |
| `server.js` | 保留原有 `node server.js` 和 `import { createServer }` 用法的入口，实际实现位于 `src/server.js` |
| `README.md`、`AGENTS.md`、许可证 | 用户入口、Agent 约定及许可说明 |

已整理的作品放在程序目录之外，通过 `.local/workspace-location.json` 找回；本次代码归类不会迁移作品、素材或位置记录。升级核心包时，更新器按新旧文件清单迁移程序；手工覆盖旧包可能留下旧模块，建议使用 `update.cmd`，或解压到新目录并按[作品目录指南](work-folders.md)恢复位置。

源码维护者在 `src/` 添加服务模块，相对程序根目录的路径统一以 `src/work-location.js` 导出的 `studioRoot` 为准。移动文件后运行 `npm run release:check`，同时检查源码启动和解压安装包；不要用创建一套新的 `.local/` 掩盖根目录解析错误。
