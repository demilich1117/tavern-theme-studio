# 素材源、执行任务与可靠导出（0.8）

Source Hub、CLI 执行和导出都在工作台本机服务完成。工程改动仍经过会话、工程 ID、指纹和 revision 检查，能撤销；没有后台发布动作。

## Source Hub

在「装饰素材」中选择当前工程、本地库或展开 Source Hub。默认地址为 `http://127.0.0.1:19325/`，可配置另一 HTTPS 目录。目录读取 `catalog.json` 和 `hub.json`；按名称/标签搜索，按图集和版本过滤。归档条目不作为新替换候选，已锁定地址不变。

目录与图片分别缓存。未缓存图片不会假装可离线显示；按「缓存 / 预览」取得图片后验证类型、字节数与 SHA-256。浏览器通过工作台访问配置源，不接触 Hub token。缓存文件在数据目录 `hub-cache.json`，不保存令牌。加载失败保留旧目录并明确显示离线状态。

先选择顶部目标图层，再按「应用到所选图层」。按哈希批量替换需先验证固定公开地址、查看旧/新地址并勾选；名字相似不会自动替换。一次应用进入一个撤销记录。素材锁定清单包含仓库、图集、版本、内容哈希、固定提交 URL 和实际验证时间。

「已本地提交」不等于已推送或已部署；API 的 pushed/deployed 为 null 表示未核验。固定 Raw 地址成功下载并匹配哈希，只证明该地址可用，不宣称 Pages 部署完成。入库仅向已配置本机 Hub 的现有 API 传输字节和目录 revision；409 冲突需刷新后重新核对。没有 Git 提交、推送、Pages 部署接口。

## 定位与复制

标点评论后可以选择图层、受控容器及命名断点。服务从当前工程生成稳定定位记录，附图层几何、插槽、选择器、条件和快照。删除图层/插槽/断点，或改变目标条件时，旧票提示重新定位并禁用错误的定位按钮。仅参数变更时保留稳定身份，但提示对照快照。图层定位复用真实画面的编辑器；容器定位使用标准容器。

复制当前票或明确勾选的多票仍是默认交接方式。CLI 重新读取单票时包含 `locationStatus`。复制不会启动进程；结果回写为 review 后只能由用户验收。历史测试票不会自动处理。

## 可选本机 CLI

在小票面板展开「通用本机 CLI」，或使用 CLI 配置 JSON：

```json
{
  "program": "C:/Program Files/nodejs/node.exe",
  "cwd": "D:/your-project",
  "args": ["your-adapter.mjs"],
  "input": "stdin",
  "timeoutMs": 1800000,
  "heartbeatMs": 120000
}
```

执行配置仅写入本机 `runner.json`，不进入工程备份或原生主题。程序和工作目录须为绝对路径，参数是数组，禁用 shell。评论不会拼进命令。file 模式将输入写入 `tasks/<id>.input.json`，通过参数中的 `{input}` 传递路径。stdin 模式传一个 JSON 对象后关闭 stdin。

输入协议 v1 包含 task 的工程 ID、实际基线、工作台地址、选中小票和完整 handoff 文本，不含会话 token。适配器使用现有 CLI 领取/回写小票、修改源码；源码更新继续复用自动构建。stdout 使用逐行 JSON：

```json
{"type":"heartbeat"}
{"type":"progress","message":"正在检查指定小票"}
{"type":"result","result":{"summary":"改动摘要","baseline":{"projectId":"实际工程ID","revision":1,"fingerprint":"64位SHA256"},"checks":[],"unverified":["尚未做视觉验证"],"artifacts":[]}}
```

须以换行结束每条事件。成功状态同时要求退出码 0 和有效结构化结果；这仍不代表视觉验证通过或用户验收。stdout/stderr 摘要最多保留 16 KiB。心跳、超时或取消结束进程树；已修改的源码不回滚。单服务串行执行，重启将未结束任务标为 interrupted，不自动重跑；核对修改后显式重试，以最新小票/工程基线重新派发。

`tests/fixtures/runner-adapter.mjs` 是不调用模型、不修改源码的协议测试适配器。测试通过只证明进程协议，不能宣称某个商业/本地模型 CLI 已适配。真实用户数据服务默认未配置 CLI。

## 优化、归档和导出

列表不再自动解码每张大原图。可按需预览、生成 256px 缩略图或指定宽度创建等比 WebP 变体；不放大、不覆盖原图。GIF、APNG 和动画 WebP 保守拒绝静态转换。浏览器负责编码，服务器校验尺寸比例；透明边缘需先对照预览，再显式替换图层。变体关系记录于 `asset-variants.json`。

引用检查覆盖基础 CSS、变量覆盖、图层、部件规则、高级 CSS、assetRefs、撤销/重做和命名快照。只允许归档已确认未引用且不属于变体关系的素材；归档隐藏条目，文件保留，可从「已归档」恢复，不进行物理删除。

「导出主题」先显示依赖与预计字节。离线模式要求每个外部依赖都有锁定且匹配的本地字节；外链模式逐个重新下载校验 Hub 固定链接。未知字体/样式表、相对 URL、缺失图片等阻止严格导出，不能默默生成部分离线文件。最终主题仅含原生字段和 CSS；工程结构留在备份中。

```powershell
$env:STUDIO_URL = 'http://127.0.0.1:19323'
node scripts/cli.js hub-status
node scripts/cli.js hub-refresh
node scripts/cli.js hub-verify <素材ID>
node scripts/cli.js runner-status
node scripts/cli.js runner-config output/adapter.json
node scripts/cli.js runner-start <小票ID>
node scripts/cli.js runner-cancel <任务ID>
node scripts/cli.js runner-retry <任务ID>
node scripts/cli.js export-audit
node scripts/cli.js asset-references
node scripts/cli.js export-offline output/theme-offline.json
node scripts/cli.js export-external output/theme-external.json
node scripts/cli.js backup-files output/new-backup-directory
node scripts/cli.js restore-files output/new-backup-directory
```

分文件备份要求新目录，包含 `manifest.json` 和独立 `assets/`。逐张传输保持 32 MiB 上限，工程元数据保持 48 MiB 请求上限，整体备份可以超过 48 MiB。清单最后写入；没有清单的中断目录不视为完整备份。恢复在任何上传之前先核验全部文件，全部上传成功后才通过同一工程队列提交；失败不改变工程，已上传的不可变素材保留。恢复暂停源码自动应用，可撤销；核对后显式恢复自动同步。

当前分文件备份覆盖当前可编辑工程和本地素材，不包含其他快照、小票、执行配置、外部依赖或本机源码。完整历史仍备份数据目录和源码仓库；外部引用是否具备离线字节看导出审计。恢复前不直接覆盖运行中的 project.json。

## 新接口

GET `/api/hub`、`/api/hub/lock`；POST `/api/hub` 的 action 为 refresh/cache/verify/ingest。

工程命令 `hub-apply {id,layerId}`、`hub-replace {ids}`、`restore-files {project}`。

GET/POST `/api/runner`；POST 的 action 为 configure/start/cancel/retry。

GET `/api/export/audit`、`/api/export?mode=offline|external`、`/api/backup/manifest`、`/api/assets/references`、`/api/assets/variants`、`/api/assets/inspect?id=...`。POST `/api/assets/variant?original=...&kind=thumbnail|optimized` 上传二进制；POST `/api/assets/archive` 使用 `{ids,archived}`。

所有 POST 都需要本机会话 token；工程与配置修改同时检查最新基线，配置另检查 version。图片缓存/优化只增添素材，不替用户应用到工程。
