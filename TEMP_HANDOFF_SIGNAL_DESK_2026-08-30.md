# Signal Desk 临时交接文档

> 文档日期：2026-09-05（Asia/Shanghai）  
> 项目目录：`D:\AI_WorkSpace\SpatialWarehouse\AI_InformationWorkflowCreationCenter`  
> 当前开发交付版本：Signal Desk `0.1.11` / 浏览器连接器 `0.1.6`  
> 用途：记录 Signal Desk 当前真实状态、结构化采集架构决策与 `0.2` 高稳定性优化实施方案，供下一窗口从设计冻结点继续。

## 0.-9 2026-09-24 R8 T1 隔离真实发现

> 路线纠正：下列“第三次尚待开始”等文字为当时的历史快照。第三、四、五次 run 后来均已完成，五次 T1 全部为 `T1_BLOCKED`。第五次已观察到 following、works、detail、comment 四类目标响应，但逐页执行、uid/sec_uid 混同及全局 Observer issue 门暴露设计错误。旧 T1 启动脚本已停用，后续按 [`R8 采集路线纠正`](docs/architecture/r8-acquisition-route-correction-2026-09-24.md) 做离线重构，再以新独立 run 验证；不重复要求用户加载一批调试扩展。

- 用户已明确授权开始 R8。只在系统临时目录的独立 run 中做真实 endpoint/schema 发现；正式 SQLite、历史任务、生产同步能力门、媒体/ASR/OCR 与云调用均未触碰。
- 首次 run `r8-t1-20260924-154922-634-c815c794` 判定 `T1_BLOCKED`：仅观察到 works 列表，following/detail 缺失；旧页面触发器未打开关注关系弹窗。
- 第二次 run `r8-t1-20260924-160320-747-bf1e24fe` 判定 `T1_BLOCKED`：实际观察到 following、works、detail；评论正式路径 `SCHEMA_CHANGED`，`/aweme/v1/web/solution/resource/list/` 与 `/aweme/v1/web/im/spotlight/relation/` 被当前泛化 schema 误分类，所有 bridge preview 因 Observer issue 失败关闭。公开作品作者 ID 与观察的 creator ID 一致，但这不足以形成验收结果。
- 两次 run 均原样保留，controller 已一次性退出；无原始响应、完整 query URL、Cookie、Authorization、签名或 token 值落盘。
- 第三次独立 T1 run `r8-t1-20260924-161104-712-a5f90b00` 已准备。R8 专用 Observer 模式只允许评论固定字段类型/存在性提纲，不记录任何字段值或未知字段名；离线泄漏与前置门测试已通过。该 run 尚待用户在当前 Chrome 加载隔离扩展并点击开始。
- T1 仍阻断，T2-shadow 与 T3-acceptance 尚未开始。`STRUCTURED_SYNC_AVAILABLE=false`。

## 0.-8 2026-09-07 正式 migration、R7 与 Observer v2 bridge

本节覆盖下方仍写着“正式库未迁移”“R7 未授权”或“生产连接器尚未桥接”的历史状态。

- 基线提交 `4069d02` 已纯 Git 推送到 `origin/main`，没有为推送启动应用或迁移数据库。
- 正式 `%APPDATA%\Signal Desk` 已在独立授权下先完整备份，再从 `user_version=4` 迁移到 `5`。通过备份源/副本逐文件清单、迁移前只读检查、迁移后 `quick_check=ok`、外键违规 0，以及 27 张既有表按旧列投影的行数与内容 SHA-256 不变核验；没有恢复、调度或删除任务。
- 通过备份目录为 `%APPDATA%\Signal Desk Backups\pre-r6-migration-20260907-230817-256-8b451d34`：128 个文件、15,957,688 字节，组合 SHA-256 `379305BC0DF61159B173DC83E727822B4926CCDC63BA9AA7990B98F36F4FEFDB`。更早一次完整备份在只读 preflight 后因仅 `signal-desk.sqlite-shm` 变化而安全中止，migration 未开始；该备份同样保留。
- R7 离线合同工作包已完成：媒体、faster-whisper/whisper.cpp、PaddleOCR、evidence map、claim/evidence/verdict、外部调用授权和费用闸门 schema，配套合成 fixture、内存 benchmark 与 UI 状态。没有下载媒体、启动 ASR/OCR 或发起云调用。
- 生产连接器已实现 Network Observer 白名单投影到 v2 following/works/comments/replies business envelope 的离线桥接，并新增 `check:r8-prerequisites` 作为 `npm run check` 第一关。bridge 对 Observer issue、投影 hash、分页闭合、目标身份与作品独立详情观察失败关闭。
- 完整 `npm run check` 通过：R8 前置门 5 项、Vitest 17 个文件 / 199 项、Python worker 2 项、Network Observer 8 项、冻结 Phase B 15 项、Native Host/manifest、连接器 content/background、TypeScript 与 Electron 生产构建全部通过。
- `STRUCTURED_SYNC_AVAILABLE` 仍为 `false`；本轮没有启动 R8、真实页面验证或采集。R8/T1/T2/T3 仍须用户另行明确批准，且只能输出到新的隔离目录，不写正式 SQLite。

## 0.-7 2026-09-07 R0～R5 PASS 补录、R6 授权与项目边界纠正

本节是当前最高优先级事实，覆盖下文所有仍把“R0～R5 联合离线人工验收”写成待办、或把 R6 写成未授权/未开始的历史文字。

- 用户在 2026-09-07 明确纠正：R0～R5 联合离线人工验收此前已经签署整体 `PASS`，只是上一窗口没有把签署结果正确写入项目记录。该事实现正式补录，不得再次把 R0～R5 联合验收误列为未签署。
- 用户同日明确授权“进入 R6”。该授权严格限于 R6 的源码、合成 fixture、内存/临时测试数据库和模拟任务事件，不包含 R7、R8、真实平台采集、正式用户数据库运行、历史任务恢复、媒体、ASR/OCR 或云调用。
- R6 已实现 comments native-cid 无损 schema migration、root/parent/reply 字段、adapter version + scope fingerprint 活动任务去重、scope 隔离 checkpoint、按 job ID 精确恢复、逐 attempt command ID、旧响应拒绝和任务身份写前校验。
- R6 migration 回归显式覆盖历史任务 `#7/#8/#10/#11/#12/#13/#14/#16`，确认状态、payload、checkpoint 与消息保持不变；本轮没有打开正式 `%APPDATA%\Signal Desk\signal-desk.sqlite`，也没有恢复任何历史任务。
- R6 基线收口后的 `npm run check` 已整体通过：项目边界门禁通过，TypeScript 通过，Vitest 14 个文件 / 181 项通过，Python worker 2 项通过，Native Host 与 manifest 通过，连接器 content/background 通过，Network Observer 8 项通过，冻结 Phase B 15 项通过，Electron 生产构建通过。`npm run package` 及 packaged-renderer 冒烟通过，生产包中结构化同步 UI 与主进程均保持硬禁用；`npm audit --omit=dev --audit-level=high` 为 0 漏洞。
- 工作区中误入的 `WSL2 同 SHA 完整回归报告.md` 属于另一个项目，已原样迁移到项目目录之外的 `D:\AI_WorkSpace\SpatialWarehouse\ExcludedProjectArtifacts\WSL_ProjectHistoryManagement\`，移动前后 SHA-256 均为 `3DE618212DEB967628BE24FAFC712225BE8866DB88AF2A70FAEA2F66EDF08453`；原项目路径不再存在，隔离副本保留。
- 该外部报告及其来源仓库、分支、SHA、测试统计、handoff/Temporal/Agent Runtime 等信息均不是 Signal Desk 的需求、证据、状态或验收结果，明确禁止再次进入本仓库。`.gitignore` 已精确忽略该文件名，`npm run test:project-boundaries` 会扫描同名文件和外仓标识，`npm run check` 首步执行该门禁；若命中必须失败关闭，不能复制、改名或改写后重新引入。
- R7 尚未授权；生产连接器尚未把 Network Observer 安全投影组装成 v2 following/works/comments 业务 envelope；R8 真实验证仍须用户另行明确批准。

## 0. 2026-09-04 23:18 基线、2026-09-05 社区路线研究与结构化重设计最新状态（优先于后文全部历史状态）

本节是当前唯一有效的续接事实和下一阶段实施依据，优先于本文后续所有版本历史、旧测试顺序和旧开场提示。后文关于“`0.1.11` 尚未安装”“不得扩大到 `3/5/20`”“评论仍待第一次真实复验”等内容均只作为历史保留，不得据此重复执行旧操作。

### 0.-6 2026-09-06 R5 离线实施状态（本节最优先事实）

> 历史检查点：其中关于 R6 未实施和等待 R0～R5 联合验收的文字已由 0.-7 正式取代；不得再据此判断当前状态。

- 用户已查看 R0～R4 离线人工验收证据，并明确签署整体 `PASS`、授权开始 R5；该授权没有扩展为真实平台、正式数据库、R6 或 R8 授权。
- R5 已完成一级评论 `/aweme/v1/web/comment/list/` 与二级回复 `/aweme/v1/web/comment/list/reply/` 的离线结构化适配器：分别固定 NETWORK → EMBEDDED → INPAGE → TRIGGER → STOP，TRIGGER 只能接纳触发后由 Network Observer 观察到的 JSON，不能从 DOM 制造事实。
- 新增 `0.2.0-r5` comment proof/route registry；每项必须有原生 `cid`，`comments[].aweme_id` 必须独立等于目标作品，回复还必须与请求 `comment_id`、root/parent 关系一致。verified-empty 严格要求 `comments=[]`、`total=0`、`has_more=false`。
- 跨作品评论、错误 root/parent、重复 cid、cursor loop、空页继续、maxPages 未闭合、分页中途 schema change、评论关闭、未观察、401/403、429、非零平台状态和错误 path/参数/header 均有独立分类或终止测试；任一错误整批 comments/replies 为 0，不 fallback 掩盖终止错误。
- 新的数据库前门禁会在 `database.ingestEnvelope` 前重算白名单 projection hash，并绑定 proof、route trace、work、root/parent、returned IDs、item、时间与分页。旧 `douyin-comment-source-proof/v1` 和 DOM/page-attribute/synthetic comment ID 已退出正式门禁。
- 在当时的 R5 检查点，R6 尚未实施，正式 comments 表还不接受 `native-cid`；内存 TaskRunner 边界测试证明合法 R5 envelope 通过 preflight 后，会被 pre-R6 CHECK constraint 安全拒绝并整笔回滚，comments/checkpoint 均为 0。该状态已由 0.-7 记录的 R6 离线实现取代，但正式用户数据库至今没有运行迁移。
- 本轮只使用合成 fixture、模拟 route/CDP 和 `AppDatabase(':memory:')`；没有连接真实平台/浏览器、读取凭据、写正式数据库、恢复历史任务/run、运行旧路线、媒体、ASR/OCR 或云分析。生产连接器仍未生成 v2 following/works/comments envelope，本结果保持 E2-doc。
- 当时登记的下一检查点是 R0～R5 联合离线人工验收；用户现已在 0.-7 补录既有整体 `PASS` 并明确授权 R6，因此这条门禁已经满足，不再是当前待办。

### 0.-5 2026-09-06 下一窗口：R0～R4 离线人工验收检查点

- 下一窗口的首要且唯一任务不是直接实施 R5，而是按照 [`docs/architecture/signal-desk-r0-r4-offline-human-acceptance-handoff.md`](docs/architecture/signal-desk-r0-r4-offline-human-acceptance-handoff.md)，以固定实现基线 `8d9cc5e` 执行 R0～R4 离线人工验收检查点；其后的提交只允许包含本交接文档和索引入口，不允许有生产代码漂移。
- 验收只使用合成 fixture、模拟 route/CDP、内存 SQLite 和系统临时证据目录；不得连接真实平台或真实浏览器，不得读取凭据、写正式数据库、恢复历史任务/run、运行旧 `0.2.3/0.2.4`，也不得启动媒体、ASR/OCR、BYOK 或真实云分析。
- 执行代理必须逐项展示 R0 冻结、R1 独立证明、安全合同、R2 六类 Observer、R3 关注分页/空结果、R4 作品详情/statistics/整批归零、数据库无副作用和敏感 canary 清除证据；自动测试通过不能代替用户人工签署。
- 本检查点始终属于 `E2-doc`，不是 E3/E4。发现失败只记录并阻断，不得在验收任务中擅自修复或继续实施 R5。
- 只有用户在查看证据后明确给出整体 `PASS` 并授权 R5，才可按已认可的一级评论/回复结构化适配器方案开始 R5；R5 完成后仍需再做 R0～R5 联合离线验收。

### 0.-4 2026-09-06 R0～R4 离线实施状态（本节最优先事实）

- 已恢复本地版本控制基线：仓库在修改前建立 `main` 根提交 `3465208`；依赖、构建物、安装包、数据库和运行时输出均按忽略规则排除。
- R0 已完成：`0.2.3` 固定为 `AUTHOR_PROOF_CIRCULAR` 失败，`0.2.4` 控制器在创建运行目录前硬拒绝，旧扩展的自动/手动启动入口同样硬拒绝。`poc/phase-b/FROZEN_RUNS.json` 固化三个历史 run 的失败分类与关键文件 SHA-256；原始 run 未删除、未覆盖、未重跑，也未作为测试输入。
- R1 已完成：实现 `douyin-work-author-proof/v2`、四 ID 一致、独立结构化 observation 对照、原生 `aweme_id/cid` 门禁、schema fingerprint、白名单 projection SHA-256、六条 route registry、非敏感 trace 以及 GET/path/参数/header/持久化字段安全负例。正式作品任务现在会在数据库写入前拒绝缺少作者证明的旧 DOM-only 结果。
- R2 已完成：新增可单测的六类 Network Observer（关注、账号作品、详情、一级评论、回复、媒体），正式连接器执行顺序改为 attach → `Network.enable` → 导航/触发；仅对允许 host 的 GET Fetch/XHR 成功 JSON 读取受限 body，随后 path + schema 双分类、白名单投影、哈希并释放原文；结束时 detach 并清空内存。
- R3 已完成（仅合成 fixture）：新增关注列表结构化适配器，固定按 `DY-FOLLOW-NETWORK → DY-FOLLOW-EMBEDDED → DY-FOLLOW-INPAGE → DY-FOLLOW-STOP` 切换；多页闭合、verified-empty、cursor loop、重复 creator ID、401/403、429、schema change、未观察 endpoint 和安全负例均有测试。新增 `douyin-following-structured-proof/v2`，正式 following 门禁会在任何数据库写入前拒绝旧 DOM v1；所有结构化路线失败时 creator 始终为 0。
- R4 已完成（仅合成 fixture、模拟 route 和内存数据库）：新增 `/aweme/post/` 作品列表与 `/aweme/detail/` 详情适配器，固定 NETWORK → EMBEDDED → INPAGE → STOP；每个列表作品都必须经过独立详情请求目标、返回 `aweme_id` 和详情作者复核，形成 page-level proof → 列表 observation → `WorkAuthorProof/v2` → 详情 proof/observation → `WorkDetailVerification/v1`。statistics 只保留点赞、评论、收藏、分享、播放五项非负整数或 `null`，列表/详情快照与差异字段分开保存；任一详情、作者、目标 ID、分页或安全校验失败时整批候选为 0，桌面端门禁在任何作品侧数据库写入前拒绝缺证据结果。
- 本批次测试只使用仓库内合成 fixture、模拟 CDP 和测试临时目录；没有连接真实平台、没有读取浏览器凭据、没有写正式 SQLite、没有恢复历史任务，也没有启动媒体/ASR/OCR/BYOK/云分析。
- 下一实施点是 R5。`0.2.3/0.2.4` 已永久退役并保持硬禁用；R3/R4 的合成成功不代表 E3/E4 验收，生产连接器尚未发出 v2 following/works envelope，不得启动真实 `R8/T1/T2/T3`。

### 0.-2 2026-09-05 社区路线研究与结构化重设计（本节最优先事实）

- 用户人工观察否决了 `0.2.3` 的作品归属证明：博主主页通常约一秒或更短即关闭，且多个最终作品实际属于未关注账号。代码与 run 证据确认，12 个主页全部使用 `inferred:common-work-ancestor-div`；程序从主页容器取到作品链接后把当前目标博主 ID 直接写入 `creatorId`，后续又校验这个自填值，没有从作品列表或详情的结构化 `author.uid/sec_uid` 独立验证真实作者。这是循环证明。因此历史 60 位关注博主的 DOM 关系列表仍可作诊断证据，但 96 个候选与 12 位博主的绑定未被证明，24 个样本不得再称为“全部来自关注账号”。
- `0.2.4` 只修复评论 endpoint 观测和汇总，不修复作品作者归属链，故不再运行。阶段 B 控制器已经停止，`127.0.0.1:43827` 当前没有监听者；`poc/phase-b/runs/` 仍只有三个历史 run，没有 `0.2.4` 新 run。历史 run 只读保留为失败证据，不删除、不覆盖。
- 已完成 Signal Desk 对应能力的社区源码与官方技术路线研究，覆盖关注列表、账号作品、详情、点赞/评论/收藏/分享数、一级评论、二级回复、浏览器 Network 捕获、媒体、ASR、OCR、内容总结和网友发言事实核验。研究证据库为 `docs/research/signal-desk-community-validated-routes-2026-09-05.md`；固定提交、许可证、关键源码、可借鉴与禁止照搬项均已记录。
- 已形成新的可执行优化方案 `docs/architecture/signal-desk-structured-acquisition-optimization-plan.md`。新原则固定为 `Network-first → embedded structured state → controlled page-context read-only request → DOM navigation/shadow only → no structured proof means reject`。每项能力都有预登记 route、替代路线、切换条件、重试上限、来源证明和验收门禁，不允许失败后临时把 DOM 升格为事实源。
- 新的作品接纳门禁要求 `followedCreatorId = profileRouteCreatorId = requestTargetCreatorId = observedWorkAuthorId`；最后一个值必须直接来自结构化作品/详情响应，禁止从任务目标回填。评论必须有原生 `cid` 并独立验证 `aweme_id`；`synthetic-content-hash` 仅作历史兼容，不能用于新采集。
- 社区项目的公开源码或文档只记为候选路线证据，不等于 Signal Desk 已在当前账号/当前平台通过。新的等级为 `E1-source / E2-doc / E3-local-poc / E4-product`；只有隔离 PoC、20～30 个自动样本和人工抽检全部通过才能达到产品级，任何作者错配、跨作品评论、敏感值泄漏或写请求都会令整批失败。
- 本轮只新增两份 Markdown 文档并更新本节；没有连接抖音、没有开始新采集、没有读取或写入正式 SQLite、没有改生产连接器代码、没有恢复历史任务，也没有备份、清理、重置、媒体处理、ASR/OCR、BYOK 或云分析。
- 历史上此处把 `R0～R2` 记为下一步；它们及 R3/R4 现已按 0.-4 完成离线实现，R5 状态见 0.-6。0.-7 已补录 R0～R5 联合验收 `PASS` 和 R6 授权/实现；当前仍需另行确认的是 R7 与真实 `R8/T1/T2/T3`。

### 0.-1 2026-09-05 阶段 B 自动抽样最新状态（优先于本节后续旧授权描述）

- 用户已经明确授权开启阶段 B，并明确允许直接进入本人真实抖音关注关系，从中随机选择 20～30 个公开作品；这项新授权取代 0.0 中“阶段 B 尚未授权”的旧状态。
- 用户不接受手工整理、复制或粘贴作品 URL。阶段 B 的产品要求是：自动打开本人主页、通过唯一语义入口打开真实关注关系弹窗、验证活动“关注（数字）”页签、唯一 `data-e2e="user-fans-container"` 和逐记录“已关注/相互关注”，再从被验证关注博主的公开主页作品区自动发现、随机/分层抽样并固化清单。
- 冻结前 `poc/phase-b/` 曾取消手工 URL 与手工 session token 输入，`0.2.4` 曾设计为与回环控制器自动配对；该行为现已由 R0 启动门禁彻底禁用。第一次真实自动发现曾安全停在“普通语义点击后未出现关注关系弹窗”；`0.2.2` 用前台本人主页和聚焦后无坐标 Enter 越过该点，但第二次真实发现因旧实现只接受 `main/[role=main]` 而形成 0 个作品候选，安全返回 `INSUFFICIENT_ELIGIBLE_SAMPLES`。两次均未接纳最终样本或开始评论。`0.2.3` 后来改为优先验证活动作品页签控制的 panel，再在唯一结构化作品列表/共同作品祖先中抽取，但其作者证明最终被否决。
- `0.2.3` 第三次真实运行 `phase-b-20260905T144519Z` 已完成自动关注、作品发现与固化抽样：验证 60 位关注博主，检查并接纳 12 个博主主页，形成 96 个候选，最终 24 个样本覆盖 12 位博主（23 video / 1 image，单博主最多 3 个）。24/24 报告均完成且未提前停止；但 Network 为 0 success / 24 not-observed，页面 API 为 0 success / 24 not-ready，全部记录 `PAGE_CONTEXT_NOT_READY`，所以评论结构化主通道真实 PoC 未通过。DOM shadow 实际为 16 success / 5 empty-unverified / 3 error；旧 summary 漏计 3 个 error，不能按其表面 21 个状态解读。3 个 error 是等待期间页面路由漂移导致 `WORK_DELETED:作品路由不匹配`；其余 21 个未观察到允许的评论请求模板。
- `0.2.4` 修复 summary 对 DOM error 的遗漏，DOM 路由漂移会追加结构化 issue 并将样本标为 ineligible；同时新增 query-free endpoint probe，只记录 `*.douyin.com` 的公开 host、去标识化 pathname、Fetch/XHR 类型、HTTP 状态和计数，明确不记录查询参数、请求头、Cookie、签名值或响应秘密。已同时兼容评论端点有无尾部 `/` 的形式。下一次真实运行用于确认实际评论结构化端点或资源路径，不得把 `0.2.3` 的 DOM 结果误报为阶段 B 通过。
- 自动发现采用每次 256 位随机种子和 `seeded-random-creator-round-robin/v1` 策略：随机打乱关注博主与其候选作品，优先跨博主抽取，单博主最多 3 个；候选允许时同时覆盖视频和图文。控制器先以 `/v1/discovery-start` 固化目标数、种子/hash 与硬上限，后以 `/v1/start` 验证关注来源证明、博主/作品绑定和确定性最终顺序。
- 关注候选上限为 60 位，单博主候选公开作品上限为 8 个。若严格验证范围不足以形成目标样本，返回 `INSUFFICIENT_ELIGIBLE_SAMPLES`；不得放宽到粉丝、推荐、侧栏、搜索结果或未知博主。
- 阶段 B 保持完全隔离：不调用正式 Native Messaging，不写正式 SQLite 或任务队列，不恢复、重试、删除或清理 `#7、#8、#10、#11、#12、#13、#14、#16`，不启动媒体、ASR、OCR、BYOK 或云分析，不读取/保存 Cookie、Authorization、签名值或完整请求模板。
- `npm run check` 已通过：原 7 个 Vitest 文件/54 项测试、2 个 Python 测试、Native Host、正式连接器测试、阶段 B 14 项测试和生产构建全部成功。阶段 B 的真实 20～30 样本尚未运行完成；不能把本地测试误报为真实平台 PoC 通过。
- Chrome 的安全模型仍可能要求用户在 `chrome://extensions` 对带 `debugger` 权限的独立未打包扩展完成一次“加载/重新加载”确认。除此之外，用户不需要手工找链接、逐个打开作品、打开关注列表、粘贴 token 或点击开始。

