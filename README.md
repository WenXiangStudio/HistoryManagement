# Signal Desk

面向 Windows 的本地内容情报桌面应用，使用 Electron、React、TypeScript 和 SQLite。程序连续完成关注清单同步、博主主页状态读取、归属校验、保存和界面更新。

应用版本 **0.1.52**，关注连接器 **0.8.12**。硅基流动GLM5.3Flash文本连接、Qwen3.5-4B图片连接已实测通过，设置页支持[自由新增和删除硅基流动模型](docs/evidence/siliconflow-dynamic-models-20261016.md)，复用同组已保存Key，原模型配置保留。视频页“仅云端识别画面”指定77秒样本12帧已由云端Qwen读取并在APP逐帧显示原图、文字和描述，全程渲染确认39.629秒；本次不运行本地模型、不转写音频或生成摘要，见[云端画面实测](docs/evidence/siliconflow-vision-20261012/README.md)。视觉准确率待用户核对。豆包录音文件识别极速版已集成，指定77秒音轨点击至原文显示3.093秒，用户确认本样本文字正确率100%、后台77秒换算0.017元，见[语音实测与人工验收](docs/evidence/doubao-flash-20261012/success-corrected-key.md)；用户已选其作为云端纯转写首选。设置页支持多套云端方案和可自由增删的硅基流动模型列表，各方案保存模型、协议与凭据，旧配置保留。所有云端配置区域均提供[连通测试](docs/evidence/cloud-connection-tests-20261016.md)，按已保存模型和凭据执行最小请求并显示结果与耗时。已有百炼qwen3.8-omni-flash单模型音轨/画面/摘要流程的质量边界见[历史验证](docs/evidence/qwen-video-app-20261011/README.md)。当前功能以本文及[实现说明](docs/architecture/following-and-creator-activity.md)为准；按日期保存的验收报告仅代表当次结果。

**视频工坊（0.1.52）已按[新规划](docs/architecture/video-workshop.md)接通下载、分类与深度处理：** 首版以单条抖音视频链接为入口，预留“处理”下载与本地分类、“深度处理”豆包极速版转写和 `Qwen/Qwen3.5-122B-A10B` 画面识别、按原视频时间对齐的图文分析总结报告。有效链接可点击“处理”下载到 E 盘并完成本地分类，公开下载受限时通过已连接 Chrome 读取对应作品；用户当前短链已实际完成。点击“深度处理”使用豆包极速版取得原始分句时间、Qwen3.5-122B-A10B识别实际时间画面并生成可核对的图文分析总结，已在该34.712秒视频完成真实转写／18帧／4段报告。原收录作品保留在“历史资料”。见[深度处理实测](docs/evidence/workshop-deep-20261016.md)。下方原视频信息／收件箱处理规则是现存历史功能，不作为新工坊设计。

## 日常使用

从桌面 **Signal Desk** 快捷方式启动。本机日常程序为 `release-following-background-final/win-unpacked/Signal Desk.exe`，资料位于 `%LOCALAPPDATA%/SignalDeskFollowingReview`；其他安装的默认资料目录由 Electron `userData` 决定。

首次连接时，在 APP 设置中选择 Chrome 配置，按连接页指引加载用户目录中的 `following-extension`。扩展升级后重新加载，无需手填 Cookie、UID 或扩展 ID。

博主资料按账号累计，以主页身份去重。新增批次、部分失败或空结果不会删除已有博主、星标、批注及历史快照。主要操作相互独立：

1. **同步关注清单**：完整分页读取，逐页入库。
2. **补全基础资料**：只处理缺失字段，每批最多20位。
3. **更新主页状态**：单作者、勾选作者或按频率分组，支持取消与继续剩余。
4. **核验并补齐**：异常分组提供“一键核验并补齐”，依次处理当前账号全部异常博主，也可单个核验。成功后恢复正常分组，未完成的保留异常并可继续剩余。
5. **视频信息与历史资料**：采集作品后自动进行本地分类与抽帧截图，默认分类并发8。标记“感兴趣”只收录资料；点击“开始处理／继续处理”后才按类别处理：纯画面人工观看；图文由硅基流动Qwen3.5-4B识别并人工校对；口播仅豆包语音识别极速版转写；无法判定停在人工审核。完成初步文案的口播与图文进入**今日收件箱**，详情显示无时间戳完整正文及硅基流动GLM5.3Flash生成的总结、分析、观点原文依据与领域推测。模型自动使用各自已保存配置。手动处理规则见[0.1.47验证记录](docs/evidence/video-interest-manual-20261015.md)，旧分类流程与样本见[规范流程](docs/architecture/video-material-workflow-2026-10-13.md)及[验证记录](docs/evidence/video-workflow-20261013/README.md)。[初始演示模板](docs/local-templates/initial-demo-20261013/README.md)保留为源码参考。

作品新增按累计历史的时间基线统计：上次最新发布时间 M 到本次采集时间 X，仅计 `M < 发布时间 ≤ X` 的已读公开作品。主页作品总数的净变化单独显示；旧置顶、历史补充和恢复公开不混入新发布。卡片支持展开按时间排序的累计作品及“已失效”标签，旧作品记录和间隔计算保留。详见[时间基线规则](docs/architecture/creator-publication-time-baseline-2026-10-13.md)。

## 频率分组与近期状态

平均间隔按有效公开作品的发布时间计算，分组使用完整精度。近期状态以**最近一次成功核验时间**为参照，不随打开 APP 的日期自动降级。

