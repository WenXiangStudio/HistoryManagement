# Signal Desk 下一窗口交接：本周公开作品筛选与请求减量（2026-10-04）

> 历史记录：这里的版本、构建路径和操作状态属于当时记录。当前运行方式请以[当前交接](../../README.md)为准。

> 2026-10-04后续：用户要求本轮优化全部回退，当前已恢复0.6.4。本页新方案/版本/验收为历史时点，不作为当前运行指令；以[最新回退交接](signal-desk-risk-rollback-2026-10-04.md)为准。

> 后续修正及交付：[请求减量与动态等待](signal-desk-activity-load-2026-10-04.md)。用户纠正video_status/private_status是其此前混用的开放平台参数，不能据此推定网页接口枚举；网页完整配置仍缺官方说明。0.6.5已交付CDP原生响应复用与反馈限速，仅一次Boujoy验证，额外本周GET0、原生列表1页。网页响应实测有status.private_status=0，但未见video_status；其完整语义及临时/好友/分组筛选尚未证明。下文“仅文档、未实现减量、0.6.4”及video_status=5猜想为此前时点，不能再作为最新任务或规则；严格筛选仍待完成，少量请求限制继续有效。

## 本窗口结束位置

用户已同意把“本周动态只统计所有人公开可见、非临时作品，研究状态字段并减少重复请求”交给下一窗口。本窗口最后要求是更新交接文档后停止，不能继续采集或实现。此文档及索引更新仅为交接，筛选改造和响应复用尚未实现。下一窗口从这里接续，不恢复此前的完整作品列表遍历。

## 用户已确定的要求

1. 作品总数直接读取博主主页前端“作品”标签旁的数字。不得改回profile接口计数，不用接口数核对前端数，不为总数遍历全部作品。前端总数读取已实现并交付。
2. 本周更新数、最近更新时间和因此产生的三区归属，只纳入该作者“所有人公开可见、非临时”的作品。私密、隐藏、分组/好友可见、临时日常作品均不应计入；保留公开视频与图文，不因字段名称包含video而漏掉图文。
3. 用户提出以`video_status=5`筛选，其他状态可能非公开；同时要求查抖音官方字段定义。该数值含义是待核实的假设，不能在下一窗口直接写成已验证规则。`video_status`如果返回5，是数值枚举，不是布尔值；不要把`true`当作5，也不要未经证据给2/4/6/7等状态命名。
4. 真实尝试必须少量，禁止大批量请求。用户明确“这次不允许有大批量请求”，该限制继续有效；不点击“更新全部博主资料”、不新增10/20位、不继续大批次剩余、不按200位扫描。先复用本地来源与官方资料，再以少量单作者验证必要字段。避免循环试参或连续重试，发现平台限制即停止。
5. 账号累计资料、身份、星标、批注和历史快照必须保留。读取失败、未知可见性或范围未覆盖时不能写成0，不能清空列表、删除博主或覆盖旧历史。以AGENTS.md要求的最小真实证明先行，随后做入库、展示和产品自动化。

## 当前可运行版本

- 工作区：`D:\AI_WorkSpace\SpatialWarehouse\AI_InformationWorkflowCreationCenter`，Windows PowerShell，北京时间。此前实现及文档尚未提交推送，保留全部现有修改，不能reset/checkout覆盖。
- 桌面入口：`C:\Users\Administrator\Desktop\Signal Desk.lnk`，目标`release-following-background-final\win-unpacked\Signal Desk.exe`；参数`--user-data-dir="C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview"`。正常快捷方式没有remote-debugging参数。
- 当前关注扩展0.6.4；APP自动部署到上述用户目录的`following-extension`。账号Chrome Default，原绑定账号保持。产品目录库`following-directory.sqlite`，配置`following-settings.json`，正式业务库另为`signal-desk.sqlite`。
- 最近验证200位博主、13次关注run、16次动态run、490份动态快照及490次结果尝试。历史行及账号配置保留，integrity=ok、外键问题0。上述是最后已核验时点，下一窗口现场可能有用户操作，先读状态，不凭文档覆盖现场。
- 正式作品详情/评论/媒体/云端分析能力门仍关闭；这次只涉及资料库元数据。资料刷新由用户按钮触发，没有新增定时全量采集。

现有资料库三区：今日更新优先上区、本周至少1条且非今日的中区、其余下区；同一作者不重复。北京时间周一至周日，跨日/跨周自动展示，待检查保持未知。已分析“—”、三行简介可展开不透明气泡、单行可点击主页链接均保留，不属于本次待改范围。

## 当前请求与筛选实现

核心文件：

- [浏览器runner](../../../../browser-connector/following-extension/creator-activity-runner.js)：`readCreatorProfileCount`、`readCreatorActivityPage`、`runCreatorActivityRefresh`。
- [来源契约与接受校验](../../../../src/shared/creatorActivity.ts)：capture v4、前端计数证明、作者/时间/分页校验、本周去重计算。
- [保存与历史展示](../../../../src/main/creatorActivityService.ts)：按账号保存，优先保留可信周结果，计数与周结果分别可保留。
- [桥接与版本](../../../../src/main/followingSync.ts)、[扩展部署](../../../../src/main/followingConnection.ts)、[manifest](../../../../browser-connector/following-extension/manifest.json)。
- [卡片](../../../../src/renderer/src/App.tsx)、[分区](../../../../src/shared/creatorActivitySections.ts)。

当前每轮开始主动GET一次`/aweme/v1/web/user/profile/self/`核对账号；逐作者在后台临时主页标签读取原生`#semiTabpost [data-e2e="user-tab-count"]`，然后主动GET`/aweme/v1/web/aweme/post/`读取本周列表。每页20、最多10页，旧非置顶作品越过周界或到末页就停止，原账号自主页不改，临时页最终清理。平台主动采集请求均为只读GET；向本机APP提交来源/进度使用POST。加载主页本身还会有原生接口、头像、脚本和埋点，不能把runner主动请求数称为全部网络请求数。

