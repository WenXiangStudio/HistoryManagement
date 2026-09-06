# Signal Desk R0～R4 离线人工验收检查点交接

> 文档状态：下一窗口的首要执行依据
>
> 编写日期：2026-09-06（Asia/Shanghai）
>
> 验收对象：Signal Desk 结构化采集计划 R0～R4
>
> 固定代码基线：`8d9cc5e feat: implement structured work verification R4`
>
> 当前证据等级：`E2-doc`
>
> 本检查点不会、也不得将结果升级为 `E3-local-poc` 或 `E4-product`

## 1. 下一窗口的唯一目标

下一窗口只执行一次可复现的“R0～R4 离线人工验收检查点”，由执行代理准备证据、解释实际结果，由用户进行最终人工判定。

本检查点的目标是回答五个问题：

1. R0 是否真正冻结了失败路线和历史 run，且旧路线不能因 R4 完成而恢复；
2. R1 的作者证明、schema fingerprint、projection hash、route trace 和安全门禁是否在语义上独立、可解释、不可通过自填字段伪造；
3. R2 的六类 Network Observer 是否只执行模拟的只读观察、白名单投影和有界内存生命周期；
4. R3 的关注列表是否只有在结构化关系、目标身份和分页闭合都成立时才产生 creator；
5. R4 的作品列表、详情、statistics 和作者证明链是否只有在每项独立复核后才产生 work，并在任何错配时于数据库写入前归零。

这不是 R5 实施窗口。只有本检查点得到用户明确的整体 `PASS` 后，才可以在后续回合或窗口开始 R5。

## 2. 固定事实与进入条件

开始验收前必须核对以下事实：

| 项目 | 预期值 |
|---|---|
| 工作区 | `D:\AI_WorkSpace\SpatialWarehouse\AI_InformationWorkflowCreationCenter` |
| 分支 | `main` |
| R4 实现基线 | `8d9cc5e`，必须是当前 HEAD 的祖先 |
| 当前 HEAD | 本交接文档提交；其相对 `8d9cc5e` 的差异只能是交接文档 |
| R4 提交主题 | `feat: implement structured work verification R4` |
| 远端 | `git@github.com:WenXiangStudio/HistoryManagement.git` |
| 分支同步状态 | `main...origin/main`，无 ahead/behind |
| 适配器版本 | `0.2.0-r4` |
| 下一阶段 | R5，尚未实施 |
| 真实平台等级 | 未开始 E3/E4 |

推荐的只读核对命令：

```powershell
git status --short --branch
git log -2 --oneline
git show -s --oneline 8d9cc5e
git merge-base --is-ancestor 8d9cc5e HEAD
git diff --name-only 8d9cc5e..HEAD
git remote -v
git diff --check
```

预期核心输出：

```text
branch: main...origin/main
R4 baseline: 8d9cc5e feat: implement structured work verification R4
8d9cc5e is an ancestor of HEAD
8d9cc5e..HEAD contains only this handoff document and its index entry
```

若工作树出现未知修改：

- 不得执行 `git reset --hard`、`git checkout --`、删除或覆盖；
- 先列出修改并判断是否属于用户的新工作；
- 如果无法证明 `8d9cc5e` 是当前 HEAD 的祖先，或其后的提交修改了 R0～R4 生产代码、fixture 或测试，本次结果标为 `BLOCKED`，不得把新状态当作固定基线；
- 不得为了得到干净状态而隐藏、丢弃或提交不明修改。

不要求为了验收执行 `git fetch`。远端不可用不影响纯离线验收；若需要核对远端，只能在用户已有授权范围内进行只读获取，不能因此修改或变基本地历史。

## 3. 不可突破的安全边界

本检查点延续 R0～R4 的全部边界：

- 只读取仓库源码、已提交文档和合成 fixture；
- 只运行单元测试、模拟 route、模拟 CDP 和内存 SQLite；
- 不访问 `douyin.com` 或任何真实平台接口；
- 不启动 Electron 开发应用进行真实采集；
- 不打开 Chrome/Edge 真实登录页面；
- 不 attach 到真实浏览器标签页；
- 不读取浏览器 profile、Cookie、Local Storage、Session Storage、IndexedDB、Authorization、签名输入或设备标识；
- 不监听或复用历史 Phase B 回环服务；
- 不运行 `0.2.3` 或 `0.2.4`；
- 不创建新的 `poc/phase-b/runs/**`；
- 不修改、恢复、重试、导入或删除历史 run；
- 不读取或写入正式 Signal Desk SQLite；
- 不恢复历史任务或改变任务状态；
- 不下载媒体，不运行 FFmpeg 媒体处理、ASR 或 OCR；
- 不调用 BYOK、OpenAI-compatible API 或其他云分析；
- 不运行 `npm install`、`npm update`、`npm audit` 或任何依赖下载；
- 不把自动化测试、人工源码审阅或合成 fixture 称为真实平台验证；
- 不把结果标记为 E3/E4；
- 不在验收过程中顺便实施 R5。