### 0.0 2026-09-05 阶段 A 完成状态（本节最新增量事实）

- 用户已于 2026-09-05 发出“按照我们之前讨论好的优化方案执行”的明确指令；结合上一轮要求“等待决定是否开始执行阶段 A”，本轮授权范围严格解释为阶段 A，不包含阶段 B 的真实平台 PoC。
- 阶段 A 已完成：新增 `PlatformAdapter`、统一分页结果、强校验的 `verified-empty`、四类版本化来源证明、结构化错误策略、适配器版本、采集范围合同与 `scope-v1:<sha256>` 范围指纹。
- 安全基建已完成：页面上下文显式请求头和持久化响应头采用 deny-by-default 白名单；请求参数按 endpoint 二次白名单；日志对 Cookie、Authorization、Bearer Token、API Key、Token、`X-Bogus`、签名输入、设备标识、URL 凭据和未知 URL 参数递归脱敏。
- 新合同和安全实现位于 `src/shared/platformAdapter.ts` 与 `src/main/platformAdapterSecurity.ts`；设计冻结文档位于 `docs/architecture/platform-adapter-phase-a.md`；纯合成 fixture 位于 `src/shared/fixtures/douyin-comment-page.mock.json`。
- `src/shared/platformAdapter.test.ts` 新增 11 项阶段 A 测试，覆盖 mock 评论适配器、分页、严格空结果、四类来源证明、错误策略、范围指纹、请求参数/头白名单、日志脱敏和 canonical JSON SHA-256。
- 完整 `npm run check` 已通过：TypeScript、7 个 Vitest 文件/54 项测试、2 个 Python 工作器测试、Native Host、固定部署清单、浏览器内容脚本、浏览器后台脚本和生产构建全部成功。
- 已新增 `THIRD_PARTY_NOTICES.md` 初始依赖审计清单。当前实际打包的 `@ffmpeg-installer/win32-x64` 与 `@ffprobe-installer/win32-x64` 二进制子包元数据分别声明 GPLv3/GPL-3.0；0.2 正式分发前必须核对精确构建、许可证正文、对应源码/再分发义务，不能只依据外层包装器的 LGPL-2.1 声明。
- 阶段 A 没有连接浏览器或真实平台，没有读取真实网络响应，没有修改现有生产采集器、浏览器连接器源码、数据库 schema、正式数据库或用户数据目录，没有恢复/重试/删除/清理任何任务或业务数据，也没有启动媒体、ASR、OCR、云分析或 API Key 调用。
- `npm run check` 按项目既有流程重新生成了工作区内的 `out` 构建输出和 Native Host 构建二进制；这不是安装、部署、正式数据变更或外部状态变更。
- 阶段 B 尚未授权。下一步只能审查/调整阶段 A；如需进入阶段 B，必须由用户单独批准真实访问、20～30 个代表性公开样本范围和隔离输出目录，且仍不得恢复现有 8 个阻断任务或写正式数据库。

### 0.1 当前运行、数据与任务事实

- 当前已经安装并运行 Signal Desk `0.1.11`，浏览器连接器为 `0.1.6`，固定扩展 ID 为 `fejndacdabkgahmfpfjaghhedbdehonh`；Signal Desk 与 Chrome 当前在线。
- 用户已经明确授权并完成一次页面资料限定的 `3/5/20` 采集：`creatorLimit=3 / worksPerCreator=5 / commentsPerWork=20 / collectionOnly=true`。该次授权已经消费完毕，不代表下一窗口可以再次执行采集。
- 新根任务为 `#4 collection.following`。本次结果为 3 位关注博主、共 11 个作品、共 16 条评论：在原有 1 位博主、1 个作品、1 条已验证评论基础上，新增加 2 位博主、10 个作品、15 条评论。
- 新增评论全部为 `source_verified=1`，来源证明契约仍为 `douyin-comment-source-proof/v1`。成功的两个新评论任务为：`#9` 获取 6 条评论，`#15` 获取 9 条评论。
- 8 个评论任务停在 `blocked_user_action`：`#7、#8、#10、#11、#12、#13、#14、#16`。统一错误是：`评论列表中尚未显示可验证的真实评论，请确认评论已加载后重试`。
- 用户已经明确表示这 8 个具体视频本身不重要，重要的是失败机制和最终版稳定性。不要恢复、重试、删除或清理这 8 个任务，除非用户以后再次明确授权。
- 本次只执行了页面资料采集，没有启动媒体下载、ASR、OCR、文本云分析、视觉分析或其他 BYOK 调用。
- 不要因为当前有 8 个 `blocked_user_action` 而点击全局“恢复”；现有实现会一次恢复所有阻断、暂停和可重试任务。
- 不要清理现有评论、任务或业务数据，不要重置任务，不要重复备份，不要重新执行 `3/5/20`。阶段 A 已按 0.0 的后续明确授权完成，但不得因此自动进入阶段 B。

### 0.2 八个评论任务被阻断的精确结论

当前评论采集不是屏幕坐标连点器，但它仍是依赖最终展示层的 DOM 采集，流程为：

```text
后台 active:false 打开作品标签页
        ↓
等待 Chrome tab.status = complete
        ↓
固定等待 1.5 秒
        ↓
立即扫描页面 DOM
        ↓
唯一合法 comment-list 已存在
        ↓
其中可见 data-e2e="comment-item" 数量为 0
        ↓
直接标记 blocked_user_action
```

已经排除的原因：

- 不是作品路由错误。
- 不是评论根容器不存在或重复；合法根容器已经找到。
- 不是关注来源证明、作品归属证明或评论作者/正文结构校验失败。
- 不是桌面端拒绝评论来源证明。
- 不是浏览器连接器离线。
- 10 个新作品均为 `video`，不是图集类型分支造成的统一失败。

直接代码原因是扫描发生时评论根容器中没有已渲染、可见的精确评论项。`tab.status=complete` 只表示文档加载完成，不代表抖音前端已经完成登录态恢复、评论接口、懒加载、评论面板初始化或 DOM 渲染；后台标签页还可能受到浏览器节流。2 个成功、8 个失败高度符合异步时序竞争和未触发懒加载。

但是当前数据没有保存评论接口响应、公开评论总数或明确空状态，因此不能继续区分这 8 个任务分别是：

