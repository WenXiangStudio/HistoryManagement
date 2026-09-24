# Signal Desk 关注发现与增量同步优化方案交接

> 原交接日期：2026-09-24；现状更新：2026-09-25。<br>
> 用途：继续实施 [`关注发现与增量同步路线优化方案`](../architecture/signal-desk-following-sync-route-redesign-2026-09-24.md)，并保留设计阶段至低请求量试跑的证据链。<br>
> 以下“截至 2026-09-25 的现状”为当前交接基准；后文标注为“原设计阶段记录”的内容保留当时判断，不能据此覆盖较新的真实结果。

## 截至 2026-09-25 的现状与边界

| 项目 | 当前事实 |
|---|---|
| 低请求量作者主页试跑 | 已实现隔离路径，并真实验证 **1 位已保存作者、1 个作品**。成功 run 为 `r8-homepage-20260924-224608-975-76d7461a`；主页看到 6 个作品候选，作品 `7662218043044416811` 经页面自然加载的列表与详情响应核对原生 `aweme_id`、`author.uid`、`author.sec_uid`，状态 `verified`。3 次页面导航、0 次扩展主动 API GET、约 16.3 秒；用户确认作品页保留且弹窗显示 `verified`。详细行为与历史试跑见 [`低请求量作者主页试跑`](../architecture/signal-desk-low-request-homepage-pilot-2026-09-24.md)。 |
| 旧批量 T2 | 仍为失败/部分完成证据。第二轮 `r8-t2-20260924-213328-485-ce080ce7` 约 86 秒内发起 19 次扩展主动请求，6 个目标作品中仅 2 个成功；关注第二页重复，随后浏览器出现抖音安全验证。不能从单作品试跑推断六作品、分页或防风控能力已经通过。 |
| 正式产品 | [`src/main/taskRunner.ts`](../../src/main/taskRunner.ts) 的 `startSampleSync` 仍先排 `collection.following`，收到关注结果后才排作者作品与评论。低请求量路径尚未接入正式桌面客户端；评论、回复、自动关注增量和多作者同步尚未由该路径验证。[`STRUCTURED_SYNC_AVAILABLE`](../../src/shared/featureFlags.ts) 仍为 `false`。正式 SQLite 仍是 schema v5；v6 仅有隔离草案与审计，未加入正式迁移列表、未写正式库。 |
| 工作区 | 有大量跨窗口未提交改动和未跟踪文件，包括本交接、低请求量试跑及 R8 隔离代码。继续工作前定向查看 `git status --short` 与目标文件 diff；保留既有成果，不执行 reset 或覆盖。 |

成功报告原件：[`pilot-report.json`](<C:/Users/Administrator/AppData/Local/Temp/signal-desk-r8/r8-homepage-20260924-224608-975-76d7461a/pilot-report.json>)。第二轮旧 T2 报告：[`t2-report.json`](<C:/Users/Administrator/AppData/Local/Temp/signal-desk-r8/r8-t2-20260924-213328-485-ce080ce7/t2-report.json>)。这些是本机临时目录证据，后续清理系统临时文件前应先归档需要保留的报告；文档内结果不能代替原始报告。

### 低请求量路径究竟做了什么

1. 从此前已验证的隔离作者目录读取 `uid`、`sec_uid` 和主页；扩展由用户在弹窗中选择单个作者后才启动。没有现成抖音标签页时，先打开首页检查登录与安全验证，再访问最多一个作者主页和一个作品页。
2. 主页 `/video/<aweme_id>` 或 `/note/<aweme_id>` 链接只形成候选。只有页面自身请求返回的作品列表与详情同时给出匹配的原生作品 ID 和作者双 ID，才写 `verified`；缺少证据时保留 `candidate-only`，不主动补发接口请求。
3. 扩展主动 API 请求数为零，**不表示抖音页面没有网络请求**：页面导航仍会正常加载资源与接口。验证或登录阻断即停止；不自动请求评论、回复，不下载视频，也不触发 ASR/OCR 或外部云调用。
4. 主要隔离实现位于 [`r8-homepage-pilot-core.js`](../../browser-connector/extension/r8-homepage-pilot-core.js)、[`r8-homepage-pilot-presentation.js`](../../browser-connector/extension/r8-homepage-pilot-presentation.js)、[`poc/r8/homepage-extension/`](../../poc/r8/homepage-extension/) 和 [`homepage-pilot-controller.mjs`](../../poc/r8/homepage-pilot-controller.mjs)；启动脚本为 [`start-r8-homepage-pilot.ps1`](../../scripts/start-r8-homepage-pilot.ps1)。隔离代码不等于已完成生产接线。

