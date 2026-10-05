# 关注清单解耦真实验证

用户授权实施完整关注清单与本地基础资料待办，并确认已重新登录抖音。测试在原桌面 APP 内实际点击“同步关注清单”一次，无作品统计或基础补充自动接续。

15页（14×20＋15）保存295个身份；原220位累计至295位，新增75位。所有295张卡片及头像可用，点击全程7921.8826ms，独立观察8046.2134ms。程序主动self1＋following15，共16GET；网页原生流量和头像图片另计。简介缺字段0、明确空串5、pending0，所以没有逐作者补充请求。

原8张表历史行哈希逐行集合一致；动态run19、snapshot512、attempt512不变。星标批注/原ID保留，integrity=ok、外键违规0。原桌面快捷方式重开后恢复295、pending0、7.92秒历史计时，扩展0.7.0在线，无调试参数、主实例1。

- live-verification.json：真实按钮、分页/字段数量、全程与阶段计时、原行哈希核对结果。
- app-after-list.png：真实APP完成界面，仅APP窗口。
- normal-restart.json：正常快捷方式启动后的持久清单与状态。
- storage-deployment.json：采集前，程序部署不改变原业务表/账号配置的审计。

没有采集作品、评论或视频文件，没有读取无关Chrome页面。真实缺字段补充尚未触发；262应用测试、14浏览器runner测试、TypeScript、生产构建、packaged renderer及project boundaries通过。完整交付与边界见[交接](../../handoff/archive/2026-10/signal-desk-following-plan-2026-10-04.md)。
