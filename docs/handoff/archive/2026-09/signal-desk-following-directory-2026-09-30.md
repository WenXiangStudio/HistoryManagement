# Signal Desk 关注目录采集与头像修正交接（2026-09-30）

> 历史记录：这里的版本、构建路径和操作状态属于当时记录。当前运行方式请以[当前交接](../../README.md)为准。

工作区：`D:\AI_WorkSpace\SpatialWarehouse\AI_InformationWorkflowCreationCenter`。

> 最新交接已转至 [2026-10-01 第二批关注资料测试交接](../2026-10/signal-desk-following-second-batch-2026-10-01.md)：又保存十位不同博主，两批共 20 位、重复 0 位；APP 展示最新一批十位。本文记录 9 月 30 日的结果与基线。

本文件接续 [R8 客户端隔离链路交接](signal-desk-r8-client-isolated-path-2026-09-29.md)，记录本轮真实十位博主资料入库、头像修正和当时工作区状态。用户随后授权整理提交并推送；提交前发现旧测试未适配新增目录表，经用户授权修正后，当时 22 个测试文件、217 项全部通过。此次提交保存实现和真实结果，不启动新的采集或扩大自动同步验收。

## 1. 当前结论

**已完成当前登录账号关注列表前 10 位博主基础信息和主页链接的真实采集、本地 SQLite 保存及 APP 展示；头像错位和漏采已修正，APP 的 10 个头像全部加载。**

本次最终成功路径是桌面操作与页面 DOM 提取脚本，采集完成后直接写入本地数据库及验证 APP 的目录数据库。原先“APP 点击开始 → Chrome 扩展自动采集 → 自动回传”的关注流程多次失败，**仍未验收通过**。不得把最后这次桌面采集成功描述为原自动同步流程已修好。

| 范围 | 当前状态 | 实际证据 |
|---|---|---|
| 真实前 10 位博主昵称、公开简介和主页链接 | 完成 | 十条采集 JSON、SQLite 回读 |
| 十条头像归属与显示 | 完成，修正 5 处 | Chrome 对应主页 anchor 内图片、APP 10/10 图片加载 |
| APP 博主资料库展示 | 完成 | 10 张卡片、10 个主页链接和 10 个头像 |
| APP 关注扩展自动采集 | 未完成 | 原真实 run 中断或没有取得作者链接 |
| 全部关注列表与分页 | 未验收 | 本轮只取得默认“综合排序”前 10 位 |
| 独立作者作品采集 | 既有隔离单作品验证通过；正式接入未完成 | 2026-09-30 R8 原始报告 |
| 评论、媒体与云端采集 | 本轮未执行 | 本次验证 profile 的作品、评论、指标和任务均为 0 |

## 2. 真实数据与证据位置

账号页面显示名称：**无限♾️进步**。来源：`https://www.douyin.com/user/self` 顶部关注数量打开的关注弹窗，“综合排序”下的前 10 位。

原始采集时间：北京时间 2026-09-30 17:36:09；头像修正核验时间：17:56:38。

采集 run：`desktop-following-20260930093609`。

| 顺序 | 博主 |
|---|---|
| 1 | 爱学习的乔同学 |
| 2 | 雪踏乌云 |
| 3 | 小涛AI大讲堂 |
| 4 | AI，我俩和一百万 |
| 5 | 浙大猫学长 |
| 6 | 曲木古也 |
| 7 | 周话多GOGOGO |
| 8 | 阿星不是程序员 |
| 9 | 每日英语 |
| 10 | oil欧呦 |

主要文件：