### 三方技术路线审查，供整改决策使用

| 环节 | Signal Desk 现状与目标 | df对标拆解助手 1.5.3 | `ai-boshu-crawler` 固定提交 |
|---|---|---|---|
| 作者入口 | 产品目标是从当前 owner 的关注列表自动发现并保存经验证的 `uid`、`sec_uid`，之后从已保存作者直接同步。正式调度目前仍把关注任务设为作者作品的前置。 | 用户打开某个抖音 `/user/<sec_uid>` 页面后工作；扩展注入主页，主动读取 `/aweme/v1/web/user/profile/other`。静态代码未证明它能自动发现当前账号的完整关注列表。 | 手工主页 URL、配置文件或飞书作者表作为日更入口；不承担 Signal Desk 所需的自动关注发现。 |
| 作品 | 旧隔离批量方案主动请求作者列表与逐作品详情，真实 T2 已出现重复分页、部分失败和安全验证。新隔离路径只看单作者主页自然响应，再核对一个作品页自然响应，已跑通 1 件。 | 在主页主动 GET `/aweme/v1/web/aweme/post`，`count=35`，按 `max_cursor/has_more` 翻页，页间约 800 ms；免费模式累计至少 20 件后停止后续页。结构化 `aweme_list` 可先提供作品元数据，无需预先下载视频。 | Chrome/CDP 读取主页可见 `/video/<aweme_id>`，通常取少量最新作品，再打开选中作品页读取元数据与媒体地址；默认下载视频，可选 Whisper 转写，“仅采集数据”模式不下载。 |
| 评论 | 目标是与作品同步分开的 `work.comments.sync`，按原生作品 ID 核对评论归属与分页；新低请求量试跑未请求评论。旧批量 T2 中评论与回复请求增加了请求量。 | 用户针对作品打开独立评论模块后，主动 GET `/aweme/v1/web/comment/list/`；一级评论 `count=20`，按 cursor 翻页，有回复的根评论可再请求回复；有重试、间隔、数量上限和本地缓存。静态审查尚未确认逐条对照响应评论 `aweme_id` 的严密程度。 | 主日更仅取页面可见评论片段并标记不完整；独立评论工具在登录页中可用 `window.byted_acrawler.frontierSign` 为评论/回复 GET 签名，默认只取少量一级评论页、默认关闭回复。 |
| 媒体与后处理 | 媒体、转写和 AI 应作为显式独立任务；目前隔离试跑均未执行。 | 导出时才取视频地址下载 MP4；转文字把视频 URL 发至 `ipforge.cn` 服务，再调用 ASR；AI 拆解把转写和作品统计发给其服务。服务端内部实现无法仅凭扩展代码确认。 | 默认日更下载视频，可选本地 Whisper 转写；仅数据模式可跳过下载和转写。 |

df 插件的审查仅针对本机解压代码 `D:\BaiduNetdiskDownload\对标拆解插件\dcxzs_extension_protected`，包含混淆脚本；**未运行该插件做真实吞吐或风控试验**，不能判定它批量处理必然稳定或不触发验证，也不能断言它完全不需要签名。`ai-boshu-crawler` 只读审查固定提交 `57ad263c0be8cf234bcadbc5c07dedc72304d182`，临时 checkout 为 `C:\Users\Administrator\AppData\Local\Temp\ai-boshu-review-57ad263`；该提交未发现许可证文件，只借鉴行为思路，不直接复制代码。

### 下一步需要延续的选择与工作

- 用户已要求先降低真实请求频次与数量、跑通最小链路；单作者单作品已达到。用户随后要求详细比较三方，正在综合考虑整改路线，**尚未最终选定**正式产品的作品/评论策略。三方审查提示可把“关注目录发现”“作者与作品元数据”“按需评论补全”“媒体及 AI 处理”拆为独立任务，但这仍是待选方案，不是已上线结果。
- 后续若继续实现，先定向核查现有改动和隔离代码，明确生产 `startSampleSync`、证明合同、v6 草案与低请求量路径的接线边界。以已保存作者可独立同步、关注刷新失败不抹掉旧作者成果、评论独立按需触发为重点，在临时库和离线测试验证身份、owner 隔离、迁移及状态语义。
- 任何新真实试跑先明确单轮作者/作品/请求上限和登录验证停止条件；此前已触发安全验证，不自行发起批量真实采集，不尝试绕过验证。根据准确报告逐步扩展范围；单作品 `verified` 不能替代独立 6 作品 T2、关注多页、评论归属、T3 吞吐和人工 shadow 验收。
- 正式迁移与能力门开启仍是独立上线步骤；必须在生产接线、隔离验收和正式库备份/迁移审计完成后，再提出具体、可审查的变更。当前不把 v6 草案或隔离报告写成正式库已升级。

