# Signal Desk 博主资料累计保留修复交接（2026-10-01）

本文件是最新交接入口，接续 [第二批关注资料测试](signal-desk-following-second-batch-2026-10-01.md)。

> 最新状态已转至 [第三批二十位资料与计时交接](signal-desk-following-third-batch-2026-10-01.md)：第三批完成，APP 显示三批共 40 位，旧资料全部保留。下文暂停及二十位为对应历史时点。

> 后续状态：用户要求第三批增加到另外 20 位，又在启动前要求暂停并增加后台计时。计时和二十位配置已准备，第三批尚未采集，原两批二十位保持。历史耗时及计时边界见 [计时准备记录](../evidence/following-timing-20261001/README.md)；源码可见报告合同已支持二十位，但当前运行 APP 仍是本文件的保留修复构建。

用户确认第二批的昵称、简介、头像与对应主页链接相符，同时指出 APP 中第一批不再显示，并要求恢复；以后测试或正式运行新增博主时不得删除已有博主资料。

## 修复与真实结果

原因是 `FollowingDirectoryStore.list()` 可见路径只查询最新 `run_id`，网络路径也只查询最新 `last_run_id`。数据库保留两批共 20 位，但界面隐藏首批十位。

已修改可见目录查询：同一账号页面名称范围内累计读取历史批次，按 `sec_uid` 去重，重复身份使用最新采集的公开字段，保留最初的稳定记录 ID、星标和批注。无账号名称的报告仍只在自己的 run 范围读取，避免猜测跨账号关联。网络目录读取当前已验证 owner 的全部已保存作者，不再按最新批次过滤。没有删除历史作者或报告，没有调整数据库 schema。

新批次、重复身份刷新、部分/空结果及重启不会使已有同账号博主消失。项目 `AGENTS.md` 已记录累计保留规则。

已将当前源码打包到：

```text
release-following-retention-review\win-unpacked\Signal Desk.exe
```

关闭旧 `release-commit-review` 窗口后，使用同一 `SignalDeskFollowingReview` profile 启动修复版。当前 APP 打开于博主资料库，显示 **20 张卡片、20 个主页、20 个已加载头像**；首批十位恢复展示，第二批十位继续保留，重复 0 位。昵称、简介、主页、头像和实际卡片图片 URL 与两批原始采集文件逐条一致。

## 验证

- `npm test`：22 个测试文件、219 项通过。
- 新回归覆盖：可见十条加十条累计、旧记录保留、同身份公开字段更新、稳定 ID/星标/批注、空报告后保留、SQLite 重开；网络作者部分及空刷新后保留。既有账号隔离与拒绝无效报告测试继续通过。
- `npx tsc --noEmit`、`npm run build`、项目边界检查通过。
- 本地 Electron 目录打包和 `scripts/test-packaged-renderer.mjs` 通过，涵盖 preload、renderer、IPC、隔离入口和既有能力门。
- 修复前通过 SQLite backup API 保存目录一致性副本；修复后四张目录表全部行的序列化 hash 与修复前一致，证明没有删除或修改已保存资料。
- 两批字段及 20 个不同 `sec_uid` 核验通过，目录完整性 `ok`、外键违规 0。review 业务库作品、评论、指标、任务、分析均为 0。

证据位于 `docs/evidence/following-retention-20261001/artifacts/`：

- [数据库核验](../evidence/following-retention-20261001/artifacts/database-verification.json)。
- [APP 核验](../evidence/following-retention-20261001/artifacts/app-verification.json)与[完整回读](../evidence/following-retention-20261001/artifacts/app-readback.json)。
- [上部截图](../evidence/following-retention-20261001/artifacts/app-restored-upper.png)、[下部截图](../evidence/following-retention-20261001/artifacts/app-restored-lower.png)。
- `directory-before.sqlite` 为本地备份，Git 忽略数据库文件，仍需单独保留。

本次只修复累计列表及保留语义，没有新采集或修改用户的字段资料。扩展自动关注、原生 owner 身份、全量分页、正式作品/评论和 v6 迁移的验收边界保持原记录；`STRUCTURED_SYNC_AVAILABLE` 仍关闭。当前可见目录的账号归属仍依赖页面名称，不能称作已验证原生 owner 隔离。

代码、回归和证据保留在工作区，未提交或推送。后续操作优先启动上面的修复版，避免旧构建再次只显示最新批次。
