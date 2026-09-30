# APP 独立关注目录真实验证 · 2026-09-30

用户要求：在 APP 点击开始同步后自动打开 Chrome，提示人工配置；随后获取当前登录账号关注列表前 10 位博主的头像、昵称与主页链接，保存到本地 SQLite 并在 APP 展示。本次不采集博主作品、作品指标或评论。

## 当前执行状态

- 已补齐 APP 入口、Chrome 配置页、独立关注扩展、本地作者目录和卡片主页链接。
- 新版安装目录：`release-following-review/win-unpacked`。
- 已通过实际 renderer 按钮点击触发，Chrome 配置页已打开；第一次 run 为 `following-20260930083351-e1b3826b3d3d8601`。
- 已向用户请求在 Chrome 手工加载扩展并确认已登录。**目前尚未收到真实关注结果；真实 10 位关注入库与头像展示不能标记通过。**
- 已保存 `app-before.json` 与 `database-before.json`。新验证 profile 的作品、指标、评论、任务和分析表均为 0。

## 第一次真实人工反馈与修正

- 用户反馈：配置页打开目录无反馈；打开 Chrome 扩展管理页出现用户选择过程；右上角扩展图标点击没有响应。用户提供截图显示配置页仍在等待扩展连接。
- 已核对实际 Chrome 扩展元数据：扩展路径正确，已在 `Default` 用户加载，禁用原因列表为空。不能把问题归因于用户没有安装扩展。
- APP 打开目录 endpoint 实测 HTTP 200；最初代码没有显示操作成功或失败，不能用 HTTP 成功推断用户已看见资源管理器。
- 初版扩展没有 `default_popup`，导致点击图标没有操作界面，属于实际实现遗漏。已添加返回配置页、刷新和开始读取的弹窗。
- Chrome 启动改为读取本机现有 `last_used` 用户名，仅用于选择同一用户，不读取登录凭证、不修改浏览器 profile。
- 配置页新增“扩展已加载，刷新连接”和每个文件夹/管理页操作的成功/失败提示；目录打开错误会返回给页面。
- 修正版打包及 APP 冒烟验证通过。当前运行 `release-following-review-v2/win-unpacked`，第二次真实 run 为 `following-20260930084634-f5da02d3191fc6ab`。已请求用户重新加载已安装扩展一次，并从新配置页开始真实读取。

## 第二次真实反馈：已操作，但尚未入库

- 用户确认抖音页面开始自动操作，但不知道是否获取成功。
- 读取真实 APP 状态：第二次 run 已 `blocked`，错误 `BROWSER_DEBUGGER_DETACHED`，关注目录 0 条、作品 0 条、评论 0 条。留存 `app-after-v2-blocked.json`。
- 用户明确确认：没有点击顶部调试提示的取消按钮，也没有打开 F12 开发者工具。不得把连接中断归因于这些用户操作。
- 旧版没有保存 `chrome.debugger.onDetach` 的 reason 参数和中断阶段，因此根因**未知**；它同时把所有失败都提示为登录/安全验证，缺少依据。
- 新版记录采集阶段、Chrome detach reason、关注响应读取次数、投影作者数及错误代码，保存在 run 的 `following-progress.json`。连接断开与登录/安全验证分别提示，不自动重新连接或重试。
- 新增抖音页面右下角结果反馈、扩展图标数量/失败徽标和弹窗实时 APP 状态；APP 成功后自动切到博主列表。
- 新版执行路径模拟 8 项通过，包含成功保存、忽略作品响应、三种 detach 原因、登录与安全验证阻断、APP 取消。它们是运行行为模拟，**不是抖音真实采集通过**。
- `release-following-review-v3/win-unpacked` 打包冒烟通过。第三次 run `following-20260930090246-658370b3bbab5097` 已从 APP 实际按钮点击打开 Chrome 配置页，等待用户重新加载版本 0.1.1 扩展并读取真实结果。

## 数据与边界

- 本轮使用持久本地 profile：`%LOCALAPPDATA%/SignalDeskFollowingReview`。
- 博主基础信息库：`following-directory.sqlite`；包含 `directory_runs` 和 `directory_creators`，按 owner 的独立 `sec_uid` 保存关系和作者的独立 `uid/sec_uid`。
- 作品数据库仍为独立 v5 `signal-desk.sqlite`；此次关注操作不执行 `TaskRunner`，不创建作品、评论、媒体、云任务。
- Chrome 扩展只对自然加载的关注列表 endpoint 请求 `Network.getResponseBody`；不读取作品、作品详情或评论响应。只投影前 10 位的基础信息，不保留完整原始响应、请求 headers、cookies 或签名参数。
- 导航自己的主页可能使抖音网页自然请求自己的作品；本应用不读取这些响应，不导航关注博主主页或作品页。`activeApiRequests: 0` 表示扩展没有主动请求抖音 API，不能解释为网页没有网络请求。
- 范围限定为默认关注顺序的第一页前 10 位，不据此推断完整关注目录或取关状态。如果第一页不足 10 位而 `has_more=true`，保存已验证基础信息并明确标记未达标，不自动继续分页。
- 当前独立目录暂未与正式 v6 作品身份合同整合。作品与评论正式门禁保持关闭。

## 检查记录

- `npm test`：22 文件、214 项通过。
- 独立扩展投影与首屏范围检查：2 项通过。
- TypeScript 与扩展 JavaScript 语法检查通过。
- 打包构建通过；打包 APP renderer、preload、独立关注入口可用性、作品门禁及既有功能冒烟通过。
- 上述是离线与本地打包验证，不能替代尚待完成的浏览器真实采集。

收到真实报告后，使用 `scripts/audit-following-client-run.mjs` 检查真实报告与数据库一致、前 10 位顺序、主页绑定、SQLite 完整性、关注操作前后作品/指标/评论/任务/分析记录数；使用 `scripts/inspect-following-live-client.mjs screenshot` 留存 APP 卡片和头像加载结果。

## 辅助开发 SOP

开始任务时读取全局 SOP，并调用辅助入口。本会话返回 `unavailable`，未读到规划修订与人工反馈记录；继续依照用户本轮明确验收要求执行。完成时保存实际报告并尝试同步；不能把尚未完成的真实测试报告为通过。
