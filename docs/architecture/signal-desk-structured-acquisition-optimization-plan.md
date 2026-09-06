# Signal Desk 结构化采集与理解可执行优化方案

> 版本：规划基线 `2026-09-05`  
> 状态：`R0～R4` 已完成离线实现与合成/模拟测试；`R5～R8` 未实施，尚未开始新的真实采集或正式库迁移
> 社区证据库：[`signal-desk-community-validated-routes-2026-09-05.md`](../research/signal-desk-community-validated-routes-2026-09-05.md)

## 1. 要解决的真实问题

`0.2.3` 的 24 个样本不能证明来自关注账号。虽然流程先打开了目标博主主页，但作品链接取自 `inferred:common-work-ancestor-div`，随后程序把“当前目标博主 ID”直接写入候选的 `creatorId`，最终校验又只检查这个自填值。用户观察到主页约一秒内关闭、多个作品所属账号并未关注，与代码和 run 证据一致：这是循环证明，不是独立作者证明。

`0.2.4` 只修复评论探针和汇总，没有修复作品归属链，因此已停止且没有生成新 run。继续调等待时间、选择器或 DOM 容器不会解决根因。

本方案的目标是把 Signal Desk 的平台事实层改成结构化、可证明、可切换的适配器系统：

```text
Network-first
  → embedded structured state
  → controlled page-context read-only request
  → DOM navigation / lazy-load trigger / shadow only
  → no structured proof = reject
```

## 2. 不变边界

实施和验证期间持续执行以下边界：

- 不恢复、不重试、不删除、不清理正式任务 `#7、#8、#10、#11、#12、#13、#14、#16`；
- 不点击正式系统全局恢复，不写正式 SQLite，不迁移正式用户数据；
- 不备份、清理、重置或删除用户数据；
- 未经另行批准不启动媒体、ASR、OCR、BYOK 或云分析；
- 不读取、打印、持久化或上传 Cookie、Authorization、Bearer、签名值、密码或完整浏览器配置；
- 不使用 `yt-dlp --cookies-from-browser`；
- 不执行点赞、评论、关注、取消关注、私信、发布或其他写操作；
- 不绕过登录、CAPTCHA、安全验证或风控；
- 不把 DOM 成功冒充为结构化成功；
- 不把 discovery PoC、合成测试或社区项目成功冒充为产品验收。

## 3. 保留、修改和替换的现有实现

| 模块 | 决策 | 具体动作 |
|---|---|---|
| `src/shared/platformAdapter.ts` | 保留并扩展 | 增加独立作者证明、schema fingerprint、route trace 和更完整错误码 |
| `src/main/platformAdapterSecurity.ts` | 保留并加固 | 继续 endpoint 参数白名单、header deny-by-default、日志递归脱敏；增加完整 URL/签名落盘的负面测试 |
| `docs/architecture/platform-adapter-phase-a.md` | 保留为阶段 A 冻结依据 | 新合同若改变需增量版本化，不覆盖旧证据 |
| `browser-connector/extension/background.js` | 重构 | 加入按 tab 生命周期管理的 Network Observer，先 attach 再导航/触发 |
| `browser-connector/extension/content.js` | 降权 | DOM 只允许导航、打开面板、触发懒加载和 shadow 对照；删除其正式事实源职责 |
| `src/main/taskRunner.ts` | 修改 | 正式接收适配器 page/proof；修复自填 `creatorId` 的循环校验、单任务锁死全局、范围扩大去重和精确恢复 |
| `src/main/schema.ts` / `database.ts` | 先设计迁移，暂不动正式库 | 增加来源证明、route trace、claim/evidence 等结构；只在测试库验证迁移 |
| `worker/media_worker.py` | 保留 | 为 faster-whisper/whisper.cpp 与 PaddleOCR 增加基准和 provider 状态，不在本轮自动运行 |
| `src/main/cloudService.ts` | 扩展 | 总结输出绑定 evidence refs；网友发言另建 claim-level 核验，不混进普通总结 |
| `src/shared/ranking.ts` | 延后修改 | 统计来源稳定后再纳入 `share_count`，按缺失值处理，先做固定基准 |
| `poc/phase-b/runs/*` | 只读保留 | 三个旧 run 是失败证据，不删除、不覆盖、不当成正式样本 |