- [独立 SQLite](../../../../local-data/douyin-following.sqlite)：`following_runs`、`following_creators`；十条顺序、昵称、`sec_uid`、主页、头像和简介。
- [当前资料 JSON](../../../evidence/following-client-20260930/artifacts/douyin-following-20260930.json)：已包含修正后的十个头像地址。
- [本地结果页](../../../evidence/following-client-20260930/artifacts/douyin-following-result.html)：十位博主卡片，主页可点击。
- [数据库验证结果](../../../evidence/following-client-20260930/artifacts/douyin-following-verification.json)：10 条、10 个主页、10 个头像、完整性 `ok`。
- [头像原始归属](../../../evidence/following-client-20260930/artifacts/following-avatar-bindings.json)：Chrome 实际页面读取；每条包含准确主页 anchor、昵称、图片 alt、URL 和加载状态。
- [头像修正差异](../../../evidence/following-client-20260930/artifacts/avatar-correction-verification.json)：五处修正与原始归属文件 SHA-256。
- [APP 最终回读](../../../evidence/following-client-20260930/artifacts/app-following-avatar-readback.json)：10 张卡片、10 个已加载头像。
- APP 截图：[上部](../../../evidence/following-client-20260930/artifacts/app-following-avatar-corrected.png)、[下部](../../../evidence/following-client-20260930/artifacts/app-following-avatar-corrected-lower.png)。
- [修正前 JSON](../../../evidence/following-client-20260930/artifacts/douyin-following-before-avatar-fix.json) 和旧截图保留为历史记录，不能用作当前头像结果。

SQLite 在 `.gitignore` 中排除，实际数据库保留本机；`local-data/` 中本轮采集的 JSON、HTML、头像差异和 APP 截图作为可复核证据纳入提交。后续交接或打包仍须另外保留实际数据库，不要假定 Git 自动包含它。

## 3. 最后成功路径与头像修正

### 昵称和主页

使用 Windows UI Automation 读取当前 Chrome 关注弹窗的前十个博主昵称，再对各自昵称链接执行 Chrome 的“复制链接地址”。直接保存页面原有主页链接，不使用旧作者目录或合成数据。

`scripts/save-following-desktop.mjs` 将资料写入独立 SQLite，再重新读取十条记录核对顺序、昵称和主页，并生成结果页。随后将同样的资料写入验证 APP 目录，使 APP 可以直接展示。

### 头像

首次头像采集按滚动后的屏幕坐标右键复制图片，发生相邻作者图片错位和漏采。用户指出问题后，改为当前页面 DOM 中按**准确主页链接中的 sec_uid → 该链接内部 img → 昵称与 alt 匹配**读取 `currentSrc/src`，不再按屏幕位置或行顺序分配图片。

实际修正：

| 博主 | 修正前 | 修正后 |
|---|---|---|
| AI，我俩和一百万 | 头像 NULL | 已补齐自己的头像 |
| 浙大猫学长 | 误用曲木古也头像 | 已恢复自己的头像 |
| 曲木古也 | 误用周话多GOGOGO头像 | 已恢复自己的头像 |
| 周话多GOGOGO | 误用阿星不是程序员头像 | 已恢复自己的头像，与阿星不同 |
| oil欧呦 | 头像 NULL，显示字母 O | 已显示照片 |

原记录无法提供独立数值 `uid`，因此保存为 `NULL`；`sec_uid` 来自准确的主页 URL。当前记录不能直接充当正式作品采集所需的已验证双 ID。owner 原生 `sec_uid` 也未通过此次桌面采集验证，不把页面昵称当成原生账号 ID。

可复用脚本与职责：

| 文件 | 职责 |
|---|---|
| `scripts/capture-following-desktop.ps1` | 从关注页复制十位昵称链接；现已接入准确头像读取 |
| `scripts/read-following-avatar-bindings.js` | 在当前页面按十位已保存身份匹配链接内头像，输出归属数据 |
| `scripts/capture-following-avatar-bindings.ps1` | 将页面读取脚本送入当前 Chrome，通过结果文本读取 JSON |
| `scripts/apply-following-avatar-bindings.mjs` | 校验头像归属、保留修正前资料、更新 SQLite 和结果页 |
| `scripts/capture-following-avatars.ps1` | 调用新头像路径的兼容入口；旧坐标复制实现已替换 |
| `scripts/save-following-desktop.mjs` | 独立 SQLite 保存、验证 APP 目录写入和 HTML 生成 |
| `scripts/inspect-following-live-client.mjs` | 读取 review APP 的 IPC/卡片/头像状态及截图，导航名称为“博主资料库” |