`npm run check` 会在既有忽略目录生成本地构建和 Native Host 测试产物；这些只能视为临时验证输出，必须继续保持未跟踪。不得打包发布、安装连接器或运行生成的 Host 连接真实浏览器。

如任一步骤意外尝试访问真实平台、凭据、正式库或旧 run，立即停止，整体标为 `FAIL`，记录触发步骤，不继续收集其他可能污染的证据。

## 4. 人工验收与自动测试的职责边界

自动化测试已经证明“代码按断言运行”；人工验收要证明“断言本身符合用户认可的业务语义”。二者不能互相替代。

执行代理负责：

- 核对固定基线；
- 运行离线自动测试；
- 从合成 fixture 和实际测试结果生成可读证据；
- 展示正例和负例的关键字段；
- 展示数据库写入前后的计数；
- 展示敏感字段 canary 输入与序列化输出的差异；
- 对每个验收项给出 `PASS`、`FAIL`、`BLOCKED` 或 `NOT_RUN` 的建议状态；
- 如实报告异常，不替用户签署人工结论。

用户负责：

- 判断证明链是否符合“独立观察而非循环回填”的真实意图；
- 判断空结果、失败和 fallback 的语义是否可以接受；
- 判断 statistics 的 `null`、差异快照和禁止猜测规则是否符合预期；
- 对整体检查点给出明确的人工 `PASS` 或 `FAIL`；
- 只有在整体 `PASS` 后，明确允许进入 R5。

执行代理不能用“测试全部通过”代替用户的最终人工确认。

## 5. 临时验收证据包

所有新生成的验收输出应写入系统临时目录，而不是仓库、正式数据库或历史 run 目录。建议使用唯一目录：

```powershell
$reviewRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("signal-desk-r0-r4-offline-review-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $reviewRoot
```

不得使用 `$HOME`、`~`、工作区根目录或 `poc/phase-b/runs` 作为验收输出目录。

建议证据包结构：

```text
signal-desk-r0-r4-offline-review-<timestamp>/
  00-scope-and-boundaries.md
  01-git-baseline.txt
  02-automated-checks.txt
  03-r0-freeze-review.md
  04-r1-proof-review.md
  05-r2-observer-review.md
  06-r3-following-review.md
  07-r4-work-detail-review.md
  08-database-side-effects.md
  09-sensitive-output-scan.md
  10-case-matrix.md
  11-human-decision-template.md
  manifest.sha256
```

规则：

- 证据包只允许包含合成 ID、计数、hash、route、schema、时间、错误分类、测试输出和人工说明；
- 不复制原始浏览器数据、完整真实 URL、query、headers、Cookie、签名或凭据；
- fixture 中故意存在 `must-not-enter-projection`、`private_token` 等 canary，它们可以出现在“合成输入说明”中，但不得出现在适配器序列化输出中；
- `manifest.sha256` 只覆盖该临时证据包，用于确认审阅期间内容未被无声替换；
- 不把证据包提交到 Git；
- 不把证据包命名为 Phase B run、E3 run 或 E4 run；
- 完成后可保留临时目录供用户复核，本窗口不得擅自删除。

证据包首页必须醒目标注：

```text
OFFLINE_SYNTHETIC_REVIEW
E2-doc
NOT E3
NOT E4
NO REAL PLATFORM VALIDATION
NO FORMAL DATABASE WRITE
```

## 6. 自动化预检

人工查看证据前，先运行现有完整离线验证：

```powershell
npm test
npm run check
```

不得在命令前后启动 dev server、浏览器或历史 Phase B controller。

基线 `8d9cc5e` 的预期结果：

| 验证项 | 预期 |
|---|---:|
| Vitest 文件 | 10 个通过 |
| Vitest 测试 | 123 项通过 |
| Python worker 测试 | 2 项通过 |
| Network Observer 测试 | 8 项通过 |
| 冻结 Phase B 回归 | 15 项通过 |
| Native Host framing/auth 测试 | 通过 |
| 连接器 content 测试 | 通过 |
| 连接器 background 测试 | 通过 |
| manifest/deployment 测试 | 通过 |
| TypeScript `tsc --noEmit` | 通过 |
| Electron/Vite 生产构建 | 通过 |

说明：

- `cloudService.test.ts` 是本地单元测试，不得向真实云服务发请求；若观察到实际外部请求，立即失败；
- worker 测试不得处理真实媒体；
- Network Observer 测试必须使用 mock CDP；
- Native Host 测试只验证本地 framing、鉴权和代理协议，不得连接真实扩展或浏览器；
- 构建产物必须继续处于 `.gitignore` 范围。

自动预检任一必需项失败时：

