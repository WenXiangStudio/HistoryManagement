# Signal Desk V0.1

Signal Desk 是一个面向 Windows 11 的本地优先抖音个人账号内容情报台。浏览器只承担“读取当前登录状态下公开可见页面”的采集桥梁；关注博主管理、作品摘要、转写、OCR、评论分析、标签、搜索、批注、队列和导出全部在桌面应用中完成。

当前仓库提供一个可运行、可打包的 V0.1，而不是只有提示词的 Skill：它包含 Electron 桌面端、SQLite 数据库、Chrome/Edge 只读连接器、Native Messaging 控制台 Host、Python 媒体工作器和 OpenAI-compatible BYOK 云端分析流程。

Signal Desk 0.2 的平台事实获取层正在分阶段重构。阶段 A 已冻结适配器、分页、来源证明、结构化错误、敏感信息白名单和范围指纹合同；设计与阶段边界见 [`docs/architecture/platform-adapter-phase-a.md`](docs/architecture/platform-adapter-phase-a.md)。阶段 A 不连接真实平台，也尚未替换 V0.1 的生产采集路径。

## 已实现能力

- 单本地用户、单抖音登录账号的关注列表同步。
- 尽力采集关注博主历史作品、公开指标和页面当前可见评论。
- 真实首轮采集使用有确认框和主进程硬上限的小样本同步，避免一次点击扩散为全量关注、作品和评论任务。
- 作品标题、简介、音频转写、OCR、关键帧和评论的统一证据库。
- 作品摘要、重点、作者核心表达、22 个受控领域标签及关键词。
- 博主领域聚合、星标和用户批注。
- “今日内容收件箱”、未读/稍后看/收藏、兴趣反馈、全文检索。
- 点赞、评论、收藏的时间戳快照；不可见值保持 `NULL`，不伪造为零。
- 基于博主自身历史样本的相对高/低流量判断基础逻辑；样本不足时不下结论。
- 可暂停、恢复、重试和记录检查点的持久化任务队列。
- 原片临时下载，本机提取证据后删除；保留压缩、去重后的证据帧。
- BYOK 云端文本、评论和视觉分析。每次调用先生成不可变批次清单并显示 token、评论数、图片数和配置单价下的费用估算。
- 匿名化 CSV/Markdown 导出；API Key 使用 Electron `safeStorage`（Windows DPAPI）加密，不写入 SQLite 或日志。
- 完全离线的演示资料：6 位博主、24 个作品、120 条评论，并可在真实同步前从设置页精确清除。

## 为什么视频分析经常需要下载原片

“下载”不是大模型理解视频的理论前提，而是媒体处理工具获得稳定、可随机访问字节流的常见工程手段。ASR 需要音轨，OCR/视觉模型需要帧，FFmpeg/ffprobe 往往需要读取容器头、索引和不同时间位置。短视频网页中的播放器地址还可能是临时 URL、分段流或 `blob:` 引用，不能只把页面链接交给模型。

并非所有场景都必须永久下载完整视频：

- 页面已有字幕时，可以只读取字幕和简介做基础摘要。
- 服务端允许 HTTP Range 或流式读取时，FFmpeg 可以直接处理远程 URL，但稳定性、重试和临时凭证仍需处理。
- 只做视觉抽样时，可以读取若干时间点的帧。
- 若平台提供正式 API 或导出接口，应优先使用正式接口。

Signal Desk 的取舍是：仅在页面暴露可用的 HTTP 媒体地址时，将原片放入本机临时缓存；提取 16 kHz 单声道音频、等距帧、ASR 和 OCR 证据后立即删除原片和 WAV。它不尝试破解 `blob:`、DRM、签名或平台风控。

## 为什么单个 Skill 不能绕过抓取限制

Skill/提示词只负责告诉代理“怎样组织工作和输出”，它本身不会凭空获得浏览器登录态、平台 API、网络权限、音视频解码器或 OCR/ASR 模型。一个有效的视频分析 Skill 背后仍必须调用至少一类真实能力：浏览器自动化或正式 API、下载器/媒体流、FFmpeg、ASR、OCR、视觉模型以及结构化存储。

因此，判断一个相关项目是否可靠，应查看它是否明确说明：数据从哪里来、登录态如何隔离、临时 URL 如何处理、是否下载原片、失败如何续跑、验证码如何暂停、模型输入究竟包含什么、是否有费用确认和证据引用。只有提示词而没有这些执行层能力，无法越过内容获取和媒体解析的技术边界。

## 开发运行

环境要求：Windows 11 x64、Node.js 20+、npm。媒体工作器固定面向 Python 3.11 x64；不要使用 Python 3.14 创建本项目的本地 AI 环境。

```powershell
$env:npm_config_cache = "$PWD\.npm-cache"
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm install
npm run dev
```

首次打开后可以在空收件箱点击“载入演示资料”，这条路径不访问抖音或任何云 API。

## 演示资料清理

