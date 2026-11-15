# 单个抖音博主深度拆解：现成 Skills、工具与参考实现

研究日期：2026-10-15。用户希望查找市场上的现成方案，并核对本地借鉴目录里的项目如何实现视频数据、作品与变化、分类、内容模式、风格、人设及领域分析。本轮是选型研究，不是新增APP功能或执行账号分析。

结论：已找到可以直接研究或配置试用的抖音账号诊断及深度分析Skill。最贴近单账号内容拆解的是 **BrandBAI 抖音账号深度分析**；最接近现成量化体检的是 **RedFox 抖音账号诊断**。本地已有参考中，**ai-boshu-crawler**提供正文画像、跨作品分析和证据报告，**duyi-douyin-video-breakdown**提供单视频内容模式拆解标准。没有一个已核实对象可以据此称为已经在本机验收的、覆盖全部历史与多模态风格的完整方案。

## 1. 调查范围与证据

- 复查本地[借鉴总目录](reference-project-catalog.md)、[固定源码索引](reference-source-index-2026-10-09.md)、[提取与总结专题](video-information-extraction-and-summary-2026-10-09.md)、CreatorHub对比及原插件文件。
- 搜索GitHub和skills.sh目录；阅读上游官方仓库、Skill合同、部分实现脚本与官方产品页面。
- 用`git ls-remote HEAD`固定8个仓库；ai-boshu、duyi、XHS主页诊断和CreatorHub的本地既有版本与本轮远端HEAD一致。
- Skill目录条目用于发现项目，不作为实际效果或稳定性证据。第三方SKILL.md在这里是被研究的源材料，没有安装或执行其工作流。
- 未请求付费数据API，未登录第三方商业平台，未访问真实抖音账号或提交媒体／模型请求；未修改APP、正式数据库、模型或现有分组规则。

| 项目 | 固定提交 | 本轮证据 |
|---|---|---|
| redfox-data/redfox-community | `cbf2d126c987047eaaeb9f47d867d60d73266897` | Skill、工作流、API合同、诊断Python源码 |
| brandbai7/brandbai-skills | `22105841f8e2f2ad06b3fe07640a255d024a74ca` | Skill、分析方法、编码合同、数据准备及交付校验源码 |
| dragon-hh/ai-boshu-crawler | `57ad263c0be8cf234bcadbc5c07dedc72304d182` | 本地固定源码、分析合同、准备器、画像／报告校验、周报Skill |
| duyi2076/duyi-douyin-video-breakdown | `fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba` | 本地Skill、五层拆解标准、报告生成源码 |
| atian-create/xhs-profile-breakdown-skill | `bde75b258c55cc06f935faa43d0bb5006ba06a2f` | 本地Skill及许可证 |
| 3441293738/creatorhub | `037f8b39387a715ef7ef7a28a22a66770e22fd67` | 本地原先源码审阅及本轮HEAD复核 |
| yzfly/douyin-mcp-server | `b0bb8b1fbe4f514bf28099b1471928ebb3716ad2` | README、项目配置、许可证 |
| xintu1314/content-boom-monitor | `98e786e7c5e8c6ca641b688e2948772a7a76f9a9` | README与评分合同；未展开采集脚本审计 |

## 2. 最贴近内容、人设及账号定位：BrandBAI

