# Signal Desk 重启首次同步修复最新交接（2026-10-03）

后续最新入口见 [结构化接口同步与160位](signal-desk-following-structured-2026-10-03.md)。以下为当时0.4.1与150位历史状态，接续 [后台化交接](signal-desk-following-background-2026-10-01.md)。用户实测重启后扩展已连接，首次关注弹窗却未打开；手动打开账号页面后成功。10 月 2/3 日日志均支持该现象，旧失败弹窗诊断为空，不能把特定页面挂载原因说成已证实。

当前入口仍为 **`release-following-background-final\win-unpacked\Signal Desk.exe`**，已用修复构建完整更新。另留本轮包 `release-following-startup-fix\win-unpacked\Signal Desk.exe`。当前 profile `C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview`，扩展升级并重载为 0.4.1；ID/目录不变。APP 重启已自动连接，不要用旧 0.4.0 包覆盖扩展。

现有产品库 **150** 位：用户 10 月 2/3 日成功同步分别至 120、140，本轮最小真实验证新增 10 至 150。原 140 行/星标/批注及历史报告未变，新十位重复 0，150 卡片及头像正常。standalone 40 位历史库、正式业务库不参与。

修复：Chrome session storage 缓存当前浏览器会话已验证 tab，重启/扩展重载自动清空；首次恢复 tab 后台刷新，再等待导航完成及当前内容脚本，随后获取真实关注卡片。正常会话后续复用。关注弹窗/账号页面就绪失败时在同一 run 自动刷新重试一次；登录/安全验证/账号及字段错配不自动重试。隐藏节点不再抑制点击，根唯一性每轮重查。APP“连接器已连接”与“本轮账号页面已验证”分开，APP 重启时账号状态未检查，历史计时保留；整轮计时包括恢复/重试。

真实 run `following-20261003053055-4f56cfded4addf87`：全程 10.1247593 秒，独立观测 10.2239 秒，页面 8.0111 秒（打开 1.1126、翻页/发现 6.8742），保存 17.6689 ms。恢复报告 coldPageRefreshed true、recoveryAttempts 空、tabActive false。未点登录确认，程序直接恢复并成功。此次没有重启电脑，真实验证的是扩展重载清空会话缓存后的首次后台恢复路线；不能声称所有重启环境已验收。

源码：`background.js` 会话 tab 验证缓存；`visible-runner.js` 后台恢复/导航等待/一次恢复重试；`following-batch.js` 隐藏节点与根唯一性、有限等待和失败结构记录；主进程/共享 state/APP 新增 accountStatus/errorCode；版本 `manifest.json` + `followingConnection.ts` 0.4.1。

检查：相关既有关注检查加三个缺陷回归共 14 项、TypeScript、构建、打包界面冒烟通过。原入口重开回读 150 位/头像/历史耗时/连接正常。没有全项目、媒体、云回归。证据见 [首次恢复修复](../evidence/following-startup-fix-20261003/README.md)。代码/证据未提交推送，未发布安装器；原生 owner sec_uid/作者数值 uid、全量关注及作品/评论能力边界仍按先前交接。
