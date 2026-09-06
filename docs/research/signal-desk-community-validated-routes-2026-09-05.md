# Signal Desk 社区已验证路线库

> 研究日期：2026-09-05（Asia/Shanghai）  
> 适用范围：Signal Desk 的关注关系、作品发现、作品详情、互动指标、评论与回复、媒体、ASR、OCR、内容总结及网友发言事实核验  
> 研究性质：公开源码与维护者文档审计，不是对当前账号、当前抖音版本或 Signal Desk 的真实采集验收

## 1. 目的与结论

本文件不是“工具推荐列表”，而是 Signal Desk 的候选路线登记册。每条正式优化路线都必须有预先研究过的替代路线、切换条件和禁止边界，不能在失败后临时改选择器或自动退回 DOM 入库。

本次研究得到的核心结论是：社区已经反复实现并交叉印证了抖音 Web 的结构化只读路线，包括关注列表、用户作品、作品详情、一级评论、二级回复、互动统计和媒体资源。Signal Desk 当前的问题不是这些数据只能由 DOM 获得，而是浏览器连接器尚未把 Network JSON、内嵌结构化状态和受控页面上下文请求实现为正式事实通道。

新的证据优先级固定为：

```text
已登录浏览器收到的结构化 Network 响应
  → 页面内嵌的结构化状态（hydration / SSR state）
  → 页面上下文内的受控只读请求
  → DOM 仅用于语义导航、触发懒加载和 shadow 对照
  → 没有结构化来源证明就拒绝，不入库
```

## 2. “社区已验证”的严格定义

本文件把证据分成四级，避免把社区项目的成功误报为 Signal Desk 已通过：

| 等级 | 含义 | 能否作为 Signal Desk 正式数据源 |
|---|---|---|
| `E1-source` | 已在公开源码中定位到 endpoint、参数、分页字段、解析字段或执行函数 | 否，只能进入候选路线库 |
| `E2-doc` | 维护者文档、示例或官方浏览器文档与源码相互吻合 | 否，只能提高候选置信度 |
| `E3-local-poc` | Signal Desk 在隔离目录、合成或少量真实样本中通过结构化来源验证 | 否，仍不能写正式库 |
| `E4-product` | 20～30 个真实公开样本、自动验收和人工抽检均通过，且安全门禁为零违规 | 是，但还需单独批准上线 |

“已验证”在本文件标题中只表示达到 `E1` 或 `E2`。Stars 是采用信号，不是正确性或稳定性证明；公开代码在过去可运行，也不代表 2026-09-05 的 endpoint、签名和风控仍保持不变。

## 3. Signal Desk 能力覆盖矩阵

| Signal Desk 能力 | 当前实现 | 社区/官方证据 | 研究结论 |
|---|---|---|---|
| 已关注账号列表 | 正式连接器和阶段 B 主要读 DOM | F2、Douyin_TikTok_Download_API 均实现 `/user/following/list/`；F2 有分页示例 | 改为结构化响应主通道；DOM 不再证明关注关系 |
| 关注账号作品 | 阶段 B 从主页链接和共同祖先容器发现 | MediaCrawler、F2、TikTokDownloader、douyin-downloader 均使用 `/aweme/post/` | 作品必须来自结构化 `aweme_list`，并读取每项真实作者 ID |
| 作品作者归属 | 旧 PoC 把目标博主 ID直接写进候选 | 多项目都从 `item.author.uid/sec_uid` 读取真实作者 | 关注记录、路由目标和响应作者三者必须一致 |
| 作品详情 | 正式连接器偏 DOM | 多项目实现 `/aweme/detail/` | 详情既是主数据源，也是作品作者的独立复核通道 |
| 点赞/评论/收藏/分享 | DOM 可见文本及局部结构 | MediaCrawler、TikTokDownloader 读取 `statistics` | 只读列表/详情响应为主；不可见值为 `NULL`，不得从缩写文本猜值 |
| 一级评论 | 正式连接器扫描 `comment-item` | MediaCrawler、F2、TikTokDownloader 等实现 `/comment/list/` | 原生 `cid`、`aweme_id`、cursor、has_more 是最低证明要求 |
| 二级回复 | 合同已有，正式通道未落地 | 多项目实现 `/comment/list/reply/` | 单独 endpoint、单独分页和父子关系验证 |
| 浏览器结构化捕获 | 旧阶段 B `0.2.4` 已冻结；R2 已完成六类通用 `chrome.debugger` Observer 的模拟 CDP 实现 | Chrome Debugger/CDP 与 Playwright 官方文档 | attach-before-navigation、endpoint/schema classifier、bounded projection 已通过合成测试；尚非真实平台验收 |
| 媒体解析 | 数据库和工作器已有，采集端仍待稳定 URL | 多个下载器、yt-dlp、浏览器资源观察 | 详情响应媒体 URL 为主；yt-dlp 只做公开 URL 隔离备选 |
| ASR | `faster-whisper` CPU INT8 | faster-whisper；whisper.cpp | 保留现路线，预设 whisper.cpp 备选并建立短视频基准 |
| OCR | PaddleOCR 抽帧识别 | PaddleOCR | 保留，但低置信度文字不能自动成为事实正文 |
| 内容总结 | 已有标题/简介/ASR/OCR/评论分块总结 | 现有本地实现可用；事实核验项目提供 evidence-first 结构 | 增加证据引用、冲突标记和人工抽检，不只输出无出处总结 |
| 网友发言“正确性” | 尚无 claim-level 事实核验 | FacTool、FActScore、AVeriTeC | 只核验可验证事实性 claim；证据不足必须 abstain |
| 任务、断点与入库 | 已有 SQLite、任务队列、游标合同 | douyin-downloader 等有增量、重试、SQLite 去重经验 | 保留上层架构，修复单任务锁死全局、范围版本和精确恢复 |
| 排序与表现评估 | 点赞、评论、收藏为主，分享未完整纳入 | 社区采集器证明 share_count 可结构化取得 | 先保证统计来源，再以缺失值友好方式纳入分享；另做本地排序基准 |