- 视频确实为 0 评论；
- 评论异步加载超过 1.5 秒；
- 后台标签页没有触发评论加载；
- 评论面板没有展开或未进入可视区；
- DOM 发生平台变体；
- 当前登录态对评论不可见。

“无法区分真实空评论与尚未加载”本身就是当前采集架构缺陷。最终版不能只把固定等待从 1.5 秒调长；DOM 读取必须降级为后备来源。

关键源码位置：

- `browser-connector/extension/background.js:105-150`：复用/创建后台标签页、等待 `complete`、固定等待 1.5 秒。
- `browser-connector/extension/content.js:467-475`：唯一评论根容器验证。
- `browser-connector/extension/content.js:505-510`：只读取已经渲染且可见的精确评论节点。
- `browser-connector/extension/content.js:571-584`：零评论节点时抛出当前统一错误。
- `src/main/taskRunner.ts:33`：任一 `blocked_user_action` 会阻止未来新同步。
- `src/main/taskRunner.ts:145`：旧 completed 博主作品任务会阻止扩大范围后的增量采集。
- `src/main/database.ts:488-489`：全局恢复会同时恢复全部阻断、暂停和可重试任务。

### 0.3 用户已经确认的安全与产品边界

用户于 2026-09-04 明确允许未来的 Signal Desk 高稳定性适配器：

- 在用户已经登录的抖音页面上下文中调用只读结构化作品/评论接口。
- 使用 `fetch(..., credentials: "include")`，由浏览器自动携带当前登录会话。
- 使用页面自身提供的签名能力，例如 `window.byted_acrawler.frontierSign(...)` 和返回的 `X-Bogus`。
- 从浏览器已有网络资源、Performance Resource Timing 或 CDP/扩展网络观察中取得请求模板和真实媒体资源。

同时继续严格禁止：

- 导出、打印、持久化或上传 Cookie 明文。
- 导出密码、Bearer Token、签名请求头或完整浏览器配置。
- 点赞、评论、关注、取消关注、私信、发布或任何其他写操作。
- 自动规避 CAPTCHA、安全验证、登录要求或平台风控。
- 默认使用 `yt-dlp --cookies-from-browser`。该能力暂不启用，未来如确实需要必须再次单独说明并取得授权。
- 未经许可证允许直接复制社区项目源码。

这是对原“只读展示层 DOM、不主动调用内部签名接口”边界的明确升级。它不允许写操作或 Cookie 落盘，但允许浏览器在页面上下文中用现有登录会话访问只读内部接口。下一窗口不需要再次询问这一项授权，但任何继续扩大的权限仍需另行确认。

### 0.4 社区项目源码审计结论

只读审计使用以下固定提交；临时仓库位于 `C:\Users\Administrator\AppData\Local\Temp\signaldesk-community-audit-20260904`，只作为审计证据，不要复制进正式工作区：

- `atian-create/xhs-profile-breakdown-skill`：`bde75b258c55cc06f935faa43d0bb5006ba06a2f`
- `dragon-hh/ai-boshu-crawler`：`57ad263c0be8cf234bcadbc5c07dedc72304d182`
- `YT-smart/video-parse-transcribe`：`35085f088eed89365ab68cb8cfe01aea02f525ce`
- `duyi2076/duyi-douyin-video-breakdown`：`fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba`

结论：

| 项目 | 实际机制 | 对 Signal Desk 的价值 | 边界/许可证 |
|---|---|---|---|
| `xhs-profile-breakdown-skill` | 只分析用户提供的主页截图、昵称、简介、封面和前 9 条标题；明确声明不做 scraping/data collection | 可参考分析提示词，不能证明批量采集能力 | MIT |
| `video-parse-transcribe` | 单分享链接页面结构化 JSON 解析、媒体下载、FFmpeg 和 Whisper；抖音读取 `_ROUTER_DATA`，小红书读取 `__INITIAL_STATE__` | 可参考单链接作品元数据、媒体解析和转写 | 仓库根目录无许可证；上游 `parse-video-py` 被 GitHub 识别为 MIT，但 vendored 代码的确切来源与许可声明仍需核对 |
| `duyi-douyin-video-breakdown` | 评论仍使用 `[data-e2e=comment-item]`、`.route-scroll-container` 和 `innerText`；媒体使用 `currentSrc`、Performance 资源、作品详情接口、`yt-dlp` 和 FFmpeg | 媒体探测、DASH 合并、证据目录和阶段复用值得参考；评论主通道仍不够稳 | CC BY-NC 4.0，不能直接用于商业用途 |
| `ai-boshu-crawler` | 在已登录 Chrome/CDP 页面上下文调用 `/aweme/v1/web/comment/list/` 和 `/comment/list/reply/`，使用页面签名、cursor/has_more 分页、原生 cid 去重、JSON/JSONL/manifest | 结构化评论 API、浏览器会话、签名、分页、错误分类、断点和媒体获取是主要架构参考 | 根目录没有公开 LICENSE，不能复制代码；只能学习行为并洁净重写 |

未在上述仓库中发现可以核验的“千条/几千条视频近零错误”公开基准报告，也没有发现针对抖音评论路径的千条级自动化验收。不能把社区口碑当成 Signal Desk 已达到的 SLA；但结构化接口路线在工程上明确优于当前 DOM 评论路线。

### 0.5 本机 `yt-dlp` 核验结果与定位

本机可执行文件：

```text
D:\yt_dlp\yt-dlp.exe
```

- 版本：`2026.07.04`
- 大小：`18,226,085` 字节
- SHA-256：`52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8`
- 当前不在 PowerShell `PATH` 中；正式实现应使用可配置绝对路径或受控自动发现，不能假定命令名可直接运行。
- 内置 extractor 已确认包括 Douyin、XiaoHongShu、Bilibili、TikTok、YouTube。
- 支持 `--cookies`、`--cookies-from-browser` 和客户端 impersonation，但浏览器 Cookie 读取暂未授权启用。

`yt-dlp` 的职责应限定为媒体/字幕解析和下载，不能替代关注关系、作品列表、评论分页和 Signal Desk 任务系统。对抖音更可靠的媒体路径通常是先由已登录 Chrome 提供真实或预签名 CDN URL，再交给 `yt-dlp` 下载，而不是把普通作品 URL 直接交给 extractor 后假定必然成功。

### 0.6 `0.2` 目标架构

保留 Signal Desk 上层架构，重写平台事实获取层：

```text
Chrome / Edge 已登录会话
        ↓
Session Broker / Page Context Executor / Network Observer
        ↓
平台适配器层
├── FollowingAdapter
├── CreatorWorksAdapter
├── WorkDetailAdapter
├── CommentAdapter
└── MediaResolver
        ↓
标准化、schema 校验、来源证明、响应哈希
        ↓
SQLite + 任务队列 + 游标检查点 + 指标快照
        ↓
媒体：yt-dlp / FFmpeg
        ↓
内容：字幕 / ASR / OCR / 视觉 / 文本分析
```

继续保留：

- Electron 本地桌面应用与 SQLite 数据仓库。
- 持久化任务、断点、采集范围硬上限和本地优先原则。
- 严格来源证明和桌面端二次校验。
- 不可见公开指标保持 `NULL`，不伪造为 0。
- 评论、作品和指标快照幂等入库。
- 本地 ASR/OCR、BYOK 文本/视觉分析与费用闸门。
- 媒体临时文件生命周期和审计事件。

需要替换：

- DOM 评论节点不再是评论主来源。
- 固定等待不再作为结构化数据就绪判据。
- 单条任务失败不再锁死整个采集系统。
- 全局恢复改为精确任务恢复。
- completed 任务去重必须纳入采集范围和适配器版本，支持增量扩大。

### 0.7 数据源优先级

每个平台适配器统一遵循：

1. 正式开放 API：仅在平台确实提供所需能力且账号有权限时优先。
2. 浏览器已经收到的结构化网络响应。
3. 在已登录页面上下文调用只读内部接口。
4. 页面内嵌结构化 JSON，例如 `_ROUTER_DATA`、`__INITIAL_STATE__`。
5. 精确 DOM 结构化读取作为后备。
6. 真正需要用户处理的登录、验证码或安全验证才进入人工阻断。

不要把“直接爬取”实现为桌面 Node/Python 进程脱离浏览器、伪造整套签名和 Cookie 的裸 HTTP 请求。更稳且更符合已授权边界的实现是“浏览器承载真实会话和签名环境，Signal Desk 在页面上下文读取结构化数据”。

### 0.8 抖音评论适配器主流程

目标流程：

```text
取得目标 aweme_id 和规范作品 URL
        ↓
复用或打开已登录抖音作品页
        ↓
验证当前页面作品 ID、登录提示、验证码/安全验证
        ↓
优先从 Network/Performance 找到页面已发出的 comment/list 请求模板
        ↓
删除旧 cursor、count、X-Bogus 等一次性参数
        ↓
按目标 cursor/count 重建 URL
        ↓
在页面 MAIN world 调用 frontierSign 并添加 X-Bogus
        ↓
fetch(url, { credentials: "include" })
        ↓
校验 HTTP、JSON、status_code、aweme_id、schema
        ↓
解析 comments / cid / user / text / digg_count / create_time / ip_label / reply_comment_total
        ↓
按 cid 去重，保存 cursor、has_more、total
        ↓
达到 commentsPerWork、has_more=false 或明确空结果时结束
```

必要实现规则：

- 浏览器扩展 content script 的 isolated world 通常不能直接访问页面 `window` 上的签名对象；需要使用 `chrome.scripting.executeScript({ world: "MAIN" })` 或等价的受控页面主世界执行方式。
- 只向桌面端返回经过白名单过滤的业务字段、证明和必要诊断，不返回 Cookie、Authorization、完整请求头或浏览器秘密。
- 主评论接口：`/aweme/v1/web/comment/list/`。
- 回复接口：`/aweme/v1/web/comment/list/reply/`。V0.2 可先完成根评论 20 条，再把回复作为独立可选阶段；回复失败不得推翻已经成功的根评论。
- 使用平台原生 `cid` 作为 `platform_comment_id`；只有明确的平台字段缺失降级场景才允许合成 ID，并必须标记 `platform_comment_id_kind`，不能混为原生 ID。
- 记录每页 `cursor`、`has_more`、`total`、返回条数、重复跳过数和接口状态。
- 如果接口成功返回 `comments=[]` 且 `has_more=false`，并有可接受的 `total=0` 或一致空状态，记录为已验证空评论，而不是 `blocked_user_action`。
- 如果接口显示还有更多数据但当前页为空，视为协议异常或可重试错误，不能误判完成。
- 如果根评论成功而某些回复页失败，记录 `partial` 和回复错误，保留根评论。
- DOM 评论读取保留为诊断/后备适配器，不能静默覆盖结构化 API 结果；两者冲突时记录差异并进入证据审查。

### 0.9 关注关系、博主作品和作品详情

关注关系：

- 继续把用户从本人主页打开的真实“关注”关系弹窗作为身份与范围起点，保留现有严格来源证明。
- 优先捕获弹窗滚动触发的结构化关系列表响应，以平台用户 ID/sec_uid 作为实体标识。
- DOM 只用于证明当前确实处于本人主页的关注关系界面，以及在结构化响应不可用时做受限后备。
- 推荐区、侧栏、搜索结果或任意 `/user/` 链接永远不能自动标记为 `isFollowing=true`。

博主作品：

- 优先捕获主页作品列表的结构化响应或页面状态 JSON，获取 aweme ID、作品类型、发布时间、描述、封面和公开指标。
- DOM 链接发现可作为增量后备，但必须与当前 creator ID/sec_uid 绑定校验。
- 视频、图集、置顶作品和重复卡片都应通过原生作品 ID 归一化。
- 旧 completed 任务不能永久阻止更大范围；任务唯一性应包含范围指纹与适配器版本。

作品详情：

- 结构化详情优先，补齐当前标题、描述、发布时间和指标缺失问题。
- 保存字段级来源：网络接口、页面内嵌 JSON、DOM 后备或媒体解析器。
- 同一字段多来源冲突时不静默覆盖，按来源优先级选择并写审计事件。

### 0.10 媒体解析、下载与内容理解

媒体适配器建议顺序：

```text
平台结构化作品详情 / yt-dlp extractor
        ↓
video.currentSrc / source.src
        ↓
Performance Resource Timing / Network.responseReceived
        ↓
页面上下文重新请求作品详情
        ↓
选择真实或预签名 CDN URL
        ↓
yt-dlp 或受控 HTTP 下载
        ↓
DASH 分离时分别下载视频/音频并用 FFmpeg 合并
```

平台建议：

- YouTube、Bilibili：优先使用 `yt-dlp` extractor，并保留平台特定适配器后备。
- 抖音：优先从已登录 Chrome 获取 `currentSrc`、媒体网络资源或结构化详情中的真实播放地址，再交给 `yt-dlp`/下载器。
- 小红书：优先使用带有效页面上下文和 `xsec_token` 的结构化详情，再进入媒体下载层。
- `blob:` 不是可下载地址；遇到 `blob:` 时从 Performance/CDP 查找背后的 `media-video` / `media-audio` CDN 请求。
- 不启用 DRM 绕过，不自动规避验证码或地区/权限限制。

内容理解继续与采集解耦：

1. 优先使用平台字幕或 `yt-dlp` 可用字幕。
2. 无字幕时 FFmpeg 提取音轨。
3. 本地 Whisper ASR。
4. 按场景抽取代表关键帧并 OCR。
5. 视觉模型只接收用户确认批次中的压缩代表帧。
6. 文本模型基于结构化元数据、评论、字幕、ASR、OCR 和证据生成总结。

媒体、ASR、OCR 或云模型失败不能回滚已经成功入库的作品和评论；评论失败也不能阻止媒体阶段未来独立重试。

### 0.11 来源证明与数据契约升级

建议新增版本化证明，而不是删除现有 `douyin-comment-source-proof/v1`：

- `douyin-comment-api-proof/v1`
- `douyin-work-api-proof/v1`
- `douyin-following-api-proof/v1`
- `media-resource-proof/v1`

评论 API 证明至少包含：

- `platform`
- `adapterName`
- `adapterVersion`
- `schemaVersion`
- `pageKind`
- `sourceKind`：`network-response` / `page-context-fetch` / `embedded-json` / `dom-fallback`
- `workId/awemeId`
- `endpointKind`，不要保存含敏感参数的完整 URL
- `requestParameterNames`，只保存白名单参数名和非敏感业务值
- `cursorIn/cursorOut`
- `hasMore`
- `reportedTotal`
- `returnedIds`
- `responseBodySha256`
- `collectedAt`
- `browserOrigin`
- `sessionUsed=true`，但不得包含 Cookie 值
- `signatureProvider=page-frontierSign`，但不得保存签名输入中的秘密或完整敏感头
- `validationResults`

建议保留受限原始响应证据，但必须先设计：

