# Signal Desk

面向 Windows 的本地内容情报桌面应用，使用 Electron、React、TypeScript 和 SQLite。程序连续完成关注清单同步、博主主页状态读取、归属校验、保存和界面更新。

应用版本 **0.1.13**，关注连接器 **0.8.4**。当前功能以本文及[实现说明](docs/architecture/following-and-creator-activity.md)为准；按日期保存的验收报告仅代表当次结果。

## 日常使用

从桌面 **Signal Desk** 快捷方式启动。本机日常程序为 `release-following-background-final/win-unpacked/Signal Desk.exe`，资料位于 `%LOCALAPPDATA%/SignalDeskFollowingReview`；其他安装的默认资料目录由 Electron `userData` 决定。

首次连接时，在 APP 设置中选择 Chrome 配置，按连接页指引加载用户目录中的 `following-extension`。扩展升级后重新加载，无需手填 Cookie、UID 或扩展 ID。

博主资料按账号累计，以主页身份去重。新增批次、部分失败或空结果不会删除已有博主、星标、批注及历史快照。主要操作相互独立：

1. **同步关注清单**：完整分页读取，逐页入库。
2. **补全基础资料**：只处理缺失字段，每批最多20位。
3. **更新主页状态**：单作者、勾选作者或按频率分组，支持取消与继续剩余。
4. **核验并补齐**：对异常组中的单个作者连续读取并校验缺口，成功后恢复正常分组。

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

正式作品详情、评论及完整分析尚未完成真实验收，功能门保持关闭。`poc/r8` 中部分模块仍用于隔离入口和打包，不应作为无用原型删除。媒体 ASR/OCR 通过设置页显式安装，模型和 Python 环境不进入 Git。云端分析使用用户自己的 API 配置，执行前确认费用。

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
| `local-data/` | 忽略提交的本机备份、原始证据和清理记录 |

工作区仅保留原日常运行包。旧发布包、重复二进制、解包目录及已完成的临时验证配置可清理；用户日常资料在工作区之外。提交范围为源码、测试、维护文档和审阅证据，数据库、发现令牌、凭据和原始运行配置保持本地。
