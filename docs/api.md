# API、CLI 与 Agent 工作流

默认地址 `http://127.0.0.1:19321`。所有编辑均进入同一命令核心，界面通过 SSE 收到变化。CLI 已可直接用于 agent harness，无需模拟点击。

真实宿主测试优先使用 [原生测试工作台](native-lab.md)。`npm run lab` 使用独立工程目录和默认 19323 端口；CLI 需要显式设置 `STUDIO_URL=http://127.0.0.1:19323`，否则它仍连接普通工作台。测试聊天由宿主连接器自己的按钮创建／打开，不通过 HTTP API 接收任意聊天正文。

## CLI

```powershell
node scripts/cli.js status
node scripts/cli.js targets
node scripts/cli.js variables
node scripts/cli.js variable binding-示意ID '24px'
node scripts/cli.js variable-reset binding-示意ID
node scripts/cli.js snapshots
node scripts/cli.js snapshot-save '排版完成'
node scripts/cli.js snapshot-diff <快照编号>
node scripts/cli.js snapshot-restore <快照编号>
node scripts/cli.js set assistant background-color '#344149'
node scripts/cli.js set assistant padding 24px
node scripts/cli.js set assistant padding 12px mobile
node scripts/cli.js unset assistant padding mobile
node scripts/cli.js rename '山间夜话'
node scripts/cli.js undo
node scripts/cli.js redo
node scripts/cli.js export output/theme.json
node scripts/cli.js backup output/design.studio.json
node scripts/cli.js import output/design.studio.json
node scripts/cli.js command output/command.json
```

输出目录需先存在。默认读取 `.local/runtime.json` 中的本地服务地址，也可通过 `STUDIO_URL` 指定。

变量编号必须使用 `variables` 返回的 `id`，不要照抄示意 ID。v3 的 `binding-*` 按变量名与声明上下文绑定，插入注释和图片长度变化不改身份；同名变量依据 `context` 和 `line` 选取。`ambiguous` 表示相同上下文重复声明，源码刷新不能猜测匹配。`legacyId` 仅用于原 CSS 的迁移，不能跨基础主题复用。`value` 是原始声明，`current` 是编辑后的值。

源码构建命令：`build-status`、`build-presets`、`build-preset <index|name>`、`build-bind <local-config.json>`、`build-now`、`build-auto on|off`、`build-cancel`。输出协议与本机配置见 [源码同步](source-build.md)。完整交接使用 `ticket-copy <id>`；结果可用 `ticket-review <id> <owner> <result.json>`，详见 [小票说明](annotations-assets.md)。