1. 保存完整失败输出；
2. 标记具体步骤为 `FAIL`；
3. 不在验收任务中擅自修复生产代码；
4. 继续执行只读、不会掩盖失败的人工审查可以帮助定位，但整体不得判为通过；
5. 向用户报告，并另开修复任务。

## 7. R0 人工验收：失败路线与历史证据冻结

### 7.1 必查文件

- `src/shared/structuredAcquisition.ts`
- `src/shared/structuredAcquisition.test.ts`
- `poc/phase-b/FROZEN_RUNS.json`
- `poc/phase-b/controller.mjs`
- `poc/phase-b/extension/background.js`
- `poc/phase-b/extension/popup.html`
- `poc/phase-b/extension/popup.js`
- `poc/phase-b/test/core.test.mjs`
- `poc/phase-b/README.md`

### 7.2 人工检查步骤

1. 展示 `LEGACY_PHASE_B_ROUTES` 中两个版本的状态；
2. 展示 `assertLegacyPhaseBRouteDisabled` 的行为；
3. 展示 controller 在创建目录前调用硬拒绝的路径；
4. 展示旧扩展自动入口和手动入口均返回同一硬拒绝；
5. 展示 popup 不再包含启动输入或可启动按钮；
6. 展示 `FROZEN_RUNS.json` 的全局 policy；
7. 展示三个历史 run 的数量、分类、关键摘要 hash 和 `benchmarkEligible=false`；
8. 确认没有新的 `0.2.4` run；
9. 确认历史 `runs/**` 没有进入 Git 差异或测试输入；
10. 搜索生产代码与既有状态文档，确认不再使用旧的 “UNTIL_R4” 临时原因码，避免 R4 完成后被误恢复；本验收文档本身也不得原样引用该旧原因码，以免搜索产生假阳性。

### 7.3 必须展示的预期语义

```text
0.2.3:
  status = frozen-failed
  executable = false
  benchmarkEligible = false
  reasonCode = AUTHOR_PROOF_CIRCULAR

0.2.4:
  status = disabled
  executable = false
  benchmarkEligible = false
  reasonCode = LEGACY_ROUTE_PERMANENTLY_DISABLED
```

### 7.4 R0 通过标准

以下条件必须全部成立：

- `0.2.3` 不能执行，也不能作为成功 benchmark；
- `0.2.4` 永久禁用，不因 R4 完成而恢复；
- controller 在任何新 run 目录或输出产生前拒绝；
- 扩展不存在绕过 controller 的启动入口；
- 历史 run 只读保留、未覆盖、未重跑、未导入；
- 三个历史 run 全部仍被分类为失败证据；
- 旧 summary 中看似成功的字段不能覆盖冻结 registry；
- 文档状态与代码状态一致。

任一旧路线仍可执行、任一历史 run 被当成通过、或出现新 run，R0 立即 `FAIL`，整体检查点不得通过。

## 8. R1 人工验收：独立作者证明与安全合同

### 8.1 必查文件

- `src/shared/platformAdapter.ts`
- `src/shared/structuredAcquisition.ts`
- `src/main/platformAdapterSecurity.ts`
- `src/shared/fixtures/douyin-structured-works.mock.json`
- `src/shared/fixtures/syntheticR4Proofs.ts`
- `src/shared/platformAdapter.test.ts`
- `src/shared/structuredAcquisition.test.ts`

### 8.2 正例证明链

从一条合成作品证据中并排展示：

```text
followedCreatorId
profileRouteCreatorId
requestTargetCreatorId
observedWorkAuthorId
observedWorkId
authorProofSource
endpointKind
routeId
schemaFingerprint
responseProjectionSha256
routeTrace.success.schemaFingerprint
```

人工确认：

- `followedCreatorId` 来自关注目标；
- `profileRouteCreatorId` 来自主页路由目标；
- `requestTargetCreatorId` 来自受控请求参数或已登记的 embedded owner 字段；
- `observedWorkAuthorId` 来自结构化作品对象的 `author.uid/sec_uid`；
- 最后一个值没有从前三个值回填；
- proof 与 independent observation 的 route、endpoint、work ID、author ID、target ID、fingerprint 和 projection hash 完全一致；
- route trace 中存在对应 route 的 `success`，且 trace fingerprint 与 proof fingerprint 一致。

### 8.3 自填作者拒绝负例

人工展示如下语义差异：

```text
任务/循环变量声称作者 = synthetic-creator-A
结构化 observation 实际作者 = synthetic-creator-B
```

预期结果：

```text
AUTHOR_PROOF_MISMATCH
```

即使 candidate 的 `creatorId` 和伪造 proof 表面写成 A，也不能覆盖独立 observation 的 B。

### 8.4 DOM-only 拒绝负例

展示只有以下内容的候选：

```text
sourceKind = dom-fallback
workId = 看似有效的字符串
creatorId = 看似正确的任务目标
```

