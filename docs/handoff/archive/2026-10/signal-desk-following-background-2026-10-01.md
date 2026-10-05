# Signal Desk 关注同步后台化最新交接（2026-10-01）

> 历史记录：这里的版本、构建路径和操作状态属于当时记录。当前运行方式请以[当前交接](../../README.md)为准。

最新入口见 [重启首次同步修复与累计150位](signal-desk-following-startup-fix-2026-10-03.md)。以下为10月1日当时状态，接续 [初次连续流程提速](signal-desk-following-fast-flow-2026-10-01.md)。用户进一步要求取消日常显式配置/诊断窗口，补齐 APP 一键后台同步；本轮已实现并真实验证另外 20 位。

当前运行目录包：`release-following-background-final\win-unpacked\Signal Desk.exe`。Profile：`C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview`。扩展 0.4.0、ID `mmnmgnfmkinopbdihhonnhndkdkchign` 仍在原 profile 的 `following-extension`，本机已完成一次升级重载。首次安装/新增权限需要重载；日常 APP 点击不打开配置页、扩展页或输出文本窗口。

产品 `following-directory.sqlite` 当前 **100** 个不重复博主。此前最新一轮追加 20 位至 80，核验完整；本轮后台化再追加不同 20 位至 100。原 80 位资料、批注与星标逐行未改，不能删除或以本轮覆盖旧资料。standalone `local-data/douyin-following.sqlite` 仍是前三批 40 位历史记录，正式 `%APPDATA%/Signal Desk` 业务库未参与。

实际成功 run `following-20261001131849-c1e10c5349603978`：点击至资料和头像显示 2.273150 秒，独立观测 2.380300 秒，平均 0.1136575 秒/新增作者；连接派发 3.1477 ms，页面阶段 1877.2 ms，APP 校验/保存 15.812 ms。原 80 行、20 个新字段绑定、100 张资料卡与头像均通过核对。失败与开发时间不能隐藏：首个后台 run 在 18.182 秒因分页未继续而阻断，零入库，随后修正内部页面活动状态；两次尝试跨 393.359 秒（包含诊断、修改、构建和工具修正）。

架构是 APP 启动时部署/注册，独立 Native Messaging 只发现这个 profile 的随机端口与 token，扩展持有长连接并对 `/commands` 长轮询。APP 下发当前身份排除名单；后台标签读取同一真实关注卡片，不缓存作者字段。真实抖音页面 hidden 状态的分页停滞用仅目标页面的焦点模拟保持内部活动，实际标签 inactive；在 finally 恢复并 detach。没有 Cookie 迁移或 Network 读取。APP 重启已真实证明自动恢复连接，保留 100 位和最近一次完成计时。

关键源码：`src/main/followingConnection.ts`（启动部署及专用 Host）、`followingSync.ts`（常驻传输/范围/受理/保存/回执）、`browser-connector/native-host/SignalDesk.FollowingHost.cs`（发现）；关注扩展 `background.js`、`visible-runner.js`、`following-batch.js`；APP/preload/IPC 补连接、登录、取消、阶段计时、最近完成结果恢复。

原截图的白色窗口来自 `scripts/inspect-following-page.js`，其作品/推荐/喜欢 tabs 为诊断概览，不是正常采集。正常产品不调用它；内容脚本更新会清理遗留窗口。勿将手动诊断文本当成程序开始点；主要全程为 APP 点击到资料和头像加载，其他阶段单列。

验证：相关既有 11+13 项通过、TypeScript、Native Host 编译、构建、最终目录包冒烟；最终真实 100 位回读与历史计时保留通过。没有全量/媒体/云端回归。当前仅证明此次复用授权页面的范围样本；没有证明全部 292 位、所有冷启动、原生 owner sec_uid 或数值作者 uid。显示名核验不是原生 owner 隔离；作品评论能力门仍 false。

完整 [后台化证据](../../../evidence/following-background-20261001/README.md)；此前 60→80 验证在 `docs/evidence/following-fast-validation-20261001/artifacts`（成功 2.2375 秒，首次超时 10.3302 秒，两次尝试整体跨 62.396 秒）。当前代码/产物均未提交或推送，未发布安装器。