设置页的“演示资料管理”提供“查看并清除”操作。程序会先统计演示博主、作品、评论、分析记录、证据帧索引、关联任务/云批次，以及演示记录上的收藏、稍后看、博主星标和批注；只有用户勾选确认框后才允许执行。

清理只删除带 `is_demo=1` 标记的演示博主、演示作品及其关联数据。真实采集的博主、作品、评论、分析、收藏、稍后看、星标和批注均不受影响。依附于演示记录的收藏、稍后看、星标和批注会随演示实体一起删除；若有关联任务或云批次正在执行，程序会阻止清理。数据库删除在一个 SQLite 事务中完成，失败会整体回滚。

## 安装浏览器连接器

正式安装器会自动把约 50 KB 的浏览器连接组件部署到当前用户固定目录 `%LOCALAPPDATA%\Signal Desk\BrowserConnector`，并恢复 Chrome 的 Native Messaging 注册。该目录位于系统固定盘，不依赖 Signal Desk 主程序所在盘符，也不会在应用覆盖升级时短暂消失。Edge 仅在用户明确需要时通过 `install.ps1 -Browser Edge` 单独注册。

源码开发环境先运行 `npm run build:native-host`，再在 `browser-connector` 目录运行：

```powershell
.\install.ps1 -Browser Chrome
```

随后打开 `chrome://extensions` 或 `edge://extensions`，启用开发者模式，选择“加载未打包的扩展程序”（三个开发者按钮中的第一个；不要选择“打包扩展程序”），加载：

```text
%LOCALAPPDATA%\Signal Desk\BrowserConnector\extension
```

扩展内置固定公钥，长期固定 ID 为 `fejndacdabkgahmfpfjaghhedbdehonh`；不得再从应用安装目录或源码目录加载用于日常使用。安装脚本会在 `%LOCALAPPDATA%\Signal Desk\NativeMessagingHosts` 生成清单，将 `allowed_origins` 只限定为该固定 ID，并让清单指向同一稳定目录下按版本隔离的 Native Host。控制台 Host 只把浏览器的长度前缀 JSON 消息转发给 `127.0.0.1` 上的桌面端随机端口；每次桌面端启动都会生成新的 256 位随机密钥。卸载注册项和连接清单可运行 `browser-connector\uninstall.ps1`；业务数据不会被删除。

## 真实小样本同步

浏览器连接器显示“桌面端在线”、Signal Desk 显示“浏览器已连接”后，右上角入口为“小样本同步”。点击后必须先确认三项范围：

- 博主上限：1～5，首次默认 3。
- 每位博主作品上限：1～10，首次默认 5。
- 每个作品评论上限：1～30，首次默认 20。

浏览器端会在达到范围后停止继续滚动，桌面主进程还会在入库前再次按相同上限截断，因此扩展页面结构变化或意外超量返回不会突破所确认的范围。默认首次范围最多入库 3 位博主、15 个作品和 300 条评论；实际数量可能因公开页面可见内容、登录状态或平台限制而更少。

关注博主还受一层独立的来源语义闸门保护。连接器必须在运行时同时确认本人关注路由、已激活的“关注”页签、唯一的语义列表容器、成员卡片归属和实际滚动目标，并把与候选 ID 绑定的来源证明交给桌面端。桌面主进程在任何写库动作前再次验证页面 URL、证明字段、博主 ID 和主页 URL；推荐区、侧栏、导航或没有来源证明的任意 `/user/` 链接会被整批拒绝。页面改版导致可信容器或结束状态无法确认时，任务进入“需要操作”，该次结果保持零入库。

当前抖音网页把本人关注账号显示在个人主页顶部“关注数量”打开的关系弹窗中，而不是普通作品页签。若首次任务进入“需要操作”，先在本人主页点击顶部关注数量，确认弹窗内“关注（数量）”页签已选中，再从任务中心恢复。恢复时连接器会保留已经打开的同一路由和弹窗；它只接受唯一活动的关注页签、同一弹窗内唯一的 `user-fans-container` 列表、账号主页链接，以及账号行中明确的“已关注”或“相互关注”关系标记。粉丝页签、背景作品区、左侧关注内容流和缺少关系标记的候选都会安全拒绝。

评论采集也使用独立的双层来源闸门。连接器只接受目标作品详情页中唯一可见的 `data-e2e="comment-list"` 评论列表，并只读取其中精确的 `data-e2e="comment-item"` 记录；公开作者必须来自 `comment-item-info-wrap` 信息区，正文必须来自其相邻正文节点。评论数量、输入框、按钮、纯数字控件、缺少作者结构的元素和全局模糊匹配结果均会被拒绝。连接器生成与目标作品和评论 ID 清单绑定的 `douyin-comment-source-proof/v1`，桌面主进程在写库前再次核验作品、作者、正文、评论 ID 及证明。作品详情会明确显示评论正文、公开作者、评论 ID、ID 来源、采集时间、所属作品和来源验证状态；旧版评论保留但标为“来源未验证”，不会进入真实评论云分析批次。