预期结果：

```text
DOM_ONLY_SOURCE_REJECTED
```

DOM URL、共同祖先容器、页面当前路由或循环变量都不能替代 `WorkAuthorProof/v2`。

### 8.5 schema 与 projection 人工核对

必须展示四类对比：

1. schema 相同、值不同：schema fingerprint 相同；
2. 字段类型或结构改变：schema fingerprint 不同；
3. projection 对象键顺序不同、值相同：canonical projection hash 相同；
4. 白名单业务值改变：projection hash 不同。

人工确认 fingerprint 只描述 shape/type，projection hash 才绑定允许持久化的业务值。

### 8.6 请求和持久化安全负例

逐项确认以下输入被拒绝：

- 非 GET；
- 绝对 URL 或包含 query/fragment 的 pathname；
- 未登记 endpoint path；
- 未知参数；
- 重复参数；
- `Cookie`、`Authorization`、Bearer、API key、token；
- `X-Bogus`、signature、device ID/fingerprint；
- 未列入 allowlist 的 header；
- route trace 中的完整 URL、headers、Cookie 或原始 response。

同时确认拒绝结果和错误文本本身不复制敏感值。

### 8.7 R1 通过标准

- 四 ID 一致是必要条件，但最后一个作者 ID 必须来自独立结构化观察；
- 原生 `aweme_id` 和原生 `cid` 合同拒绝 synthetic content hash 冒充新 ID；
- proof、observation、hash 和 trace 不能被分别替换；
- DOM-only 和自填作者负例均稳定拒绝；
- 非 GET、未知 path/参数/header 和敏感字段均 fail closed；
- 序列化证明只包含白名单字段。

若人工无法说明每个 ID 的来源，或 observed author 仍可能由任务目标回填，R1 必须 `FAIL`。

## 9. R2 人工验收：六类通用 Network Observer

### 9.1 必查文件

- `browser-connector/extension/network-observer.js`
- `browser-connector/extension/fixtures/network-observer.synthetic.json`
- `browser-connector/extension/background.js`
- `scripts/test-network-observer.mjs`
- `scripts/test-connector-background.mjs`

### 9.2 六类分类必须全部出现

| 能力 | route |
|---|---|
| 关注列表 | `DY-FOLLOW-NETWORK` |
| 账号作品 | `DY-WORKS-NETWORK` |
| 作品详情 | `DY-DETAIL-NETWORK` |
| 一级评论 | `DY-COMMENT-NETWORK` |
| 二级回复 | `DY-REPLY-NETWORK` |
| 媒体资源 | `DY-MEDIA-NETWORK` |

R2 只完成通用观察与投影能力；一级评论、回复的业务适配器仍属于未开始的 R5。人工审阅不得把“Observer 能识别评论响应”误写成“R5 已完成”。

### 9.3 生命周期检查

使用 mock CDP 事件展示顺序：

```text
attach
→ Network.enable
→ navigation/trigger simulation
→ request/response classification
→ bounded response-body read
→ schema check
→ whitelist projection
→ SHA-256
→ raw body released
→ detach
→ listeners removed
→ buffers cleared
```

必须人工确认：

- attach 发生在导航或触发之前；
- 只接受允许 host；
- 只接受 GET Fetch/XHR；
- 只读取成功且声明 JSON 的响应；
- body 大小超过上限时拒绝；
- malformed JSON 拒绝；
- path 与 schema 必须双重分类；
- 已知 path 但 schema 改变时记录 schema change；
- 已知 schema 出现在未登记 path 时隔离，不自动升格；
- in-flight 与 completed buffer 都有固定上限；
- detach 后计数、listener 和缓存归零；
- Observer 输出不包含原始 body、完整 URL、query、headers、Cookie 或签名。

### 9.4 R2 通过标准

- 六类模拟响应全部可分类；
- 非允许输入全部 fail closed；
- 内存和 listener 生命周期可证明闭合；
- 输出只有白名单 projection、hash 和非敏感 trace；
- background 保持 attach-before-navigation；
- 测试没有触碰真实浏览器或真实平台。

任一原始响应或敏感字段可从 completed observation 恢复，R2 立即 `FAIL`。

## 10. R3 人工验收：关注列表结构化适配器

### 10.1 必查文件

- `src/main/douyinFollowingAdapter.ts`
- `src/main/douyinFollowingAdapter.test.ts`
- `src/shared/fixtures/douyin-following-pages.mock.json`
- `src/shared/platformAdapter.ts`
- `src/shared/contracts.ts`
- `src/main/taskRunner.ts`
- `src/main/collectionGate.test.ts`

### 10.2 固定路线

必须展示并确认：

```text
DY-FOLLOW-NETWORK
→ DY-FOLLOW-EMBEDDED
→ DY-FOLLOW-INPAGE
→ DY-FOLLOW-STOP
```