## 4. 新的来源证明合同

### 4.1 作者归属必须是独立证明

每个作品候选新增以下字段：

```ts
type WorkAuthorProof = {
  contract: 'douyin-work-author-proof/v2'
  followedCreatorId: string
  profileRouteCreatorId: string
  requestTargetCreatorId: string
  observedWorkAuthorId: string
  observedWorkId: string
  authorProofSource: 'network-response' | 'embedded-json' | 'page-context-fetch'
  endpointKind: 'creator-work-list' | 'work-detail' | 'follow-feed'
  observedAt: string
  schemaFingerprint: string
  responseProjectionSha256: string
}
```

接纳条件是：

```text
followedCreatorId
  = profileRouteCreatorId
  = requestTargetCreatorId（若 endpoint 有此参数）
  = observedWorkAuthorId
```

`observedWorkAuthorId` 必须直接来自作品列表项或作品详情的结构化 `author.uid/sec_uid`。程序不得从循环变量、当前主页或任务目标回填这个字段。任意一处不一致都产生 `AUTHOR_PROOF_MISMATCH`，该作品拒绝；若是采样 run 中的严重错配，整批判失败。

### 4.2 结构化响应证明

在现有 proof 基础上增加：

- `routeId` 与 `adapterVersion`；
- `endpointKind`；
- `schemaFingerprint`：只对字段路径和类型的规范化结果哈希，不含值；
- `cursorIn/cursorOut/hasMore/reportedTotal`；
- `returnedIds`；
- `responseProjectionSha256`：仅对白名单投影计算；
- `requestParameters`：只保存 endpoint 允许的业务参数；
- `validationResults`；
- 非敏感 `routeTrace`。

禁止保存原始响应体、原始 headers、完整 URL、Cookie、签名输入或签名结果。签名如确需使用，只能存在于页面/扩展内存，并随请求完成销毁。

### 4.3 原生 ID 门禁

- 作品必须有结构化响应中的原生 `aweme_id`；
- 评论必须有原生 `cid`，并满足其 `aweme_id` 等于目标作品；
- 回复必须有原生 `cid` 和可验证的根/父评论关系；
- `synthetic-content-hash` 仅作为历史记录的兼容显示，禁止新结构化采集生成；
- `verified-empty` 只在结构化响应明确 `reportedTotal=0`、`hasMore=false` 且 items 为空时成立。

## 5. Network Observer 与 schema classifier

正式扩展继续使用 Chrome 官方 `chrome.debugger`/CDP，不把 Playwright 变成强制运行依赖。

执行顺序固定为：

1. 为目标 tab attach；
2. 调用 `Network.enable`；
3. 注册 request/response 生命周期和 bounded in-memory buffer；
4. 再执行导航、语义点击或滚动触发；
5. 仅对 Fetch/XHR、允许 host、候选 path、成功 JSON 响应调用 `Network.getResponseBody`；
6. 先做大小上限、content-type 和 JSON 解析；
7. 用 path classifier 与 schema classifier 双重识别；
8. 只产生白名单投影、ID、分页、fingerprint 和哈希；
9. 立即丢弃原始响应体；
10. tab 完成或超时后 detach，并清空内存缓冲。

classifier 至少覆盖：

- `following-list`；
- `creator-work-list`；
- `work-detail`；
- `comment-list`；
- `comment-reply-list`；
- `media-resource`。

路径变化但 schema 相同：记录 `UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA`，只进入隔离报告，默认不入正式数据；经审查更新 allowlist 后再启用。路径相同但 schema 改变：报 `SCHEMA_CHANGED` 并停用该 route，绝不自动 DOM 降级。

## 6. 每项能力的主路线和预设替代路线

### 6.1 关注关系