## 原设计阶段记录（2026-09-24，保留历史判断）

以下段落记载最初只读审查时的状态。其中“本窗口”“下一窗口”均指 **2026-09-24 原交接时点**；与上面的最新状态冲突时，以上面的真实运行和代码状态为准。

## 用户已经确认的产品意图

1. 客户端点击同步后，应能自动定位当前用户主页与关注列表，自动发现关注博主；这解决首次建目录和以后新增关注的问题，不要求用户逐个手工添加。
2. 应保存经验证的作者导航信息。后续处理已有博主的作品、详情和评论，要从已保存的博主主页或 `sec_uid` 开始；不能每次都把“本人主页 → 关注列表”设为已有作者同步的前置步骤。
3. 关注关系刷新与已有作者作品同步可以同轮运行，但分开记状态。关注刷新失败不能抹掉已知作者的本次成果，也不能把未出现的作者判为取关。
4. 平台身份与分页协议先经真实验证，再制定证明规则；失败报告必须足以定位 endpoint、目标和分页阶段。不要凭截断错误码猜测修复。
5. 媒体、ASR/OCR、云核验独立控制。正式同步能力门当前仍关闭。

## 本窗口新产生的文档与自检

- 设计稿：[`docs/architecture/signal-desk-following-sync-route-redesign-2026-09-24.md`](../architecture/signal-desk-following-sync-route-redesign-2026-09-24.md)。含操作路径、三类任务、身份与分页执行、目录模型、失败报告、T2/T3 和上线门。
- 本交接：`docs/handoff/signal-desk-following-sync-redesign-handoff-2026-09-24.md`。
- 已逐条对照用户确认内容完成自检，详见下节。下一窗口如发现新的真实协议证据，可版本化更新设计；不能把当前设计稿当成平台已经验证通过的事实。

### 偏移自检结果

| 用户要求或历史错误 | 设计稿中的落点 | 检查结论 |
|---|---|---|
| 首次自动找到本人关注，不手工录博主 | §1 首次路径、§2 `following.refresh` | 覆盖 |
| 后续从已保存博主主页/`sec_uid` 直接同步 | §1 后续路径、§2 任务依赖、§3 浏览器执行 | 覆盖；关注刷新不再是已有作者任务的硬前置，`stale` 沿用上次可信关注关系 |
| 自动发现新增关注与谨慎处理取关 | §1 新增/取消关注、§4 两类提交边界 | 覆盖；已确认的新关注可先加入，只有完整可信关注快照可标取关 |
| `uid` 与 `sec_uid` 分开 | §3 身份核对、§4 作者目录 | 覆盖；需新 schema 与版本化证明 |
| 观察响应不等于执行采集 | §3 主动 GET、签名、多页退出 | 覆盖；要求真实协议验证 |
| 失败报告不能丢端点和分页信息 | §5 诊断字段与修复顺序 | 覆盖；禁止依截断码猜修复 |
| T2/T3、正式库和同步门状态不能虚报 | §6 验收顺序与上线门 | 覆盖；T2=0/6，T3 未跑，生产能力门关闭 |

## 已核实的项目现状

- [`src/main/taskRunner.ts`](../../src/main/taskRunner.ts) 的 `startSampleSync` 目前总是先排 `collection.following`；关注结果进入 `onEnvelope` 后才排作者作品任务。这个耦合需要改变。
- [`src/main/schema.ts`](../../src/main/schema.ts) 的 `creators` 只有 `platform_creator_id` 与 `profile_url`，没有独立 `sec_uid`；`owner_accounts` 也没有已验证的 owner `sec_uid`。历史数据升级需要审计与迁移设计，不能简单改一个字段含义。
- [`src/main/database.ts`](../../src/main/database.ts) 以 `(platform, platform_creator_id)` upsert 作者。当前入库会更新所见作者，却没有“完整快照成功后再标缺席作者取关”的事务边界。
- [`browser-connector/extension/background.js`](../../browser-connector/extension/background.js) 的生产路径仍按单任务打开页面并为作品详情逐页导航。新批量采集器 [`r8-batch-core.js`](../../browser-connector/extension/r8-batch-core.js) 只在隔离 PoC 中，不等于生产接线完成。
- [`production-envelope-bridge.js`](../../browser-connector/extension/production-envelope-bridge.js) 的作品 v2 证明仍混同 `uid` 与 `sec_uid`。关注 v3 的局部改动已在未提交工作区，但没有完成作品侧和生产任务链。
- [`src/shared/featureFlags.ts`](../../src/shared/featureFlags.ts) 为 `STRUCTURED_SYNC_AVAILABLE=false`。[`check-r8-prerequisites.mjs`](../../scripts/check-r8-prerequisites.mjs) 对已知生产缺陷故意失败关闭。
- 工作区有大量先前窗口留下的**未提交改动与未跟踪文件**，包括 R7 合同、桥接、隔离 T1/T2 和 migration 审计。新窗口开始先 `git status --short` 与定向 diff，保留现有内容；不要 reset、覆盖或把它们误当已合并基线。