- 仅保存与业务字段有关的结构化响应正文或经过白名单裁剪的 canonical JSON。
- 对响应做 SHA-256，保证入库记录可以追溯。
- 不保存响应头中的 `set-cookie`、Authorization 或设备秘密。
- 设置保留期限和用户可见的清理策略。
- schema 漂移时保存最小脱敏诊断样本，不能把未知字段全部上传或写日志。

### 0.12 任务状态模型、隔离与增量规则

建议将当前过度宽泛的状态拆分为：

- `queued`
- `running`
- `retry_wait`
- `completed`
- `completed_empty_verified`
- `partial`
- `blocked_login_required`
- `blocked_challenge`
- `inaccessible_private`
- `inaccessible_deleted`
- `schema_changed`
- `failed_terminal`
- `cancelled`

如果暂不迁移数据库枚举，也应至少增加结构化 `error_code` / `terminal_reason`，不要继续只靠中文 `status_message` 判断。

调度规则：

- 单个作品失败只影响该作品，不得阻止其他已排队作品或未来新批次。
- 只有确认是全局登录失效、全局 CAPTCHA、安全验证或平台级频控时才触发批次熔断。
- 超时、临时网络错误和页面签名尚未就绪进入自动重试，不进入人工阻断。
- 支持“恢复此任务”“恢复此批次”“恢复同类错误”，不再只有全局恢复。
- 重试使用有上限的指数退避和随机 jitter；平台级全局速率限制优先于单任务并发。
- 评论任务每一页后持久化 cursor 和已接收 cid；进程退出后从断点继续。
- 任务幂等键包含：平台、账号、实体 ID、采集类型、范围上限、采集模式、适配器版本和必要的时间窗口。
- 将 `1/1/1` 扩大到 `3/5/20` 时创建差量任务；已采 1 个作品的博主只补缺少的作品，不重复全量写入。
- 评论上限从 1 扩大到 20 时可从已知 cursor/已有 cid 补齐，不因旧 completed 状态永久跳过。

### 0.13 重试、限速、风控和错误分类

建议错误码至少包括：

- `BROWSER_OFFLINE`
- `PAGE_NAVIGATION_TIMEOUT`
- `PAGE_CONTEXT_NOT_READY`
- `LOGIN_REQUIRED`
- `CAPTCHA_OR_SECURITY_CHALLENGE`
- `RATE_LIMITED`
- `HTTP_TRANSIENT`
- `API_STATUS_ERROR`
- `SIGNATURE_UNAVAILABLE`
- `SIGNATURE_REJECTED`
- `SCHEMA_CHANGED`
- `WORK_PRIVATE`
- `WORK_DELETED`
- `COMMENTS_DISABLED`
- `VERIFIED_EMPTY`
- `MEDIA_URL_EXPIRED`
- `MEDIA_DOWNLOAD_FAILED`

策略：

- 请求页面之间维持低并发，初始可参考 1.5 秒基础间隔加 0～700 毫秒 jitter，但最终参数由基准测试调整。
- 429、临时 5xx 和网络超时自动退避；明确 CAPTCHA 不重试轰炸。
- 签名对象尚未出现可以短时间轮询就绪；签名明确被拒绝应停止该适配器并记录协议变化。
- schema 校验失败不得把部分错位字段写入正式业务表。
- 对同一平台连续出现阈值数量的相同协议错误时熔断，避免大批量污染。
- 日志只记录错误码、阶段、状态码、非敏感摘要和关联任务 ID。

### 0.14 洁净实现与许可证约束

- `ai-boshu-crawler` 根目录无公开许可证：不得复制脚本、函数、常量表或注释；只能根据公开可观察接口行为和独立设计重新实现。
- `video-parse-transcribe` 根目录无许可证；虽然其上游 `wujunwei928/parse-video-py` 被 GitHub 识别为 MIT，也必须先确认 vendored 代码版本、版权和 MIT notice，再决定是否复用。优先自行实现当前真正需要的平台适配器，避免整包 vendoring。
- `duyi-douyin-video-breakdown` 为 CC BY-NC 4.0：商业或潜在商业 Signal Desk 不得直接移植其代码。
- `xhs-profile-breakdown-skill` 为 MIT，但它不提供采集能力；如果未来复用其分析文本，应保留许可证要求的版权和许可声明。
- 架构思想、公开接口路径和平台返回字段应由 Signal Desk 自己的测试和实现验证，不把社区仓库复制进正式项目。
- 下一窗口实施前新增 `THIRD_PARTY_NOTICES` 或等价依赖审计清单；只有真正纳入分发物的依赖才写入正式 notice。

### 0.15 实施阶段与顺序

阶段 A 已于 2026-09-05 获得授权并完成；阶段 B～G 尚未授权。以下继续保留冻结的阶段定义和顺序。

#### 阶段 A：设计冻结与只读诊断基建

- 当前状态：已完成；实现与验证细节见本节 0.0 和 `docs/architecture/platform-adapter-phase-a.md`。
- 定义 `PlatformAdapter`、分页结果、来源证明和结构化错误合同。
- 定义 Cookie/请求头白名单与日志脱敏测试。
- 增加结构化 `error_code`、适配器版本和范围指纹设计。
- 不连接真实平台即可先完成单元测试框架、fixture 和 mock response。

#### 阶段 B：隔离的抖音评论 PoC

- 使用另行批准的 20～30 个代表性公开视频样本；不要恢复当前 8 个阻断任务，不写正式数据库。
- 对比 Network response 捕获、页面上下文结构化 API 和旧 DOM 路线。
- 验证登录状态、签名、cursor、has_more、total、原生 cid、零评论和 schema 错误。
- PoC 输出只能进入单独的临时测试目录和汇总报告。

#### 阶段 C：正式 `DouyinCommentAdapter`

- 洁净重写页面 MAIN world 调用、响应白名单、分页、去重、断点和证明。
- 接入 SQLite 前先通过 fixture 测试、签名对象缺失测试、敏感信息泄漏测试和异常响应测试。
- 旧 DOM 适配器保留为显式 fallback/shadow，不静默混合。

#### 阶段 D：任务系统修复

- 单任务隔离、精确恢复、批次熔断、错误码和重试退避。
- 修复 `blocked_user_action` 阻止未来新同步。
- 修复范围扩大后旧 completed 任务阻止增量。
- 为旧任务状态提供无损迁移；不得自动恢复现有 8 个任务。

#### 阶段 E：关注、作品与详情结构化适配

- 先保留当前真实关注弹窗身份闸门。
- 捕获结构化关系/作品响应，按 sec_uid/aweme_id 绑定。
- 补齐作品元数据来源和字段级冲突处理。

#### 阶段 F：媒体层接入

- 注册本机 `D:\yt_dlp\yt-dlp.exe`，增加版本与哈希诊断。
- 接入 `currentSrc`、Performance/CDP 媒体资源和 DASH 合并。
- 默认不使用浏览器 Cookie 提取。
- 媒体阶段仍受用户单独启动和现有费用/资源控制约束。

#### 阶段 G：影子运行与迁移

- 新旧采集器对同一批准样本并行，结构化适配器暂不写正式业务表。
- 对比评论数量、原生 ID、正文、作者、零评论、重复、耗时、错误分类和风控。
- 达到验收门槛后才切换主通道；旧 DOM 路线保留一段时间作为诊断后备。

### 0.16 稳定性验收标准

“近零错误”必须定义样本资格和错误类型，不能把私密、删除、验证码等预期不可访问状态混入随机软件错误，也不能通过把失败都标为“不可访问”美化成功率。

建议分 30、200、500、1000 个作品逐级验收。最终目标门槛：

- 在有效登录态下、公开可访问、未触发平台挑战的 eligible 作品中，目标评论采集成功率至少 `99.5%`。
- 未分类错误率低于 `0.1%`。
- 抽样人工核验中，错误的“已验证零评论”数量必须为 0。
- 评论正文、作者与作品错绑数量必须为 0。
- 原生 cid 可用时，使用合成 ID 的数量必须为 0。
- 单条失败导致整个批次停止的数量必须为 0；只有全局登录/挑战熔断例外。
- 中断后从 cursor 恢复不得重复写入评论。
- 同一批次重复运行不得重复创建作品或评论。
- 根评论成功、回复部分失败时必须保留根评论并精确标记 `partial`。
- 私密、删除、评论关闭、登录失效、验证码、频控、schema 改变必须分别归类。
- 所有正式入库记录必须带适配器版本、来源类型、采集时间和可验证证明。
- 敏感信息测试必须确认 Cookie、Authorization、Bearer Token 和签名秘密不出现在数据库、日志、IPC、导出或错误报告中。

成功率报告至少包含：

- 样本选择和 eligible 判定规则。
- 首次成功率与重试后成功率。
- 每个错误码数量。
- 评论页请求次数和平均/95 分位耗时。
- API/DOM 结果差异。
- schema 版本和运行日期。
- 登录、验证码和风控事件数量。

在完成千条级真实基准前，不得对外声称“基本零错误”或已经达到 `99.5%`。

### 0.17 下一窗口的准确起步点

下一窗口先完整读取本文件并只以本第 0 节为当前事实。阶段 A 已完成，但新合同尚未接入生产采集器、数据库或任务系统；不得把“合同和 fixture 测试通过”误报为真实结构化评论采集已完成。

除非用户另行明确批准阶段 B 的真实访问和样本范围，否则下一窗口只能：

- 解释、审查或调整阶段 A 合同与安全策略；
- 运行不连接真实平台、不读取正式数据库的本地测试；
- 讨论阶段 B 的样本资格、隔离目录、报告格式和停止条件。

不得自行：

- 把阶段 A 合同接入真实采集代码或修改数据库 schema；
- 恢复 #7/#8/#10/#11/#12/#13/#14/#16；
- 点击全局恢复；
- 新建或重新执行真实采集；
- 重新执行 `3/5/20`；
- 启动媒体、ASR、OCR、云分析或 API Key 调用；
- 备份、清理评论、删除数据或重置任务；
- 启用 `yt-dlp --cookies-from-browser`；
- 把临时社区仓库复制进工作区。

下一窗口如获准进入阶段 B，应先创建完全隔离的临时测试目录和只读 PoC 停止开关，再按另行批准的 20～30 个代表性公开样本验证 Network response、页面上下文结构化 API、cursor/has_more/total、原生 cid、真实零评论和 schema 错误。阶段 B 不写正式数据库，不恢复历史阻断任务；阶段 C 仍需在阶段 B 报告审查后另行开始。

### 0.18 本次记录操作的边界

本次只修改本交接 Markdown，将用户的边界授权、源码审计结论和完整优化方案持久记录。没有修改应用代码、浏览器连接器、数据库或正式用户数据；没有恢复、重试或执行任何任务；没有采集平台数据；没有启动媒体、ASR/OCR 或云分析；没有执行备份、评论清理或任务重置。

### 0.19 2026-09-05 阶段 A 执行边界

本轮修改了阶段 A 新合同、安全工具、纯合成 fixture、测试、设计文档、README 和本交接文件，并由既有 `npm run check` 重新生成工作区构建输出。没有修改旧生产采集路径、浏览器连接器源码或数据库迁移；没有访问 `%APPDATA%\Signal Desk`；没有安装或启动 Signal Desk/Chrome；没有连接抖音或任何其他平台；没有恢复、执行、清理或重置任务；没有备份、删除或变更业务数据；没有启动媒体、ASR/OCR、BYOK 或云端调用。

## 历史附录 A：2026-09-04 20:40 备份状态（如有冲突以第 0 节为准）

本节记录真实评论验证成功后的正式数据备份和只读核验结果。它优先于本文所有后续历史状态；不得因为后文仍保留旧步骤而重复清理评论、重置任务或重新执行定向评论复验。

- 用户已经人工确认真实评论获取成功。正式业务状态仍为 `creators=1 / works=1 / comments=1 / jobs=3`，三个 `collection.*` 任务均为 `completed`。
- 唯一真实评论继续精确匹配：所属作品 `7664620658675961094`、正文 `哪个agent`、公开作者 `FanFan ...`、`platform_comment_id=comment-9373bda1`、`platform_comment_id_kind=synthetic-content-hash`、`source_verified=1`、来源证明契约 `douyin-comment-source-proof/v1`。
- 2026-09-04 20:24～20:40，在 Signal Desk 和 Chrome 进程均为 0 的条件下，已经完成“真实评论验证成功后”的整个 `%APPDATA%\Signal Desk` 数据目录备份。
- 新备份目录为 `C:\Users\Administrator\AppData\Roaming\Signal Desk Backups\post-verified-comment-20260904-202643`。源目录复制前、复制后和新备份目录均为 21 个子目录、123 个文件、14,968,818 字节；三者组合清单 SHA-256 均为 `36B8A1416C80DAA740887280A3AC8203CAD25AE0B5C9041AEEE777751EC9BC79`。
- 三方逐项比对结果均为 0：目录路径差异 0、文件路径差异 0、文件大小差异 0、逐文件 SHA-256 差异 0。复制前后的正式源目录也完全一致。
- 新备份数据库为 `C:\Users\Administrator\AppData\Roaming\Signal Desk Backups\post-verified-comment-20260904-202643\signal-desk.sqlite`。正式数据库与新备份数据库均为 425,984 字节，SHA-256 均为 `8D7857A46AD7C0010D98A3F14ECFB06B4EDB3B9BEAABA0527D53F407944AE12C`。
- 仅对新备份数据库使用 Python 3.14 / SQLite 3.50.4，以 `mode=ro + immutable=1 + PRAGMA query_only=ON` 执行验证；结果为 `query_only=1`、`user_version=4`、`integrity_check=ok`、`foreign_key_check=[]`。
- 只读验证前后备份数据库的大小和 SHA-256 完全不变，整个备份清单也完全不变；没有创建 `signal-desk.sqlite-wal`、`signal-desk.sqlite-shm` 或 `signal-desk.sqlite-journal`。
- 最新业务计数为：`owner_accounts=1 / creators=1 / works=1 / comments=1 / metric_snapshots=3 / jobs=3 / collection_checkpoints=3 / search_index=3 / inbox_states=1 / sync_runs=0 / analysis_batches=0 / analyses=0 / transcript_segments=0 / ocr_blocks=0 / evidence_frames=0`。
- 注意：`metric_snapshots=3 / collection_checkpoints=3` 是当前正确状态，不得继续按旧交接摘要中的 2/2 判断。第三条指标快照来自 2026-09-04 真实评论成功定向复验；第三个检查点是修复后按作品 ID `7664620658675961094` 建立的正确评论检查点。旧指标和旧检查点依照此前授权被保留，没有清理。
- 任务 #3 的历史范围仍精确为 `creatorLimit=1 / worksPerCreator=1 / commentsPerWork=1 / collectionOnly=true`，并绑定 `workId=7664620658675961094` 和 `sourceUrl=https://www.douyin.com/video/7664620658675961094`。
- 评论来源证明继续绑定：`containerIdentity=data-e2e:comment-list`、`itemIdentity=data-e2e:comment-item`、`authorIdentity=class-token:comment-item-info-wrap`、`bodyIdentity=adjacent-visible-sibling-after-author`、`workId=7664620658675961094`，且 `commentIds` 只包含 `comment-9373bda1`。任务 #3 检查点中的证明与评论记录中的证明完全一致。
- 两份历史备份仍然存在且不得删除：`C:\Users\Administrator\AppData\Roaming\Signal Desk Backups\pre-cleanup-sync-following-1788357514501-20260902-224140` 和 `C:\Users\Administrator\AppData\Roaming\Signal Desk Backups\pre-comment-retry-20260904-191407`。
- 本轮没有修改正式数据库，没有删除评论，没有重置、恢复或执行任务，没有启动采集、媒体、ASR/OCR 或云分析，也没有安装程序。备份及核验完成后的最终进程计数仍为 Signal Desk 0、Chrome 0。
- Signal Desk `0.1.11` 尚未安装。下一步只能在用户另行明确授权后，将 `release\SignalDesk-0.1.11-x64.exe` 覆盖安装到原 `E:\InforWork\Signal Desk`，然后验证桌面端版本为 `0.1.11`、连接器仍为 `0.1.6`、固定扩展 ID 仍为 `fejndacdabkgahmfpfjaghhedbdehonh`、已验证评论和三个 completed 任务完整保留，并确认 Signal Desk 与 Chrome 双方在线。
- 安装验证期间不得点击“小样本同步”或“恢复”。安装验证通过后也不得自动恢复 `3/5/20`；扩大页面资料采集仍需要用户新的明确授权，且不得同时启动媒体、ASR/OCR、BYOK 文本分析或视觉分析。