| 优先级 | Route ID | 路线 | 接纳要求 |
|---:|---|---|---|
| 1 | `DY-FOLLOW-NETWORK` | 被动捕获页面已发出的 `/aweme/v1/web/user/following/list/` 响应 | 当前登录用户目标一致；原生 creator ID；分页闭合 |
| 2 | `DY-FOLLOW-EMBEDDED` | 读取页面 hydration/SSR 的结构化关注数据 | schema 完整且能证明关系为 following；缺字段即拒绝 |
| 3 | `DY-FOLLOW-INPAGE` | 在已登录页面上下文复用已观察成功的只读 GET | 仅 GET；参数白名单；凭据/签名不离开内存 |
| 4 | `DY-FOLLOW-CLEANROOM` | 依据 Apache-2.0 F2 的 endpoint/model 行为洁净重写 adapter | 必须通过合成测试和小 PoC；不复制凭据管理实现 |
| 停止 | `DY-FOLLOW-STOP` | 没有结构化证明 | 不产生关注候选；DOM 仅报告 shadow 差异 |

`/follow/feed/` 可用于发现作品，不单独证明关注列表完整性；其中每个作品仍需结构化作者 ID 与已证明关注 creator ID 对齐。

### 6.2 账号作品与作者归属

| 优先级 | Route ID | 路线 | 接纳要求 |
|---:|---|---|---|
| 1 | `DY-WORKS-NETWORK` | 捕获 `/aweme/v1/web/aweme/post/` 的 `aweme_list` | 请求目标 ID 与每项 `author.uid/sec_uid` 一致；cursor 闭合 |
| 2 | `DY-WORKS-EMBEDDED` | 读取主页结构化 hydration state | 每项同时有 `aweme_id` 和作者 ID；不能只从链接反推 |
| 3 | `DY-WORKS-INPAGE` | 页面上下文发起受控只读作品 GET | 仅白名单参数；结构化 schema 验证 |
| 4 | `DY-WORK-DETAIL-VERIFY` | 对候选调用/捕获 `/aweme/detail/` 独立复核 | 详情 `aweme_id` 和作者 ID 与候选一致 |
| 5 | `DY-FOLLOW-FEED` | 从结构化关注作品流发现候选 | 仍需详情或作品项作者证明，不因来自 feed 就默认关注 |
| 停止 | `DY-WORKS-STOP` | 所有结构化路线均失败 | 候选为 0；`common-work-ancestor` 只能触发/诊断 |

任何路线都不能把当前循环中的 creator ID写成 `observedWorkAuthorId`。主页打开时间长短不再作为成功判据；成功只由结构化响应和 proof 决定。

### 6.3 作品详情和互动指标

| 优先级 | Route ID | 路线 | 接纳要求 |
|---:|---|---|---|
| 1 | `DY-DETAIL-NETWORK` | 捕获 `/aweme/v1/web/aweme/detail/` | 返回作品 ID、作者 ID 与目标一致 |
| 2 | `DY-DETAIL-EMBEDDED` | `_ROUTER_DATA` 等内嵌详情对象 | schema fingerprint 已登记，目标 ID 一致 |
| 3 | `DY-DETAIL-INPAGE` | 页面上下文只读详情 GET | 参数白名单、签名内存化、无写副作用 |

点赞、评论、收藏、分享、播放等仅从列表/详情 `statistics` 白名单字段读取。第二个结构化来源可做交叉核验；两者差异超过时间窗口允许范围时记录 snapshot 差异而非任意选一个。禁止调用 F2 示例中可能增加播放量的 `/aweme/v2/web/aweme/stats/`，禁止把 DOM 的“1.2万”作为主数据或猜测整数。

### 6.4 一级评论和二级回复

| 优先级 | Route ID | 路线 | 接纳要求 |
|---:|---|---|---|
| 1 | `DY-COMMENT-NETWORK` | 捕获 `/aweme/v1/web/comment/list/` | 原生 `cid`；每项 `aweme_id` 匹配；cursor/has_more 合法 |
| 2 | `DY-COMMENT-EMBEDDED` | 读取首屏 SSR/hydration comments | 仅接纳结构化且目标一致的首屏；不能假定完整 |
| 3 | `DY-COMMENT-INPAGE` | 在页面上下文复用只读 GET | 只改 cursor/count 等白名单业务参数；重新验证签名和 schema |
| 4 | `DY-COMMENT-TRIGGER` | 滚动/打开评论面板触发下一页 | 动作只负责触发；事实仍来自 Network JSON |
| 5 | `DY-COMMENT-CLEANROOM` | 按 F2/MediaCrawler 行为洁净重写 endpoint adapter | 必须走相同来源证明和安全门禁 |
| 停止 | `DY-COMMENT-STOP` | 结构化路线均失败 | 标记未验证，不产生合成 ID，不把 DOM 内容入库 |