这一阶段只采集页面资料，不自动下载媒体、不启动 ASR/OCR，也不创建或执行云端分析任务。连接器会在后台依次打开关注页、博主主页和作品页；遇到登录、验证码、安全验证或频控时，任务进入“需要操作”。在浏览器中处理完毕后，可在任务中心点击“恢复”重新尝试。

## 本地 ASR/OCR

设置页提供两个明确动作：

- “检查本地 AI”：检查 Python 3.11、FFmpeg、FFprobe、faster-whisper 和 PaddleOCR。
- “安装本地 ASR/OCR”：用户点击后才在 `%APPDATA%\Signal Desk\runtime\python` 创建受控 venv 并安装 `worker\requirements.txt`。

应用不会在启动时静默安装大型依赖。首次实际转写或 OCR 时，相关库还可能下载模型文件。针对 i5-12600K、32 GB、无 NVIDIA GPU 的目标机器，默认使用 CPU INT8 `faster-whisper small`，媒体并发为 1。

如果需要制作不依赖系统 Python 的安装包，先准备 Python 3.11 x64 运行时：

```powershell
.\scripts\prepare-python-runtime.ps1
```

脚本把已安装的 Python 3.11 复制并验证到 `runtime\python311`；打包时它会进入 `resources\python311`。仓库默认不提交这一大型二进制目录。

## 云端 BYOK 与费用闸门

设置页把文本分析与可选视觉分析拆成两套兼容 `/chat/completions` 的服务配置。两者可使用不同服务商，并分别保存 Base URL、API Key、模型和计价参数；API Key 均通过 Electron `safeStorage` 加密，不写入 SQLite。视觉 Base URL 或视觉模型留空时，任何图片都不会进入云端批次。

点击“预估待分析批次”只会在本机生成清单，不会调用模型。确认框会列出：

- 文本作品数、评论作品数和实际纳入的有效评论数；
- 视觉作品数和精选关键帧数；
- 文本与视觉服务各自的预计输入/输出 token；
- 按两套服务各自的输入、输出和图片单价分别计算的费用与合计费用。

视觉选择每位博主最多 12 个代表作品，每个作品最多 16 张等距、SHA-256 去重且已压缩的帧；从不上传完整原视频。点击“确认并执行”后，程序按确认时固化的批次 ID 和证据清单执行，新采集到的内容会留到下一批。

## 数据位置与安全边界

默认业务数据位于 `%APPDATA%\Signal Desk`（Electron 实际 `userData` 路径），核心数据库为 `signal-desk.sqlite`，启用 WAL、外键和严格表。缓存、受控 Python 环境、加密凭据和回环发现文件也在该用户目录下。

连接器是只读的：没有点赞、评论、收藏、关注、取消关注、私信或发布能力；不导出 Cookie、密码、Bearer Token 或签名请求头。遇到登录失效、验证码、安全验证、频控文本或无法验证关注列表结构时，任务进入“需要操作”，不会尝试绕过，也不会把未证明的候选写入数据库。

## 验证与打包

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

生成免安装目录：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run package
```

`npm run package` 和 `npm run dist:win` 会在打包结束后实际启动 `win-unpacked` 中的应用，并验证安全 preload 桥、React 首页渲染和 `getDashboard` IPC 均可用；检查还会拒绝任何误入最终资源的用户专属 Native Messaging 清单。这些检查用于捕获只在 ASAR/安装包环境中出现的白屏和扩展授权覆盖问题。

生成当前用户 NSIS 安装器使用 `npm run dist:win`。输出位于 `release`。

## 已知限制

- 抖音没有为此个人工具提供稳定的全量关注/评论接口；关注列表只接受可验证的语义容器和成员关系。页面改版后可能需要维护结构识别规则，在规则更新前程序会安全阻断而不是退化为全页面扫描。
- 删除、私密、地区限制、登录权限之外、被风控阻断或页面未加载出的数据无法保证采集。
- 本仓库的自动化测试没有使用你的真实抖音登录态，真实端到端采集必须在你自己的浏览器会话中验证。
- 默认仓库未携带 Python 3.11、大型 ASR/OCR 包和模型；缺失时媒体工作器会结构化降级，页面文本、数据库和其他功能仍可使用。
- 未配置用户自己的 API Key 和服务商时不会调用云模型；不同兼容服务对 `response_format` 和视觉消息格式的支持可能不同，程序会先尝试结构化格式再兼容回退。
- 评论只分析公开可见内容；导出默认匿名化，系统不推断评论者真实身份。

## 目录

```text
src/main/                 Electron 主进程、SQLite、队列、媒体与云端服务
src/preload/              最小化 IPC 安全桥
src/renderer/             React 桌面界面
src/shared/               版本化合同、领域表和排名逻辑
browser-connector/        MV3 扩展、控制台 Native Host 与安装脚本
worker/                   Python NDJSON 媒体工作器
scripts/                  运行时准备和协议测试
runtime/python311/        可选的自包含 Python 3.11（默认空）
```
