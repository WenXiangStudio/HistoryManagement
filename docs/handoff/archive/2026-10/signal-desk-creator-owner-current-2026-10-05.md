# 当前主页文档绑定优化与新样本验证交接（2026-10-05）

> 历史记录：这里的版本、构建路径和操作状态属于当时记录。当前运行方式请以[当前交接](../../README.md)为准。

接续[新样本loader来源拒绝](signal-desk-creator-owner-new-samples-2026-10-05.md)。用户授权沿新方案优化，并用不同样本验证一次，错误即停止回报后讨论。已交付0.7.5；只做灵鲸科技袁亮一次单卡真实采集，completed/成功1/失败0。当前原入口可见295/pending0、online/ready、无采集运行。

## 最终实现

首位导航前Page.enable一次（本地CDP命令、非GET），观察Page.frameNavigated以确认当前已提交主文档。同一run/new tab/同一主frame/同一作者主页可更新loader，账号请求须匹配当前已提交loader/frame、first-author文档分类且无子会话；端点GET/HTTP200/JSON/账号双ID仍保留。Page.navigate返回或Document请求不冒充提交，未提交/待提交/离开作者主页/主frame移除/子frame或session/旧loader均停止；任何已观察HTTP/JSON/身份/来源错误不fallback，另一条成功响应不能遮盖错误。等待响应体期间重检当前来源，诊断上限8/4不限制实时来源跟踪。

生产后端在接受原生证明时复核当前主页提交、导航主frame一致、请求与当前loader/frame一致和HTTP/JSON/双ID阶段，诊断不代替证明，未验证账号仍不写作者。诊断新增当前文档/提交转换、请求与当前文档关系；旧run和旧诊断不改写，新增字段兼容可选，原始标识/URL/query/header/Cookie/全文不持久化。

无原生self时只在已提交且无待提交的主页补一次主动GET；其他失败不补。新增平台GET0/专用导航0/主动重载0/等待0；成本仍run最多1主动账号GET＋n必需作者导航＋p必要后续GET，可信原生self省该1GET。作品/前端计数逻辑保持。

## 实测及证明边界

样本排除前6位和上一轮3位候选，只本地选已保存的灵鲸科技袁亮。1位/2页/额外列表GET最多2/一次尝试，程序连续执行，临时guard仅约束对象/重复/预算，不改响应。run activity-1560b316d6b46be3457d0f69：主页630（旧631快照保留）、本周0/最近null/下区，原生1页21视频/3置顶/周界覆盖，双ID、作品ID去重/状态/周界独立复算通过。

APP数据显示4.2866秒、独立资料/头像4.4638秒。作者导航1/专用页0/主动self1/额外列表GET0；self观察1/list1、平台API13/全部310，仅attach窗口观察非总浏览器/传输。

诊断真实观察同作者同frame两次Page提交，当前loader不同于初始导航。**核验决策前原生self未观察，走active-get一次；不称文档切换后的原生账号复用已真实通过或本轮省了账号GET。** 新切换原生复用单元/集成/后端离线通过，仍缺实样。

真实采集后补更严格初始commit/待提交/等待期间来源和后端关系拒绝边界，只离线验证，无第二次平台采集；实际运行扩展留在local-data且live-source-hashes与最终delivered-source-hashes分别保留。最终43浏览器/273应用31文件（含30相关）/1guard、TypeScript、build、项目边界及最终打包renderer通过。

## 数据与交付

旧数据库全行SHA-256和设置不变，星标批注、清单计划、基础资料保留；run31→32、snapshot/attempt521→522只加成功结果，旧失败记录不改。295卡片/头像/pending0、integrity ok/外键0。

最终包在release-creator-owner-current-final-20261005；正常原包/普通release与其EXE/ASAR匹配、最终源码/包/用户扩展哈希一致、guard移除。原快捷方式主实例1、无远程调试、online/ready、无运行采集、库可见295。验证窗口10秒不退出只终止该验证实例子进程，不算正常退出验收。未提交推送或发布安装器。

[完整证据](../../../evidence/creator-owner-current-20261005/README.md)，备份/实际结果/扩展/脚本在local-data/creator-owner-current-20261005。本轮“优化＋不同样本验证一次”已完成，无真实失败触发新讨论。不自动继续其他作者；仍未实测新loader原生账号复用/必要补页/受限临时未知，正式作品/评论门false，限速/统一调度/学习策略仍回退。