## HTTP

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/session` | 获取工程、sessionId、projectId、fingerprint、revision、能力与临时写入 token |
| `GET /api/project` | 读取工程与撤销/重做状态 |
| `GET /api/theme` | 导出主题，本地素材内嵌，外链保留 |
| `GET /api/backup` | 可移植工程备份，内嵌本地素材并重映射变量编号 |
| `GET /api/assets` | 素材清单 |
| `POST /api/assets?name=<文件名>` | 原始图片二进制上传，32 MiB 上限，需 token |
| `POST /api/assets/link` | `{url,name?}` 添加外链引用，不抓取 URL |
| `GET /assets/<id>` | 仅此只读路径允许跨域与不可变缓存 |
| `GET /api/tickets` / `GET /api/tickets/<id>` | 小票队列 / 单票 |
| `POST /api/tickets` | `{...basis,comment,anchor,scope}` 保存小票和工程快照 |
| `POST /api/tickets/<id>` | `{...basis,action,version,owner?,result?}` 领取、提交、验收、重开 |
| `GET /api/handoff-context` | 公开交接上下文；含路径和当前基线，不含 token |
| `GET /api/build` / `GET /api/build/presets` | 本机源码绑定与构建状态 / 可用配方 |
| `POST /api/build/configure` | `{...basis,bindingVersion,config,autoSync}` 保存本机绑定 |
| `POST /api/build/control` | `{...basis,bindingVersion,action,enabled?}`，action 为 build/auto/cancel |
| `GET /api/variables` | 读取变量、原位置、上下文与当前值 |
| `GET /api/snapshots` | 列出命名快照，不含工程正文 |
| `GET /api/snapshots/<id>` | 读取快照工程与到当前工程的 `changes` |
| `GET /api/events` | 默认事件为工程快照；tickets / assets 通知重新读取，build 推送构建状态 |
| `POST /api/commands` | 带版本号执行命令并保存 |

写入需要 `Content-Type: application/json` 和 `X-Studio-Token`（图片上传直接发送二进制）。浏览器同源请求可获取 token，外站 API 请求、非允许 Host 和无 token 写入会被拒绝。仅本机监听；这不是供公网部署的账户系统。CLI 不打印 token。

素材命令 `optimize-assets` 提取当前工程内嵌图片；导入也自动提取。小票 action 包含 `claim`（需 owner）、`review`（需相同 owner 与文本或结构化 result）、`accept`、`reopen`，均需小票自身的 version 和当前工程基线。不同工程 ID 不能领取或提交。具体流程与 CLI 见 [标注与素材](annotations-assets.md)。

工程、构建和小票 JSON 写入均需 `basis = {sessionId, projectId, fingerprint, revision}`，从刚读取的 `/api/session` 取得。旧客户端缺字段返回 428；工程变化或重启后基线失效返回 409。图片二进制上传只检查本机 token，不修改工程。构建配置还需 `/api/build` 的 version 作为 bindingVersion。

请求体示例（示意字符串必须替换成当前服务实际返回值）：

```json
{
  "sessionId": "当前运行会话ID",
  "projectId": "当前稳定工程ID",
  "fingerprint": "当前工程SHA256",
  "revision": 3,
  "command": {
    "type": "set",
    "target": "assistant",
    "property": "padding",
    "value": "24px",
    "scope": "base"
  }
}
```

命令支持 `set`（`value: null` 删除覆盖）、`reset-target`、`rename`、`custom-css`、`base-theme`、`import-theme`、`import-project`、`undo`、`redo`。精确参数以 `shared/core.js` 为准，部件/字段可用 CLI `targets` 查询。

0.2 新命令：

```json
{"type":"variable","id":"var-123","value":"calc(100% - 24px)"}
{"type":"variable","id":"var-123","value":null}
{"type":"snapshot-save","name":"排版完成"}
{"type":"snapshot-restore","id":"服务端返回的32位编号"}
```

保存快照同样检查 revision，但不修改工程、不推进 revision，响应额外含 `snapshotCreated`。恢复快照进入正常修改历史，可撤销。快照为独立文件，不随导入主题删除。命名版本差异含稳定 `path` 和可读 `label`；大段 CSS 只摘要其变化，原文可在返回的快照工程中取得。

工程格式为 `schemaVersion: 3`：稳定 `projectId`、`variableEdits` / `variableBindings`、`bindingConflicts`、`breakpoints`、`decorations` 和 `assetRefs`。v1/v2 自动迁移，首次升级磁盘数据前备份原始工程、快照与小票，校验失败不替换原文件。旧票只能依据其快照和原指纹归属；无法证明是当前工程时标为需核对，绝不按同名合并。当前装饰字段作为后续阶段基础，尚无图层编辑与编译能力。

`baseTheme.custom_css` 保持原文，编译顺序为基础主题及变量修改、部件规则和断点覆盖、高级 CSS。手动 `base-theme` 重新读取会清空变量覆盖；自动 `source-refresh` 按稳定绑定合并最新界面修改。工程备份不包含本机源码路径/程序配置。恢复快照与撤销基础 CSS 会暂停自动应用，继续同步须明确调用 build-now 或 build-auto on。

成功返回 `{project, revision, canUndo, canRedo}`。过期 revision 返回 HTTP 409，调用者应重新读取并判断是否仍应应用该操作，不要无条件反复重试。校验失败、保存失败不会推进内存工程和历史。

## 接入 Agent harness

建议工具映射：`inspect_project` → `status`，`list_targets` → `targets`，`set_style` → `set`，`undo_change` → `undo`，`export_theme` → `export`。工具返回命令结果，避免让 Agent 直接写 `.local/project.json` 或酒馆设置。

一个可操作流程：读取工程、变量与部件 → 保存命名快照 → 修改变量或部件 → 在真实酒馆中观察与诊断 → 运行场景检查 → 对比快照 → 用户微调 → 导出主题。当前 HTTP API 返回工程与快照状态，不包含截图、聊天正文或实时 DOM；浏览器诊断和场景检查由界面向连接器请求，报告可从界面导出。Agent 需要另用经授权的浏览器工具获取视觉反馈。工作台未接入任何远程模型，也不发送聊天数据。