## 历史附录 B：2026-09-04 20:10 覆盖状态（如有冲突以第 0 节为准）

本节记录 `0.1.10` 安装和真实评论复验完成后的最新事实；后文关于“尚待安装 `0.1.10`、尚待删除错误评论或尚待重置任务 #3”的内容只保留为历史，不得再次执行。

- 用户已经安装并运行 Signal Desk `0.1.10`，C 盘固定浏览器连接器已经是 `0.1.6`，固定 ID 仍为 `fejndacdabkgahmfpfjaghhedbdehonh`。
- 2026-09-04 19:14 已在 Signal Desk 完全退出时完整备份 `%APPDATA%\Signal Desk` 到 `C:\Users\Administrator\AppData\Roaming\Signal Desk Backups\pre-comment-retry-20260904-191407`。备份为 21 个子目录、123 个文件、14,968,774 字节，逐文件差异为 0，组合清单 SHA-256 为 `F01A4C7DA4195C99EC7FAC5A3DAD82DB9B7286F6EFA07B50B0ED586B27BE3DE4`；备份数据库 SHA-256 为 `21E3361602EE569168F39AB839477DC955AF2D27038EA980F18BD452A6E02F90`。该备份不得删除。
- 在完整备份和严格前置断言下，旧错误评论 `comment-6dd16729`（正文 `32`）及其唯一评论搜索索引已经用单事务精确删除，只有任务 `#3 collection.work_comments` 被重置为 `queued`；任务 #1/#2、博主、作品、指标、收件箱状态和检查点均保留。不要再次执行这次清理或重置。
- 第一次启动 `0.1.10` 时发现冷启动调度竞态：任务命令先进入 Bridge 队列，任务随后因连接器尚未完成在线握手而被标记为 `blocked_user_action`；连接器稍后返回的有效结果因任务不是 `running` 被误拒绝为 `stale-command`。用户在连接器已经在线后点击一次“恢复”，定向评论复验随后成功。
- 2026-09-04 20:01 的最新正式库只读核验确认：`user_version=4`、`creators=1 / works=1 / comments=1 / jobs=3 / search_index=3`，三个采集任务均为 `completed`，`integrity_check=ok`，无外键违规。唯一评论正文为“哪个agent”，公开作者为 `FanFan ...`，`platform_comment_id=comment-9373bda1`，ID 来源为 `synthetic-content-hash`，`source_verified=1`，来源证明契约为 `douyin-comment-source-proof/v1`，并绑定作品 `7664620658675961094`。用户已经人工确认评论获取成功。因此关注来源、作品归属和本次受控评论采集均通过；媒体、ASR/OCR、云批次和分析记录仍全部为 0。
- Signal Desk `0.1.11` 已永久修复上述冷启动竞态：连接器离线时不再把命令放入 Bridge 队列；连接器在线时先以 `WHERE state='queued'` 条件原子更新任务为 `running`，确认恰好更新 1 行后才公开命令。新增回归测试验证离线派发命令数为 0、在线恢复入队瞬间任务已经是 `running`，以及连续调度不会重复入队。
- `npm run check` 已通过：TypeScript、6 个 Vitest 文件/43 项测试、2 个 Python 工作器测试、Native Host、固定部署清单、严格关注/评论来源闸门、连接器后台和生产构建全部通过。`0.1.11` 普通打包冒烟和当前正式库只读生成的临时副本升级冒烟均通过；后者确认现有博主、作品、星标和批注计数保持不变。
- 新推荐安装器为 `release\SignalDesk-0.1.11-x64.exe`，大小 222,059,587 字节，SHA-256 为 `20822412F3A385044C86488FAA9655674344871FCDD4E3C9E1B290C175388D7C`。免安装主程序 `release\win-unpacked\Signal Desk.exe` 大小 210,896,896 字节，SHA-256 为 `053719A8AFFBC0E52E464CE03F8F20899C5D8A2FD6C13CCB396968F26E8248ED`。
- 下一步先正常关闭 Signal Desk 和 Chrome，再将 `0.1.11` 覆盖安装到原 `E:\InforWork\Signal Desk`，随后确认主程序版本、现有已验证评论和双方在线状态。连接器代码未变化，仍为 `0.1.6`。安装验证通过后，才可在用户另行明确授权下考虑恢复一次页面资料限定的 `3/5/20` 小样本；不得自动开始，不得在该采集验收前启动媒体、ASR/OCR、BYOK 文本分析或视觉分析。

## 1. 当前结论

Signal Desk V0.1 已完成源码实现、Windows 打包和前五阶段离线验收。用户已经安装并亲自验证 `0.1.3`，确认任务中心、设置页，以及文本/视觉分析服务各自独立的 Base URL、API Key、模型与计价字段均显示正常。

用户已安装 `0.1.4`，确认“演示资料管理”的清理范围正确，并亲自勾选确认框、执行清理。阶段 6 已正式通过。

阶段 7 的首次连接已通过：用户在 Chrome 中使用“加载未打包的扩展程序”加载连接器，扩展 ID 为 `knpefdpoedgfgndggjdkjgnfgomnllng`；扩展弹窗曾显示“桌面端在线”，Signal Desk 曾显示“浏览器已连接”。随后审查发现 `0.1.4` 的“开始同步”仍会扩散为全量关注、作品和评论任务，所以用户没有点击；`0.1.5` 已增加有确认框和双层硬上限的小样本同步。

用户安装 `0.1.5` 并重新加载扩展后，扩展弹窗曾出现 `Access to the specified native messaging host is forbidden.`，点击“重新连接桌面端”看起来没有反应。已确认确切根因：`0.1.4` 与 `0.1.5` 安装资源误带了开发测试生成的 `com.signaldesk.bridge.json`，其中 `allowed_origins` 固定为测试 ID `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`；覆盖安装替换了此前按用户真实扩展 ID 生成的清单。`0.1.6` 已把清单迁移到 `%LOCALAPPDATA%\Signal Desk\NativeMessagingHosts`、从安装资源中强制排除该文件，并改善手动重连反馈。用户现已安装并按原扩展 ID 重新注册，亲自确认扩展显示“桌面端在线”、Signal Desk 显示“浏览器已连接”，连接回归正式通过。阶段 8 的范围确认框也已由用户截图验收：默认 3 位博主、每位 5 个作品、每作品 20 条评论，总上限 15 个作品/300 条评论，并明确不下载媒体、不启动 ASR/OCR 或云端分析、不调用 API Key。

用户第一次点击确认后发现 Chrome 登录了错误的抖音账号。只读审计确认任务在关注列表阶段即进入 `blocked_user_action`，尚未返回任何数据：博主、作品、评论、指标快照、采集检查点、媒体缓存和云端缓存均为 0；唯一新增内容是任务 `#1 collection.following`。用户关闭 Signal Desk 后，已在事务和严格前置计数校验下精确删除该任务。清理后再次确认任务、博主、作品、评论、指标和检查点全部为 0，设置、凭据、连接器注册和业务数据库保留。用户随后在安装连接器的同一 Chrome 配置中登录正确抖音账号，并重新执行了 3/5/20 小样本同步。

第二次同步的数量限制正常工作，但语义结果失败：程序采集了 1 位名为“巫启贤”的博主、5 个作品和 89 条评论；用户明确确认自己没有关注该博主。只读数据库审计和源码检查确认根因是旧版 `collectFollowing()` 对整个页面使用全局 `a[href*="/user/"]`，把推荐区、侧栏或其他任意用户链接当作关注对象，并无条件写入 `isFollowing: true`。该无效批次现已在完整备份和严格前置断言保护下精确清理；`0.1.7` 已实现浏览器端来源证明与桌面端入库前语义闸门。`0.1.8` 又修复了 E 盘可移动目录导致扩展重启后被 Chrome 清退的问题。2026-09-04 第一次新闸门 `1/1/1` 真实尝试安全阻断并保持零入库；用户随后提供真实 DOM 证据，确认关注账号位于本人主页顶部关注数量打开的关系弹窗中。`0.1.9` / 连接器 `0.1.5` 已严格适配该弹窗并部署到 C 盘，下一步是在 Chrome 重新加载扩展后恢复同一个阻断任务；自动测试通过不等于当前抖音真实 DOM 已验收。

当前阶段状态：

| 阶段 | 状态 | 说明 |
|---|---|---|
| Windows 安装和启动 | 已通过 | `0.1.0` 白屏已修复；`0.1.10` 已完成最终打包 EXE 与正式库只读副本升级冒烟，尚待用户覆盖安装 |
| 离线演示资料 | 已通过 | 6 位博主、24 个作品、120 条评论 |
| 收件箱与作品详情 | 已通过 | 用户已测试并确认修复有效 |
| 搜索、博主资料、星标与批注 | 已通过 | 用户已测试并确认修复有效 |
| 关闭重启与状态持久化 | 已通过 | 前四项验收已经完成 |
| 任务中心和设置页 | 已通过 | 用户已确认页面、字段和入口正常，双云服务配置区正常 |
| 演示资料隔离/清理 | 已通过 | 用户已确认范围，亲自勾选并执行清理 |
| 浏览器连接器安装 | 已通过稳定性验收，待升级 | 固定扩展 ID 保持不变；当前 C 盘为 `0.1.5`，`0.1.6` 随 `0.1.10` 安装器部署后再重新加载 |
| 真实抖音采集 | 关注与作品归属通过，评论待复验 | `1/1/1` 的旧版评论误采为 `32`；严格评论闸门已实现，仍不得恢复 `3/5/20` |
| 本地 ASR/OCR 安装 | 尚未验收 | 默认安装器未携带完整 Python/模型 |
| 云端 BYOK 调用 | 尚未验收 | 未使用用户 API Key 发起真实调用 |

## 2. 用户的产品目标

用户希望做一个面向 YouTube、抖音、快手、Bilibili 等短视频平台的个人账号管理与内容分析工具，V0.1 先以抖音为例。

核心需求包括：

- 分析当前抖音账号关注的博主，并识别博主领域，例如科技、军事、情感、金融等。
- 分析关注博主的视频和图文作品。
- 对作品生成内容总结、重点梳理和作者核心表达。
- 记录点赞、评论、收藏等公开指标。
- 批量分析博主作品，识别相对高流量和低流量作品，以及博主内容偏好。
- 为博主添加用户批注，帮助用户选择性观看。
- 提炼作品关键词和标签，用于搜索与后续复盘。
- 不把产品做成仅有提示词的单个 Skill；需要真实的采集、媒体处理、数据库和分析执行层。

## 3. 已实现的产品形态

Signal Desk 是面向 Windows 11 x64 的本地优先桌面应用：

```text
Chrome / Edge 中的抖音登录态
        ↓
Manifest V3 只读浏览器连接器
        ↓
C# Native Messaging 控制台 Host
        ↓
127.0.0.1 随机端口 + 256 位随机密钥
        ↓
Electron 桌面端
        ↓
SQLite + 持久化任务 + Python 媒体工作器 + BYOK 云分析
```

浏览器只承担只读采集桥角色；管理、搜索、分析、批注和复盘均在桌面应用中完成。

主要技术栈：

- Electron 39.8.10。
- React 19。
- TypeScript。
- electron-vite。
- Electron 内置 `node:sqlite`。
- SQLite WAL、外键、STRICT 表、迁移和 FTS5。
- Python 3.11 NDJSON 媒体工作器。
- FFmpeg、FFprobe。
- CPU INT8 `faster-whisper small`。
- PaddleOCR。
- OpenAI-compatible `/chat/completions` BYOK 云分析。

目标机器配置为 i5-12600K、32 GB 内存、无 NVIDIA GPU，因此媒体默认并发为 1。

## 4. 已实现的主要功能

### 4.1 桌面端和数据层

- 单本地用户、单抖音登录账号。
- 今日内容收件箱：未读、稍后看、收藏、全部。
- 博主资料库：领域、星标、批注、作品数、分析数。
- 标题、简介、摘要、转写、OCR、关键词、领域和博主名称搜索。
- SQLite 本地持久化。
- 数据库迁移、幂等采集和指标时间戳快照。
- 不可见公开指标保持 `NULL`，不伪造为 0。
- 持久化任务队列：暂停、恢复、重试和检查点。
- 匿名化 CSV/Markdown 导出。

### 4.2 内容分析

- 作品摘要。
- 重点梳理。
- 作者核心表达。
- 作品领域。
- 博主领域。
- 作品关键词。
- 作品和博主领域在界面中明确分组，不再混为一谈。
- 基于博主自身历史指标的相对高/低流量判断。
- 每位博主少于 8 个有效样本时显示样本不足，不强行下结论。

### 4.3 媒体处理

- 临时下载页面暴露的可用 HTTP 媒体。
- FFprobe 探测。
- 提取 16 kHz 单声道 WAV。
- `faster-whisper` CPU INT8 ASR。
- PaddleOCR。
- 每 2 秒抽帧、压缩和 SHA-256 去重。
- 保留压缩证据帧，成功提取后删除原视频和临时 WAV。
- 不绕过 `blob:`、DRM、签名、验证码或平台风控。
- 缺少本地 AI 依赖时结构化降级，不阻塞页面文本和数据库功能。

### 4.4 云分析与费用闸门

- OpenAI-compatible BYOK。
- API Key 使用 Electron `safeStorage` / Windows DPAPI；不写 SQLite 和日志。
- 用户点击“预估”只在本机建立不可变批次，不调用云模型。
- 执行前显示作品数、评论数、图片数、输入/输出 token 和费用估算。
- 用户明确确认后才执行。
- 确认后的新采集数据不会加入原批次。
- 视觉分析只上传压缩后的代表关键帧，不上传完整视频。
- 每位博主最多 12 个代表作品，每作品最多 16 张帧，每张不超过 1.5 MB。
- 上传前校验缓存路径和 SHA-256。

