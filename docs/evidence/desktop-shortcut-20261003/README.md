# 桌面快捷方式与最新实现对齐（2026-10-03）

桌面 `Signal Desk.lnk` 原来指向 `E:\InforWork\Signal Desk\Signal Desk.exe`。该旧包没有当前关注同步服务和独立关注扩展。已将原快捷方式的目标、图标和工作目录改为工作区现用的 `release-following-background-final/win-unpacked/Signal Desk.exe`，启动参数设为 `--user-data-dir="C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview"`，继续使用现有170位博主及账号配置。原快捷方式备份保留在本机 `local-data/backups`，不提交Git。

正常关闭原APP后，实际通过这个桌面快捷方式重开。Windows进程路径和参数与快捷方式回读一致；没有remote-debugging启动参数。APP主窗口可见，产生新的账号准备会话，连接扩展0.5.2在线、准备ready，资料总数170。此次Chrome原先仍在运行，验证范围是桌面入口重开APP，不是Chrome冷启动或整机重启。

自动准备服务约2446.4ms，其中结构化API约804.8ms，self/following共2个GET、DOM查询0、点击0。上述为准备阶段时间，不是桌面点击至界面就绪的全程时间，也不是同步采集耗时。

5张目录表（含作者字段、星标、批注及账号元数据）和账号配置文件在重开前后哈希一致，仍为170位、11次采集记录、1个账号；integrity=ok、外键错误0，没有新增采集。旧安装目录及其它资料库未变更。整机重启后的连接、账号准备和授权同步仍待用户验证。

- [快捷方式、实际启动和数据保留核对](verification.json)
- [当前启动交接](../../handoff/archive/2026-10/signal-desk-following-cold-start-2026-10-03.md)