回复单独使用 `DY-REPLY-*` 路线和 `/comment/list/reply/`，不得把一级评论数组误判为回复完整。DOM 评论列表只能用于 shadow：比较可见条数、正文摘要哈希和页面空态，不参与正式入库。

### 6.5 媒体

| 优先级 | Route ID | 路线 | 接纳要求 |
|---:|---|---|---|
| 1 | `DY-MEDIA-DETAIL` | 详情响应中的视频/音频/图片资源 | HTTPS；作品 ID 绑定；URL 仅在受控生命周期使用 |
| 2 | `DY-MEDIA-NETWORK` | 页面已经加载的媒体 Network/Performance 资源 | 与目标媒体元素/作品证明绑定，排除广告和推荐资源 |
| 3 | `DY-MEDIA-YTDLP-PUBLIC` | 把已取得的公开 URL交给隔离 yt-dlp | 不读取浏览器 Cookie；不替代来源证明 |
| 停止 | `DY-MEDIA-STOP` | 无可验证资源或 URL 过期 | 保留可重试状态，不启动 ASR/OCR，不猜 URL |

媒体处理必须由用户显式选择或既有授权范围触发；本计划编写不运行媒体工具。

### 6.6 ASR、OCR 与内容总结

ASR 主路线为 `faster-whisper small / CPU INT8`，备选为 `whisper.cpp`。切换只在固定基准中比较安装成功率、实时系数、内存、空转写率、中文字符错误和时间戳误差；某 provider 失败时保留音频提取结果和结构化错误，不伪造转写。

OCR 主路线为 PaddleOCR，备选为可选本地视觉模型或人工复核。低置信度、冲突字幕和装饰性文字标为 `unverified`，不得直接进入事实正文。

总结输入形成 evidence map：

```text
title/description → source text ID
ASR segment       → start/end timestamp
OCR block         → frame ref/time/confidence
key frame         → frame ref
comment           → native cid
```

每个总结点绑定一个或多个 evidence refs。ASR 与 OCR 冲突时输出冲突，不由模型静默裁决。分块/合并后进行自动覆盖率检查和随机人工抽检。

### 6.7 网友发言事实核验

该能力与普通评论总结分开，流水线固定为：

1. 判断是否为可验证事实性陈述；
2. 拆成 atomic claims；
3. 为每条 claim 生成检索问题；
4. 在获准的检索源中查找证据；
5. 去重和 rerank；
6. 生成 `supported/refuted/mixed/insufficient-evidence/time-sensitive/not-a-factual-claim`；
7. 输出引用、来源日期、检索时间、置信度和 justification；
8. 无充分证据即 abstain；低置信度进入人工复核队列。

主观意见、情绪、讽刺、偏好和价值判断不做真假评分。启用外部搜索或云模型前继续执行 BYOK、费用和隐私批准，不静默外发评论。

## 7. 统一路线切换状态机

每条 route 注册以下元数据：

```ts
type RoutePolicy = {
  routeId: string
  adapterVersion: string
  evidenceLevel: 'E1-source' | 'E2-doc' | 'E3-local-poc' | 'E4-product'
  allowedMethods: ['GET']
  maxAttempts: number
  timeoutMs: number
  switchOn: string[]
  nextRouteId: string | null
  requiresNewUserApproval: boolean
  eligibleForFormalData: boolean
}
```

切换规则：