现有清洗并非完全没有，但还不覆盖用户新口径：接受公开条件是`status.private_status===0 && status.is_delete===false && status.is_prohibited===false`；明确private_status>0、删除、禁止公开条目单独排除，外作者须双ID均不同才排除，缺失/冲突身份拒绝。尚未读取或证明`video_status`，没有明确的分组/好友可见及临时日常作品判断；这些不能凭基本三项检查就宣称全部已排除。

v4白名单来源只保留作者ID、作品ID、发布时间、置顶、publicVisible及排除记录，通常不含原始video_status/日常/受众状态。已有来源可用于查归属/范围/去重，不能从这些投影反推被丢弃状态。新字段若必要，应以最小真实观察确认后加入业务白名单、保存来源和后端重算校验，不只在浏览器里给一个无证据的publicVisible=true。

## 已完成的少量恢复验证

用户关闭APP/Chrome、清理Cookie及部分数据并重新登录后，仅Boujoy两次单卡尝试：首次在账号页发生Chrome debugger `Inspected target navigated or closed`，done=0，没有本周来源提交；页面稳定后第二次成功，前端18、本周1条、最近更新2026-10-02 21:13，errorCode=null。

成功capture为1次主动本周请求、1页、18个不重复公开条目，作者双ID通过。约6.98秒是该次点击到APP资料显示，不能当作接口耗时；这1次也不包含APP准备和浏览器页面自动请求。最终原桌面快捷方式无调试参数重开，200卡片、数据保留、无运行采集已核验。见[恢复证据](../../../evidence/cookie-reset-probe-20261004/README.md)和[verification.json](../../../evidence/cookie-reset-probe-20261004/verification.json)。

用户判断此前为临时风控，恢复现象与之相符；没有平台明确错误分类，尚不能把风控或Cookie问题写成已证实根因。禁止再以大批量请求验证风控阈值。

此前255项应用测试/28文件、9项runner测试、TypeScript、build/package、renderer smoke和project boundaries通过，只验证现有0.6.4实现，不代表本次新筛选已实现或验收。原v3全遍历方案被用户否决：200位run检查到95位时停止（94成功、1失败），没有完成全量验收，旧快照保留，不继续剩余。

## 官方字段调研：已查内容与未解决事项

本次讨论只读代码和公开文档，没有向博主采集接口发请求，也未改代码。公开查询入口为[抖音官方“查询视频”目录](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/search-video)及其[“查询视频发布结果”页](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/search-video/video-share-result)。后者是share-id/发布结果能力，不提供当前网页作品列表的完整可见状态映射。

在本次能获取的官方页面中，未找到`/aweme/v1/web/aweme/post/`的完整状态枚举，也未找到官方支持传入`video_status`作为服务端筛选条件的说明。尝试的若干旧video-list路径实际文档数据指向404，不能把HTTP200的文档外壳当作字段证据。不要把“本轮没查到”写成“官方一定不存在”，也不能把第三方解释标为抖音官方。

调研临时文件在忽略目录`local-data/public-visibility-research-20261004`，只含文档HTML；不作为产品依赖。下一窗口查到有效官方说明时，记录对应接口、字段类型、路径、文档日期和具体状态含义；开放平台OAuth接口与当前网页内部接口必须分清。同名字段不可直接跨接口套用，图文/日常也可能另有字段。

## 下一窗口的工作顺序与验收

1. 读现场状态，保持前端总数与现有功能；核实官方字段及接口适用范围，再核对已有本地样本。必要真实证明仅用少量作者和有限页，不能以未知映射或样本不足为理由扫描全库。
2. 先分别确认“所有人可见”和“非临时”所需证据。`video_status=5`是否充分、private_status如何互补、分组/好友/日常如何表示都待核实。不能只用当前账号能够访问作为所有人可见的充分证明。明确非目标内容排除，未知可见性留待确认；若页面全被过滤而范围未证明完整，不能直接给本周0。
3. 按确认规则完善浏览器筛选、来源白名单和后端接受校验；保留作者双ID、公开/图文、时间边界、原生ID去重和置顶逻辑。检查过滤后的分页顺序和周界停止是否仍有可靠依据，不能因排除若干作品就过早认定本周覆盖完整。
4. 请求减量与清洗分别验证：收到一页后本地过滤不会消除这次请求。优先研究复用主页自身已加载的作者作品列表响应，减少额外第一页GET；只复用目标作者、分页/状态/时间均匹配的响应。不得为了取得状态给每条作品另加详情请求。没有已证明服务端支持的筛选参数，就不编造`video_status=5`查询参数。
5. 加入有意义的公开/非公开/临时/未知、图文、置顶、周界和空结果测试；以少量真实样本验证字段和归属。报告APP点击到数据可用总耗时及主动接口请求、页面自动流量、缓存复用命中分别计量；不要保证未经测量的请求下降比例。
6. 若完成交付，同步匹配的app.asar/Signal Desk.exe及扩展资源、版本检查并重新加载；原用户目录和桌面快捷方式不改。最后无调试参数重开，确认无采集在跑并更新证据/交接。产品流程由APP连续完成，不依赖代理逐位发命令。

补充：此前[删除与发布历史讨论稿](../../../architecture/creator-publication-history-2026-10-04.md)尚未实现。本次用户授权的是可见作品筛选与减量，不顺带改成“历史曾发布累计”，不扩大到正式作品/评论/媒体/云端采集。Windows完整重启与第二真实账号仍未独立验收。