### 4.5 浏览器连接器安全边界

- 仅声明抖音域名权限。
- 尽力采集关注列表、博主公开作品、公开指标和页面可见评论。
- 不导出 Cookie、密码、Bearer Token 或签名请求头。
- 不具备点赞、评论、关注、取消关注、私信或发布能力。
- 遇到登录失效、验证码、安全验证和频控提示时暂停，不绕过。

## 5. 版本与修复历史

### 5.1 `0.1.0`：首次交付，打包版白屏

表现：Electron 窗口能够打开，但只有米白色背景。

确切根因：

```text
package.json 使用 "type": "module"
        ↓
electron-vite 将 preload 默认构建为 index.mjs
        ↓
BrowserWindow 启用 sandbox
        ↓
沙箱按普通 preload 脚本执行该文件
        ↓
SyntaxError: Cannot use import statement outside a module
        ↓
window.signalDesk 未注入
        ↓
React 调用 getDashboard/onDataChanged 时崩溃
```

真实错误包括：

```text
Unable to load preload script
SyntaxError: Cannot use import statement outside a module
TypeError: Cannot read properties of undefined (reading 'getDashboard')
TypeError: Cannot read properties of undefined (reading 'onDataChanged')
```

### 5.2 `0.1.1`：白屏修复版

- preload 明确构建为 CommonJS：`out/preload/index.cjs`。
- 保留 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- 新增 `preload-error` 日志。
- 新增可见的 preload 启动失败页，防止未来只显示空白。
- 新增打包后真实 EXE 冒烟测试，检查 preload、React 首页和 Dashboard IPC。

### 5.3 `0.1.2`：离线验收问题修复版

用户在前四步离线测试中报告：

1. 作品详情没有作品领域，只有博主资料库能看到博主领域。
2. 演示作品点击原页后抖音提示无效视频。
3. 没有找到任何“不可见”指标示例。
4. 收件箱搜索 `AI`、`金融`、`科技`无结果。
5. 博主资料库搜索领域和博主名称无结果。
6. 星形按钮提示“博主资料已更新”，语义不清楚。

已完成的修复：

- 新增结构化 `work_tags` 表。
- 从已有分析 JSON 自动回填作品领域。
- 作品详情分为“作品领域 / 博主领域 / 作品关键词”。
- 收件箱卡片显示类似“作品·科技”的明确标签。
- 演示记录新增 `is_demo` 标识。
- 演示详情显示“离线演示作品”。
- 演示作品原页按钮改为禁用的“演示作品无原页”。
- 现有演示资料会自动迁移，不需要重新载入。
- 增加三个明确的缺失指标样本：
  - “为什么芯片制程数字不等于性能”：公开收藏不可见。
  - “家庭现金流的四个账户”：公开评论不可见。
  - “从地形看一场战争”：公开点赞不可见。
- 详情指标区增加“不可见不等于 0”的说明。
- 修复 FTS5 trigram 无法命中少于 3 字符查询的问题。
- 短关键词增加安全的子串查询回退。
- 作品索引加入作品领域、博主领域和博主名称。
- 收件箱搜索和博主搜索拆成独立状态。
- 输入增加 220 毫秒防抖。
- 丢弃晚到的过时查询响应，避免旧结果覆盖新结果。
- 开始在收件箱输入搜索词时自动切到“全部”，避免已读作品被“未读”筛选挡住。
- 星标按钮显示“星标 / 已星标”。
- 星标提示改为“已星标博主 / 已取消博主星标”。
- 批注提示改为“博主批注已保存”。

用户对 `0.1.2` 的最终反馈是：“修复得很好，所有问题都被完美修复了。”

### 5.4 `0.1.3`：文本与视觉服务独立配置

用户在第五步检查设置页时指出：视觉模型与文本模型共用一个 Base URL 不合理，因为两者可能来自不同服务商。

已完成的修复：

- 文本分析服务与视觉分析服务拆成两个明确配置区。
- 两者分别保存 Base URL、API Key、模型和 token 单价。
- 视觉服务另外保留图片单价。
- 两套 API Key 分别通过 `safeStorage` / Windows DPAPI 加密。
- 旧共享 Base URL 只迁移到文本服务，不擅自复制给视觉服务。
- 云批次预估和实际调用按文本/视觉服务分别计算和执行。

用户已重新安装并确认两个服务配置区显示正常，第五步正式通过。

### 5.5 `0.1.4`：演示资料安全清理

- 设置页新增“演示资料管理”和“查看并清除”入口。
- 执行前统计演示博主、作品、评论、分析记录、证据帧索引、关联任务/云批次，以及依附于演示记录的个人状态。
- 必须勾选二次确认框后才能清理。
- 只删除 `is_demo=1` 的演示博主、演示作品及其关联数据。
- 真实博主、作品、评论、分析、收藏、稍后看、星标和批注均保留。
- 依附于演示记录的收藏、稍后看、星标和批注会随演示实体删除，确认框明确提示。
- 关联任务或云批次正在运行时阻止清理。
- 清理在单个 SQLite 事务中执行，失败整体回滚。
- 显式处理没有外键或包含固化清单的 `analyses`、`search_index`、`jobs`、`analysis_batches`、`audit_events` 和 `collection_checkpoints`。
- 纯演示库清空后会复位抖音同步时间和 `following` 检查点；混合库保留真实同步状态。
- 确认框已在 `1120×720` 最小窗口下完成真实打包 EXE 截图检查。

`0.1.4` 已构建并通过自动化冒烟；用户随后安装该版本，确认清理范围无误，并亲自勾选、执行了演示资料清理。阶段 6 已通过。

### 5.6 `0.1.5`：真实采集小样本硬上限

阶段 7 连接成功后，在放行真实采集前发现：`0.1.4` 的“开始同步”会完整滚动关注列表，并为所有返回博主继续创建作品和评论任务，无法保证交接方案要求的 3～5 位小样本。因此没有让用户点击旧入口，而是在 `0.1.5` 中完成以下修复：

- 顶部入口改为“小样本同步”，浏览器连接器离线时不可点击。
- 点击后先显示真实采集范围确认框。
- 默认范围为最多 3 位博主、每位 5 个作品、每作品 20 条评论，即最多 15 个作品和 300 条评论。
- 可调硬上限为 1～5 位博主、每位 1～10 个作品、每作品 1～30 条评论。
- 浏览器内容脚本达到目标数量后提前停止滚动。
- 桌面主进程在入库前根据原始任务范围再次过滤和截断；即使扩展意外超量返回也不能突破上限。
- 博主作品只接受属于目标博主的记录；作品评论只接受属于目标作品的记录。
- 小样本阶段只采集页面资料，不下载媒体、不启动 ASR/OCR，也不创建或执行云端分析任务。
- 采集任务收到成功结果后会正确标记为完成，不再永久停留在“运行中”。
- 登录、验证码或安全验证导致的“需要操作”任务，在用户处理后可以通过任务中心“恢复”重新排队。
- 同一时间存在未结束的采集任务时，阻止建立另一套重叠同步。
- 修正真实页面未出现某项指标时仍被误标为可见的问题，并收紧指标文本匹配，减少把评论正文中的数字误判为指标。
- 浏览器连接器版本从 `0.1.0` 更新为 `0.1.1`；安装路径不变，因此 Chrome 扩展 ID 应保持不变，但安装桌面端后必须在 `chrome://extensions` 点击扩展卡片的圆形箭头重新加载。

`0.1.5` 已通过单元测试、浏览器内容脚本测试、生产构建和真实打包 EXE 冒烟。尚未使用用户真实抖音登录态执行采集。

### 5.7 `0.1.6`：修复升级覆盖浏览器连接授权

用户安装 `0.1.5` 并重新加载现有 Chrome 扩展后，弹窗显示：

```text
Access to the specified native messaging host is forbidden.
```

确切根因已经通过检查源码目录、`0.1.4` 打包目录和 `0.1.5` 打包目录确认：三处都存在同一份构建测试残留清单，其 `allowed_origins` 为：

```text
chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/
```

Chrome 能找到 `com.signaldesk.bridge`，但用户真实扩展 ID 不在许可列表中，因此拒绝连接。点击“重新连接桌面端”只会重复同一个权限错误，并不能修改系统注册。

`0.1.6` 完成以下修复：

- `install.ps1` 将用户相关清单写入 `%LOCALAPPDATA%\Signal Desk\NativeMessagingHosts\com.signaldesk.bridge.json`，注册表指向这一稳定目录。
- `electron-builder` 明确排除 `native-host/bin/com.signaldesk.bridge.json`，任何构建机上的动态清单都不会进入应用资源。
- 打包后真实 EXE 冒烟会先断言最终资源中不存在该清单；一旦重新污染，构建直接失败。
- 新增清单生成测试，断言只允许调用时传入的扩展 ID，并检查打包排除规则。
- `uninstall.ps1` 只移除 Native Messaging 注册和连接清单，保留业务数据。
- 扩展版本升级到 `0.1.2`；点击“重新连接桌面端”会显示“正在重新连接…”，并强制替换旧 Native Port。
- 修复连续手动重连时旧 Port 的断开回调可能清空新 Port 的竞态，并新增回归测试。

从旧版升级到 `0.1.6` 后需要使用真实扩展 ID 再运行一次新版 `install.ps1`，把授权迁移到稳定目录。完成这一次后，后续覆盖升级不会再覆盖授权清单。

### 5.8 `0.1.6`：真实关注列表识别失败，待 `0.1.7` 修复

用户使用正确账号执行默认 3/5/20 小样本同步后，任务中心显示全部完成：

```text
同步关注列表：1 位博主
采集博主历史作品：5 个作品
补齐作品评论：共 5 个任务，分别为 17、17、18、17、20 条评论
Dashboard：关注博主 1、已收作品 5、公开评论 89
```

用户人工审查后确认被采集博主并不在自己的关注列表中。只读审计得到当前正式数据库中的无效批次：

```text
根任务 commandId：sync-following-1788357514501
采集时间：2026-09-02 21:58～21:59（Asia/Shanghai）
博主：1
作品：5
评论：89
指标快照：10
采集任务：7（ID 1～7，全部 completed）
采集检查点：2
```

错误博主：

```text
数据库 ID：1
昵称：巫启贤
platform_creator_id：MS4wLjABAAAATC2OuF5TP1QCwt0lhSq9EVTv0ZMmL_vP8wJ6bKwofoA
主页：https://www.douyin.com/user/MS4wLjABAAAATC2OuF5TP1QCwt0lhSq9EVTv0ZMmL_vP8wJ6bKwofoA
```

无效作品 platform_work_id：

```text
7653699762013082993
7639336148564774190
7622234995876651994
7612516319922372083
7612166758661213403
```

根因位于 `browser-connector/extension/content.js`：

- `collectFollowing()` 使用 `const selector = 'a[href*="/user/"]'`，扫描整个文档，而不是已经验证的“我的关注列表”容器。
- 候选只排除 `/user/self`，没有排除导航、推荐、侧栏、活动或其他页面区域的用户链接。
- 候选没有任何真实关注关系证据，却直接写死 `isFollowing: true`。
- `scrollUntilStable()` 只调用 `window.scrollTo()`；如果关注列表使用弹层或内部滚动容器，真实列表不会随窗口滚动加载。
- 只找到 1 个杂项用户链接且多轮不增长后，逻辑会把结果错误标为 `complete`。
- `scripts/test-connector-content.mjs` 的关注列表测试页面只包含纯净的 `<li><a href="/user/...">`，没有推荐账号、侧栏账号、未加载列表或内部滚动容器，因此只验证数量上限，没有验证关注语义。

这次验证说明：

- 桌面端和浏览器端的 3/5/20 数量硬上限有效；5 个作品均未超过 20 条评论，总量未突破 15/300。
- “必须属于当前账号真实关注列表”的来源语义没有得到验证，因此整批 1/5/89 数据无效。
- Signal Desk 没有在抖音上执行关注或其他写操作；数据库中的 `is_following=1` 只是采集器错误写入的本地标记。
- 本次仍为 `collectionOnly: true`，没有媒体下载、ASR/OCR、云端批次或 API Key 调用。

以上是 `0.1.6` 的历史故障记录。无效批次清理和 `0.1.7` 修复现已完成，详见下一节。

### 5.9 `0.1.7`：精确清理与关注来源双层语义闸门

用户确认 Signal Desk 正常关闭后，已对正式数据库进行只读审计，并精确确认根命令 `sync-following-1788357514501` 对应的 1 位错误博主、5 个作品、89 条评论、10 个指标快照、7 个任务和 2 个检查点。

清理前已完整备份整个 `%APPDATA%\Signal Desk`：

```text
C:\Users\Administrator\AppData\Roaming\Signal Desk Backups\pre-cleanup-sync-following-1788357514501-20260902-224140
```

备份包含 124 个文件、14,970,820 字节；正式库与备份库清理前的 SHA-256 均为：

```text
298F2BB7E40DCDCD679FF5B83BD8EFB22CF7569471EACE1A785A2BB3187A64CE
```

清理先在一次性数据库副本上演练，再以严格前置断言和单个 `BEGIN IMMEDIATE` 事务应用到正式库；失败会整体回滚。只删除目标 creator、works、comments、metrics、jobs、checkpoints、FTS 索引及其级联本地状态，并将 `owner_accounts.id=1` 的 `last_sync_at` 恢复为 `NULL`。设置、凭据、连接器注册和其他非数据库文件均保留，完整回滚备份也继续保留。

清理后复核结果：

```text
creators=0
works=0
comments=0
metric_snapshots=0
jobs=0
collection_checkpoints=0
search_index=0
inbox_states=0
owner_accounts.last_sync_at=NULL
integrity_check=ok
foreign_key_check=[]
```

`0.1.7` 的核心修复：

- 浏览器端只允许在精确的本人关注页、唯一激活的“关注”页签、可信列表根容器和语义列表成员中提取博主，明确排除导航、侧栏和推荐子树。
- 识别真实内部滚动容器并使用跨滚动轮次的 `Map` 累积虚拟列表成员；连续无增长不再被当作完整。
- 缺少可信容器、活动页签、滚动根或结束证据时安全失败，进入“需要操作”并保持零入库。
- `browser-collection-envelope/v1` 增加 `douyin-following-source-proof/v1` 来源证明；证明中的 creator ID、顺序、URL、关系和空状态必须自洽。
- 桌面主进程在 `ingestEnvelope()` 前执行第二层验证；无证明、证明不匹配、重复博主、`isFollowing=false`、错误 host/path 或混入作品/评论时全部拒绝，且不更新同步时间、不创建下游任务。
- 合法空关注列表使用明确的 `following` 检查点；命令关联由模糊字符串匹配改为精确 JSON `commandId` 匹配。
- Bridge 返回明确的 `accepted` receipt；业务拒绝不会再被浏览器误报成桌面离线。
- 应用版本升级到 `0.1.7`，扩展版本升级到 `0.1.3`。

