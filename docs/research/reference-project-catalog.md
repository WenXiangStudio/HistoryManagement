# 可借鉴项目、工具与 Skills 总目录

> 建立日期：2026-10-09。用途：Signal Desk 后续实现、选型和复查的长期参考入口。本文登记“曾经讨论或研究过什么、适合借鉴什么”，不代表已经安装、接入、通过真实采集验收或决定采用。

## 阅读入口与定位

- 查看具体实现：[视频信息提取与结构化总结研究](video-information-extraction-and-summary-2026-10-09.md)。覆盖标题、描述、口播文案、点赞量、评论正文、评论数、收藏量及结构化总结。
- 追溯代码：[固定版本源码索引](reference-source-index-2026-10-09.md)。记录 commit、文件位置和证据级别；不依赖会移动的 `main` 链接。
- 查看当前产品：[根 README](../../README.md)、[当前交接](../handoff/README.md)。历史参考不能覆盖现行实现说明。
- 查看已确认路线：[CreatorHub 讨论共识](creatorhub-consensus-2026-10-09.md)。保留轻量路线，先稳定作品详情、评论与完整采集，再考虑后台监控。
- 查看最新方向确认：[2026-10-10 用户确认的分环节借鉴思路](video-information-extraction-and-summary-2026-10-09.md#confirmed-direction)。作为后续设计依据，允许随反馈调整；具体工具接入和产品细则仍待落实。
- 查看账号深度分析：[单个抖音博主拆解的Skills、工具与实现调查（2026-10-15）](creator-account-analysis-tools-and-skills-2026-10-15.md)。新增BrandBAI与RedFox专用账号分析Skill，并复查本目录已有画像／文案拆解项目；仅研究，未安装或接入。

本目录收录此前历史清单中的 **31 个具名参考对象，另保留 1 个尚未识别的分享材料占位，共 32 项**。FFmpeg / FFprobe、OpenCLI / Browser Bridge、父项目 / 子 skill 分开登记，因此不等于 32 个独立产品。另有本次核查发现的 4 个分析子 skills，单独编号 `N01–N04`，不倒推为用户过去明确提过。

历史来源取自当前对话、项目归档，以及此前按本项目工作目录匹配检索的 35 份本地会话记录；这不是对已经删除、其他机器或其他目录中所有对话的完整性保证。这里沿用上一轮确认的历史对象清单，本轮重点复核实现。

## A. 用户明确引入的参考对象

| 编号 | 对象与入口 | 定位、介绍 | 适合借鉴 | 边界与历史来源 |
|---|---|---|---|---|
| R01 | [duyi2076/duyi-douyin-video-breakdown](https://github.com/duyi2076/duyi-douyin-video-breakdown) | 抖音单视频采集、媒体处理及文案拆解 skill | 证据目录、分阶段复用、时间轴、原文与结构功能对应、最终报告合同 | DOM 指标与评论不等于精确全量数据；CC BY-NC 4.0。2026-08-27 用户链接 |
| R02 | [YT-smart/Ether_vs](https://github.com/YT-smart/Ether_vs) | 本地 Web 视频下载和 Qwen3-ASR 文案提取工具 | 常驻转写工作器、分块进度、下载与转写分开操作 | 不是评论采集或完整总结系统；本次未发现根许可证。2026-08-27 用户链接 |
| R03 | [YT-smart/video-parse-transcribe](https://github.com/YT-smart/video-parse-transcribe) | 分享链接解析与 Whisper 转写 skill | 单链接解析、JSON 输出、音频提取与转写组合 | 统一输出不包含完整互动指标/评论；根许可证未发现，不能以 vendored 上游 MIT 代替。2026-08-27 用户链接 |
| R04 | [atian-create/xhs-profile-breakdown-skill](https://github.com/atian-create/xhs-profile-breakdown-skill) | 小红书主页定位、昵称、简介、封面、前九篇内容诊断 | 账号级分析维度、固定输出合同 | 明确不做 scraping/data collection；不是视频转写器。MIT。2026-08-27 用户提及，之后定位仓库 |
| R05 | [dragon-hh/ai-boshu-crawler](https://github.com/dragon-hh/ai-boshu-crawler) | 多平台博主内容采集、下载、转写、飞书镜像及分析工作流 | 已保存作者入口、独立评论任务、转写原稿/可读稿分层、正文哈希缓存、证据化画像 | 抖音主流程指标仍有 DOM 来源；部分语言分析由 Agent 按 skill 完成。根许可证未发现。2026-08-27 用户链接 |
| R06 | [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | 通用媒体下载与站点元数据解析器 | 格式选择、下载恢复、字幕与媒体元数据适配 | 平台及 extractor 决定能力，不能以“支持评论选项”推断抖音评论可用；不做 ASR/总结。2026-09-04 用户明确提到本机安装 |
| R07 | df 对标拆解助手 **1.5.3** | 用户提供的 Chrome 扩展，做作者作品列表、评论、转写及 AI 拆解 | 元数据/评论/下载/转写分开操作、缓存、分析结果展示 | **未确认开源**；本机混淆前端可读，服务端模型与提示词不可核实。2026-09-24 用户引入 |
| R08 | [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 多平台结构化采集器 | 作品/评论字段映射、评论归属检查、分页和存储分层 | 浏览器协助登录/签名，同时使用独立 HTTP 请求，不能等同于纯被动监听；非商业学习许可证。用户 2026-10-05 明确链接，研究早于此日期 |
| R09 | [3441293738/creatorhub](https://github.com/3441293738/creatorhub) | 多账号、多平台监控、下载、评论及运营桌面系统 | 账号生命周期、独立采集任务、模式选择、状态与通知工程 | 不同业务模型覆盖字段不同；已审阅版本未见完整 ASR + 语义总结链路；风控节流不等于封控率证据。2026-10-09 用户链接 |

R07 本地审查目录：`D:\BaiduNetdiskDownload\对标拆解插件\dcxzs_extension_protected`。历史说明见[三方审查](../handoff/archive/2026-09/signal-desk-following-sync-redesign-handoff-2026-09-24.md)。不要将此路径当成可分发的开源地址。

## B. 研究过程中引入的采集与下载项目

| 编号 | 对象与入口 | 定位、介绍 | 主要借鉴点 | 边界 |
|---|---|---|---|---|
| R10 | [Johnserf-Seed/F2](https://github.com/Johnserf-Seed/F2) | 抖音/TikTok 等平台数据采集框架 | endpoint、响应过滤器、作品统计、评论与回复分页 | 自行维护请求参数与签名，不提供视频语义总结 |
| R11 | [JoeanAmier/TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader) | 抖音/TikTok 作品数据及媒体下载器 | `desc` 与 `statistics` 提取、评论回复分层、多格式存储 | 下载/数据采集能力不能推断为 ASR 或 AI 总结能力 |
| R12 | [Evil0ctal/Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API) | 平台数据及下载 API 工具包 | 当前 `src/dtk` 的类型化解析、缺失值、平台适配和分页合同 | 本次版本已不同于 9 月旧 `crawlers/` 布局；旧文件路径不应继续当最新证据 |
| R13 | [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader) | 抖音下载、增量记录、评论与可选转写 | 错误分类、去重恢复、原始元数据存档、转写独立状态 | 当前可选转写调用外部兼容接口；不是默认本地 Whisper，也未确认语义总结管线 |
| R14 | [Johnserf-Seed/TikTokDownload](https://github.com/Johnserf-Seed/TikTokDownload) | 较早的抖音/TikTok 下载项目 | 历史作品下载与用户入口设计 | README 评论仍为未完成；后续路线优先看 F2 |
| R15 | [JoeanAmier/XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) | 小红书图文/视频和作品元数据下载器 | 页面内嵌状态、标题/描述分离、互动数字映射 | 评论数与评论正文不同；本次未定位到完整评论树或视频总结链路 |

以上对象大部分也在[2026-09-05 路线研究](signal-desk-community-validated-routes-2026-09-05.md)中出现。旧研究按其日期保留；本次专题标注版本差异，不改写历史结论。

## C. 子 Skills、解析库与浏览器工具

| 编号 | 对象与入口 | 定位、介绍 | 主要借鉴点 | 边界 |
|---|---|---|---|---|
| R16 | [douyin-comments](https://github.com/dragon-hh/ai-boshu-crawler/tree/main/.agents/skills/douyin-comments)（R05 子 skill） | 已登录浏览器会话内的评论/回复读取 | 页面上下文请求、原生 `cid`、cursor、覆盖情况与独立产物 | 独立于主下载器；不同 Python/Node/Chrome helper 的默认值和行为须分别审阅 |
| R17 | [douyin-download](https://github.com/dragon-hh/ai-boshu-crawler/tree/main/.agents/skills/douyin-download)（R05 子 skill） | 浏览器辅助发现视频流，再交给下载器 | 媒体来源探测、音视频分流与合并 | 发现或下载媒体不等于得到口播稿、评论和总结 |
| R18 | [eze-is/web-access](https://github.com/eze-is/web-access) | Agent 联网与 CDP 浏览器控制 skill | 登录会话复用、目标就绪判断、页面执行、截图和媒体 URL 发现 | 通用控制层，平台字段提取及完整业务流程仍需另写；不将它的 Agent 工作流当本产品日常采集流程 |
| R19 | [jackwener/opencli](https://github.com/jackwener/opencli) | CLI、站点适配器及浏览器控制 | 稳定会话/标签页路由、页面读取、执行与生命周期 | 自带 Douyin 适配器主要面向 `creator.douyin.com`，不能推断为任意博主采集器 |
| R20 | [OpenCLI Browser Bridge](https://github.com/jackwener/opencli/tree/main/extension) | R19 的 Chrome 扩展与本机 daemon 桥接组件 | CLI → 本机服务 → 扩展 → 页面执行机制 | 同一工具体系的组件，不是独立视频分析产品 |
| R21 | [wujunwei928/parse-video-py](https://github.com/wujunwei928/parse-video-py) | 多平台分享链接及媒体解析库；R02/R03 使用的上游 | URL 跳转、页面结构化状态、统一媒体输出 | 根上游 MIT 不自动覆盖下游包装项目；统一 `VideoInfo` 偏媒体/作者，不是完整互动统计模型 |

## D. 媒体处理、转写与画面文字

| 编号 | 对象与入口 | 输入 → 输出 | 借鉴用途 | 不承担的能力 |
|---|---|---|---|---|
| R22 | [FFmpeg](https://ffmpeg.org/ffmpeg.html) | 媒体 → 音频、抽帧、合并或转码后的媒体 | ASR/OCR 前处理及下载音视频合并 | 不读取平台点赞/收藏/评论，不独立理解或总结文案 |
| R23 | [FFprobe](https://ffmpeg.org/ffprobe.html) | 媒体 → 时长、流、编码、音轨等探测信息 | 校验文件可用、是否有音轨、时长是否合理 | 文件标签不等于平台发布描述或完整口播 |
| R24 | [openai/whisper](https://github.com/openai/whisper) | 音频 → 识别文字、片段/时间戳等 | 本地通用语音识别基线 | 不是标题采集器或事实核验/语义总结器 |
| R25 | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | 音频 → Whisper 转写；CTranslate2 推理 | CPU INT8、GPU、VAD、词时间戳；本项目既有路线 | 本机准确率和速度仍须用本项目样本验证 |
| R26 | [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) | 音频 → Whisper 转写；C/C++ 推理 | 量化、CPU、本地运行时备选 | 不因运行时轻量就能断言中文准确率更高 |
| R27 | [QwenLM/Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) | 音频 → 多语言/方言转写；可选强制对齐 | R02 所用模型路线，中文样本的候选比较对象 | ASR 名称中的 Qwen 不意味着已接入通用 Qwen 总结模型；模型卡指标不能替代本机实测 |
| R28 | [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 图片/视频抽帧 → 画面文字、位置和置信度等 | 补充屏幕字幕、PPT、代码或数字证据 | 需要自行做视频抽帧、跨帧去重和时间轴；不能恢复纯口播 |

## E. 事实核验与证据质量

| 编号 | 对象与入口 | 定位、介绍 | 主要借鉴点 | 边界 |
|---|---|---|---|---|
| R29 | [GAIR-NLP/FacTool](https://github.com/GAIR-NLP/factool) | 借助工具验证生成内容的事实性 | 断言提取 → 检索问题 → 外部证据 → 判断/理由/纠正 | 不是视频采集器；忠实转述与外部事实核验要分开 |
| R30 | [shmsw25/FActScore](https://github.com/shmsw25/FActScore) | 将长文本拆为原子事实并统计证据支持比例 | 原子断言、检索证据、逐项支持判断 | 原评测目标不是给普通评论直接判“对/错”，也不是视频摘要生成器 |
| R31 | [MichSchli/AVeriTeC](https://github.com/MichSchli/AVeriTeC) | 真实世界断言核验数据集与基线 | 问答证据、来源、时间、判定理由和评测结构 | 数据/基准有非商业限制；不是开箱即用的视频理解服务 |

## F. 尚未识别的历史材料

| 编号 | 对象 | 已知信息 | 处理方式 |
|---|---|---|---|
| R32 | 2026-08-27 用户提供的未命名 Cloudreve 分享材料 | 历史记录有分享入口，但未核实其产品名、文件与版本 | 保留占位；不公开可能带访问令牌的完整链接，不与 df 插件等同，不虚构功能或实现 |

## G. 本次核查新增发现，单独登记

这些都在 R05 的同一已固定提交内。本次发现不等于近期版本新增，也不等于用户此前明确指定过。

| 编号 | 子 skill | 定位和可借鉴点 |
|---|---|---|
| N01 | `video-transcript-doc-writer` | 从原始转写生成可读章节；保留原意、操作/情节细节、保守修正 ASR；不把整理稿写成摘要 |
| N02 | `creator-daily-analysis` | 根据完整正文、视频画像和代表评论形成日分析；要求证据引用 |
| N03 | `creator-three-day-analysis` | 复用同一视频画像观察话题扩散、跟进、升温或消退 |
| N04 | `creator-weekly-analysis` | 复用同一画像观察趋势、共识与分歧；固定 JSON → HTML |

参阅专题中 [R05 的实现分析](video-information-extraction-and-summary-2026-10-09.md#r05)及[对应固定源码](reference-source-index-2026-10-09.md#n01-n04)。其 24/72/168 小时窗口仅为他方设计，**没有采纳为 Signal Desk“今日收件箱”的时间口径**。用户已撤回先前的收件箱时间选择，仍待重新讨论。

## 维护规则

1. 新对象先登记定位、历史来源、仓库/官方入口，再补固定提交和具体文件证据；记录“未找到”与“已确认没有”的差别。
2. 区分平台接口原始字段、页面展示值、模型推断、README 宣称和真实执行结果。
3. 更新上游版本时新增复核记录，不覆盖旧报告中的真实实验事实；父项目与子 skill 标明关系。
4. 只把有证据的功能写成具备，不将实验代码、采集样例、测试数量或 stars 写成稳定性/封控率保证。
5. 借鉴优先落在行为、合同、错误处理和交互；需要复制代码或分发依赖时再核对具体版本及文件许可证。无根许可证、非商业及 GPL 类项目不能仅凭“公开仓库”判断可直接移植。
6. 本目录不改变产品路线、能力门和累计博主资料规则。正式功能仍按“最小真实提取 → 归属/字段验证 → 入库展示 → 自动化”推进。


## H. 2026-10-10 本地内容处理补充

原始32项及N01–N04历史编号保留。本轮新增以下参考，固定版本与实际验证边界见[本地优先调查](video-content-local-first-feasibility-2026-10-10.md)。未因高星而整体替换现有APP。

| 编号 | 对象 | 借鉴与验证结论 |
|---|---|---|
| R33 | [BiliNote](https://github.com/JefferyHcool/BiliNote) | 视频转写、分段笔记、截图与原片定位；只借鉴行为 |
| R34 | [VideoCaptioner](https://github.com/WEIFENG2333/VideoCaptioner) | 多转写引擎、重叠分段和合并；GPL代码不直接移植 |
| R35 | [VideoLingo](https://github.com/Huanshere/VideoLingo) | 阶段恢复；其辅助翻译总结截取开头，不能当全文摘要 |
| R36 | [FunASR](https://github.com/modelscope/FunASR) | SenseVoiceSmall CPU对照；本机更快但当前样本有遗漏，暂不替换small |
| R37 | [llama.cpp](https://github.com/ggml-org/llama.cpp) | 本地模型服务、结构化输出、Windows CPU；已运行候选模型 |
| R38 | [Ollama](https://github.com/ollama/ollama) | 模型管理备选，本轮未安装 |
| R39 | [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL) | 视觉理解和时间定位参考，未本机运行 |
| R40 | [Qwen3.5-4B量化对照](https://modelscope.cn/models/unsloth/Qwen3.5-4B-GGUF) | 与Qwen3-4B比较；真实摘要仍有主语混淆，未通过质量门 |

## I. 2026-10-15 单账号深度分析补充

原历史编号和计数保留。以下为本轮新增发现，具体固定源码与证据边界见[账号分析专题](creator-account-analysis-tools-and-skills-2026-10-15.md)。

| 编号 | 对象 | 借鉴与验证结论 |
|---|---|---|
| R41 | [redfox-data/redfox-community](https://github.com/redfox-data/redfox-community)的`douyin-account-diagnosis`及关联作品／相似账号skills | API账号与近期作品＋Python规则评分＋Agent格式化；需第三方Key／积分，未实测覆盖。量化健康分不等于完整内容／风格／人设理解 |
| R42 | [brandbai7/brandbai-skills](https://github.com/brandbai7/brandbai-skills)的`brandbai-douyin-account-analysis` | 单账号采集包、全部置顶＋最近最多30条非置顶、代表作／评论语义对齐、证据卡与JSONL交付校验；默认无转写。PolyForm非商业许可，商业复用需作者授权 |
| R43 | [yzfly/douyin-mcp-server](https://github.com/yzfly/douyin-mcp-server) | 单视频链接解析、下载及云ASR，适合作为供稿工具，非账号综合画像；README／LICENSE与pyproject许可声明不一致，复用前核对 |
| R44 | [xintu1314/content-boom-monitor](https://github.com/xintu1314/content-boom-monitor) | Just One API＋同账号中位数相对评分＋Codex候选分析，适合代表作品筛选；有限页数及启发式阈值不代表完整账号分析或爆款概率 |
| R45 | [飞瓜抖音](https://dy.feigua.cn/) | 商业账号数据／历史表现候选，官网列达人分析、粉丝画像和近3年追溯；本轮未登录付费功能，无内部算法源码证据 |
| R46 | [蝉妈妈](https://www.chanmama.com/)／[抖查查](https://www.douchacha.com/) | 作为商业产品候选登记，官方首页可访问但为JS壳；未验证当前会员的账号语义报告、导出与定价，不宣称已覆盖全部需求 |