## 4. 抖音结构化采集项目审计

### 4.1 NanmiCoder/MediaCrawler

- 仓库：[NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)
- 审计提交：[`d6f7c5bb906b6dac40ddf343ef9e26438a3de092`](https://github.com/NanmiCoder/MediaCrawler/tree/d6f7c5bb906b6dac40ddf343ef9e26438a3de092)
- 采用信号：审计时约 64k stars
- 许可证：自定义 `NON-COMMERCIAL LEARNING LICENSE 1.1`；只可用于架构研究，不能把源码复制进潜在商业产品
- 证据等级：`E1-source + E2-doc`

源码已确认：

- 通过 Playwright/CDP 复用现有 Chrome 登录环境；
- 使用结构化 Web API：`/aweme/v1/web/aweme/detail/`、`/aweme/v1/web/aweme/post/`、`/aweme/v1/web/comment/list/`、`/aweme/v1/web/comment/list/reply/`；
- 作品页读取 `aweme_list / max_cursor / has_more`；
- 评论页读取 `comments / cursor / has_more`；
- 保存评论前验证 `comment_item.aweme_id` 等于目标作品；
- 作品字段包含 `author`、`statistics.digg_count`、`collect_count`、`comment_count`、`share_count`、`desc`、`create_time` 和媒体 URL；
- 评论字段包含 `cid`、`aweme_id`、`text`、用户、点赞数、回复总数、父回复 ID 和评论图片。

关键源码：[`client.py`](https://github.com/NanmiCoder/MediaCrawler/blob/d6f7c5bb906b6dac40ddf343ef9e26438a3de092/media_platform/douyin/client.py)、[`core.py`](https://github.com/NanmiCoder/MediaCrawler/blob/d6f7c5bb906b6dac40ddf343ef9e26438a3de092/media_platform/douyin/core.py)、[`help.py`](https://github.com/NanmiCoder/MediaCrawler/blob/d6f7c5bb906b6dac40ddf343ef9e26438a3de092/media_platform/douyin/help.py)、[`store/douyin/__init__.py`](https://github.com/NanmiCoder/MediaCrawler/blob/d6f7c5bb906b6dac40ddf343ef9e26438a3de092/store/douyin/__init__.py)。

可借鉴：endpoint/分页模式、目标 ID 交叉校验、结构化字段投影、浏览器会话承载。不可照搬：受非商业许可证约束的实现代码，以及任何把签名/Cookie 暴露到日志或配置的做法。README 对“浏览器上下文签名”的描述和当前 `help.py` 中已弃用的 Playwright 签名函数并不完全相同，因此它主要证明结构化 endpoint 和字段模式，不证明某一签名实现长期稳定。

### 4.2 Johnserf-Seed/F2

- 仓库：[Johnserf-Seed/F2](https://github.com/Johnserf-Seed/F2)
- 审计提交：[`7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3`](https://github.com/Johnserf-Seed/F2/tree/7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3)
- 采用信号：审计时约 2.6k stars
- 许可证：Apache-2.0
- 证据等级：`E1-source + E2-doc`

这是关注关系路线最重要的公开实现证据。源码已确认：

- 关注列表：`/aweme/v1/web/user/following/list/`，由 `fetch_user_following()` 实际调用；支持 `user_id/sec_user_id`、`offset`、`min_time`、`max_time`、`source_type`、`count`，按 `has_more` 翻页；
- 关注作品流：`/aweme/v1/web/follow/feed/`；
- 用户作品：`/aweme/v1/web/aweme/post/`；
- 详情：`/aweme/v1/web/aweme/detail/`；
- 一级评论：`/aweme/v1/web/comment/list/`；
- 回复：`/aweme/v1/web/comment/list/reply/`；
- filter 从结构化作品读取 `author.uid`、`author.sec_uid`、nickname、`aweme_id`、`desc` 和媒体字段。

关键源码：[`api.py`](https://github.com/Johnserf-Seed/F2/blob/7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3/f2/apps/douyin/api.py)、[`model.py`](https://github.com/Johnserf-Seed/F2/blob/7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3/f2/apps/douyin/model.py)、[`crawler.py`](https://github.com/Johnserf-Seed/F2/blob/7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3/f2/apps/douyin/crawler.py)、[`handler.py`](https://github.com/Johnserf-Seed/F2/blob/7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3/f2/apps/douyin/handler.py)、[`filter.py`](https://github.com/Johnserf-Seed/F2/blob/7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3/f2/apps/douyin/filter.py) 以及维护者的 [关注列表示例](https://github.com/Johnserf-Seed/F2/blob/7dab3e2ffffaa2535834d28fca99dbc2e89fa9d3/docs/snippets/douyin/user-following.py)。

可借鉴：关注列表模型、分页、作品作者字段以及 Apache-2.0 下的行为参考。重要禁区：仓库中的 `/aweme/v2/web/aweme/stats/` 示例文案显示可能增加播放量，Signal Desk 不调用它；互动指标只从只读列表或详情响应读取。

### 4.3 JoeanAmier/TikTokDownloader

- 仓库：[JoeanAmier/TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader)
- 审计提交：[`078e0537faa6bdc11458355b1e88b9ee9f5a07e9`](https://github.com/JoeanAmier/TikTokDownloader/tree/078e0537faa6bdc11458355b1e88b9ee9f5a07e9)
- 采用信号：审计时约 15.7k stars
- 许可证：GPL-3.0
- 证据等级：`E1-source + E2-doc`

源码确认了用户作品、详情、一级评论、回复四类结构化接口，并从结构化响应中记录 `digg_count`、`comment_count`、`collect_count`、`share_count`、`play_count`、`author.sec_uid/uid/nickname`、`aweme_id` 和 `desc`；还实现了增量下载与 SQLite/CSV/XLSX 输出。

关键源码：[`account.py`](https://github.com/JoeanAmier/TikTokDownloader/blob/078e0537faa6bdc11458355b1e88b9ee9f5a07e9/src/interface/account.py)、[`detail.py`](https://github.com/JoeanAmier/TikTokDownloader/blob/078e0537faa6bdc11458355b1e88b9ee9f5a07e9/src/interface/detail.py)、[`comment.py`](https://github.com/JoeanAmier/TikTokDownloader/blob/078e0537faa6bdc11458355b1e88b9ee9f5a07e9/src/interface/comment.py)、[`extractor.py`](https://github.com/JoeanAmier/TikTokDownloader/blob/078e0537faa6bdc11458355b1e88b9ee9f5a07e9/src/extract/extractor.py)。

可借鉴：endpoint、cursor/has_more、统计字段标准化、评论/回复分离。不可照搬：Cookie 明文配置和进入请求头的管理方式、可能记录完整 URL/headers 的策略，以及未经许可证评估复制 GPL-3.0 代码。

### 4.4 Evil0ctal/Douyin_TikTok_Download_API

- 仓库：[Evil0ctal/Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)
- 审计提交：[`42784ffc83a72a516bfe952153ad7e2a3998d16c`](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/tree/42784ffc83a72a516bfe952153ad7e2a3998d16c)
- 采用信号：审计时约 19.8k stars
- 许可证：Apache-2.0
- 证据等级：`E1-source + E2-doc`

源码定义并实际调用用户详情、用户作品、作品详情、关注列表、关注作品流、评论和回复 endpoint；其 `web_crawler.py` 包含异步请求实现，签名路线包括 X-Bogus/A-Bogus。

关键源码：[`endpoints.py`](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/42784ffc83a72a516bfe952153ad7e2a3998d16c/crawlers/douyin/web/endpoints.py)、[`models.py`](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/42784ffc83a72a516bfe952153ad7e2a3998d16c/crawlers/douyin/web/models.py)、[`web_crawler.py`](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/42784ffc83a72a516bfe952153ad7e2a3998d16c/crawlers/douyin/web/web_crawler.py)。

这也是一个重要反例：仓库中的 Chrome Cookie Sniffer 会读取完整 Cookie、保存到 `chrome.storage.local`，并支持发送到 webhook。Signal Desk 明确禁止采用这种凭据提取和外发设计；Apache-2.0 许可不等于该安全做法适合本项目。

### 4.5 jiji262/douyin-downloader

- 仓库：[jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader)
- 审计提交：[`9b3b6f1fec09c847f94a95aae16b52ab3bad5f12`](https://github.com/jiji262/douyin-downloader/tree/9b3b6f1fec09c847f94a95aae16b52ab3bad5f12)
- 采用信号：审计时约 9.6k stars
- 许可证：MIT
- 证据等级：`E1-source + E2-doc`

该项目以 API 为主，支持作品、图集、主页、合集、SQLite 去重、重试和下载完整性检查；对作品分页提供浏览器 fallback。源码明确区分登录失效、HTTP 403/429、HTTP 200 空响应反爬、cursor/has_more 异常，并提供签名失败后的替代策略和评论/二级回复采集。

关键源码：[`api_client.py`](https://github.com/jiji262/douyin-downloader/blob/9b3b6f1fec09c847f94a95aae16b52ab3bad5f12/core/api_client.py)、[`comments_collector.py`](https://github.com/jiji262/douyin-downloader/blob/9b3b6f1fec09c847f94a95aae16b52ab3bad5f12/core/comments_collector.py)、[`test_comments_collector.py`](https://github.com/jiji262/douyin-downloader/blob/9b3b6f1fec09c847f94a95aae16b52ab3bad5f12/tests/test_comments_collector.py)。

最值得借鉴的是错误分类、降级状态机、重试边界、SQLite 幂等和浏览器执行环境 fallback。不能照搬 Cookie 管理或签名实现；Signal Desk 的登录态必须留在浏览器内存环境，敏感参数不得持久化。

### 4.6 Johnserf-Seed/TikTokDownload

- 仓库：[Johnserf-Seed/TikTokDownload](https://github.com/Johnserf-Seed/TikTokDownload)
- 审计提交：[`64acbfda8621563da97ed06f133330c3335b1e8d`](https://github.com/Johnserf-Seed/TikTokDownload/tree/64acbfda8621563da97ed06f133330c3335b1e8d)
- 采用信号：审计时约 8.8k stars
- 许可证：MIT
- 证据等级：`E1-source + E2-doc`（历史采用证据）

它证明了用户作品、喜欢、收藏、图文、音频和关注用户信息等历史能力，但 README 中评论仍标为未完成，且后续能力指向 F2。因此它不能作为评论路线的首选证明；评论与关注的当前参考使用 F2 和前述多个交叉实现。

## 5. Endpoint 与字段交叉验证矩阵

| 能力 | 结构化 endpoint | MediaCrawler | F2 | TikTokDownloader | Download API | 采用结论 |
|---|---|---:|---:|---:|---:|---|
| 关注列表 | `/aweme/v1/web/user/following/list/` | — | 是 | — | 是 | 可进入 Signal Desk 路线库；先被动观察再受控 replay |
| 关注作品流 | `/aweme/v1/web/follow/feed/` | — | 是 | — | 是 | 可作候选发现替代，仍需逐作品作者复核 |
| 用户作品 | `/aweme/v1/web/aweme/post/` | 是 | 是 | 是 | 是 | 四项目交叉印证，作品主路线 |
| 作品详情 | `/aweme/v1/web/aweme/detail/` | 是 | 是 | 是 | 是 | 四项目交叉印证，作者与统计复核路线 |
| 一级评论 | `/aweme/v1/web/comment/list/` | 是 | 是 | 是 | 是 | 四项目交叉印证，评论主路线 |
| 二级回复 | `/aweme/v1/web/comment/list/reply/` | 是 | 是 | 是 | 是 | 四项目交叉印证，独立分页 |

必须由 schema classifier 验证而不能只匹配路径的核心字段：

- 关注页：用户数组、稳定 `uid/sec_uid`、`has_more` 及游标/时间边界；
- 作品页：`aweme_list`、每项 `aweme_id`、每项 `author.uid/sec_uid`、`max_cursor`、`has_more`；
- 详情页：`aweme_detail.aweme_id`、`author.uid/sec_uid`、`statistics`；
- 评论页：`comments`、每项原生 `cid`、每项 `aweme_id`、`cursor`、`has_more`；
- 回复页：原生 `cid`、目标作品 ID、根评论/父评论关系、`cursor`、`has_more`。

路径只用于候选识别。即使 endpoint 路径改变，只要响应满足已版本化 schema，也应进入“待审查的新 fingerprint”，而不是静默丢弃；反过来，路径相同但 schema 不符合时必须报 `SCHEMA_CHANGED`，不得解析或降级到 DOM 入库。

## 6. 浏览器结构化响应捕获的官方证据

- [Chrome `chrome.debugger` API](https://developer.chrome.com/docs/extensions/reference/api/debugger)：官方把它定义为 Chrome Remote Debugging Protocol 的扩展 transport，可按 tab attach、发送协议命令并接收 Network 事件。
- [Chrome DevTools Protocol Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/)：提供 `Network.enable` 与 `Network.getResponseBody`。
- [Playwright Response API](https://playwright.dev/docs/api/class-response)：`response.json()` 可读取 JSON 响应。
- [Playwright `connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)：可连接现有 Chromium 和默认 context；官方同时提示 CDP 连接的 fidelity 低于 Playwright 自有协议。

因此 Signal Desk 使用 `chrome.debugger` 捕获响应体的方向本身正确，无需因为旧 `0.2.4` 失败就整体改用 Playwright。R2 已在模拟 CDP 中实现先监听后导航/触发、六类 endpoint、path + schema 双判定和 bounded projection；作品发现等具体业务绑定仍属于 R3～R5，未经真实小样本验证不能升格为产品通过。Playwright/CDP 保留为独立诊断和交叉验证 harness，而非唯一正式依赖。

## 7. 媒体、ASR 与 OCR 路线

### 7.1 媒体

社区下载器共同证明媒体 URL 可以从作品详情/作品列表的结构化对象取得。Signal Desk 应先保存白名单投影和资源 URL 的哈希，在真正需要媒体处理且用户授权时才下载。

[yt-dlp](https://github.com/yt-dlp/yt-dlp) 可作为用户已提供公开 URL或浏览器已得到可公开媒体 URL时的隔离 fallback；它不负责证明关注关系、作品归属或评论。项目持续禁止 `--cookies-from-browser`，也不得让它提取或落盘浏览器 Cookie。

### 7.2 ASR

- [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)，审计提交 [`ed9a06cd89a93e47838f564998a6c09b655d7f43`](https://github.com/SYSTRAN/faster-whisper/tree/ed9a06cd89a93e47838f564998a6c09b655d7f43)，MIT，审计时约 25k stars。支持 CPU INT8、GPU、batch、word timestamps 和 Silero VAD；当前 `faster-whisper small + CPU INT8` 路线合理。
- [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)，审计提交 [`52a939a2a762224e255d366c1182b2af4dd1a032`](https://github.com/ggml-org/whisper.cpp/tree/52a939a2a762224e255d366c1182b2af4dd1a032)，MIT，审计时约 53k stars。支持 CPU-only、量化、VAD 和多种加速后端，可作为 Python 环境不稳、faster-whisper 安装失败或需要轻量运行时的备选。

社区 benchmark 不等于 Signal Desk 短视频中文准确率。上线前必须建立普通话、方言、音乐/噪声、多人重叠和字幕重叠的小型固定基准，记录字符错误、空转写、时间戳漂移和运行成本。

### 7.3 OCR

[PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 使用 Apache-2.0，审计时约 88k stars，支持 100+ 语言、结构化输出和场景文字识别。Signal Desk 当前抽帧 + PaddleOCR 方向可保留，但文档/OCR benchmark 不能直接代表短视频字幕；需单独测竖屏压缩、花字、运动背景和字幕遮挡。低置信度 OCR 只能作为待复核证据，不可自动进入事实正文。

## 8. 内容总结与网友发言事实核验

### 8.1 现有总结能力的正确扩展

Signal Desk 已能聚合标题、简介、ASR、OCR、关键帧和评论，并进行分块/合并总结。下一步不应只增加更长 prompt，而要把输出改为 evidence-first：每个总结点绑定输入片段 ID、时间戳或帧引用；ASR/OCR/标题冲突时显式标记；没有证据的推断与原文事实分开。

### 8.2 FacTool

- 仓库：[GAIR-NLP/factool](https://github.com/GAIR-NLP/factool)
- 许可证：Apache-2.0
- 采用信号：审计时约 933 stars
- 证据：实现 claim 提取、query 生成、外部证据检索、claim-level factuality、reasoning/error/correction 和 response-level 结果，并包含 ChineseFactEval 相关能力。

它依赖外部模型/搜索/抓取服务，因此不能被 Signal Desk 静默启用；可借鉴的是合同与流水线，不是默认外发内容。

### 8.3 FActScore

- 仓库：[shmsw25/FActScore](https://github.com/shmsw25/FActScore)
- 许可证：MIT
- 论文/项目：EMNLP 2023
- 采用信号：审计时约 457 stars

其关键方法是把长文本拆为 atomic facts，再对知识源逐条验证。Signal Desk 可借鉴“评论中的可核实断言原子化”，但不能把原本用于长文本生成事实精度的总分直接用于给网友贴“正确/错误”标签。

### 8.4 AVeriTeC

- 仓库：[MichSchli/AVeriTeC](https://github.com/MichSchli/AVeriTeC)
- 许可证：CC BY-NC 4.0
- 项目性质：NeurIPS 数据集/基准

其 pipeline 包括粗粒度 Web 检索、问题生成、文档 reranking、veracity prediction 和 justification generation；数据结构包含 claim、日期、speaker、来源 URL、证据问答、verdict 与 justification。适合借鉴评测数据结构和流程，但非商业许可证内容不能直接复制进潜在商业实现。

### 8.5 Signal Desk 的核验边界

只处理可验证的事实性 claim，不处理审美、偏好、讽刺、价值判断和纯预测。固定 verdict 集合为：

- `supported`
- `refuted`
- `mixed`
- `insufficient-evidence`
- `time-sensitive`
- `not-a-factual-claim`

每个非弃权 verdict 必须绑定证据 URL、引用片段、来源时间、检索时间和置信度。无可靠证据时必须返回 `insufficient-evidence`；模型不得凭内部记忆直接判定“网友说错了”。涉及外部检索、内容上传或 BYOK 调用时，仍需走现有费用与隐私闸门。

## 9. 明确禁止采用的社区做法

- Cookie Sniffer、读取全量浏览器 Cookie、写入 `chrome.storage.local` 或发送到 webhook；
- 打印或持久化 Cookie、Authorization、Bearer、签名值、完整请求头、完整带查询 URL 或完整浏览器配置；
- `yt-dlp --cookies-from-browser`；
- 脱离真实浏览器会话伪造设备环境、绕过登录、CAPTCHA、安全验证或风控；
- 点赞、评论、关注、取消关注、私信、发布，以及任何用途不明或可能增加播放量的 endpoint；
- 失败后自动切换 DOM 作为关注、作者、作品、统计或评论事实源；
- 用正文哈希伪造原生评论 ID；
- 未经许可证评估复制 GPL、非商业或无许可证项目的代码；
- 用 README、stars 或一次成功请求宣称“千条近零错误”或生产稳定性。

## 10. 研究限制与复核规则

本次核查基于公开仓库、固定提交的源码和维护者/浏览器官方文档；后段 GitHub 未认证 API 触发速率限制后，改用固定 raw/blob URL 核查，不影响已记录的源码路径，但 stars 是研究时近似值。没有运行这些第三方项目，没有导入它们的依赖，没有读取本机 Cookie，也没有对当前账号发出请求。

任何候选路线进入实现前必须再次完成以下检查：

1. 固定 commit 和许可证；
2. 只洁净重写行为，不复制许可证不兼容或无许可证代码；
3. 先用合成 fixture 验证 schema、分页、错误和脱敏；
4. 再做隔离 `E3-local-poc`；
5. 只有通过 20～30 个样本及人工验收后才能标为 `E4-product`；
6. endpoint 或 schema fingerprint 变化时自动降回“待验证”，不得延用旧成功标签。

可执行的实现顺序、路线切换矩阵和验收门禁见 [`signal-desk-structured-acquisition-optimization-plan.md`](../architecture/signal-desk-structured-acquisition-optimization-plan.md)。
