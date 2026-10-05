# Signal Desk 关注同步结构化通路最新交接（2026-10-03）

> 历史记录：这里的版本、构建路径和操作状态属于当时记录。当前运行方式请以[当前交接](../../README.md)为准。

后续最新入口见 [APP账号与浏览器配置](signal-desk-following-account-config-2026-10-03.md)。以下为本轮结构化0.5.0历史状态，接续 [重启首次同步修复](signal-desk-following-startup-fix-2026-10-03.md)。用户要求 APP 启动时自动打通连接器/账号，未就绪禁用同步；随后明确要求不再通过 DOM 定位关注。中间 DOM 准备版本出现反复刷新，已停止并将生产路径替换为真实通过的结构化只读 GET。

## 当前运行入口与资料

原入口 **`release-following-background-final\win-unpacked\Signal Desk.exe`** 已完整更新为本轮结构化构建，另留 `release-following-structured-delivery`。Profile `C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview`，关注扩展 **0.5.0**，ID/安装目录不变，已重载。当前 APP 运行该原入口，启动自动准备已完成，同步按钮已解锁。

产品库 **160 位**：原150保留，本轮结构化验证新增10，无重复；原行、星标、批注和历史报告保持原值。SQLite 增加 `owner_sec_uid`、`native_uid` 和 `following_account_owners`；旧行新增列保持 NULL，旧数据不重新写入，也不因新合同改变而隐藏。standalone历史40位及正式 `%APPDATA%/Signal Desk` 业务库不参与。作品/评论/指标/任务/分析0。

## 最终生产路径

- APP 打开即创建准备任务、自动启动安装了当前扩展的 Chrome profile；界面立即禁用同步。扩展版本/在线、准备状态双条件，同时由主进程拒绝未就绪同步。
- 扩展复用/创建后台 `/user/self` 上下文，`Runtime.evaluate` 执行授权同源只读 `fetch`；不查询 DOM、不定位/点击关注、不操作关注弹窗。日常 `background.js` 只调用 `structured-runner.js`，manifest 不再给抖音页加载旧 DOM 内容脚本。
- 先请求 `/aweme/v1/web/user/profile/self/`，取得实际 owner `uid/sec_uid/nickname`；再请求 `/aweme/v1/web/user/following/list/`，用请求 sec_user_id 与返回 myself_user_id 核对同一身份、status_code=0、字段schema。准备只请求首批，不创建采集 run/博主记录。平台实测每页返回20，count=1也返回20，不能声称只取得单条。
- 成功才标记 ready、解锁按钮并通知。页面导航/关闭或连接器实例变化/离线重新锁定检查；登录失效或账号不一致保持禁用，提供浏览器登录/重新检查入口。连接恢复仍用 Native Messaging + 本机长轮询。自动恢复有上限，已取消无期限每5秒刷新页面。
- 同步从第一页开始、按已有 sec_uid 排除旧博主，复用响应 min_time/max_time、offset 串行分页；上限20页/21个GET、原APP整轮截止仍在。昵称/简介/头像/主页来自同一个响应作者对象；保存受理再次核对分页身份、连续性、逐字段、去重，SQLite事务保存/回读，APP头像全部加载回执计全程。
- `uid`/`sec_uid` 不混用。首次结构化保存时在账号映射中关联原显示名目录；历史作者原生UID仍NULL，不把现在读到的owner当成过去每条的原生证明。新十位已有真实原生author UID；后续owner核对优先原生sec_uid，改昵称不会覆盖/丢失已绑定资料。

## 已取得的真实证据

首次无DOM探测两个GET约550.7ms，返回owner实际身份及20条真实关注。启动准备第一次接口575.7ms、服务602.1964ms；包含更新扩展的窗口观测2.206s。最终原入口重开接口592.2ms、准备服务1008.9242ms；从窗口可观测的检查工具约0.932s，两个测量起点不同，不把它们当同一个精确全程。

正式验证run `following-20261003081049-f57ba611448f397c`：新增10，150→160，DOM查询0、点击0、8个列表页+1个self请求共9GET。APP点击至全部资料/头像显示 **2713.5457ms**，独立观测2810.6ms，平均271.35457ms/新增博主，接口获取2545.2ms，保存16.9742ms。旧150行及星标/批注、160张卡片/头像、10个字段来源逐条通过；新10空简介0。

初次同步在2063.5ms因6页上限不足停止，零入库；扩展把count=100也按实际20返回，改成count20且允许覆盖旧150以上的连续分页后成功。保留失败记录，不能说首次试跑就成功。早期DOM准备调试有重复刷新/中断/部分成功，不是最终日常通路。

验证：相关受理/目录11项（包括native接入不丢星标批注）、TypeScript、构建、最终打包界面检查通过。真实readiness观察同时验证初始disabled、主进程reject未就绪同步、准备后解锁且无新增资料；最终重开160及历史计时保留。没有额外采集20/全量，没有正式作品/评论或媒体云回归，未重启用户电脑。

源码关键：`structured-runner.js`、`structuredFollowingAcceptance.ts`、`followingDirectoryStore.ts`、`followingSync.ts`、shared state/APP按钮与启动通知、`followingConnection.ts`版本/部署。`visible-runner.js`、`following-batch.js` 等仅为历史诊断，不能再用于日常产品定位关注；结构化probe入口为本轮可行性证据工具。

完整 [实测证据](../../../evidence/following-structured-20261003/README.md)。原owner `sec_uid` 实际为 `MS4wLjABAAAAWc2jAoKnRCJhCEmYQW8qjyRKpAj0phnOEYXuhvhpbnMHVxzRalioATiTXlyXCH7B`，uid `2131296669408333`。新owner/作者身份来源改善只覆盖本轮，不代表原历史作者UID补齐、全部账号或全量关注/取关闭合。作品/评论正式能力门false。代码/证据未提交推送，未发布安装器。
