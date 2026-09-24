# R8 采集路线纠正：从逐页探针改为会话内批量结构化采集

> 决定日期：2026-09-24<br>
> 状态：替代实现合同，待离线实现与一次新的隔离真实验收。现有五次 T1 run 均保留为失败证据；不将其改写为通过。

## 为什么要改路线

前一实现把 `chrome.debugger` 的每次 attach、页面导航、DOM 触发和 `observer.stop()` 绑在单个任务上；作品列表之后还按 DOM 找到的每个链接逐页导航以取得详情。它把同一个 tab 内无关响应的 `RESPONSE_TOO_LARGE` 和未知 path issue 当成整条业务链失败，并在没有主动分页执行器的情况下要求 `has_more` 闭合。T1 又把完整 v2 business envelope 通过当成 endpoint/schema 发现的条件。这个执行模型会慢，也无法完成它自己设定的分页退出条件。

平台身份合同也写错了：五次隔离 run 已观察到同一账号的公开 `uid` 与 `sec_uid` 是不同值。现有 works proof 要求 `followedCreatorId = profileRouteCreatorId = requestTargetCreatorId = observedWorkAuthorId`，而作品请求使用 `sec_user_id`，作品作者优先投影 `author.uid`。把两种 ID 当成一个字符串比较，会错误拒绝真实作品。桥接生成的博主主页 URL 还使用了 `uid`，应使用已观察到的 `sec_uid`。

研究库早已确认，F2、MediaCrawler、TikTokDownloader、douyin-downloader 等项目均从结构化接口读取作品、详情和评论，并有原生 ID、作者、评论所属作品、分页或错误分类检查。此前把它们描述成“快但不做这些校验”是不正确的。候选行为与许可证边界见 [社区路线库](../research/signal-desk-community-validated-routes-2026-09-05.md)。

## 新执行模型

1. **一个隔离浏览器会话。** 在当前已登录的浏览器上下文内持有只读会话，不导出 Cookie、Authorization、签名值或完整请求。一个 run 只建立一次观察和执行上下文。登录、验证码、403 或 429 立即停止该 run。
2. **按 endpoint 批量分页。** 关注列表按 `offset/min_time/max_time` 或实际响应证明的分页字段推进；账号作品按 `max_cursor/has_more`；一级评论和回复各按自己的 `cursor/has_more`。只发已登记的 GET，参数来自当前页响应和目标公开 ID，不靠滚动 DOM 链接形成作品事实。
3. **签名和凭据只留在浏览器内存。** 优先复用页面已验证的只读请求路径；若需要洁净重写签名，参考 Apache-2.0 F2 的行为和公开模型，在扩展/页面上下文中实现并版本化测试。不得复制非商业或 GPL 实现，不得把签名或 Cookie 交给本地控制器。签名不可用时该 route 失败，保留结构化 fallback，不用 DOM 填补事实。
4. **两种平台 ID 分开存储和比较。** `CreatorIdentity = { uid, secUid }`；关注响应的 `uid` 对比作品列表/详情的 `author.uid`；关注响应的 `sec_uid` 对比主页路由与请求 `sec_user_id`，并对比响应 `author.sec_uid`（若提供）。两种 ID 不互相替代。缺少必要一侧则标记证明不足，不能伪造或从任务目标回填响应作者。
5. **响应归属到当前 route。** 无关 endpoint 的未知 path 或大响应进入隔离诊断，不阻断已确认的目标响应。目标 route 的 schema 变化、超限、分页循环、作者不符、跨作品评论仍失败关闭。每个可接纳项记录来源 route、schema fingerprint、白名单投影 hash 和目标绑定；严重作者或评论归属错误使验证批次失败。
6. **批量处理并设置上限。** 同一会话内以小并发读取作品详情和评论（初始上限 3，遵守 429/Retry-After），去重后写入新的隔离 run。不要为每个作品创建新 tab 或重复 debugger attach。性能以 24 个及 100 个公开视频的实际完成时间、请求数、失败数和 p50/p95 延迟衡量；未测得前不声称达到任何固定吞吐。

## 验收顺序

| 阶段 | 证明什么 | 通过条件 |
|---|---|---|
| T1 discovery | 当前浏览器上真实 endpoint、响应字段和分页字段 | 至少确认关注、作品、详情、一级评论的 path/schema；记录 uid/sec_uid 配对、根评论哨兵、目标 GET 的分页形状。T1 不要求完整 business envelope 或整个关注列表闭合。 |
| T2 shadow | 6 个作品的结构化数据与页面可见内容差异 | 结构化作者、作品 ID、详情、评论关系可独立复核；DOM 仅作影子对照；记录每项耗时与错误。 |
| T3 acceptance | 默认 24 个、允许 20～30 个自动抽样公开作品 | 延用路线图的 100% 原生 ID/作者归属、零跨作品评论、分页闭合、敏感信息零泄漏及人工抽检；另报吞吐和尾延迟。 |

严格验收仍保留，但不再要求每条无关 Network 响应都通过目标业务解析。T2/T3 必须使用新的独立 run，正式 SQLite 和历史任务保持不动，生产同步能力门继续关闭。

## 实施清单与先行失败测试

- 建立 `{ uid, secUid }` 类型与证明，先用 `uid != secUid` 的 fixture 验证作品作者可被正确接受；交换或篡改任一值必须拒绝。迁移现有 `WorkAuthorProof/v2` 时发布新版本，不静默放宽旧合同。
- 将现有已实现的 following/works/comments 适配器通过一个浏览器会话执行器接到真实 GET 分页；删除生产桥中“从一次被动 snapshot 虚构完整分页链”的路径。
- 为一级评论 `reply_id = "0"`、回复真实 root/parent、`has_more=true` 多页闭合、空页继续、重复 cursor、跨作品 `aweme_id` 建立统一 fixture。
- 将 Observer issue 按 request/route 归属；未知 path 和无关超限只进入诊断，目标响应超限仍拒绝。
- 建立 24/100 作品隔离基准，记录总时间、单 route 请求数、成功/失败项、重试、p50/p95 和内存上限。完成离线回归后只跑一次新的 T1，不再每修一项就新建扩展/run。

## 开源项目采用边界

- **F2（Apache-2.0）**：作为关注分页模型、异步 endpoint 执行和双 ID 字段的首选行为参考；先核对固定提交与当前版本差异。
- **MediaCrawler（非商业许可）**：只借鉴其目标 `aweme_id` 与评论 `aweme_id` 交叉校验、结构化响应处理思路，不复制实现代码。
- **jiji262/douyin-downloader（MIT）**：借鉴 HTTP 200 空响应、403/429、cursor 异常、增量去重和有界重试分类。
- **TikTokDownloader（GPL-3.0）**：仅作字段和行为交叉证据，不复制代码。

`poc/r8` 的五次历史 T1 报告只用于诊断，不作为新路线的验收样本。现有逐页 T1 启动脚本已停用，避免继续让用户安装一批新扩展来调试实现细节。