只有预登记的 `not-observed`、`schema-missing`、`schema-changed` 等条件可以切换；401/403、429、身份错配或分页协议错误不得被下一个 fallback 掩盖。

### 10.3 正例检查

从合成多页结果展示：

```text
ownerAccountId
requestTargetCreatorId
relationship = following
creatorIds
returnedIds
cursorIn
cursorOut
hasMore
reportedTotal
schemaFingerprint
responseProjectionSha256
routeTrace
```

人工确认：

- owner 与请求目标一致；
- 每个 creator ID 来自结构化列表；
- `creatorIds` 与 `returnedIds` 顺序、数量完全一致；
- 无重复 ID；
- cursor 前进并最终闭合；
- page proof 与 envelope 的时间、origin、cursor 和完成状态一致；
- 正式 following 门禁只接受 v2 结构化 proof。

### 10.4 verified-empty 检查

真正空关注必须同时满足：

```text
creatorIds = []
returnedIds = []
reportedTotal = 0
hasMore = false
completion/completeness = complete
```

“DOM 没看到项目”“endpoint 未观察到”“schema 失败”都不得标为 verified-empty。

### 10.5 必查负例

- 未观察 endpoint；
- Network schema change 后按登记路线切换；
- cursor loop；
- 空页但 `has_more=true`；
- 重复 creator ID；
- 401/403；
- 429；
- proof creator 清单与返回 item 不一致；
- profile URL 身份不一致；
- `isFollowing=false`；
- 粉丝或推荐账号混入；
- 旧 DOM v1 proof；
- 所有结构化路线失败。

最后一种的预期结果必须是 creator 数为 0，而不是保留 DOM 候选。

### 10.6 R3 通过标准

- 只有结构化、明确为 following 的关系才能产生 creator；
- verified-empty 具有 total/cursor/hasMore 的完整闭合；
- 终止错误不 fallback；
- route 切换不混合不同来源分页；
- v1 DOM proof 在数据库写入前被拒绝；
- 全路线失败时零 creator；
- 当前生产连接器尚未生成 v2 following envelope，这一限制必须在结论中保留。

## 11. R4 人工验收：作品、详情、statistics 与作者独立证明

### 11.1 必查文件

- `src/main/douyinWorkAdapters.ts`
- `src/main/douyinWorkAdapters.test.ts`
- `src/shared/fixtures/douyin-work-pages-r4.mock.json`
- `src/shared/fixtures/syntheticR4Proofs.ts`
- `src/shared/platformAdapter.ts`
- `src/shared/structuredAcquisition.ts`
- `src/shared/contracts.ts`
- `src/main/taskRunner.ts`
- `src/main/collectionGate.test.ts`
- `src/main/taskRunner.test.ts`

### 11.2 固定路线

作品列表：

```text
DY-WORKS-NETWORK
→ DY-WORKS-EMBEDDED
→ DY-WORKS-INPAGE
→ DY-WORKS-STOP
```

作品详情：

```text
DY-DETAIL-NETWORK
→ DY-DETAIL-EMBEDDED
→ DY-DETAIL-INPAGE
→ DY-DETAIL-STOP
```

人工确认作者错配、目标 ID 错配、HTTP 终止错误和分页中途 schema change 均不可通过 fallback 掩盖。

### 11.3 page-level 作品证明

展示 `douyin-creator-works-structured-proof/v2`：

```text
followedCreatorId
profileRouteCreatorId
requestTargetCreatorId
targetCreatorIdSourcePath
requestParameters（embedded 时必须为空）
workIds
returnedIds
authorBindings
cursorIn
cursorOut
hasMore
reportedTotal
schemaFingerprint
responseProjectionSha256
routeTrace
collectedAt
browserOrigin
```

人工确认：

- Network/INPAGE 的目标作者来自 `request.sec_user_id`；
- Embedded 的目标作者来自 `embedded.profile_user.uid/sec_uid`；
- Embedded 不得伪造 request parameters；
- followed、profile、request/embedded owner 一致；
- 每个 `workId` 都有且只有一个 author binding；
- 每个 observed author 等于目标关注博主；
- `workIds`、`returnedIds` 与 items 顺序完全一致；
- proof 与所有列表 observation 的 source、route、hash、trace 和采集时间一致。

### 11.4 每作品独立详情链

至少人工展开一个视频作品和一个图文作品：

```text
列表 aweme_id
列表 author.uid/sec_uid
列表 observation
WorkAuthorProof/v2
详情请求 aweme_id 或 item_id
详情 targetWorkIdSourcePath
详情返回 aweme_detail.aweme_id
详情返回 aweme_detail.author.uid/sec_uid
详情 observation
详情 source proof
WorkDetailVerification/v1
```

必须人工确认以下相等关系：