### 5.10 `0.1.8`：浏览器连接器固定本地目录与固定身份

2026-09-04 用户反馈每次重启电脑后，Chrome 的“Signal Desk 抖音只读连接器”会从 `chrome://extensions` 消失。只读诊断确认这不是工具栏隐藏：Chrome 中只剩旧扩展的路径和权限残留，缺少活动 `manifest`；截图中的正常扩展均保留完整活动记录。

根因是 Signal Desk 安装在 `E:\InforWork\Signal Desk`，而 Windows 将 `E:` 识别为 `Removable Drive`。旧扩展以“加载未打包”方式直接引用：

```text
E:\InforWork\Signal Desk\resources\browser-connector\extension
```

如果 Chrome 在登录时早于 `E:` 完全就绪，或应用覆盖升级时该目录被短暂替换，Chrome 会把源目录判定为丢失并清退活动扩展；`E:` 稍后恢复时不会自动重新加载。旧扩展未配置固定 `key`，身份还依赖加载路径。

`0.1.8` 只修改浏览器连接器部署链路，未修改数据库、设置、凭据、采集规则、分析或媒体功能：

- 扩展加入固定公钥，连接器版本升级到 `0.1.4`，长期固定 ID 为 `fejndacdabkgahmfpfjaghhedbdehonh`。
- `install.ps1` 将扩展与 Native Host 部署到 `%LOCALAPPDATA%\Signal Desk\BrowserConnector`，不再依赖主程序所在盘符。
- Native Host 使用版本隔离目录 `%LOCALAPPDATA%\Signal Desk\BrowserConnector\native-host\0.1.4`，避免覆盖正在运行的 Host。
- Native Messaging 清单仍位于 `%LOCALAPPDATA%\Signal Desk\NativeMessagingHosts`，但 Host 路径和唯一 `allowed_origins` 均改为新的 C 盘稳定部署和固定 ID。
- 安装器加入 `customInstall` 钩子，覆盖安装时自动刷新稳定副本并只恢复 Chrome 当前用户注册项；Edge 仅在用户明确需要时手动注册。部署失败会明确提示，不会把主程序安装误报为连接器部署成功。
- 部署脚本拒绝调用者传入与固定身份不一致的旧扩展 ID。
- `0.1.8` 安装器已完成 NSIS 构建；最终打包 EXE 冒烟和全部既有回归均通过。

实际稳定连接器已经部署到：

```text
C:\Users\Administrator\AppData\Local\Signal Desk\BrowserConnector
```

实际共 8 个文件、39,753 字节；扩展 6 个文件和 Native Host 均与最终打包资源 SHA-256 相同。2026-09-04 最终只读核验确认：实际 `Administrator` 用户的 Chrome Native Messaging 注册项已恢复并指向 C 盘清单，Edge 注册项不存在；清单中的 Host 路径为版本隔离的 `native-host\0.1.4\SignalDesk.NativeHost.exe`，且只允许固定扩展 ID `fejndacdabkgahmfpfjaghhedbdehonh`。用户随后从该稳定目录完成一次性加载，并确认扩展与 Signal Desk 双方在线。

### 5.11 `0.1.9`：真实关注关系弹窗适配

第一次 `1/1/1` 新闸门真实尝试进入“需要操作”后，用户提供了本人主页和 DevTools 结构证据。真实抖音页面不会因 `?showTab=follow` 自动显示关注账号，而是必须点击个人资料顶部“关注数量”打开关系弹窗。弹窗结构确认如下：

- “关注（273）”为 `role="tab"` 且 `aria-selected="true"`，并通过 `aria-controls="semiTabPanel0"` 关联面板；相邻存在“粉丝（105）”页签。
- 真实列表的唯一滚动容器为 `data-e2e="user-fans-container"`。
- 账号主页链接和头像位于容器内的记录中，头像节点使用 `role="listitem"`。
- 每条真实关注关系在同一记录内显示“已关注”；适配也接受语义等价的“相互关注”。

`0.1.9` / 连接器 `0.1.5` 只修改这条浏览器连接器采集适配链路：

- 活动关注页签允许严格匹配“关注”或“关注（数字）”，不使用颜色、坐标或易变 class 作为唯一证明。
- 弹窗必须同时具有唯一活动的关注页签、同一关系弹窗内唯一可见的 `user-fans-container`、合法的抖音账号主页链接，以及所属记录中的“已关注/相互关注”标记。
- 粉丝页签、多个弹窗、缺少关系标记、背景作品区、推荐区、侧栏和其他任意 `/user/` 链接仍安全拒绝。
- 恢复阻断任务时，若已有标签页已处于完全相同的本人关注路由，不再重新导航，以免关闭用户已打开的关系弹窗。
- 固定公钥和扩展 ID 保持 `fejndacdabkgahmfpfjaghhedbdehonh`，连接器版本升级为 `0.1.5`。

最终 C 盘部署已完成：共 9 个文件、51,315 字节；增加的第 9 个文件是保留的旧版 Native Host 隔离副本。扩展 6 个文件和 `native-host\0.1.5\SignalDesk.NativeHost.exe` 均与最终打包资源 SHA-256 相同；Chrome 注册正确，Edge 注册不存在。任务 `#1 collection.following` 未恢复、未删除，仍为 `blocked_user_action` 和 `1/1/1 + collectionOnly`；核心业务采集表仍全部为 0，`last_sync_at=NULL`，`integrity_check=ok`，无外键违规。

### 5.12 `0.1.10`：严格评论来源闸门和可审计详情

真实 `1/1/1` 完成后，用户确认关注博主和作品归属正确，但无法从界面核实具体评论。只读数据库审计发现唯一评论正文为 `32`、作者为占位“公开用户”，确认旧版全局模糊选择器把评论数量或控件误当成评论。用户随后分批提交了普通作品评论页、真实评论正文节点、顶部评论输入区和评论列表根结构的截图，并明确说明“所有截图提交完毕”。真实结构证据为：

- 作品 URL 为 `/video/7664620658675961094`。
- 唯一评论列表根容器为 `data-e2e="comment-list"`，同时带有稳定语义类 token `comment-mainContent`。
- 每条评论记录为精确的 `data-e2e="comment-item"`。
- 评论作者信息区的类 token 为 `comment-item-info-wrap`。
- 真实正文位于作者信息区的相邻可见兄弟节点中；截图示例正文为“哪个agent”。
- 顶部评论输入框位于评论列表根容器外，必须排除。

据此实现 Signal Desk `0.1.10` / 连接器 `0.1.6`：

- 移除评论全局 `[data-e2e*="comment"]` 和 class 模糊扫描，只允许唯一可见的 `comment-list/comment-mainContent` 根容器。
- 只读取根容器内精确的 `comment-item`，要求唯一 `comment-item-info-wrap` 作者区和相邻正文节点。
- 纯数字正文、评论按钮/输入框、缺少作者、占位“公开用户”、多评论容器和结构不完整候选全部安全拒绝。
- 页面提供 `data-comment-id` 时标为 `page-attribute`；未提供时使用目标作品、明确作者和正文生成 `synthetic-content-hash`，并在 UI 清楚说明不是页面稳定 ID。
- 浏览器端生成 `douyin-comment-source-proof/v1`，固定声明评论列表、评论项、作者和正文结构，并绑定目标作品 ID 与评论 ID 清单。
- 桌面主进程在任何写库动作前二次验证作品路由、唯一作品实体、证明字段、评论清单、正文、作者和评论 ID；缺少证明的旧连接器结果整批拒绝。
- 评论表新增 ID 来源、来源验证状态和来源证明；迁移只为旧记录补默认“来源未验证”，不删除旧数据。
- 作品详情改为逐条显示公开作者、正文、评论 ID、ID 来源、公开作者 ID、点赞、发布时间、采集时间、所属作品、采集结构和原作品入口；旧记录显著提示不能作为有效评论验收。
- 真实云评论批次只接收 `source_verified=1` 的评论；离线演示评论仍可用于演示流程。当前错误评论不会被云分析选中。
- 评论检查点改为使用目标作品 ID，不再错误使用博主 ID。
- 版本固定扩展 ID 仍为 `fejndacdabkgahmfpfjaghhedbdehonh`，不修改 Edge，不改变采集范围，不启动媒体、ASR/OCR 或云调用。

自动测试已覆盖真实 DOM 模拟、纯数字拒绝、输入框排除、缺少/多个评论列表拒绝、合成 ID、评论证明绑定、桌面入库二次闸门、持久化证明、旧评论云端排除和评论详情审计字段。当前正式数据库与三个 completed 任务保持原状；安装器部署和受控评论重试仍须按后续步骤执行。

## 6. 当前安装与数据状态

用户的安装目录此前为：

```text
E:\InforWork\Signal Desk
```

用户当前已安装的主程序为 `0.1.10`，安装目录仍为 `E:\InforWork\Signal Desk`；C 盘稳定连接器为 `0.1.6`。`0.1.11` 已修复冷启动任务调度竞态并完成打包，但尚未覆盖安装；最新状态和严格下一步以第 0 节为准。

业务数据目录：

```text
%APPDATA%\Signal Desk
```

核心数据库：

```text
%APPDATA%\Signal Desk\signal-desk.sqlite
```

重要说明：

- 不要删除 `%APPDATA%\Signal Desk`。
- 不要要求用户重新载入演示资料。
- 用户之前的收藏、稍后看、星标和批注已经被迁移验证为可保留。
- 清理前完整回滚备份位于 `C:\Users\Administrator\AppData\Roaming\Signal Desk Backups\pre-cleanup-sync-following-1788357514501-20260902-224140`，不得删除。
- 数据库采用 WAL；如需再次人工备份，应先正常关闭 Signal Desk，再复制整个用户数据目录。
- 演示资料已由用户通过 `0.1.4` 的应用内确认流程清理。不要让用户重新载入演示资料。
- 旧扩展 ID `knpefdpoedgfgndggjdkjgnfgomnllng` 是从 `E:` 可移动盘路径生成的历史 ID，Chrome 已将其清退；不要再从 `E:` 加载。
- 固定扩展版本为 `0.1.6`，固定 ID 必须继续为 `fejndacdabkgahmfpfjaghhedbdehonh`，稳定加载目录必须继续为 `C:\Users\Administrator\AppData\Local\Signal Desk\BrowserConnector\extension`。
- 2026-09-04 最新真实评论复验已经通过，数据库为 `user_version=4`、`creators=1 / works=1 / comments=1`，三个 `collection.*` 任务均为 `completed`；评论正文为“哪个agent”，来源已验证。错误评论清理和任务 #3 定向重置均已完成，不得重复执行。
- `0.1.11` 的普通打包冒烟和正式库只读副本升级冒烟均已通过。先安装并验证 `0.1.11`；之后若扩大到 `3/5/20`，仍必须取得用户新的明确授权，且仍不得同时启动媒体、ASR/OCR 或云端分析。

## 7. 最终交付物

### 7.1 当前推荐安装器

文件：

```text
D:\AI_WorkSpace\SpatialWarehouse\AI_InformationWorkflowCreationCenter\release\SignalDesk-0.1.11-x64.exe
```

SHA-256：

```text
20822412F3A385044C86488FAA9655674344871FCDD4E3C9E1B290C175388D7C
```

文件大小：

```text
222,059,587 字节
```

### 7.2 当前免安装版本

主程序：

```text
D:\AI_WorkSpace\SpatialWarehouse\AI_InformationWorkflowCreationCenter\release\win-unpacked\Signal Desk.exe
```

SHA-256：

```text
053719A8AFFBC0E52E464CE03F8F20899C5D8A2FD6C13CCB396968F26E8248ED
```

文件大小：

```text
210,896,896 字节
```

## 8. 自动验证状态

`0.1.10` 已通过此前全部回归，并新增通过：

- TypeScript `tsc --noEmit`。
- Vitest：6 个测试文件、42 个测试。
- Python 工作器：2 个测试。
- 浏览器内容脚本：推荐/导航/侧栏噪声隔离、可信容器缺失阻断、关注页签验证、真实“关注（数字）”关系弹窗、`user-fans-container`、逐记录“已关注”证明、粉丝页签阻断、缺少关系标记阻断、多个弹窗阻断、内部滚动容器、虚拟列表跨轮累积、明确空状态、未知 action 拒绝，以及博主/作品/评论限额测试。
- electron-vite build。
- NSIS 安装器构建。
- Native Messaging 长度前缀协议与随机密钥代理测试。
- Native Messaging 清单真实扩展 ID、稳定目录覆盖参数与打包排除规则测试。
- 扩展固定公钥到固定 ID 的推导测试。
- C 盘稳定目录逐文件部署与 SHA-256 一致性测试。
- Native Host 版本隔离目录、部署状态文件和错误旧 ID拒绝测试。
- NSIS `customInstall` 自动部署/注册钩子编译测试。
- 最终 `win-unpacked` 资源不含用户相关 `com.signaldesk.bridge.json` 的强制检查。
- 浏览器连接器强制重连、重连状态反馈、旧/新 Port 竞态，以及复用相同本人关注路由时不刷新/不关闭关系弹窗的回归测试。
- 打包后真实 Electron EXE 启动测试。
- preload 桥注入测试。
- React 首页渲染测试。
- Dashboard IPC 测试。
- 桌面端 collection gate：无来源证明零入库、proof ID/profile ID 不匹配、重复 creator、`isFollowing=false`、错误 host/path、实体混入和合法空列表检查点测试。
- Bridge receipt 与 background 状态：业务拒绝不误报桌面离线、只有 accepted envelope 才触发数据更新、Native Host 原样转发 receipt。
- 小样本确认框、默认 3/5/20 范围、主进程范围校验和仅页面采集模式测试。
- 演示资料载入测试。
- 演示资料范围统计、混合库真实数据保留、运行任务阻断、纯演示库同步状态复位及重复清理安全测试。
- 文本与视觉服务独立配置、密钥保存和旧配置迁移测试。
- `AI`、`金融`、`科技`和博主名称搜索测试。
- 作品领域、博主领域和演示标识详情测试。
- 缺失指标演示样本测试。
- 历史验证：曾使用用户当时的 `0.1.1` 数据库只读快照完成 `0.1.2` 升级测试，作品数、博主数、星标数和批注数保持一致。
- 严格评论 DOM：唯一 `comment-list/comment-mainContent`、精确 `comment-item`、作者区、相邻正文、输入框隔离、纯数字拒绝、缺失/多容器拒绝和页面/合成 ID 测试。
- 桌面评论闸门：目标作品、来源证明、评论 ID 清单、作者、正文、ID 来源二次核验，失败时零入库。
- 评论来源证明持久化、作品 ID 检查点、旧评论云端排除和离线演示兼容测试。
- 打包版可审计评论详情：公开作者、评论 ID、ID 来源、采集时间、所属作品、来源状态和原作品入口。
- 使用当前正式数据库的只读备份副本完成 `0.1.10` 升级冒烟，原库计数和个人状态快照保持一致。

