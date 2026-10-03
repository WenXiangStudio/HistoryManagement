# 关注同步后台化真实验证 · 2026-10-01

用户要求日常使用只有 APP 内点击同步、等待、看到资料；同时指出每轮配置页与白色诊断窗造成观感和等待问题。本轮把每次连接配置页改为常驻 Native Messaging + 本机 HTTP 长轮询。页面字段提取先前已真实证明，本轮先检查真实后台运行，发现分页停滞后修正，再完成真实保存、回读和显示核验。

## 已实现链路

- APP 启动时部署变化的扩展文件、独立关注发现 Host 和随机端口服务；同步开始的路径不再复制扩展、创建服务或打开配置页。
- 扩展的 Native Messaging 长连接维持 Chrome worker；长轮询在 APP 点击时立即收到命令。APP 重启后自动重新发现服务。Host 只读取本产品 profile 的发现文件，不访问 Cookie、业务库或正式作品服务。
- 复用授权账号 `/user/self` 页，页面不存在时创建 `active:false` 标签，不调用窗口激活。旧内容脚本通过受限文件注入更新，避免为了加载扩展刷新整个页面。
- 抖音在后台文档 hidden 状态下分页停滞；对唯一授权目标使用 `Emulation.setFocusEmulationEnabled`，让文档内部继续运行。实际标签页仍为 inactive，未调用 tabs.update(active:true) 或 windows.update(focused:true)。成功、失败或取消均在 finally 中关闭内部焦点模拟并 detach。该接口不读取 Network、Cookie、浏览器凭证或作者作品。
- 只读取当前关注弹窗的卡片。连接、授权页面选择、有效 DOM 定位和已有 sec_uid 排除名单复用；作者昵称、简介、头像和主页按本轮卡片核对，不使用旧字段充当新采集。头像按事件并发就绪。
- 原始捕获、卡片绑定受理、去重、SQLite 追加事务、回读和 APP 实际头像加载回执保持原校验。旧行、星标和批注保留。
- APP 展示连接状态、同步/取消、必要时的首次连接与登录入口，以及连接/派发、页面读取、保存、其余传输与展示耗时。最近一次完成计时在重启后保留；旁栏正确显示关注连接状态。

白色 `signaldesk-following-page-result` 窗口来自此前人工诊断脚本，包含页面 tabs 概览，不是产品获取字段窗口。正常链路不调用该脚本，不读取作品、推荐、喜欢分类；新脚本加载时清掉遗留诊断输出。

## 真实结果

成功 run：`following-20261001131849-c1e10c5349603978`。此前 80 位，新增另外 20 位，累计 100 个不同 sec_uid，重复 0。

| 测量 | 实测 |
|---|---:|
| APP 开始到全部资料卡及头像显示 | **2273.150 ms** |
| 独立观测点击到完整结果 | 2380.300 ms |
| 连接与派发 | 3.1477 ms |
| 页面读取与头像核验 | 1877.200 ms |
| APP 校验、归档、保存及回读 | 15.812 ms |
| 其余传输及界面展示 | 376.9903 ms |
| 全程平均 / 新增博主 | 113.6575 ms |

平均是整批全程除以新增人数，不是每个作者串行耗时。此次使用已经存在的授权页面，不是全部关注或所有冷启动的速度保证。

`browser-execution.json` 记录实际目标复用、`tabActive:false`、模拟前 `visibility:hidden/focused:false`，模拟后文档内部 `visibility:visible/focused:true`。这里的 focused 为页面内部模拟值，不代表 Windows 前台或真实标签切换。成功后的页面释放由 runner finally 完成。成功的连续 Windows 前台采样脚本因 PowerShell 5 不识别 `0u` 提前退出；脚本已修正，但没有为了补采样再追加一批作者，不声称成功 run 的完整前台采样通过。

第一次后台 run 在 18.182 秒因 `FOLLOWING_NO_MORE_NEW_AUTHORS` 阻断，未入库。检查发现关注列表滚动目标正常，后台分页未继续；修正内部活动状态后成功。从第一次尝试到最后完成历时 393.359 秒，其中包括源码修改、真实页面诊断、打包/重启和工具修正；这段开发过程不能被描述为 2.27 秒。完整失败记录与时间范围保存在 [尝试汇总](artifacts/attempt-summary.json)。

## 资料质量与最终 APP

原 80 位全部行及批注/星标、原报告逐条未变；新增 20 位的昵称、简介、头像 URL、图片 alt、昵称主页 anchor 与保存记录/APP 卡片一致。新 20 位空简介 0；APP 100 张资料卡、100 个实际图片加载正常；SQLite integrity 为 ok、外键违规 0。作品、评论、指标、任务及分析数均为 0。原生 owner sec_uid 与数值作者 uid 仍缺失，账号显示名匹配不能替代原生账号身份验证；本轮不声称全量关注快照、取关语义或正式作品流程验收。

当前构建：`release-following-background-final/win-unpacked/Signal Desk.exe`，profile 仍为 `SignalDeskFollowingReview`。最终重新打开后无需重载扩展自动连接，100 位回读、100 个头像及最近一次 2.273 秒历史回执保留。原 standalone 四十位历史库与正式业务库未参与。

验证只使用相关既有检查：DOM/连续流程/计时 11 项、受理与目录 13 项、TypeScript、Native Host 编译、构建与最终打包界面冒烟。没有执行全项目、媒体或云端回归。

- [资料与旧行核验](verification.json)
- [全程计时](timing.json)
- [后台页面状态](browser-execution.json)
- [完整 APP 点击观测](artifacts/app-benchmark.json)
- [原始卡片捕获](artifacts/capture.json)
- [最终 APP 状态截图](app-final-status.png)
- [新增博主截图](app-final-new-20.png)