```text
list.workId
= detail request targetWorkId
= detail returnedWorkId
= detail observation.workId
= verification.workId

followedCreatorId
= profileRouteCreatorId
= list requestTargetCreatorId
= list observed authorId
= detail expectedCreatorId
= detail observed authorId
```

并确认：

- list endpoint 是 `creator-work-list`；
- detail endpoint 是 `work-detail`；
- list 与 detail 使用不同 route ID；
- detail observation 与 detail source proof 的 route、source、fingerprint、projection hash、trace、time 精确绑定；
- `verifiedAt` 与详情 observation/proof 时间精确一致；
- 每个列表候选都单独执行详情复核；
- 任意一个详情失败时，整个作品批次 `items=[]`，前面已验证候选也不残留。

### 11.5 statistics 人工核对

只允许五项：

```text
likeCount
commentCount
collectCount
shareCount
playCount
```

每个作品必须保留：

```text
statistics.list
statistics.detail
statistics.changedFields
```

从合成视频 `synthetic-work-2001` 展示：

```text
list:
  likeCount: 10
  commentCount: 2
  collectCount: 3
  shareCount: 1
  playCount: 100

detail:
  likeCount: 12
  commentCount: 3
  collectCount: 3
  shareCount: 1
  playCount: 120

changedFields:
  likeCount
  commentCount
  playCount
```

从合成图文 `synthetic-work-2002` 展示：

```text
list:
  likeCount: null        # 输入为“1.2万”，禁止猜测
  commentCount: 4
  collectCount: null     # 输入为负数，禁止接纳
  shareCount: 2
  playCount: null

detail:
  likeCount: 20
  commentCount: 4
  collectCount: 5
  shareCount: 2
  playCount: null

changedFields:
  likeCount
  collectCount
```

人工确认：

- 只接受非负安全整数；
- 格式化数字、负数、缺失和未知类型均为 `null`；
- `null` 不等于 0；
- 列表和详情快照不会被静默合并；
- `changedFields` 精确列出所有差异，不多不少；
- 当前正式数据库 schema 只支持 like/comment/collect/share，`playCount` 只保留在 R4 证明投影中；不得在本检查点补做正式 migration，迁移留给 R6。

### 11.6 必查负例

| 负例 | 必须结果 |
|---|---|
| 推荐作品混入 | `AUTHOR_PROOF_MISMATCH`，零候选 |
| profile creator 自填/错配 | 路线读取前拒绝，零候选 |
| 列表作者错配 | `AUTHOR_PROOF_MISMATCH`，零候选 |
| detail 返回另一个 `aweme_id` | `TARGET_ID_MISMATCH`，零候选 |
| detail 返回另一个作者 | `AUTHOR_PROOF_MISMATCH`，零候选 |
| 所有 list route 失败 | STOP trace，零候选 |
| 所有 detail route 失败 | STOP trace，零候选 |
| cursor loop | 终止分页错误，零候选 |
| 空页且 `has_more=true` | 终止分页错误，零候选 |
| 重复 `aweme_id` | `DUPLICATE_NATIVE_ID`，零候选 |
| `maxPages` 内未闭合 | 终止分页错误，零候选 |
| 空列表缺少明确 `total=0` | 不得标 verified-empty |
| 分页中途 schema 变化 | 不得切换并混合路线，零候选 |
| list/detail 401/403 | `LOGIN_REQUIRED`，不 fallback |
| list/detail 429 | `RATE_LIMITED`，不 fallback |
| 错误 path/参数/header | `UNSAFE_REQUEST`，不泄漏原值 |
| 缺 page-level proof | 数据库前 `DOM_ONLY_SOURCE_REJECTED` |
| 缺 detail verification | 数据库前 `DOM_ONLY_SOURCE_REJECTED` |
| 伪造 projection hash | 数据库前拒绝 |
| verification 时间错配 | 数据库前拒绝 |
| metrics 不来自 detail projection | 数据库前拒绝 |

### 11.7 R4 通过标准

- `/aweme/post/` 和 `/aweme/detail/` path 精确匹配；
- 作品和详情只使用 GET 与白名单参数/header；
- 原生 work ID 和两次独立作者观察全部闭合；
- 推荐、错作者、错作品或伪填 creator 无法产生候选；
- 分页只允许单 route 完整闭合，不能跨路线拼页；
- 每个作品都有 page proof、list observation、WorkAuthorProof/v2、detail proof/observation 和 WorkDetailVerification/v1；
- 五项 statistics 只保留非负安全整数或 `null`；
- 列表/详情差异不静默合并；
- 任一详情失败导致整批零候选；
- 当前生产连接器尚未生成 v2 works envelope，这一限制必须保留在结论中。

## 12. 跨阶段数据库前置门禁验收

这一部分只使用 `AppDatabase(':memory:')`，不得使用文件数据库。

### 12.1 正例

合成 following envelope 通过后，可以在内存数据库中形成一个 creator 和一个待执行的作品任务。随后合成 R4 完整作品 envelope 通过时，才允许产生受 scope 上限约束的作品与评论子任务。