- `not-observed`：只说明被动监听没看到请求，可转 embedded 或 in-page；
- `schema-missing/schema-changed`：当前 route 停用，不能在同一 route 重试不同解析器；
- `signature-unavailable/rejected`：最多一次重新发现，之后转 embedded 或停止；不暴力重试；
- `HTTP 403/401/login-required`：停止批次，要求用户恢复正常登录；
- `CAPTCHA/security-challenge`：立即停止，不自动处理；
- `HTTP 429/rate-limited`：尊重 Retry-After，结束当前 PoC，不跨账号规避；
- `cursor-loop`、空页但 `has_more=true`、ID 重复异常：协议失败，整条 route 停用；
- `author-proof-mismatch`：严重来源错误，拒绝作品并使当前验证批次失败；
- `DOM mismatch`：只记录 shadow 差异，不改变结构化事实，也不触发 DOM 入库。

示例路线 trace：

```text
DY-FOLLOW-NETWORK:not-observed
  → DY-FOLLOW-EMBEDDED:schema-missing
  → DY-FOLLOW-INPAGE:signature-unavailable
  → DY-FOLLOW-CLEANROOM:not-ready
  → DY-FOLLOW-STOP
```

trace 只保存 route、非敏感失败类、次数、耗时、schema fingerprint 和时间；禁止保存完整 URL、query、headers、body 或签名值。

## 8. 分阶段实施清单

为避免与已完成的历史“阶段 A”和已暂停的“阶段 B”混淆，新工作包使用 `R0～R8`。

### R0：冻结失败路线和验收口径

状态：已完成（2026-09-06）。`0.2.3` 已冻结为作者证明失败，`0.2.4` 的控制器与扩展启动入口均硬拒绝；历史 run 由 `poc/phase-b/FROZEN_RUNS.json` 记录摘要文件哈希和失败分类，原始目录保持只读且不进入测试。

改动：

- 将 `0.2.3` 标记为“作品归属证明失败”，24 个样本不得作为关注作品基准；
- 保留旧 run，仅作只读失败证据；测试必须另用合成 fixture；
- 禁止 `inferred:common-work-ancestor-div` 产生正式候选；
- `0.2.4` 永久退役并保持硬禁用，不因 R1～R4 完成而恢复；
- 建立 route registry 和证据等级枚举。

退出条件：单元测试能证明 DOM-only 候选被拒绝，自填作者 ID 被拒绝，历史 run 不被误判为通过。

### R1：扩展合同和安全门禁

状态：已完成（2026-09-06，仅合成 fixture）。已实现 `WorkAuthorProof/v2`、四 ID 一致与独立 observation 对照、原生 `aweme_id/cid` 门禁、schema fingerprint、白名单 projection hash、route registry/trace，以及 GET/path/参数/header/持久化字段安全负例。

主要文件：

- `src/shared/platformAdapter.ts`
- `src/main/platformAdapterSecurity.ts`
- 新增 `src/shared/structuredAcquisition.ts` 或等价模块
- 对应测试文件和纯合成 fixtures

改动：实现 `WorkAuthorProof/v2`、schema fingerprint、projection hash、route trace、原生 ID 门禁和新增错误类型。

退出条件：所有合成正/反例通过；未知参数、敏感 key、原始 response、完整 URL 和非 GET 方法均被拒绝。

### R2：实现通用 Network Observer

状态：已完成（2026-09-06，仅模拟 CDP）。Observer 已提取到 `browser-connector/extension/network-observer.js`，覆盖六类响应、attach-before-navigation、bounded buffer、path + schema 双分类、只保留投影、detach 清理；没有连接真实浏览器或平台。

主要文件：

- `browser-connector/extension/background.js`
- 新增独立 classifier/projection 模块，避免逻辑堆积在 background
- connector 测试和 fixture

改动：attach-before-navigation、`Network.enable`、响应体读取、bounded buffer、path + schema 双分类、投影后销毁、detach 清理。

退出条件：用合成 CDP 事件验证六类响应；敏感字段泄漏测试为零；path/schema 变体按预期分类。

### R3：关注列表结构化适配器

状态：已完成（2026-09-06，仅合成 fixture）。已实现 `DY-FOLLOW-NETWORK → DY-FOLLOW-EMBEDDED → DY-FOLLOW-INPAGE → DY-FOLLOW-STOP` 的固定切换、严格分页闭合、`douyin-following-structured-proof/v2`、schema/projection hash 和非敏感 route trace；正式 following 入库门禁已拒绝旧 DOM v1。生产连接器尚未把 Observer 投影桥接为 v2 envelope，因此本阶段不构成真实平台或 E4 验收。

