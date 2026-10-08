# 0.5 第一批实施与验证

日期：2026-10-08 至 2026-10-09（Asia/Shanghai）。工作台/连接器 0.5.0，工程 v3；真实宿主 SillyTavern 1.19.0 / `06bde939f`，地址 8000，测试工作台 19323。仅使用连接器的虚构测试聊天，不发送消息或调用模型。

## 恢复与保留

- 实施前本地 Git 基线：`3979cfa`。仓库原先无提交；明确选择源码和已有作品文件提交，未推送。
- 原文件与测试数据完整副本：`output/recovery/2026-10-08-workbench-before/`，包括 685 个文件、原始 `.local`、素材和两套 2.2.4 发行目录；`baseline-manifest.json` 记录 SHA-256。原已安装连接器另保存在该目录的 `installed-connector/`。
- v3 首次迁移另保存原始文件到 `.local/native-lab/migrations/1791469390604-b7aeacba-6f97-4774-8061-3366987ff983/`。不删除旧票、快照或素材。
- 两套 2.2.4 发行目录的 70 个文件逐项哈希与基线一致；连接器包的 17 个文件与真实宿主安装逐项一致。见 [状态报告](../output/playwright/checkpoint-report.json)。Source Hub 未修改，未推送或公开发布。

## 自动检查

`npm test`：33 项通过，无跳过。使用 `tests/*.test.js` 避免把忽略目录中的恢复副本重复当作测试。覆盖稳定变量、无损迁移、失败原文保留、同名不同工程、跨重启旧写入、磁盘失败不推进历史、构建合并/迟到/失败/取消/快照暂停、真实 12 素材候选协议、剪贴板文本脱敏、结构化结果与单票领取竞争。

`npm run check`：JavaScript / MJS 语法和 manifest 版本通过。`npm run package:connector`：生成 0.5.0 ZIP 与目录；安装后只刷新专用测试标签。原生导出编译不含工程 ID、会话或执行路径。

## 真实宿主

- 每次读取聊天或截图前，先等待并检查工作台 `#fixture-status` 为「当前为虚构测试对话」。使用独立 Playwright CLI 标签，用户其他酒馆标签保持原样。
- v2 → v3 前后原生主题导出逐字一致，预览仍显示原样。证据：[迁移后的宿主](../output/playwright/phase1-v3.png)。稳定变量另用插入注释、图片值长度变化和重复声明测试，不靠截图判断绑定。
- 在工作台把角色消息留白临时设为 23px。维护源码连续保存后，真实根样式出现 `--tts-source-proof: 314`，消息实际 paddingTop 仍为 23px。源码位置变化没有丢失界面覆盖。证据：[同步面板](../output/playwright/phase2-source-and-ui.png)、[完整宿主](../output/playwright/phase2-host.png)、[报告](../output/playwright/native-stage2-report.json)。
- 注入未闭合 CSS，构建指出第 280 行错误，工程指纹与成功预览保持不变。随后恢复有效源码，自动同步成功。
- 重启测试工作台，原已打开面板重连并取得新写入会话；UI 修改 23→24→23px 在真实消息生效。证据：[重连截图](../output/playwright/phase2-reconnected.png)。
- 最后移除全部临时测试 CSS，留白恢复原工程无覆盖状态，保存自动构建仍启用。刷新后源码绑定保留，不再提示把宿主旧主题覆盖当前工程。面板自动同步开关实际关闭/开启通过。证据：[清理报告](../output/playwright/validation-cleanup.json)、[最终同步状态](../output/playwright/phase2-final.png)。

## 复制给已有 harness

真实 UI 创建一张明确标记「工作台功能验收专用虚构小票」的票，仅处理该 ID `ac18bfb822c40efe6a6daae95c3ec2d5`，原历史票未改。

从面板复制完整文本 → 解析指定单票 → CLI 重新读取票和快照 → CLI 领取 → 临时改留白 23→24px → 真实宿主确认 → CLI 恢复 23px → 真实宿主确认 → CLI 回写结构化结果 → UI 显示待验收、检查、未验证项与证据路径。没有自动启动新模型对话，也没有点击用户验收按钮。

选中这一票再复制，输出只有指定 ID。模拟浏览器拒绝 clipboard.writeText，手动复制对话框保留完整文本并明确提示手动复制。原先 iframe 权限策略导致真实复制失败，已补 `allow="clipboard-write"` 并实测成功。

证据：[复制](../output/playwright/phase6a-copy.png)、[修改](../output/playwright/phase6a-modified-host.png)、[恢复](../output/playwright/phase6a-restored-host.png)、[待验收](../output/playwright/phase6a-review.png)、[手动复制回退](../output/playwright/phase6a-manual-copy.png)、[CLI 报告](../output/playwright/phase6a-report.json)。测试票保持 review，由用户验收；本次测试不代替用户对主题设计的验收。

## 本次未验证与后续范围

阶段 1–2 和 6A 的普通部件交接完成。装饰配方/拖动、Source Hub、CLI 自动启动、大素材优化与分文件导出尚未实现；6A 图层关联等待阶段 3–4。本次未重新进行完整 390/768/1440/1920px 回归、真实流式/群聊/工具调用、实体手机、第三方组件或关闭连接器后候选主题原生导入；这些留待相关阶段和阶段 8，不用历史验证替代本轮结论。

CSS 检查是结构检查，不是浏览器全部语法/视觉验证。迁移多文件备份提供恢复依据；不能宣称所有文件更新具备跨文件事务。可移植单 JSON 备份仍有当前请求上限，大工程分文件恢复待阶段 7。
