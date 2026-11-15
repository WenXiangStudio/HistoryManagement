# CreatorHub 浏览器、接口与风控复核

日期：2026-10-09。源码基线：CreatorHub `037f8b39387a715ef7ef7a28a22a66770e22fd67`，Signal Desk `bd107a1`。本轮仅阅读源码、已有验收记录及公开 Issue，并更新方案；不运行平台采集，不修改产品代码和用户资料。

**范围修正**

作品详情和评论已有规划，尚未完成正式链路；完整采集是下一步重点。后台运行与新作品监控等采集稳定后再考虑。通知是已有设想，可以借鉴实现。发布暂不纳入；安装升级等全部功能完善稳定后再做。CreatorHub 的功能覆盖不能直接代表更适合当前项目，也不能代表账号封控概率更低。

**账号与浏览器实现**

| 层次 | Signal Desk 日常链路 | CreatorHub |
|---|---|---|
| 浏览器来源 | 系统已安装 Chrome | 浏览器通道使用 Patchright 管理的持久化 context，优先系统 Chrome；小红书有专用系统 Chrome/CDP 路线；另可选第三方内核 |
| Profile | 选择系统 Chrome 的 Default/Profile N，通过扩展定位并核验登录账号；可以是用户已有的独立 Chrome 配置，不强制每个账号新建项目专用 user-data-dir | 每登录账号项目专用 Profile，独立 cookie/localStorage/cache；带跨进程锁、同账号串行锁、缓存上下文和闲置回收 |
| 控制入口 | Electron 与本机连接服务、扩展发现及 Native Messaging；扩展通过 chrome.debugger 执行 CDP 命令和观察响应 | Python/FastAPI → BrowserManager → Patchright；小红书 CDP 通过 connect_over_cdp 接入专用 Chrome |
| 登录态使用 | 留在真实 Chrome 会话，页面请求 credentials:include；日常链路不导出 Cookie 给外部 HTTP 客户端 | Profile 加数据库 storage_state，提供缺失 Cookie 补回；直连通道从保存的登录态取 Cookie |
| 作者页面生命周期 | 每作者临时页；保存确认后释放 debugger、关闭临时页，再本地等待 | 常驻账号 context，新建或按业务复用标签；含窗口关闭后的 context 重建和闲置回收 |
| 环境设置 | 当前路线没有指纹内核切换或自维护浏览器画像 | native 账号采用浏览器/系统默认环境；旧 legacy 保留历史画像；第三方内核是独立可选分支，不是所有账号都使用 |

依据：[本项目 Chrome 启动](../../src/main/followingSync.ts)、[本项目连接部署](../../src/main/followingConnection.ts)、[CreatorHub BrowserManager](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/browser/manager.py)、[CDP 后端](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/browser/cdp.py)。BrowserManager 的 `_uses_xhs_cdp()` 明确限定小红书，因此不能把所有平台都描述为同一种系统 Chrome/CDP 路线。

稳定性须分三类判断。对当前一个或少量自用账号，保留既有 Chrome 会话与已验证扩展路线，可以减少登录态搬运、签名维护及架构迁移变量，建议继续使用。对大量独立执行账号，CreatorHub 的专用 Profile 与锁更方便控制资源和隔离操作，但不构成更低封控率的证据。对调试连接稳定性，本项目依赖 chrome.debugger，有明确的扩展连接与页面生命周期故障面；CreatorHub 避开了该扩展控制入口，也有自己的 context 关闭、Profile 占用和重建问题。没有同条件长期对照，不能宣布某方整体更稳定。

本项目历史上已定位网页自定义协议子框架触发 Chrome 扩展调试会话断开；现已通过作者保存后立即释放页面减少等待期间的触发窗口，读取期间意外断开仍停止。[原因](../handoff/archive/2026-10/signal-desk-debugger-disconnect-cause-2026-10-06.md)、[修复](../handoff/archive/2026-10/signal-desk-debugger-disconnect-fix-2026-10-06.md)。该故障不等于账号封禁，也不能推断 Python/CDP 就绝无类似故障。