主要文件：

- `src/main/douyinFollowingAdapter.ts`
- `src/shared/fixtures/douyin-following-pages.mock.json`
- `src/main/douyinFollowingAdapter.test.ts`
- `src/shared/contracts.ts`
- `src/main/taskRunner.ts`

改动：依次实现 `DY-FOLLOW-NETWORK`、`EMBEDDED`、`INPAGE`，把 DOM 关注弹窗降为导航/触发/shadow；F2 行为只用于 clean-room 模型参考。

退出条件：合成多页、空页、游标循环、重复 ID、403/429 和 schema 变化全部覆盖；没有结构化关系证明时 creator 数为 0。

### R4：作品、详情与作者独立证明

状态：已完成（2026-09-06，仅合成 fixture、模拟 route 和内存数据库）。已实现 `DY-WORKS-NETWORK → DY-WORKS-EMBEDDED → DY-WORKS-INPAGE → DY-WORKS-STOP` 与对应详情路线；列表页级 proof、逐作品 `WorkAuthorProof/v2` 和 `WorkDetailVerification/v1` 将关注目标、主页目标、请求目标、列表作者、详情请求作品、详情返回作品与详情作者闭合为独立证明链。详情失败、作者错配、目标 ID 错配或分页未闭合均整批返回零候选。

主要文件：

- `src/main/douyinWorkAdapters.ts`
- `src/main/douyinWorkAdapters.test.ts`
- `src/shared/fixtures/douyin-work-pages-r4.mock.json`
- `src/shared/fixtures/syntheticR4Proofs.ts`
- `src/shared/structuredAcquisition.ts`
- `src/main/taskRunner.ts`

改动：实现 `/aweme/post/`、详情复核、statistics 投影和四 ID 一致门禁；删除把目标 creator ID 回填成观察作者 ID 的路径。

退出条件：推荐作品混入、错误作者、伪填 creator ID、详情 ID 不一致均被拒绝；主页 DOM 链接不再产生候选。点赞、评论、收藏、分享、播放只投影安全非负整数或 `null`，列表与详情快照及差异字段分别保留，禁止猜测“1.2万”或静默合并。生产连接器尚未生成对应 v2 envelope，本阶段仍为 E2-doc 的离线实现，不构成 E3/E4。

### R5：评论和回复结构化适配器

改动：实现评论/回复 Network、embedded、in-page 和 trigger 路线；原生 `cid`；严格 `verified-empty`；分页断点与幂等。

退出条件：跨作品评论、重复 cid、cursor loop、空页但 has_more、评论关闭、真实空评论、未观察到 endpoint 等均有不同结果；DOM 结果只能出现在 shadow 报告。

### R6：任务系统和测试库集成

改动：`taskRunner` 使用适配器版本 + scope fingerprint 去重；单 item 失败不锁死无关任务；恢复必须精确到 job；只在临时测试库验证 schema/migration/幂等。

退出条件：不能触碰八个历史阻断任务；旧 completed 范围不阻碍新范围；任何来源证明失败都在数据库写入前被拒绝。

### R7：媒体、ASR/OCR、总结和事实核验合同

本阶段先实现合同、fixture、benchmark harness 和 UI 状态，不自动下载媒体或调用云服务。建立 faster-whisper/whisper.cpp、PaddleOCR、evidence map 和 claim/evidence/verdict schema。

退出条件：provider 失败不会生成伪结果；每个总结点可追溯；事实核验无证据会 abstain；外部调用仍受授权和费用闸门控制。

### R8：隔离真实验证与正式上线门禁

R8 必须由用户另行确认开始；输出只进新的隔离目录，不写正式 SQLite。

验证分三级：

1. `T1-discovery`：2～3 个入口，只发现实际 endpoint 和 schema，不称为样本通过；
2. `T2-shadow`：6 个作品，比较结构化与 DOM shadow，定位差异但 DOM 不覆盖事实；
3. `T3-acceptance`：从结构化证明的关注账号中自动抽取 20～30 个公开作品，推荐默认 24 个，执行完整验收。

