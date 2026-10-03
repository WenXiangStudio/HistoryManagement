# 工作区整理与 GitHub 提交（2026-10-03）

用户认可当前启动测试通过，同时明确整机重启验收尚未完成。本次只更新交接、整理临时产物、运行必要离线检查并提交/推送，不自动采集博主，不重启电脑或删除Chrome登录态。

现用APP只保留 `release-following-background-final/win-unpacked/Signal Desk.exe`。旧版和重复打包目录清理，源码、开发依赖、Python运行时和本机实际资料库保留。已保存的各轮字段、归属、时序、失败与验收证据统一归档到各 `docs/evidence/*/artifacts`；开发中间配置、重复回读、日志和过时备份不作为日常运行依赖。

现用资料库位于 `%LOCALAPPDATA%/SignalDeskFollowingReview`，当前170位。清理前后核对所有目录表（含星标、批注及账号元数据）、保存账号配置和历史库哈希；数据库保持完整。本机另外留一份清理前的一致性备份，数据库与登录/连接发现凭据不提交Git。

- [清理清单及统计](cleanup-manifest.json)
- [清理前后存储核对](data-preservation.json)
- [提交前检查](validation.json)

Git远端沿用当前仓库origin，分支main。推送结果以代理最终回复中的实际提交SHA/远端核对为准。没有发布或上传安装器。