入口：[抖音账号深度分析Skill](https://github.com/brandbai7/brandbai-skills/blob/22105841f8e2f2ad06b3fe07640a255d024a74ca/skills/brandbai-douyin-account-analysis/SKILL.md)。版本0.2.0。

它接收已有采集包，包括作品ID、标题、发布时间、链接、置顶状态、可见互动、封面、评论原文及来源。可以配合同仓库的下载Skill，也允许其他来源；本Skill自身不采集。

实际方法：

1. 取当前全部置顶作品，加最近最多30条非置顶作品。置顶单独解释身份信号、代表作或主动展示意图，不混入近期表现基线。
2. 按用户任务、内容类型、周期、商业属性、时长和表达方式建立可比组，用中位数和四分位数观察互动表现。
3. 深看全部置顶及最多10条非置顶代表作，覆盖高、常态、低表现和反例。记录人物角色、核心承诺、结构、视觉锚点、表达、证明方式及注意力归属。
4. 将对应评论编码，比较“作品表达了什么”与“评论接收了什么”：关注内容／方法、人物、关系、场景、商品，还是噪声。
5. 输出稳定角色与内容任务、高表现候选机制、反例、替代解释、失效条件和未知项。证据分为F可观察事实、P重复模式、H假设、U未知。

程序负责准备和校验，不代替AI分析。`build_analysis_dataset.py`显式输出`semantic_analysis_included: false`；Agent依照方法填写`video_analysis.jsonl`、`evidence_ledger.jsonl`和`claim_cards.jsonl`。交付校验器检查作品／评论ID引用，P模式至少两个支持作品并有评论证据，另检查Excel与内部数据、模板占位、观察层级等。

产物是`01_账号深度分析.md`、`02_D1评论语义证据包.xlsx`、`03_分析说明与资料缺口.md`及原始JSONL。

适合借鉴的核心是“账号定位／角色信号＋代表作品＋评论反馈＋证据卡”。它默认无ASR，封面、标题与评论材料足够时即可完成其轻量模式；未直接看到的口播、开头、动作或剧情必须写未确认。因此不能将其`complete`理解为已经完整理解30条视频的声音、画面和剪辑。

它限制近期样本，并非长期变化或全账号领域占比引擎。需要长期内容变化时仍需多期数据；需要语气、镜头及剪辑风格时需追加相应媒体证据。

源码：[分析方法](https://github.com/brandbai7/brandbai-skills/blob/22105841f8e2f2ad06b3fe07640a255d024a74ca/skills/brandbai-douyin-account-analysis/references/analysis-method.md)、[准备数据](https://github.com/brandbai7/brandbai-skills/blob/22105841f8e2f2ad06b3fe07640a255d024a74ca/skills/brandbai-douyin-account-analysis/scripts/build_analysis_dataset.py)、[交付校验](https://github.com/brandbai7/brandbai-skills/blob/22105841f8e2f2ad06b3fe07640a255d024a74ca/skills/brandbai-douyin-account-analysis/scripts/validate_analysis_delivery.py)。

许可：PolyForm Noncommercial 1.0.0；该Skill明确商业用途需取得作者授权。本次只研究其方法，没有复制进产品。

## 3. 最接近现成量化体检：RedFox

入口：[douyin-account-diagnosis](https://github.com/redfox-data/redfox-community/blob/cbf2d126c987047eaaeb9f47d867d60d73266897/skills/douyin-account-diagnosis/SKILL.md)。skills.sh已能检索到对应条目。

实现不是“模型直接看全账号”。`scripts/douyin_diagnosis.py`根据昵称或抖音号，通过带`X-API-KEY`的`POST /story/api/dyUser/queryData`获取账号画像与近期作品。Python计算六组指标及加权100分；Agent把程序原始结果转换为固定Markdown报告。

六组分别是账号资料、内容生产力、互动、内容质量、内容趋势、粉丝质量。粉丝分层决定阈值；中位数／均值、变异系数、零互动占比、爆款集中、发布时间等参与规则判断。脚本包含样本不足、零分母和部分字段缺失的处理。关联`douyin-works-crawler`提供作品列表，文档声明支持分页和每页最多50条；`douyin-similar-account`从服务端返回的分类与红狐指数提供相似／头部账号候选。

适合直接试用：账号基础数据、近期作品明细、更新节奏和粗略表现诊断。需要RedFox API Key及服务积分；本轮没有请求API，价格、账号覆盖、时效和返回条数未实测。

实际局限：

- “内容质量”“粉丝质量”是规则指标名称，不能据此声称模型理解了作品内容或验证了粉丝真实性。脚本不包含完整作品转写、风格、人设和语义领域分析。
- `diagnose_trend`排除未满3天作品后，比较较早与较新两组作品的累计互动。减少了新作品年龄偏差，但仍不是同一作品的多时点增长曲线；不能当成已证实的播放／涨粉趋势。
- “僵尸粉／刷量／限流”在该项目中是阈值预警标签，没有平台侧因果证明，不宜直接作为账号事实。
- 账号未进入第三方库、接口只返回部分作品与账号确实清空作品不同；其空数据处理规则不能直接迁移为本产品删除或降级博主的依据。

源码：[诊断脚本](https://github.com/redfox-data/redfox-community/blob/cbf2d126c987047eaaeb9f47d867d60d73266897/skills/douyin-account-diagnosis/scripts/douyin_diagnosis.py)、[完整流程](https://github.com/redfox-data/redfox-community/blob/cbf2d126c987047eaaeb9f47d867d60d73266897/skills/douyin-account-diagnosis/references/core_workflow.md)、[规则](https://github.com/redfox-data/redfox-community/blob/cbf2d126c987047eaaeb9f47d867d60d73266897/skills/douyin-account-diagnosis/references/diagnosis_rules.md)。本轮根`LICENSE`入口404，不据公开源码推断允许复制分发。

## 4. 本地参考中的分析实现

### ai-boshu-crawler：可复用的单视频画像与跨作品聚合

数据从本地只读镜像表进入，含博主、作品、转写稿、指标快照及代表评论。`prepare_creator_analysis.py`按最新同步完成时刻构建24／72／168小时输入包，检查同步新鲜度、正文文件与SHA。

Agent读取完整正文，为每条视频写入：摘要、主／次话题、核心主张及原文证据、实体、目标受众、受众问题、立场、新颖角度。缓存键是`video_record_id + transcript_sha256`，正文变化就产生新画像。Python校验画像结构／身份／SHA，报告渲染器校验证据视频ID属于本窗口、章节及置信级别，然后生成固定JSON与离线HTML。`validate_profile`对引文检查的是存在且非空；不能仅凭该校验宣称引文已逐字匹配或解释正确。

这最适合借鉴用户“常发什么领域／内容、跨作品有哪些重复模式”的中间数据结构。它已有周报关注趋势、共识、分歧与重复，但默认是跨博主窗口分析，不是一个账号的完整定位／人设报告。改成账号维度聚合及领域占比属于需要适配的部分。

源码：[分析合同](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/CREATOR_ANALYSIS.md)、[准备器](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/prepare_creator_analysis.py)、[渲染器](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/render_creator_analysis_report.py)、[周分析Skill](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/creator-weekly-analysis/SKILL.md)。

### duyi-douyin-video-breakdown：单视频内容模式与表达机制

Runner按`collect_douyin → prepare_video → transcribe → extract_frames → build_report`保存阶段产物和manifest，可复用同一证据目录续跑。自动报告使用首句、关键词、句段与评论信号等启发式生成初稿；Skill明确要求Agent重新读取全文、时间戳、关键帧和页面证据再完成最终报告。

五层标准覆盖：观众任务、内容骨架、开头／转场／结尾、案例数字与表达填充、可信度和营销机制。关键节点要求原文、解释与可迁移方向。这比“总结说了什么”更贴近内容模式和口播表达风格。

它分析的是单条视频。比较多条再归纳账号稳定模式可借鉴，但不是其现成的账号级统计功能；声音及动态镜头风格也不能仅由转写和静态帧推断。CC BY-NC 4.0。

源码：[Skill](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/SKILL.md)、[五层拆解标准](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/references/layered-breakdown-v2.md)、[启发式报告实现](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/scripts/build_report.py)。

### XHS Profile Breakdown：主页定位检查表

输入主页截图／信息和最近9篇封面标题，检查昵称、简介、封面、背景和前9篇的一致性，然后输出内容主线、三个问题与一个下一步动作。适合借鉴“账号第一印象、服务谁、持续提供什么”的检查维度。它面向小红书，Skill明确不采集、不做完整深度诊断；不能直接当抖音全账号分析器。MIT。

源码：[Skill](https://github.com/atian-create/xhs-profile-breakdown-skill/blob/bde75b258c55cc06f935faa43d0bb5006ba06a2f/SKILL.md)。

### CreatorHub、MediaCrawler、F2：数据基础层

CreatorHub提供目标账号监控、作品／评论读取、保存、任务与时间调度。原固定版本审阅未见完整的ASR＋内容语义＋人设分析链路；本轮远端HEAD仍相同。MediaCrawler、F2主要提供字段、作品和评论分页、下载／存储能力。它们适合供数，不能由“采到作品”推断已经实现内容模式、风格和人设分析。

本地定位：[CreatorHub比较](creatorhub-comparison-2026-10-09.md)、[采集项目固定索引](reference-source-index-2026-10-09.md)。其中Signal Desk状态是10月9日历史，不覆盖当前APP已实现功能。

### 本机df对标拆解助手1.5.3

对`D:\BaiduNetdiskDownload\对标拆解插件\dcxzs_extension_protected`只读复查，可定位作品列表、评论模块、`/api/asr/transcribe`及`/api/ai/script-analysis`客户端调用。能看出列表／评论／转写／AI拆解的产品划分，但未确认开源，服务端提示词、模型、分析算法和账号聚合能力不可由混淆前端核实。可借鉴交互，不能当可直接移植的完整账号算法。

## 5. 其他现成工具

| 工具 | 核实到的机制或能力 | 对本需求的用途与限制 |
|---|---|---|
| [Content Boom Monitor](https://github.com/xintu1314/content-boom-monitor/tree/98e786e7c5e8c6ca641b688e2948772a7a76f9a9) | Just One API获取关键词／对标账号作品；标准化去重；以当前互动÷同账号其他作品中位数计算R；Codex再拆解少量候选 | 适合异常高表现作品筛选，非完整领域／风格／人设报告。至少5条对比；权重和阈值是项目规则，不是爆款概率。README默认每账号8条、1页会限制覆盖 |
| [douyin-mcp-server](https://github.com/yzfly/douyin-mcp-server/tree/b0bb8b1fbe4f514bf28099b1471928ebb3716ad2) | 单链接解析、媒体下载、音频提取及云端ASR；WebUI／MCP／CLI | 可供单作品转写，README未提供全账号语义拆解。固定LICENSE是Apache 2.0，pyproject写MIT，许可声明不一致，实际复用须复核 |
| [飞瓜抖音](https://dy.feigua.cn/) | 官网明确列出达人分析、粉丝画像、运营／带货数据及追溯近3年数据 | 现成商业数据看板候选，适合账号数据与历史表现；具体账号覆盖、价格与导出/API权限未登录验证。内部采集／模型实现未公开，不按开源项目描述 |
| [蝉妈妈](https://www.chanmama.com/)、[抖查查](https://www.douchacha.com/) | 官方入口均可访问，分别定位短视频内容运营／直播电商及数据分析 | 作为商业产品候选保留；本轮页面是JS壳，未核实其当前会员下的账号深度报告、语义风格或导出能力，不列为源码已验证方案 |

## 6. 对本次需求的选择建议

| 用户想了解的内容 | 优先研究对象 | 还缺什么 |
|---|---|---|
| 作品数、更新频率、互动分布 | RedFox、飞瓜；自采看MediaCrawler／F2 | 确定数据时间、字段缺失与作品覆盖 |
| 单账号近期内容、人设定位信号与观众反馈 | BrandBAI | 默认是轻量材料；更深风格分析需要声音／画面证据 |
| 常发领域、话题、观点、目标人群 | ai-boshu的视频画像 | 账号维度聚合、统一标签及可解释占比 |
| 开头、论证、结构、表达及内容模式 | duyi五层拆解 | 多条代表作品的稳定模式聚合 |
| 哪些作品偏离常态、值得深看 | Content Boom Monitor的同账号中位数 | 同龄作品对照、适当样本及持续快照 |
| 历史内容转向与互动／粉丝变化 | 多期元数据与内容画像；飞瓜历史数据候选 | 单次快照不能还原过去增长；主题变化与数据增长应分别验证 |

若只挑三个分析参考优先深入：BrandBAI看账号级分析方法，ai-boshu看可复用画像及证据结构，duyi看单视频内容模式。若只想先拿到现成账号数据诊断，则优先评估RedFox服务覆盖与费用，或试用飞瓜。这里的推荐是本轮源码／文档比较，没有代替用户决定采购或安装。

本机原始快照、检索结果、固定提交和SHA清单：`local-data/research/creator-analysis-20261015/manifest.json`。GitHub树API曾遇匿名限额，已改用`git ls-remote`和固定提交raw文件；未以接口失败推断项目不存在。部分不相关搜索结果未纳入推荐。
