# 源码构建与工程同步（0.5）

在真实酒馆测试面板打开「源码同步」，选择月弧浮页配方、保存绑定，再启用「保存源码自动同步」。绑定也可使用任意本机程序与参数数组；不使用 shell，不从小票评论拼命令。程序配置只保存在当前数据目录的 `source-bindings.json`，不进入可分享工程。

```powershell
Set-Location 'D:\RUA\sillytavern-plugins\tavern-theme-studio'
$studioRuntime = Get-Content -LiteralPath '.local/native-lab/runtime.json' -Raw | ConvertFrom-Json
$env:STUDIO_URL = $studioRuntime.address
node scripts/cli.js status
node scripts/cli.js build-presets
node scripts/cli.js build-preset 0
node scripts/cli.js build-now
node scripts/cli.js build-auto on
node scripts/cli.js build-status
# 需要停止时：build-auto off；取消当前任务：build-cancel
```

配方序号以实际列表为准。`build-bind <local-config.json>` 可提供自定义本机配置：`root`、`program`、`args` 数组、`watch` 相对路径数组、`mode`、可选 `debounceMs` 和 `timeoutMs`。`program: "$NODE"` 在 CLI 侧解析为当前 node.exe。Windows `.cmd` / `.bat` 不能直接作为程序；使用真正的可执行程序和独立参数。参数中的 `{output}` / `{mode}` 和环境变量 `STUDIO_BUILD_OUTPUT` / `STUDIO_ASSET_MODE` 告诉构建器候选输出位置与素材模式。

月弧浮页的 `studio.build.json`、`theme.css`、`theme-fields.json`、`assets.manifest.json` 和 `assets/production/` 是维护入口。素材清单记录固定提交和哈希。两种发行模式共享构建核心 `scripts/folio-build.mjs`；已有冻结发行包内的独立构建器保持原样。新版可维护外链入口生成候选文件，不包含冻结构建器的 `--verify-urls` 功能；公开链接验收仍需单独完成。

## 候选输出协议

构建程序成功后，输出目录必须有 UTF-8 `build.json`：

```json
{
  "schemaVersion": 1,
  "themeFile": "theme.json",
  "assets": [
    {"file":"assets/example.png","id":"图片SHA256.png","sha256":"图片SHA256","bytes":123}
  ],
  "assetRefs": []
}
```

上面哈希和字节仅为占位示例。`theme.json` 是包含原生字段与 CSS 的薄主题，使用 `tts-asset://<sha256>.<ext>` 或固定外链。独立文件逐张核对签名、哈希、字节和真实路径边界，再进入素材库；同步 JSON 不携带 base64 图片。即使选择 embedded，内部同步仍使用独立文件，原生内嵌交付候选另存为 `moonveil.theme.json`。CSS 检查覆盖字符串、注释和括号结构、未解析素材标记；它不是完整 CSS 语义解析器。

短时间保存合并，单个工程只运行一个构建。源码指纹与任务代际在产物验证和提交前再次核对；旧任务不能覆盖新保存。输出、`.git`、`.local`、`dist`、`output`、依赖、缓存、历史和日志不参与监听。编译失败、缺图、变量映射冲突保留最后成功的工程和真实预览，并显示具体原因。

提交通过当前命令队列合并最新变量、属性、高级 CSS 和素材引用。变量按声明上下文唯一匹配；源码删改导致无法确定时暂停该次提交，不猜测。源码刷新会更新基础主题，不主动替换工程 ID 或工作台名称。

## 暂停、恢复和服务重启

恢复快照或撤销基础 CSS 变更会暂停自动应用。源码文件保持用户当前版本；点击「立即构建」或重新开启自动同步才能继续。取消也保留源码与候选文件。重启保留绑定、开关、最近成功记录，中断任务标为 interrupted；浏览器重连读取最新工程和写入会话。不能复用旧 PID、token 或写入基线。

候选位于 `.local/native-lab/builds/<projectId>/`。项目 v1/v2 迁移前的原始文件位于相同数据目录的 `migrations/`，路径由 `/api/project` 的 `migrationRecovery` 返回。完整恢复应先停止服务，恢复对应工程、快照、小票和素材目录后再启动；不要在运行中直接覆盖 `project.json`。仅恢复工程预览时优先使用快照/API。
