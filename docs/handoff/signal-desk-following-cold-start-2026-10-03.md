# Signal Desk 浏览器完全关闭后的启动修复（2026-10-03）

本文件接续 [账号配置交接](signal-desk-following-account-config-2026-10-03.md)，是当前最新状态。用户关闭 APP 和 Chrome 后重新打开 APP，连接器未能启动。本轮已经确认原因并修复、更新原入口；APP 保持打开，不自动新增采集。

## 用户验收结论与下一次验证

用户反馈（2026-10-03）：当前测试通过，暂未再出现启动连接问题。**“整机重启后仍然通过”的结论保留，尚未验收。** 关闭 APP/Chrome 后重开已通过，不能据此宣称电脑重启、后台进程全部消失或不依赖临时测试文件/运行缓存的场景也已经通过。

工作区清理后只保留现用 APP 包，开发临时文件与历史中间构建被清除。产品启动应依赖已安装 APP、用户选择的 Chrome profile/扩展、持久账号配置与实际登录会话，不依赖代理命令、工作区测试 JSON 或已有进程。保留 Chrome 登录态和用户数据库属于正常产品持久化，不能为验证而删除。

下一步需由用户真实重启电脑后验证：只打开现用 APP，不提前启动浏览器、不手动确认账号；同步按钮先禁用，连接与账号接口准备完成后自动解锁；随后在用户授权同步时核对字段、去重和已有星标/批注保留，并分别记录启动准备与点击同步到资料/头像可用的耗时。失败时保留具体状态和原因再排查，不回到重复刷新或 DOM 关注定位。

## 原因与行为

现场 APP 的连接为 offline、准备为 PREPARATION_TIMEOUT，Windows 没有 Chrome 进程。所选 Default、连接器 ID、扩展安装、账号配置均还在。原自动启动参数 `--profile-directory=Default --no-startup-window` 在真实用户 Chrome 上约 289.9ms 即以退出码 0 结束；8 秒后仍没有 Chrome 进程，因此扩展无法启动。不能把正常退出码当作连接成功，也不能要求用户重新确认账号来掩盖浏览器启动失败。

`followingSync.ts` 的后台启动改为所选 profile 的真实账号窗口：`--new-window --start-minimized --hide-crash-restore-bubble https://www.douyin.com/user/self`。准备命令携带 `backgroundStart`；连接器复用刚创建的 self 页面完成两个授权 GET，随后 detach debugger、通过 `chrome.windows.update` 最小化该窗口，再报告 ready。同步按钮继续由连接在线与原生账号/接口准备共同控制。主动打开登录、设置页面仍走用户可操作的页面路径。

Chrome error/nonzero exit 现在阻止准备并报告 CHROME_START_FAILED，作用于对应的准备会话，不改历史采集 phase。退出码 0 可能只是转交已有 Chrome 进程，仍以真实扩展回连作为判定。没有添加浏览器循环重启或 DOM 关注定位。

扩展 **0.5.2** 已完成一次真实重新加载。开发时仅覆盖 unpacked 文件、关闭/重开 Chrome，可能仍执行已有 service worker/module cache：曾观察 getManifest 为新版，但 registration 仍是 0.5.1。应一次明确重载升级扩展；不要把这一步当作用户日常启动流程。最终 proof 含 backgroundStart=true、backgroundWindowState=minimized，证明新版 runner 确已执行。

## 当前入口与核对

- 原入口 `release-following-background-final\win-unpacked\Signal Desk.exe` 已完整更新；工作区只保留这一现用包，重复的 `release-following-cold-start-delivered` 与其他旧构建在本次整理中删除。
- Profile 仍为 `C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview`，Default、原账号和 connector ID 不变，扩展版本为 0.5.2。
- 最终验证前 APP/Chrome 进程均为 0。只启动 APP，无手动登录确认或同步动作。约 **3840.1ms** 后 ready 且同步按钮启用；其中 APP 准备服务 **3347.0ms**，结构化 API **549.0ms**。这些是启动准备耗时，不是新增博主同步耗时。
- Windows API 验证账号 Chrome 窗口 minimized=true、foreground=false；APP 已显示在前台。结构化准备仍为 self+following 2 GET、DOM/UI clicks/reloads 均为 0。
- 4 个原目录表逐行一致：160 位、10 次历史 run，星标/批注/字段/报告不变。数据库 integrity=ok、外键错误 0；没有创建新采集 run。账号昵称核验仍属于原生账号配置流程。
- 随后用户使用 APP 后，最新打开时只读状态为 **170 位**。160 位是上述启动修复时点的历史验收数量，不能用该历史快照覆盖目前的170位。本次交接/清理不新增采集、不修改账号配置或博主资料；清理前后另做存储哈希核对。
- TypeScript、生产构建、打包通过；打包 renderer smoke 通过；最终交付真实启动/按钮/窗口/数据库验收通过。没有电脑实际重启、另一真实账号或另一 Chrome profile 验收。

[本轮证据](../evidence/following-cold-start-20261003/README.md)。用户已授权整理后提交并推送 GitHub；具体清理与提交记录见 [工作区整理](../evidence/workspace-cleanup-20261003/README.md)。没有发布安装器；不要自动进行新批次测试。