人工确认整个测试仍保持 `collectionOnly=true`，不会创建或运行媒体、ASR/OCR 或 cloud job。

### 12.2 失败无副作用

对“缺少独立详情 verification”的作品 envelope，展示写入前后：

```text
followingCount: 1 → 1
workCount:      0 → 0
commentCount:   0 → 0
works rows:     0 → 0
metric rows:    0 → 0
work checkpoint for creator: 0 → 0
comment jobs:   0 → 0
creator-work job state: running → blocked_user_action
receipt: invalid-collection-proof
```

另外抽查作者错配、目标作品错配和 metrics 错配也在 `database.ingestEnvelope` 之前失败。

### 12.3 通过标准

- 证明校验发生在任何业务写入之前；
- 失败不会留下部分 works、metrics、checkpoint 或下游 job；
- 已经合法写入的上游 creator 不因下游作品失败被回滚或篡改；
- 内存数据库关闭后无正式数据残留；
- 不存在文件 SQLite、WAL 或 SHM 被新增到 Git。

## 13. 敏感信息与输出边界人工验收

### 13.1 合成 canary

R4 fixture 故意含有以下或同类字段：

```text
authorization
cookie
private_token
session_token
raw_headers
X-Bogus
internal_score
must-not-enter-projection
```

这些字段存在于纯合成输入是为了验证清除能力，不是泄漏。人工验收必须扫描“适配器结果、proof、trace、issue 和临时证据输出”，而不是简单扫描输入 fixture。

### 13.2 输出通过标准

最终序列化业务输出不得包含：

- canary 值 `must-not-enter-projection`；
- Cookie 或 Authorization 内容；
- Bearer/token/secret；
- `X-Bogus` 或签名值；
- request/response raw headers；
- 原始 response body；
- 完整带 query 的 URL；
- 设备标识；
- 未登记内部统计字段。

允许出现的安全信息只有：

- 合成业务 ID；
- endpoint kind；
- route ID 和有限状态；
- cursor、hasMore、total 和计数；
- schema fingerprint；
- projection SHA-256；
- 非敏感时间和耗时；
- 固定 browser origin；
- 白名单请求参数名和值；
- 白名单业务 projection。

任一敏感 canary 进入结果或错误文本，整体立即 `FAIL`。

## 14. Git 与输出范围审计

验收末尾运行：

```powershell
git status --short --branch
git status --short --ignored
git diff --check
```

预期：

- tracked 工作树仍然干净；
- `poc/phase-b/runs/` 仍为 ignored，且未修改为新的验收 run；
- `out/`、`release*/`、`.npm-cache/`、Native Host bin 仍为 ignored；
- `*.sqlite`、`*.sqlite-wal`、`*.sqlite-shm` 仍为 ignored；
- 没有验收证据包进入工作树；
- `.git` 正常存在；
- 不存在 `.git-codex-r4` 等临时 Git 元数据目录。

忽略目录中存在此前构建输出不等于失败，但不得暂存、提交、发布或声称它们是本次验收产物。历史 run 不得因审计而被删除或移动。

## 15. 验收状态与总判定规则

每一项只能使用以下状态：

| 状态 | 含义 |
|---|---|
| `PASS` | 已执行、实际结果符合明确标准，并向用户展示了证据 |
| `FAIL` | 已执行，但实际结果违反标准 |
| `BLOCKED` | 因基线、环境或权限原因无法安全执行 |
| `NOT_RUN` | 尚未执行 |

不使用含糊的 `PASS_WITH_NOTES`。非阻断观察可以单独记录，但所有必需项仍必须明确为 `PASS`。

整体 `PASS` 必须同时满足：

1. `8d9cc5e` 是当前 HEAD 的祖先，且其后的提交只包含本交接文档及索引入口；
2. 自动化预检全部通过；
3. R0、R1、R2、R3、R4 各自全部通过；
4. 数据库失败无副作用检查通过；
5. 敏感输出检查通过；
6. Git/输出范围审计通过；
7. 没有连接真实平台或真实浏览器；
8. 没有读取凭据；
9. 没有写正式数据库；
10. 没有恢复历史任务或运行旧路线；
11. 没有运行媒体或真实云分析；
12. 用户在看到证据后明确签署整体 `PASS`。

出现以下任一情况时整体必须 `FAIL`：

- 作者 ID 仍可能来自任务目标回填；
- DOM-only 候选能通过正式门禁；
- 错作者、错作品、跨 route 拼页或未闭合分页产生候选；
- verified-empty 缺少结构化闭合；
- 部分详情失败后仍留下其他作品候选；
- proof/hash/trace 可被替换而不触发拒绝；
- 失败 envelope 已产生业务写入；
- 敏感字段进入输出；
- 旧路线可以启动；
- 历史 run 被修改、重跑或升级为通过；
- 验收触碰真实平台、真实凭据或正式数据库。

