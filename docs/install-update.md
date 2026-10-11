# 一键安装与更新（0.11）

Windows 日常只用两个入口：

| 要做什么 | 操作 |
| --- | --- |
| 首次安装 / 日常打开 | 双击 `start.cmd` |
| 更新并重新打开 | 双击 `update.cmd` |

先启动酒馆。工作台首次启动会让你选择 **SillyTavern 文件夹**（包含 `server.js`）；只有多用户酒馆才需要再选用户。随后自动安装连接器并打开专用测试页。位置会记住，不需要手工复制文件、填写端口或每次重新连接。

没有合适的 Node.js 时，启动器从 [Node.js 官方下载站](https://nodejs.org/dist/latest-v22.x/) 获取 Windows x64 / ARM64 的 Node 22 便携版，并使用官方 SHA-256 清单核验。运行环境只放在本工具 `.local/runtime/`，不要求管理员权限，也不修改系统 Node 或系统 PATH。已有 Node 22+ 时优先复用；首次缺少依赖时自动准备。下载失败时显示原因，解决网络问题后重新双击即可。

默认读取酒馆 `config.yaml` 中的 `dataRoot` 和 `port`；不读取聊天、密钥或用户设置内容。特殊启动参数、反向代理或远程酒馆需使用下方手动选项。本地一键入口不会安装或启动 SillyTavern 本体。

## 更新时会发生什么

核心安装包通过 [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) 查询正式版本，下载核心 ZIP 和校验文件，核对总哈希、文件清单和每个文件后才替换。只采用更高版本；尚未发布的新源码不会被当成正式包，也不会降级。

通过 `start.cmd` 启动的工作台会先保存并关闭，再更新、同步连接器并重新打开测试页。下载期间原服务可继续使用。旧版或手动 `npm start` 启动的服务需要先关闭其窗口一次，不会按进程名强制结束 Node。

更新只处理程序清单中的文件；作品目录、`.local/`、自定义数据目录和其他扩展保留。旧程序文件保存在 `.local/updates/`，旧连接器文件保存在 `.local/connector-backups/`。写入失败会恢复已备份的文件；中断的安装在下次启动时检查恢复。如果中断后文件又被手工修改，会保留现场并显示备份位置，不覆盖新修改。

Git 克隆的源码目录使用 `origin/master` 快进更新并重新准备依赖，不覆盖为核心安装包。存在已跟踪的本地改动、开发分支或自定义远端时停止自动更新；未跟踪文件不会被清理。没有 `.git` 的源码压缩包可一键启动，但不能原地自动更新；后续使用正式核心包或 Git 克隆。

## 从旧版首次迁入

1. 关闭原工作台窗口。
2. 备份并保留原工具 `.local/`、完整作品目录和自定义数据目录，将新版程序放回原工具目录。
3. 双击 `start.cmd`，选择酒馆目录。以后用 `update.cmd` 更新。

换到不同工具目录时，作品位置的恢复方法见 [固定作品目录](work-folders.md)。普通更新不要求迁移作品，也不要求先导出再导入。

## 特殊位置与命令行

macOS / Linux 需要自行准备 Node.js 22+。源码先运行 `npm ci --omit=dev`，核心包已有依赖，然后运行 `npm run setup`，按提示输入酒馆路径。也可明确指定：

```powershell
node scripts/launcher.js --tavern "D:\path\SillyTavern" --profile default-user
```

常用选项：`--data-root <实际数据目录>`、`--url <实际酒馆地址>`、`--no-browser`、`--setup-only`。需要重选位置时使用 `--configure --tavern <新目录>`；修改位置前先关闭运行中的工作台。环境变量 `STUDIO_TAVERN_DIR`、`STUDIO_TAVERN_DATA_DIR`、`TAVERN_URL` 也可指定。工作台仍遵循原来的 `STUDIO_DATA_DIR` / `STUDIO_PORT`，不会改掉已有作品位置。

手动更新可运行 `node scripts/update.js`，再准备源码依赖并 `npm run setup`；Windows 的 `update.cmd` 已串好这些步骤。首次安装或升级失败无需重装酒馆，按启动窗口的具体提示处理即可。