这些脚本目前针对本机真实页面和本轮十位已保存作者；窗口句柄、页面布局及浏览器焦点不能当作通用产品接口。不要无指令重新执行采集。

## 4. APP、数据库和工作区状态

本轮验证 APP：

```text
release-following-dom\win-unpacked\Signal Desk.exe
```

验证 profile：

```text
C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview
```

交接核实时，该 APP 主进程为 PID `11416`，已显示“博主资料库”。PID 和窗口句柄随重启变化，后续操作前重新读取。

APP 博主目录数据库：

```text
C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview\following-directory.sqlite
```

- `directory_runs`、`directory_creators`：最初网络响应合同路径。
- `visible_directory_runs`、`visible_directory_creators`：当前成功的可见关注列表资料。
- 最新 run 中有十位博主。APP 的 `FollowingDirectoryStore.list()` 读取可见目录并显示昵称、头像、简介和主页。
- 可见目录独立于 v5 作品库，当前可见记录按 run 保存；完整账号切换、历史关系合并、批注跨刷新保留等尚未正式验收。
- 同 profile 的 `signal-desk.sqlite` 中 `works=0`、`comments=0`、`metric_snapshots=0`、`jobs=0`。
- 正式 `%APPDATA%/Signal Desk/signal-desk.sqlite` 未接收此次桌面十条采集；不得混淆正式库、review profile 和 R8 隔离库。

相关实现：`src/main/followingSync.ts`、`src/main/followingDirectoryStore.ts`、`src/shared/followingDirectory.ts`、`src/main/index.ts`、`src/preload/index.ts` 和 `src/renderer/src/App.tsx`。

APP 已增加“开始同步关注”及 Chrome 配置页，博主卡片有主页链接；独立关注入口不执行原 `TaskRunner` 的作品链。关注扩展当前源码版本 `0.2.0`，已移除调试权限；`following-dom.js` 的头像查找也已按主页 anchor 修正。**此扩展的最终源码没有取得新的成功自动采集验收。**

`STRUCTURED_SYNC_AVAILABLE` 仍为 `false`，它继续限制正式作品和评论采集；现在独立关注目录入口不再使用这个旧门作为可用性判断。不能把“旧门仍关闭”误解为本轮没有取得真实关注数据，也不能把独立关注按钮可点击误解为自动流程已经通过。

此次按用户授权将本轮及此前 R8 的代码、项目规则、文档和相关证据整理到 `main` 并推送既有 `origin`，具体提交以 Git 日志为准；本机数据库、缓存和构建目录继续排除。未创建安装包发布。

## 5. 验证状态及失败记录

最终真实验证：

- SQLite 十条昵称和主页与采集资料一致，十个主页不同，完整性 `ok`。
- Chrome 原始头像归属十条均匹配昵称、主页和图片 alt；十张图片已加载。
- APP 十张卡片、十个主页链接、十个已加载头像；头像 URL 逐条等于当前 Chrome 对应作者图片。
- 此轮没有采集关注博主的作品、点赞数、评论数或评论内容。

此前自动流程的主要失败：配置页/扩展反馈缺失、调试目标断开 `BROWSER_DEBUGGER_DETACHED/target_closed`、关注弹窗结构判断 `FOLLOWING_DIALOG_NOT_READY`、DOM 提取不到主页链接。`target_closed` 仅证明调试目标失效，不能据此断定用户关闭标签页；用户明确表示没有取消调试提示或打开开发者工具。最初两轮缺少完整持久化进度日志。

离线及打包检查须按执行时的代码版本理解：