存在任一 `BLOCKED` 或 `NOT_RUN` 的必需项时，整体不能判为 `PASS`。

## 16. 人工签署模板

执行代理应在下一窗口末尾向用户提供以下模板，并填入实际结果：

```text
Signal Desk R0～R4 离线人工验收检查点

代码基线：8d9cc5e
执行时间：<Asia/Shanghai timestamp>
临时证据目录：<absolute temporary path>
证据 manifest SHA-256：<digest>

自动化预检：PASS / FAIL / BLOCKED
R0 旧路线与历史冻结：PASS / FAIL / BLOCKED
R1 独立证明与安全合同：PASS / FAIL / BLOCKED
R2 Network Observer：PASS / FAIL / BLOCKED
R3 关注列表：PASS / FAIL / BLOCKED
R4 作品/详情/statistics：PASS / FAIL / BLOCKED
数据库前置门禁：PASS / FAIL / BLOCKED
敏感输出扫描：PASS / FAIL / BLOCKED
Git 与范围审计：PASS / FAIL / BLOCKED

边界声明：
- 未连接真实平台：是 / 否
- 未读取浏览器凭据：是 / 否
- 未写正式数据库：是 / 否
- 未恢复历史任务/run：是 / 否
- 未运行旧 0.2.3/0.2.4：是 / 否
- 未运行媒体/ASR/OCR/真实云分析：是 / 否
- 本结果仍为 E2-doc：是 / 否

执行代理建议结论：PASS / FAIL / BLOCKED
已知问题：<none 或逐项列出>
非阻断观察：<none 或逐项列出>

用户人工结论：PASS / FAIL
用户是否授权进入 R5：是 / 否
```

执行代理建议为 `PASS` 不等于用户已签署。用户没有明确回复整体 `PASS` 和允许 R5 时，下一阶段仍视为未授权。

## 17. 通过后进入 R5 的门禁

只有满足以下条件，才可以开始 R5：

```text
R0_R4_OFFLINE_HUMAN_CHECKPOINT = PASS
USER_R5_AUTHORIZATION = YES
```

R5 已得到用户原则认可的范围是：

- 一级评论 `/aweme/v1/web/comment/list/`；
- 二级回复 `/aweme/v1/web/comment/list/reply/`；
- NETWORK → EMBEDDED → INPAGE → TRIGGER → STOP 的预登记路线；
- TRIGGER 只能触发观察，不能制造事实；
- DOM 只能作为 shadow/诊断；
- 原生 `cid`；
- 评论 `aweme_id` 与目标作品独立一致；
- 回复与请求 `comment_id`、root/parent 关系独立一致；
- 严格 verified-empty；
- cursor、has_more、total、重复 cid 和分页闭合；
- 评论关闭、未观察 endpoint、schema change、登录、频控、跨作品和父关系错配分别分类；
- 所有证明在数据库写入前校验；
- 仍只用合成 fixture、模拟 route/CDP 和内存或临时输出。

本检查点不得提前创建 R5 生产代码、fixture、schema 或任务迁移。R5 完成后还必须执行一次 R0～R5 的联合离线人工验收；R6 才处理临时测试库 migration、scope fingerprint、幂等分页和精确恢复。

## 18. 下一窗口建议开场指令

用户可直接发送：

```text
按照 docs/architecture/signal-desk-r0-r4-offline-human-acceptance-handoff.md，
以提交 8d9cc5e 为 R0～R4 实现基线执行离线人工验收检查点；
允许 HEAD 在其后仅包含本交接文档及索引入口，不允许有生产代码漂移。
只使用合成 fixture、模拟 CDP、内存数据库和系统临时证据目录；
不要连接真实平台，不要读取浏览器凭据，不要写正式数据库，
不要恢复历史任务或运行旧路线，不要实施 R5。
请逐项展示证据和实际结果，最后停下来让我给出人工 PASS/FAIL。
```

## 19. 下一窗口最终回复必须包含

最终回复必须是自包含的，至少包含：

- 验收 commit、分支和工作树状态；
- 临时证据目录及 manifest hash；
- 自动化测试的实际数量和结果；
- R0～R4 每阶段的人工核对结论；
- 至少一个独立作者正例和一个自填作者负例；
- R2 六类 Observer 和 detach/清空证据；
- R3 verified-empty 与全路线失败零 creator 证据；
- R4 视频、图文 statistics 快照和至少三个终止负例；
- 数据库失败前后计数；
- 敏感 canary 输入与输出扫描结论；
- 未触碰真实平台、凭据、正式库、历史任务、媒体和云分析的声明；
- 明确说明结果仍是 E2-doc；
- 执行代理建议结论；
- 人工签署模板；
- 在用户签署前停止，不自动开始 R5。
