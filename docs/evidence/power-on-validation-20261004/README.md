# 长时间关机后开机与首次同步验证 · 2026-10-04

**通过范围：长时间关机后开机，现用桌面APP自行启动浏览器、恢复账号准备、同步新增博主并自动补齐其作品总数和本周动态。** 用户确认关机后间隔很久才开机，未手动打开Chrome。系统2026-10-04 12:10:11的Kernel-Boot 27事件为引导类型0x1（快速启动/混合启动），Windows内核启动时间仍为2026-10-03 14:37:57。单独的Windows“重启”完整启动场景未在本次执行，保留独立验收边界。

## 启动前提与实际入口

初始APP进程0，Chrome在登录后自动启动。为核验产品不依赖已有浏览器，正常关闭Chrome，确认APP与Chrome进程均0、旧following-bridge发现文件不存在，然后只调用桌面 `Signal Desk.lnk`。该快捷方式携带现有 `SignalDeskFollowingReview` 用户目录，没有remote-debugging或force-renderer-accessibility参数，没有手动登录、读取/绑定账号、重载扩展或打开测试配置页。

通过Windows UI Automation只观察真实APP按钮，Native Messaging与程序内部连续完成准备。约486.6ms观察到窗口，约4333.94ms连接ready且同步按钮启用；记录到按钮先禁用再解锁。APP准备服务3752.7346ms、结构化API749.9ms、两个GET，DOM查询/页面点击/刷新0。新版准备ID与当前会话一致。Chrome是新的进程，由APP启动，窗口最小化且不在前台。上述为启动准备，与同步耗时分开。

启动前后目录和元数据8张表逐行哈希一致，170位、11次关注run及已保存动态恢复，账号设置哈希一致。没有靠历史ready文件判定：必须取得本次新准备ID及新接口证明。

## 一次点击的真实同步

在真实APP下拉选择“新增10位”，通过实际“同步关注”按钮的Windows InvokePattern启动，不直接调用采集接口。程序9页following加1次self共10GET，字段与原生owner/作者归属、投影hash、连续分页、去重均重新校验，170→180位，无重复主页。

- 产品记录点击至基础资料及全部头像可用3225.0647ms，独立观察3470.1642ms；接口获取2853.8ms、校验保存13.316ms。这些阶段不替代全程。
- 随后程序自动刷新新增10位的作品总数和本周动态，没有第二次启动命令。10/10成功，3位本周有更新、7位暂无更新；该阶段记录12746.122ms。
- 从原同步按钮操作至自动补齐全部元数据的独立观察为15704.344ms，包含两部分连续执行。只读检查账号1GET加每位profile/post共21GET，未启动作品详情、评论、媒体或云处理。
- UI有180个主页链接、180个“已分析”占位栏。基础同步展示回执仅在180张头像实际加载成功后保存，截图已视觉核对。

旧170位所有原字段（含星标和批注）、11次历史run、360条历史动态快照/尝试及7次动态run逐行一致；配置不变。新库为180位、12次关注run、370条动态快照/尝试、8次动态run，integrity=ok、外键违规0。新关注来源和10位元数据快照均用当前合同独立回验。

再次正常关闭APP并只用原桌面快捷方式重开，连接ready、180位、最新关注及动态run/计时恢复。当前资料库保存的本周结果为100位有更新、80位暂无更新，旧170位沿用各自检查时的快照。没有再刷新全部已有博主。

## 可使用的验收结论

“已通过Windows长时间关机后开机的桌面启动与同步实测：无需手动启动浏览器或确认账号，APP可自动恢复连接、准备账号并连续同步资料，保留既有资料与批注。”

该结论覆盖本机当前账号、Chrome Default、扩展0.6.2与桌面快捷方式。Windows完整重启、第二真实账号/profile、正式作品/评论、媒体与分析仍是各自独立范围。本轮无产品代码修改；全部采集由APP程序连续执行，验证脚本只启动入口、操作真实按钮和观察。

- [验证摘要](verification.json)
- [启动与按钮记录](artifacts/desktop-start.json)、[原生准备证明](artifacts/preparation.json)、[启动后存储核对](artifacts/startup-storage-audit.json)
- [一次点击同步与自动补齐](artifacts/sync-verification.json)、[来源记录](artifacts/following-capture.json)、[新增作者报告](artifacts/following-report.json)
- [旧数据保留与新字段回验](artifacts/sync-storage-audit.json)、[新增元数据来源](artifacts/new-metadata-snapshots.json)、[再次桌面重开](artifacts/reopen.json)
- [启动界面](startup-app.png)、[同步完成](after-sync-app.png)、[新增卡片](new-cards.png)