| 自动分组 | 条件 | 建议检查周期 | 更新按钮 |
|---|---|---|---|
| 高频 | 平均间隔≤7天，且核验时最新作品距核验时间≤7天 | 每天 | 高频更新 |
| 中频 | 平均间隔>7～14天；或≤7天但距上次更新>7～30天 | 每周 | 中频更新 |
| 低频 | 平均间隔>14～30天，且未命中30天无更新规则 | 每两周 | 低频更新 |
| 极低频 | 平均间隔>30天，或核验时已超过30天未更新 | 每30天 | 全量更新 |

超过30天未更新优先于平均间隔；缺少可靠依据时保留“待确认”，暂列极低频区域。手动加权／降权保存明确目标等级并优先生效，关闭后恢复自动分类。异常作者独立隔离，不受手动权重影响。

资料库初始不展开卡片，点击分组后只显示该组。分组更新使用当前账号完整分组，不受搜索或到期提示限制；全量包含四档及待确认作者，异常作者须单独处理。每批33位，作者间隔3～8秒，批间休息3～5分钟；未加入后台定时采集。

核验时最近七天无更新的作者，昵称使用红色 `#B42318`，上次更新日期使用 `#FF8247`；手动权重的紫色昵称优先。本周记录数仍作为附加统计，不再决定颜色或分组。

主页作品总数与本地已保存作品数分别处理。平均间隔通常积累可信观察；取得无错误、读至末尾且公开作品数与主页计数一致的新完整列表时，重新确定当前参与计算的作品集合，原始历史证据保留。

作品总数较旧基线增加≥10条，或新作品数量／记录衔接无法解释变化时，进入最右侧的**异常**组。新结果不会覆盖有效基线；单独补齐通过后才解除异常。部分结果、断线、验证或取消都不能将缺口标为已修复。

## 数据库、图表与飞书

“博主数据库”提供昵称、上次更新日期、主页作品数、平均间隔和活跃情况五个自动字段，以及可编辑的自定义文本、整数和日期列。支持列格式、搜索、排序、多条件筛选、发布间隔图表和作者明细，显示设置按账号保留。

表格使用可变行高虚拟列表，已访问视图保留选择状态，隐藏视图暂停效果及轮询。卡片仅在接近视口时测量简介高度。

“连接飞书”支持单作者写入核验、全库同步和自动同步。方向为 APP → 飞书，按账号和主页去重，不删除远端独立记录或列。凭据由本机 `safeStorage` 加密；配置、授权、字段和失败处理见[飞书接入说明](docs/architecture/feishu-creator-database.md)。

## 开发与检查

开发环境为 Windows、**Node.js 24+** 和 npm；媒体工作器使用 Python 3.11。数据库依赖 `node:sqlite`。

```powershell
npm ci
npm run dev
```

常用离线验证：

```powershell
npx tsc --noEmit
npm test
npm run test:following-flow
npm run test:following-plan
npm run test:creator-activity
npm run test:video-information
npm run test:project-boundaries
npm run test:worker
npm run test:native-host
npm run test:connector-content
npm run test:connector-background
npm run test:network-observer
npm run test:phase-b
npm run build
```

`npm run check` 首先运行正式作品／评论链路的 R8 前置门禁；该门禁因既有设计缺口保持关闭。日常关注及状态读取通过，不代表正式作品／评论采集已完成验收。参见[当前交接](docs/handoff/README.md)。

构建免安装目录或安装器：

```powershell
npm run package
npm run dist:win
```

生成文件位于 `out/`、`release/`，不提交 Git。打包冒烟测试使用独立合成资料，不访问真实账号。本机日常包可验证：

```powershell
node scripts/test-packaged-renderer.mjs 'release-following-background-final/win-unpacked/Signal Desk.exe'
```

## 其他能力和资料位置

单视频基础信息的独立入口已通过[一条真实样本验收](docs/evidence/video-information-20261010/README.md)。原完整作品详情、评论及分析链路尚未完成真实验收，原功能门保持关闭。`poc/r8` 中部分模块仍用于隔离入口和打包，不应作为无用原型删除。媒体 ASR/OCR 通过设置页显式安装，模型和 Python 环境不进入 Git。云端分析使用用户自己的 API 配置，执行前确认费用。

后续选型与实现可从[可借鉴项目、工具与 Skills 总目录](docs/research/reference-project-catalog.md)进入；[视频信息提取与结构化总结专题](docs/research/video-information-extraction-and-summary-2026-10-09.md)记录各参考对象的数据来源、处理方式和能力边界，并链接固定版本源码。

| 目录 | 用途 |
|---|---|
| `src/` | 主进程、界面、共享规则及测试 |
| `browser-connector/` | 浏览器扩展、Native Messaging 主机源码 |
| `scripts/` | 构建、回归、诊断和历史复现工具 |
| `worker/` | Python 媒体工作器及测试 |
| `poc/` | 仍被测试或隔离功能引用的实验组件 |
| `docs/architecture/` | 当前实现与功能门约束 |
| `docs/handoff/` | 当前交接及按月归档的历史报告 |
| `docs/evidence/` | 经审阅的验证结论和必要证据 |
| [`docs/research/`](docs/research/README.md) | 技术研究、外部工具对比与已确认的借鉴方向 |
| `local-data/` | 忽略提交的本机备份、原始证据和清理记录 |

工作区仅保留原日常运行包。旧发布包、重复二进制、解包目录及已完成的临时验证配置可清理；用户日常资料在工作区之外。提交范围为源码、测试、维护文档和审阅证据，数据库、发现令牌、凭据和原始运行配置保持本地。

2026-11-15 已将35个历史打包目录移至 `local-data/archive/release-builds-20261115/`，原日常运行包路径保留；归档清单、数据保留核对与本次离线检查见[工作区整理记录](docs/evidence/workspace-cleanup-20261115/README.md)。