## R8 真实证据，保持原样

1. 早期五次隔离 T1 均 `T1_BLOCKED`，不改写。
2. 新路线 T1 [`r8-batch-t1-20260924-184239-072-cf0c7a5b`](<C:/Users/Administrator/AppData/Local/Temp/signal-desk-r8/r8-batch-t1-20260924-184239-072-cf0c7a5b/acceptance-report.md>) 为 `T1_DISCOVERED`：同一浏览器会话内读到 following、creator-work-list、work-detail、comment-list；关注第二页通过 `offset` 试读取到。它只证明 endpoint/schema 和该次只读 GET，不能证明完整关注分页或六作品验收。
3. T2 [`r8-t2-20260924-190435-064-14487a7b`](<C:/Users/Administrator/AppData/Local/Temp/signal-desk-r8/r8-t2-20260924-190435-064-14487a7b/t2-report.json>) 为 `T2_BLOCKED`、`0/6`。报告只有截断的 `R8_BATCH_CURSOR_NOT_ADVANCING_`，无法从证据确定具体失败 endpoint。前一窗口曾猜测为关注 `offset`，这一结论没有证据，不能作为已诊断根因或要求用户再重装扩展的理由。
4. T3 未开始；没有真实 24/100 作品吞吐实测；shadow 人工对照未完成。正式 SQLite 未被这些 R8 run 写入，媒体、ASR/OCR、云未启动。

## 对 `ai-boshu-crawler` 的参考边界

只读审查固定提交 `57ad263c0be8cf234bcadbc5c07dedc72304d182`。对方抖音主流程从已知作者主页出发，用 Chrome CDP 获取主页最新作品卡片，按作品保存元数据与 manifest；独立评论工具复用已连接的 CDP 代理，在已登录页面内用 `frontierSign` 对评论/回复请求签名、按 cursor 翻页、去重并报告覆盖缺口。其主抖音日更流程的评论补全仍是页面可见片段，仓库自己声明不是稳定全量评论管线。因此可借鉴“复用授权会话、从已知作者直达、独立产物、诚实报告部分完成”，不能声称其已实现 Signal Desk 所需的自动关注发现或完整评论验收，也不能复制未评估许可的代码。

## 下一窗口建议的第一批工作

1. 先阅读本交接和设计稿，核对未提交工作区及两次 R8 报告。不要继续使用旧逐页 T1 或直接复跑 T2；先让失败报告能指出确切 endpoint 与分页输入/输出。
2. 画出现有 `startSampleSync → following → creator_works → comments` 的调度与持久化调用图，明确哪些代码和合同可以保留。以设计稿的三个独立任务为目标，先拟版本化 schema 与任务状态迁移方案。
3. 在临时测试库中验证 owner 隔离、旧作者目录升级、`uid != sec_uid`、刷新失败仍可同步已有作者、完整快照才标取关，以及新关注自动入队。不要提前动正式 `%APPDATA%\Signal Desk`。
4. 真实验证先确认签名和每个 endpoint 的多页推进协议；保留精确安全诊断，再完成独立的 6 作品 T2 与页面 shadow 对照。若仍失败，依据当次报告修改，不让用户为每个猜测重装扩展。
5. 只有新路线 T2/T3 通过后，才准备正式 migration 与生产切换的可审查结果，并沿用独立备份与批准边界。不要打开 `STRUCTURED_SYNC_AVAILABLE` 来绕过未完成门禁。

## 明确无需重复的工作

- 基线提交 `4069d02` 已推送 `origin/main`；正式 SQLite 已在完整备份后从 v4 迁至 v5。这些不是本优化窗口的待办。
- R7 离线合同与 fixture 已在工作区；这里不要求重做 R7。
- 之前的 R8 隔离 run 保留为证据，不需重新生成同样的失败 run。

## 设计到实施的边界

下一窗口以用户当时的指令为准实施已讨论的优化目标。本交接不把正式数据库迁移或生产开关切换视为已经完成的事；文档中的状态是截至本窗口的事实，任何后续通过结果都需来自新的独立 run。
