# Signal Desk 关注资料自动流程提速交接（2026-10-01）

后续最新交接见 [后台化与累计一百位](signal-desk-following-background-2026-10-01.md)。以下为当时六十位历史状态，接续 [第三批二十位](signal-desk-following-third-batch-2026-10-01.md)。用户指出读取虽快但整体需两分钟，明确授权整体流程优化及必要策略，本轮已实现并取得自动真实闭环。

## 已完成与实测

APP 选择新增十或二十位，点击后自动连接扩展、复用/打开本人主页、打开关注弹窗、排除旧身份、读取/核对字段和头像、回传、SQLite 追加/回读并即时展示。已取消逐作者固定等待；账号、卡片和图片按真实事件就绪。过程中没有代理逐步发命令。

首次正常 run `following-20261001104050-7f0ac06504488215`，新增二十位，旧四十位保留，APP 累计六十位。点击到全部卡片与头像显示 **1.688 秒**，独立观测 **1.769 秒**。最终构建在独立 profile 从四十位备份复跑同二十位，点击到显示 **4.170 秒**，观测 **4.262 秒**；原 review 没有再次插入。

完整阶段、真实来源、失败与界限见 [本轮证据](../evidence/following-fast-flow-20261001/README.md)。不能将这两个样本描述为任何页面冷启动或全量关注都固定两秒以内。

## 当前运行与数据

最终 APP：`release-following-fast-final\win-unpacked\Signal Desk.exe`。

当前 profile：`C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview`。

APP 已打开在博主资料库，六十位、六十个头像正常显示。每次同步结束时状态区显示点击到全部展示的全程时间及平均耗时；重启后状态回到 idle，历史时间保存在该 run 的 `following-timing.json`。

实际产品库 `following-directory.sqlite` 有六十位；原独立 `local-data/douyin-following.sqlite` 保持前三批四十位作为历史记录，本轮没有重复维护两个业务库。后续身份排除以 APP 当前目录为准。作品/评论/指标/任务/分析均为 0，正式 `%APPDATA%/Signal Desk` 库未参与。

关注扩展 0.3.0 位于 review profile 的 `following-extension`，Chrome 已安装并重载。一次更新/首次安装仍需要正确的 Chrome profile；日常已连接的配置页自动启动，不需再点击配置完成。原只读连接器和隔离作品扩展没有改为本轮身份或权限。

## 关键源码

- `browser-connector/following-extension/following-batch.js`：真实 DOM、emoji 字段、单卡片归属、排除旧身份、按事件等待、并发图片核验；桌面脚本与产品共用。
- `following-timing.js`：单调计时；逐条仅记最终字段核验，共用发现/图片等待另记。
- `visible-runner.js`、`background.js`、`setup-content.js`：自动开始、页面复用、连续读取至报告回传、取消/阻断。
- `src/main/followingBatchAcceptance.ts`：完整二十位原始捕获和字段绑定二次校验，拒绝重复、错账号、头像/简介错位、超量和不足。
- `src/main/followingSync.ts`：本轮排除身份/范围，一次归档、SQLite accept、保存回读、事件刷新和显示回执计时。
- `src/renderer/src/App.tsx`：十/二十位选择、完成后展示目录并清除搜索、真实目录头像加载确认与全程时间。

旧 DOM 提取实现已退出产品，旧网络 runner 仅保留历史诊断/测试，不是当前执行路线。当前 scope、session token 和取消状态在保存前复核，未放宽字段/头像归属或安全验证阻断。

## 验证与剩余边界

23 测试文件/224 项通过；最后针对改动重跑受理/目录 13 项、连续流程/DOM/计时 11 项，TypeScript、边界及最终构建打包冒烟均通过。最终构建独立真实复跑与真实六十位回读通过。

关注自动路径取得的是两次正常二十位真实样本，尚未证明全部关注多页、所有账号、账号切换或取关语义。owner 原生 sec_uid、数值作者 uid 仍缺失；页面昵称核对不能代替原生 owner 证明。`STRUCTURED_SYNC_AVAILABLE` 仍 false，作品、评论、正式 v6、T2/T3 和媒体/云边界仍按此前记录。

代码、证据和构建留在本机，未提交/推送，未发布安装器。后续启动以上最终构建，继续累计保留已有六十位及批注/星标，不把此前只排除二十或四十位的历史配置用于新采集。