**接口方式：本项目也在调用网页 API**

1. 本项目同步关注：扩展在真实抖音页面通过 Runtime.evaluate 调用 fetch；核验 `/user/profile/self/` 后，GET `/user/following/list/` 分页，缺基础资料时 GET `/user/profile/other/`。数据经过主页/UID 归属验证后投影至 APP，不把登录 Cookie 带回主进程作为直连凭据。[following-plan-runner.js](../../browser-connector/following-extension/following-plan-runner.js)
2. 本项目主页状态：先观察 Chrome 加载主页已产生的原生作品响应，合格时直接复用；不足时在对应作者页面 GET `/aweme/post/`，继续必要的有界分页。页面同源、当前作者路径、来源、UID/secUid、公开状态、游标与日期都参与验收。未发现本项目自行实现 a_bogus 算法；不能据此断言浏览器最终发出的请求一定不含站点处理过的参数。[creator-activity-runner.js](../../browser-connector/following-extension/creator-activity-runner.js)、[网络观察](../../browser-connector/following-extension/creator-activity-network.js)
3. CreatorHub 的抖音 API 直连：Python 的 DouyinClient 从保存的登录态提取 Cookie，构造网页接口参数、token、a_bogus 签名及请求头，使用 curl_cffi 会话发送；为网络层提供与账号 UA 相配的浏览器模拟配置。减少了页面加载，但增加接口参数、签名、Cookie 新鲜度以及浏览器与直连状态一致性的维护面。[client.py](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/platforms/douyin/client.py)
4. CreatorHub 也有浏览器通道。所查抖音主页作品监控 `_scan_target_locked()` 仍调用打开主页、滚动、监听响应的 `fetch_videos()`。`api/browser/hybrid` 是按业务路由的配置，不能概括整套系统。两者所用网页接口都不应被误称为平台向第三方承诺稳定性的官方开放 API。

外部直连可能减少页面资源请求；页面内 GET 更直接沿用当前浏览器环境，原生响应复用还可以避免重复业务请求。实际风险还取决于总量、频率、分页深度、登录状态和失败处理；两条路线都不能凭技术名称被认定“安全”。本项目也有固定网页参数、页面 DOM 和站点响应结构依赖，不能认为完全免维护。

**CreatorHub 确实有风控设计，但不是经平台认可的安全阈值**

默认 `risk_control.enabled=true`、`mode=conservative`。以下均为作者程序配置，不是建议本项目采用的安全额度。

| 规则 | 默认配置 |
|---|---|
| 同网络组并发 | 1；未设置代理的账号归 direct 组；实现主要按规范化代理配置分组，不应理解为完美识别所有实际出口 NAT |
| 轻读/重读间隔 | 20 秒 / 60 秒 |
| 跨操作节奏 | 8～25 秒 |
| 连续操作休息 | 12 次操作后休息 180～480 秒；失败也计入，等待持久化 |
| 跨功能写间隔 | 至少 300 秒 |
| 评论 | 至少 600 秒；3 次/小时、10 次/天 |
| 关注等社交动作、私信 | 各至少 900 秒；各 2 次/小时、8 次/天；社交+私信合并 3 次/小时、10 次/天 |
| 发布 | 至少 7200 秒；1 次/小时、3 次/天 |
| 风险冷却 | 1800 / 7200 / 21600 / 86400 秒阶梯 |
| 恢复探测 | 间隔 600 秒，连续成功 3 次；明确人工验证时需人工处理 |

