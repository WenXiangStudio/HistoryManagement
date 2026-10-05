# Signal Desk

面向 Windows 的本地内容情报桌面应用，使用 Electron、React、TypeScript 和 SQLite。当前已验收的日常流程是：同步关注博主资料，按账号累计保存，再独立刷新主页作品数与本周动态。

## 当前状态

应用版本 **0.1.11**，关注连接器 **0.7.9**。用户的日常资料库为 295 位博主，保留星标、批注和历史快照；新增批次按主页身份去重，空结果或部分失败不会替换整个列表。

最近一次真实验证：排除 231 位历史样本后，八位新博主在同一轮、一次点击下全部成功，无重试；点击到全部资料及头像可用 **51.416 秒**。此前一次点击三作者验证为 **16.944 秒**。这些是各轮测量结果，日常稳定性仍需持续观察。

首次失败会同步冻结已有日志、停止后续作者、保留故障网页，并分别尝试扩展本地缓存和 APP 诊断入库。真实 Chrome 本地断开、导航中断、APP 写入拒绝三项验收通过；明石此前失败的具体根因仍未知。

- [当前交接与验证入口](docs/handoff/README.md)
- [关注与博主动态实现](docs/architecture/following-and-creator-activity.md)
- [八位新样本结果](docs/handoff/signal-desk-new-eight-validation-2026-10-05.md)
- [日常部署与故障捕获验收](docs/handoff/signal-desk-stable-deployment-2026-10-05.md)

## 日常使用

从桌面 **Signal Desk** 快捷方式启动。当前本机目标为 `release-following-background-final/win-unpacked/Signal Desk.exe`，用户资料位于 `%LOCALAPPDATA%/SignalDeskFollowingReview`。默认安装的数据目录由 Electron `userData` 决定，通常为 `%APPDATA%/Signal Desk`。

在“博主资料库”使用独立动作：

1. **同步关注清单**：完整分页读取基础资料，逐页入库。
2. **补全基础资料**：仅处理本地缺失字段，每批最多 20 位。
3. **刷新资料**：单作者、勾选多作者或全部作者，连续读取作品数和本周动态。

作品总数取作者主页“作品”计数。本周按北京时间周一至周日统计可信列表记录，作者 UID/secUid、公开状态、作品 ID 和分页覆盖由后端复核。最近更新时间是本周范围内的最近发布；本周零条时显示“—”。界面分为今日更新、本周有更新、今日/本周暂无更新三个互斥区域。

首次连接或更新关注扩展，在 APP 设置中选择 Chrome 配置，按连接页指引加载该用户目录中的 `following-extension`。更新后重新加载扩展；无需手填 Cookie、UID 或扩展 ID。

## 开发与验证

使用 Windows 11 x64、**Node.js 24+** 和 npm。数据库使用 `node:sqlite`。媒体工作器使用 Python 3.11 x64。

```powershell
npm ci
npm run dev
```

以下检查不使用真实账号采集：

```powershell
npx tsc --noEmit
npm test
npm run test:following-plan
npm run test:creator-activity
npm run test:project-boundaries
npm run test:worker
npm run test:native-host
npm run test:connector-content
npm run test:connector-background
npm run test:network-observer
npm run test:phase-b
npm run build
```

`npm run check` 还包含正式作品/评论路线的 R8 前置检查。该能力门保持关闭，已知设计缺口会使前置检查失败；不能把关注与资料刷新验收写成正式作品/评论采集已经通过。

生成免安装目录或安装器：

```powershell
npm run package
npm run dist:win
```

输出位于 `release/`，构建时自动生成。打包后的 renderer 冒烟检查会使用隔离的合成数据验证 preload、IPC、页面渲染和功能门，不访问抖音。当前已验收的独立包还可检查：

```powershell
node scripts/test-packaged-renderer.mjs 'release-stable-20261005/win-unpacked/Signal Desk.exe'
```

## 其他能力与边界

正式作品详情、评论和完整分析流程尚未完成真实验收，能力开关保持关闭。一位已保存作者的单作品隔离路径已验证；历史方案与阶段合同见 [架构目录](docs/architecture/) 和 [历史交接索引](docs/handoff/archive/README.md)。

原有作品/隔离连接组件通过 `browser-connector/install.ps1 -Browser Chrome` 安装，使用固定扩展 ID 与 Native Messaging。它和日常关注扩展是不同组件，按各自界面指引配置。

本地 ASR/OCR 由设置页明确触发检查或安装，使用 FFmpeg、faster-whisper 和 PaddleOCR；模型与 Python 环境不随 Git 提交。云端文本与可选视觉分析使用用户自己的兼容 API 配置，密钥通过 Electron `safeStorage` 加密。预估批次只生成本地清单，执行前需在 APP 确认费用；视觉分析只上传筛选后的帧，不上传完整视频。

演示资料有独立标记，可在设置页查看并清除；真实资料、星标和批注不受影响。连接器没有点赞、评论、关注、私信或发布能力。页面、权限或登录变化可能使读取停止；失败保留已取得的可信资料。

## 目录与历史资料

| 目录 | 用途 |
|---|---|
| `src/main/` | 主进程、SQLite、队列与服务 |
| `src/preload/` | IPC 桥 |
| `src/renderer/` | React 桌面界面 |
| `src/shared/` | 字段合同与校验 |
| `browser-connector/` | 浏览器扩展、Native Host、安装脚本 |
| `worker/` | Python 媒体工作器 |
| `scripts/` | 构建和验证工具 |
| `docs/handoff/` | 当前交接，历史按月份归档 |
| `docs/evidence/` | 经审阅的验证结论、诊断和截图 |
| `local-data/` | 本机原始捕获、数据库备份和临时验证脚本，Git 忽略 |

工作区保留日常包 `release-following-background-final/` 和当前验收包 `release-stable-20261005/`。过期打包目录已清理，历史文件中的旧构建路径仅供追溯。原始数据、凭据、发现文件与数据库备份留在本机，提交只包含源码、测试、文档和已审阅证据。