- `npm test` 的 22 文件、214 项通过发生在加入最终可见目录和头像修正之前。
- 原网络 runner 的 8 项模拟检查已通过，但它不是当前 DOM 自动路径的真实验收。
- `release-following-review`、v2、v3 曾通过打包冒烟；当前 `release-following-dom` 以真实十条资料完成 APP 展示，不能外推它已经通过前述全部回归。
- 最终头像相关脚本的 JS/PowerShell 语法检查通过，并以真实页面、数据库和 APP 结果完成核验。
- 提交前重跑 `npm test`，最初 213 项通过、1 项失败：`followingDirectoryStore.test.ts` 的旧表清单断言缺少两张可见目录表。经用户授权更新该断言，并补充重开 SQLite 后头像/主页归属保持、最新可见 run 读取与批注隔离、无效报告不修改已保存记录三项检查。重跑结果：**22 个文件、217 项全部通过**；TypeScript、当前源码构建及项目边界检查通过。
- 当前源码另行打包到 `release-commit-review/win-unpacked`，执行 `scripts/test-packaged-renderer.mjs` 通过，涵盖 preload、renderer、IPC、隔离单作品结果接收、独立关注入口、作品门禁和既有演示/云设置行为。此打包检查没有访问抖音；仍不能替代未完成的关注扩展自动采集真实验收。
- 提交前只读核验原始已保存资料：独立 SQLite 的十条昵称、主页和头像逐项匹配 Chrome 头像归属文件，头像数 10、完整性 `ok`，没有重新采集。
- 原网络 runner 模拟 8 项、R8 harness 28 项在提交准备阶段通过。它们仍不代表当前 DOM 扩展的真实自动采集已通过。当前生产先决条件审计因文档列明的既有作品连接器缺口继续关闭，此次没有删除该检查或开启生产能力。

详细业务证据见 [桌面采集成功记录](../../../evidence/following-client-20260930/desktop-success.md) 和 [头像修正记录](../../../evidence/following-client-20260930/avatar-correction.md)。

## 6. 与此前 R8 工作的关系

此前真实单作品 run `r8-homepage-client-20260930065027-7ce58f08` 验证了“AI，我俩和一百万”的作品 `7662218043044416811`，用户确认 URL、作者和标题一致。该 run 保留在临时目录与 [R8 原始证据目录](../../../evidence/r8-homepage-client-20260930/README.md)，其临时 v6 库与本轮十条目录是不同资料。

关注、作者作品、作品评论必须继续保持独立动作：关注结果不自动创建作品任务，作品结果不自动创建评论任务。历史单作品 run 曾有一个未执行的关注任务，已作为历史事实保留，新隔离作品 run 已移除该任务。见 [任务解耦记录](../../../architecture/following-works-task-decoupling-2026-09-30.md)。

正式 v6 迁移、生产 works 的 uid/sec_uid 证明与主页路径、关注分页、六作品 T2、评论/回复分页、T3 和发布仍未完成。旧 T2 的 2/6 和安全验证不能称为通过。

## 7. 后续工作的原则与待办

本次提交推送完成后等待用户下一步指令。后续若继续产品化，优先沿用本轮已经取得正确真实字段的提取方式，将一条作者资料从真实页面准确取出并入库后，再验证十位和 APP 自动入口，不重建未经验证的长流程。

待办顺序供后续讨论：

1. 收敛已保存资料的原生身份、账号归属、目录存储与刷新语义，明确哪些字段实际取得、哪些仍缺失。
2. 把按准确主页链接读取昵称/头像/简介的已验证方式接回独立关注入口，简化扩展配置和结果回传，完成真实自动流程验收。
3. 让错误记录直接说明失败阶段和已保存数量；网站结构不匹配时先查看真实结构，避免只修改预设条件后整体重跑。
4. 在每条作者记录上核对字段归属，特别是图片与主页一致；“图片能加载”不足以说明头像正确。
5. 根据实际最终修改运行必要回归，再推进独立作者作品采集及后续阶段。

用户偏好：在已授权范围内自主完成，不反复要求加载扩展或确认试跑；优先取得真实效果，清楚区分代码/模拟通过与真实数据正确；失败应缩小问题、依据新证据调整方式，不反复在同一假设上修补和打包。