R8 通过后仍需单独批准，才可设计正式数据库迁移和生产切换；不能因 PoC 成功自动上线。

## 9. 合成测试与故障注入矩阵

实现阶段必须先覆盖：

- 推荐内容混入账号主页或关注 feed；
- 作品作者 ID 与目标关注账号不一致；
- 程序把目标 ID伪填为观察作者 ID；
- endpoint path 变化但 schema 相同；
- path 相同但 schema 改变；
- 重复 ID、cursor 不前进、cursor 循环；
- 空页但 `has_more=true`；
- `reportedTotal=0` 与数组不一致；
- 跨作品评论、缺失 `cid`、父回复关系错误；
- 登录失效、验证码/安全验证、403、429、5xx、HTTP 200 空响应；
- Network attach 太晚、tab 路由漂移、响应体已被回收；
- Cookie、Authorization、签名、完整 query、未知设备 ID 企图进入日志；
- POST/PUT/PATCH/DELETE 或未知 endpoint 被请求层拒绝；
- 媒体 URL 过期；
- ASR 空转写、OCR 低置信度、ASR/OCR 冲突；
- 事实核验只有无来源模型判断、证据过期、claim 不是事实陈述。

## 10. 20～30 样本验收标准

`T3-acceptance` 同时满足以下条件才通过：

| 维度 | 硬门槛 |
|---|---|
| 样本来源 | 20～30 个；默认 24；全部由结构化关注关系自动发现，不要求用户粘贴 URL |
| 账号覆盖 | 尽量跨账号 round-robin，单账号最多 3 个；种子、范围和最终清单可复现 |
| 作者归属 | 100% 满足四 ID 一致；出现 1 个严重错配即整批失败 |
| 作品 ID | 100% 原生 `aweme_id`，不得只从任意 DOM 链接产生 |
| 评论 ID | 所有接纳评论均有原生 `cid`；跨作品评论为 0 |
| 空评论 | 只有结构化 total/has_more/items 闭合才能标 `verified-empty` |
| 分页 | 无 cursor loop、无空页继续、无未解释重复 ID；达到范围上限要标 partial 而非 complete |
| 来源通道 | 正式事实中 DOM 占比必须为 0%；DOM 只在 shadow 报告 |
| 安全 | 敏感值落盘/日志/上传为 0；写方法和副作用 endpoint 调用为 0 |
| 人工验收 | 不要求手工录入链接；由系统生成可点击清单和证据摘要，随机抽检账号归属、作品详情、评论和计数 |
| 严重错误 | 作者错配、跨作品评论、凭据泄漏、写请求任一出现即整批失败 |

人工抽检效果不佳时，不通过修改报告掩盖，而是按失败能力切换到预登记 fallback，再生成新的独立 run。旧 run 保留且状态不可被新 run 覆盖。

## 11. 每次 run 必须生成的非敏感产物

```text
run/<run-id>/
  manifest.json
  route-trace.json
  schema-fingerprints.json
  source-proof-summary.json
  acceptance-report.md
  human-review-sample.md
  issues.json
```

这些文件只包含白名单业务 ID、计数、hash、route、schema、时间和错误分类。不得包含原始响应体、headers、Cookie、签名值或完整带 query URL。

## 12. 实施顺序与授权点

推荐按 `R0 → R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8` 执行，不并行触碰真实平台。`R0～R7` 可以全部用源码、合成 fixture、临时测试库和浏览器事件模拟完成；到 `R8` 才需要真实页面验证。

当前交付已完成 `R0～R4` 的离线实现与合成/模拟测试，没有执行新采集、没有写正式数据库、没有恢复历史任务。下一实施点是 `R5`；`0.2.3/0.2.4` 已永久退役并由代码硬禁用，也不得进入真实 `R8/T1/T2/T3`。R3/R4 已完成关注、作品列表、作品详情和桌面端 v2 入库门禁，但生产连接器尚未把 R2 Observer 投影转换为业务 envelope，评论与回复投影仍待 R5，因此不能把本轮测试视为 E3/E4 或真实平台验收。