还有失败代理不自动改直连、写结果不确定时不自动重发、风险事件记录和多账号网络组熔断等控制。源码注释和 README 明确提到自动评论、关注/取关、私信的风险。[默认配置](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/config.example.yaml#L103)、[风险控制](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/risk.py)

这些控制有三个边界：

- 限流主要包裹逻辑操作，不是所有 HTTP 请求统一逐次计费。所查主页监控甚至归类 READ_LIGHT，但一次操作可加载页面并滚动取多页；关注同步外层只经过一次 READ_HEAVY 预算，直连分页默认每页额外等待 0.15 秒，另加响应耗时。
- `_limits()` 对 READ_LIGHT/READ_HEAVY 返回间隔加 `0,0`，即没有该处的小时/日额度。它们仍受其他休息、并发、冷却规则约束，不能理解为无限制；也不能解释为每小时/每日请求总量已受严格上限保护。
- 监控配置可设 1～86400 秒，实际执行仍受调度、串行和冷却限制。若 295 个目标每 5 分钟检查一次，配置需求是 295×288=84,960 次目标检查/天，并非实际可达到的请求量；一次目标检查还可能产生多个请求。高频设置可能形成积压，并不保证及时性或低风险。

GET 也可能触发访问频控、验证码或登录校验；POST 既可能是读取查询或遥测，也可能是评论/发布等业务写入。真正要比较的是动作语义与频次、目标范围、请求深度和失败后的行为。评论、私信等额外涉及内容、接收人、重复操作和举报，风险面更广，但没有统计资料不能量化其封控率。扩展向 127.0.0.1 APP 上报的 POST 不是对抖音的写操作；正常抖音网页自身也可能产生 POST，因此不宜宣称本项目全部网络流量只有 GET。

**真实规模与风险数据：未找到足够证据**

查阅范围包括 README、CHANGELOG、配置、风控/监控源码、相关 tests、Windows CI，以及公开 Issue 关键词检索“风控”“封号”“批量”。GitHub REST API 本次受公共 IP 限流，改读公开网页；不把搜索结果空白当作平台从未封控的证明。

- CHANGELOG 声称已验证关注和粉丝各 6 万条列表数据，但未附对应的执行账号数、真实采集频率、持续时长、请求量和封控事件统计。不能将列表读写能力替换为高频平台安全证据。
- 检查的 `test_follow_sync.py` 大列表用 2500 个合成用户和 AsyncMock；`test_risk_control.py`、`test_risk_pacing.py` 主要用临时 SQLite、模拟账号、时间和结果验证限流状态机。它们能说明逻辑行为被测试，不能测出平台真实风险概率。
- 公开 [Issue #16](https://github.com/3441293738/creatorhub/issues/16) 提出大量账号同机、同出口的关联风险。它是用户讨论与建议，没有对照测量数据；不采纳其中“某种设备天然抗检测”等未经证实的推断。
- 公开 [Issue #27](https://github.com/3441293738/creatorhub/issues/27) 是已关闭的浏览器 context 生命周期故障报告，不能当作当前版本仍有该故障或账号被封的证据。

在上述范围内未找到能支撑“数百/上千目标长期高频运行，风险可控到某个概率或某个阈值”的报告。也没有足够证据对双方封控率排序。295 个被观察博主与 295 个登录执行账号是不同规模，任何测试都应先说明这两个数量。

本项目当前通过手动触发、限制动作面、复用原生响应、有界读取、33 位分批及明确错误即停止来减少风险暴露。这支持继续沿用现有路线，不支持把“最低封控率”作为已统计证明的结论。未来加入持续监控前，应在用户正常使用中累计执行账号/目标数、业务请求及原生请求观察量、连续时长、分页深度、验证码/限流/登录失效/浏览器故障等分项事件；不通过主动触发平台限制来寻找极限。

**取关分区**

规则与接入方案见[关注关系及取关分区方案](../architecture/following-relationship-reconciliation-plan-2026-10-09.md)。保留累计档案，另存最近可靠完整关注关系；同步完成后更新关系和显示数量，未出现于部分结果不得判取关。当前仅形成方案，产品尚未实现。