最终打包 EXE 的常规冒烟结果：

```json
{
  "preloadBridge": "ok",
  "renderer": "ok",
  "dashboardIpc": "ok",
  "boundedSync": "ok",
  "cloudProviders": "ok",
  "demoSearch": "ok",
  "demoDetail": "ok",
  "commentAuditUi": "ok",
  "demoCleanup": "ok",
  "upgradeSnapshot": "not-requested"
}
```

最小窗口视觉检查截图：

```text
release-0.1.5-final\sample-sync-confirm-1120x720.png
```

截图验证了 `1120×720` 最小窗口下的小样本确认框、默认 3 / 5 / 20 范围、最多 15 个作品 / 300 条评论，以及“本阶段不启动媒体或云端处理”的提示。

历史 `0.1.2` 使用用户数据库只读快照时的升级冒烟结果（本轮未再次读取用户当前数据库）：

```json
{
  "preloadBridge": "ok",
  "renderer": "ok",
  "dashboardIpc": "ok",
  "demoSearch": "ok",
  "demoDetail": "ok",
  "upgradeSnapshot": "ok"
}
```

## 9. 新窗口从哪里继续

关注关系弹窗、稳定连接器部署、严格评论来源闸门和可审计详情均已实现。下一窗口严格按以下顺序继续：

1. 保持当前正式数据库和任务不动；先正常关闭 Signal Desk 与 Chrome。
2. 运行 `release\SignalDesk-0.1.10-x64.exe`，覆盖安装到原 `E:\InforWork\Signal Desk`；安装器会自动把兼容的连接器 `0.1.6` 部署到固定 C 盘目录，只注册 Chrome，不修改 Edge。
3. 打开 Chrome 的 `chrome://extensions`，对固定 ID `fejndacdabkgahmfpfjaghhedbdehonh` 点击一次“重新加载”，确认版本为 `0.1.6`；不要从 E 盘或源码目录重新加载。
4. 启动 Signal Desk，确认作品详情中的旧评论 `32` 显示“来源未验证”，并确认扩展与桌面端双方在线。此时仍不要点击“小样本同步”或“恢复”。
5. 取得用户明确授权后，先关闭 Signal Desk，并对整个正式用户数据目录做新完整备份；然后用严格前置断言确认 `creators=1 / works=1 / comments=1`、目标作品 `7664620658675961094`、评论正文 `32`、评论 ID `comment-6dd16729`、任务 #1～#3 均 completed、无媒体/云/分析任务。
6. 只删除错误评论及其搜索索引，只把任务 `#3 collection.work_comments` 精确重置为 queued；保留正确博主、作品、任务 #1/#2、指标和个人状态。不要新建整套同步。
7. 打开目标作品评论页并确认真实评论已加载，让 `0.1.6` 定向重试任务 #3。若结构证明不足，任务应进入“需要操作”且零新增评论；不得放宽选择器。
8. 完成后在作品详情核对公开作者、正文、评论 ID/ID 来源、采集时间、所属作品和“来源已验证”，再由用户对照 Chrome 页面确认具体评论。
9. 只有评论人工确认与只读数据库核验同时通过，才可考虑恢复 `3/5/20`。此前不得进入媒体、ASR/OCR、BYOK 文本分析或视觉分析阶段。

## 10. 后续测试顺序

不要同时启用所有功能。建议严格按以下顺序推进：

### 阶段 6：处理演示数据隔离或清理

已通过。用户已在 `0.1.4` 中亲自确认并完成演示资料清理。

### 阶段 7：安装浏览器只读连接器

已通过。旧的 E 盘加载方式在重启后会被 Chrome 清退，已经由 `0.1.8` 改为 C 盘固定目录和固定身份。用户已完成固定扩展的一次性 Chrome 界面加载并确认双方在线；当前稳定目录仍是 `0.1.5`，安装 `0.1.10` 后由安装器升级为 `0.1.6`，再点击 Chrome 卡片上的一次“重新加载”。

Chrome：

```text
chrome://extensions
```

Edge：

```text
edge://extensions
```

操作：

1. 启用开发者模式。
2. 选择三个开发者按钮中的第一个“加载未打包的扩展程序”；不要选择第二个“打包扩展程序”。
3. 选择 C 盘稳定目录中的：

```text
C:\Users\Administrator\AppData\Local\Signal Desk\BrowserConnector\extension
```

4. 安装 `0.1.10` 后确认版本为 `0.1.6`，ID 为 `fejndacdabkgahmfpfjaghhedbdehonh`。
5. 保持 Signal Desk 桌面端运行，打开扩展弹窗验证连接状态。

安装器已自动部署连接器和恢复注册，通常不再需要手动运行 `install.ps1`。授权清单位于 `%LOCALAPPDATA%\Signal Desk\NativeMessagingHosts`，Host 和扩展均位于固定 C 盘用户目录；移动 E 盘应用安装目录不再影响 Chrome 扩展。

### 阶段 8：真实抖音小样本采集

`0.1.7` 的关注来源闸门、`0.1.8` 的稳定部署、`0.1.9` 的真实关系弹窗适配，以及 `0.1.10` / 连接器 `0.1.6` 的严格评论来源闸门均已构建并通过自动测试；真实 `1/1/1` 的旧版评论误采导致整体真实 DOM 采集仍未通过。安装新版后仍只允许对同一作品定向复验：

2026-09-04 第一次 `1/1/1` 真实尝试在关注列表阶段安全进入“需要操作”：`无法唯一验证已激活的“关注”页签（找到 0 个；结构标记：data-e2e:user-info-follow）`。扩展仍显示在线，这是页面结构验证失败而不是连接故障。只读数据库复核确认任务 `#1 collection.following` 为 `blocked_user_action`，范围为 `1/1/1 + collectionOnly`；博主、作品、评论、指标、检查点、搜索索引和收件箱状态均为 0，`last_sync_at=NULL`，`integrity_check=ok`，无外键违规。真实弹窗结构证据已取得并完成严格适配；用户重新加载扩展 `0.1.5` 并重新打开关系弹窗后，应只恢复这个现有任务。

2026-09-04 重新加载连接器 `0.1.5`、打开真实关注关系弹窗并恢复原任务后，三个采集任务均已完成，任务中心显示 `1 位博主 / 1 个作品 / 1 条评论`。用户人工确认候选博主正确、本人确实关注该博主，并确认作品 `7664620658675961094` 确实属于该博主；因此关注来源与作品归属通过本轮验收。作品标题、描述和发布时间等元数据仍不完整，不应描述为作品元数据已完全验收通过。

评论验收失败。正式数据库只读核验发现唯一评论为：`platform_comment_id=comment-6dd16729`、正文=`32`、公开作者=`公开用户`、公开作者 ID/点赞数/发布时间均为空，所属作品为 `https://www.douyin.com/video/7664620658675961094`。`32` 极可能是评论数量、评论按钮或评论区控件数字，不是可验证的真人评论。根因是 `collectWorkComments()` 使用了过宽的全局选择器 `[data-e2e*="comment"], [class*="comment-item"], [class*="CommentItem"]`，随后直接把整个候选元素可见文本当作正文；缺少作者时又自动回退为“公开用户”，缺少页面评论 ID 时则根据正文生成合成 ID。桌面端当前只验证来源作品 ID，没有验证唯一评论区容器、真实评论项、正文节点、作者节点或评论来源证明，因此该误采通过了入库闸门。

当前验收结论必须保持为：

- 关注博主：通过。
- 作品归属：通过；作品元数据质量尚不完整。
- 评论：失败。
- 整体真实 DOM 采集：尚未通过。

Signal Desk 作品详情已有“代表评论”区域，但当前查询和界面只展示匿名作者标识、正文、点赞数，未清楚展示公开作者、平台评论 ID、采集时间、所属作品链接及来源验证状态。用户无法仅凭应用界面确认本次采到了哪条真实评论。因此还需要补齐可审计评论详情 UI；同时必须根据真实作品评论区 DOM 证据实现严格评论来源证明和桌面入库二次闸门。修复前不得删除当前误采记录、不得自动重置或重试任务 `#3`，不得恢复 `3/5/20`。

- 最多 1 位关注博主。
- 每位最多 1 个作品。
- 每个作品最多 1 条可见评论。
- 本阶段只采集页面资料，不启动媒体、ASR/OCR 或云端处理。

只有严格评论采集修复完成、受控重试成功，并由用户确认候选确实已关注、作品归属正确且具体评论正文真实之后，才可考虑恢复原定范围：

- 最多 3 位关注博主。
- 每位最多 5 个作品。
- 每个作品最多 20 条可见评论。
- 最多 15 个作品、300 条评论；实际数量可以更少。
- 本阶段只采集页面资料，不启动媒体、ASR/OCR 或云端处理。

样本尽可能包含：

- 包含不同领域。
- 至少一个视频和一个图文作品。
- 至少一个评论较多的作品。

重点检查：

- 博主昵称、简介、头像和主页。
- 作品标题、描述、时间和 URL。
- 公开指标。
- 页面未显示指标保持不可见。
- 可见评论采集。
- 重复采集不创建重复作品。
- 新指标追加快照。
- 验证码、登录失效和频控时暂停。
- 候选博主必须有可信的“来自当前账号关注列表”证明；推荐区、侧栏或任意 `/user/` 链接不得入库。

不要一开始同步全部关注列表或几百位博主。

### 阶段 9：本地 ASR/OCR

默认安装器没有完整携带 Python 3.11、大型 ASR/OCR 包和模型。

先确认：

```powershell
py -3.11 --version
```

然后在设置页：

1. 点击“检查本地 AI”。
2. 核对 Python 3.11、FFmpeg、FFprobe、faster-whisper 和 PaddleOCR。
3. 用户明确点击“安装本地 ASR/OCR”。
4. 先用一个 30～90 秒、语音清晰且有字幕的视频测试。

不要使用 Python 3.14 创建本项目媒体工作环境。

### 阶段 10：BYOK 文本云分析

先只配置文本模型，不配置视觉模型。第一次只处理 1～3 个作品。

检查：

- 点击“预估”不调用云 API。
- 批次显示作品、评论、token 和费用。
- 用户确认前没有费用。
- 确认后只执行固化清单。
- 新采集数据进入下一批。
- API Key 不出现在数据库、日志和导出文件。

### 阶段 11：视觉分析

文本闭环稳定后，再使用一个作品测试视觉模型：

- 只上传压缩、去重的关键帧。
- 不上传完整视频。
- 核对图片数和图片单价。
- 结果明确标记为静态帧补充分析。

## 11. 主要源码位置

```text
README.md
package.json
electron.vite.config.ts
src/main/index.ts
src/main/database.ts
src/main/schema.ts
src/main/taskRunner.ts
src/main/cloudService.ts
src/main/workerClient.ts
src/main/bridgeServer.ts
src/preload/index.ts
src/renderer/src/App.tsx
src/renderer/src/styles.css
src/shared/contracts.ts
worker/media_worker.py
browser-connector/extension/
browser-connector/native-host/SignalDesk.NativeHost.cs
browser-connector/build-native-host.ps1
scripts/test-native-host.mjs
scripts/test-packaged-renderer.mjs
scripts/prepare-python-runtime.ps1
```

## 12. 常用开发和验证命令

```powershell
npm run check
npm run test:native-host
npm run test:native-manifest
npm run test:connector-background
npm run test:packaged-renderer
node --check browser-connector/extension/background.js
node --check browser-connector/extension/content.js
node --check browser-connector/extension/popup.js
npm audit --omit=dev --audit-level=high
```

构建免安装版本：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run package
```

构建 NSIS 安装器：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist:win
```

项目最初不是 Git 仓库。开始新的修改前不要假定存在可用的提交历史或回滚点。

## 13. 当前已知限制

- 已使用用户真实抖音登录态执行过一次 3/5/20 小样本，旧版关注列表候选识别失败并采到未关注博主；该无效批次已精确清理，完整回滚备份仍保留。
- 抖音 DOM、无限滚动和页面选择器只能尽力而为，平台改版后需要维护。
- `0.1.7` 已移除全局 `/user/` 扫描并实现双层来源闸门，`0.1.8` 修复连接器部署稳定性，`0.1.9` 严格适配真实关注关系弹窗；真实 `1/1/1` 已确认关注来源和作品归属，但评论选择器误把正文为 `32` 的页面控件当作评论，评论及整体真实 DOM 采集验收失败。修复前不得恢复 `3/5/20`。
- 删除、私密、地区限制、权限外、页面未加载和被风控阻断的数据无法保证采集。
- 不存在验证码、登录、DRM、签名、`blob:` 或风控绕过。
- 默认安装器没有物理携带完整 Python 3.11、大型 ASR/OCR 包及模型。
- 真正完全自包含的构建需要先运行 `scripts\prepare-python-runtime.ps1`，然后重新打包。
- 云 API 没有使用用户 API Key 实际调用。
- 视觉批次逻辑已测试，但尚未对某个真实云服务商完成远程调用。
- 当前使用 Electron 默认图标。
- 安装器没有商业代码签名证书，Windows 可能显示未知发布者。

## 14. 新窗口建议开场提示

用户可以在新窗口直接发送：

```text
请完整阅读项目根目录的 TEMP_HANDOFF_SIGNAL_DESK_2026-08-30.md，尤其是 5.9～5.12、6、7、9 和阶段 8。Signal Desk 0.1.10 / 连接器 0.1.6 已依据用户真实评论 DOM 截图实现严格评论来源证明、桌面入库二次闸门和可审计评论详情：唯一 comment-list/comment-mainContent、精确 comment-item、comment-item-info-wrap 作者区和相邻正文；评论输入框、按钮、纯数字、缺少作者和全局模糊匹配均拒绝。固定扩展 ID 仍为 fejndacdabkgahmfpfjaghhedbdehonh。npm run check 已通过 6 个测试文件/42 项测试，安装器和普通打包版冒烟通过，正式数据库只读副本升级冒烟通过。安装器为 release\SignalDesk-0.1.10-x64.exe，SHA-256 93AA126F3DCE22781B3FC6A08621461D890A23AEE9001798D8E495229F7C9DBF。当前实际安装仍是主程序 0.1.8 / C 盘连接器 0.1.5，正式库仍为 user_version=3、1 位博主/1 个作品/1 条错误评论“32”、三个 collection 任务 completed；没有被删除、迁移或重试。下一步先关闭 Chrome 和 Signal Desk，覆盖安装 0.1.10，让安装器部署 0.1.6，Chrome 重新加载并确认双方在线。得到用户明确授权后再完整备份、严格断言、只删除错误评论及索引并定向重置任务 #3；不得新建整套同步、恢复 3/5/20，或启动媒体、ASR/OCR、云分析。
```

接手模型应先完整阅读本文件，再检查当前工作区实际状态。不要重做已经完成的实现，也不要把尚未执行的真实采集、ASR/OCR 和云调用误报为已通过。
