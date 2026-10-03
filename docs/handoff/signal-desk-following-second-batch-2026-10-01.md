# Signal Desk 第二批关注资料测试交接（2026-10-01）

> 后续已修复累计展示，最新状态见 [博主资料保留修复交接](signal-desk-following-retention-fix-2026-10-01.md)。用户确认本批昵称、简介、头像与主页相符；APP 现显示两批共 20 位。下文“仅显示最新十位”为修复前历史行为。

本文件是最新交接入口，接续 [2026-09-30 关注目录与头像修正交接](signal-desk-following-directory-2026-09-30.md)。

## 最新事实

用户要求第二次测试另外十位博主资料，不得重复。已从同一登录账号“无限♾️进步”的真实关注弹窗取得十位新博主，按主页中的 `sec_uid` 排除首批十位，追加保存并在 APP 展示。第二批与首批重合 0 位，两批合计 20 位不同博主。

第二批：木子不写代码、数字生命卡兹克、老袁讲AI、躺在废墟里、浩瀚烟火日记、涌现EmergenceHK、Fateless、刺猬星球super-i、Mx-Shell、盐选财经。

采集时间为北京时间 2026-10-01 16:47:22；run 为 `desktop-following-batch2-20261001084722`。详细字段、截图、保存验证及边界见 [本轮证据](../evidence/following-client-20261001-batch2/README.md)。

## 数据与 APP

- 独立 SQLite：`local-data/douyin-following.sqlite`，两批共 20 条、20 个不同 `sec_uid`。
- APP 目录：`C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview\following-directory.sqlite`，可见目录两批共 20 条。
- 本轮使用已有最新提交构建 `release-commit-review\win-unpacked\Signal Desk.exe`，profile 沿用 `SignalDeskFollowingReview`；应用仍打开于“博主资料库”。操作前重新查进程，不依赖历史 PID。
- APP 按现有目录模型只展示最新一批十位；首批十位未删除，但尚无历史切换或合并展示入口。
- 本轮保存前后两库一致性副本位于 `docs/evidence/following-client-20261001-batch2/artifacts/`；首批记录及原始 JSON 已核对保持原样。
- APP 十张卡片、十个主页、十个实际加载头像逐条核验通过。原生数值 `uid` 和 owner `sec_uid` 仍缺失，不将其猜作已验证双 ID。
- 正式 `%APPDATA%/Signal Desk` 库不参与本轮；review profile 的作品、评论、指标、任务和分析仍为 0。

## 可复用成果与边界

新增页面结构读取、按身份排除旧资料的第二批 DOM 提取、独立批次保存及核验脚本。`scripts/inspect-following-live-client.mjs` 增加实际图片 URL 的回读，便于核对头像归属。

真实页面没有 `role=tabpanel`，关注页签与列表实际是同一容器内的相邻元素；本轮依据真实结构核对它们的归属。直播作者头像会链接到直播间，需依据同一张唯一主页卡片与昵称 alt 核对，不将“头像必须在主页 anchor 内”当作所有页面结构的固定前提。

这仍是桌面页面脚本读取、直接写入验证目录和 APP 展示。原扩展一键自动同步没有得到成功验收；全量关注分页、账号隔离、目录历史合并及批注跨刷新仍未验收。关注、作品、评论保持独立，生产结构化同步开关仍为 false。

本轮现有报告合同、脚本语法、SQLite 回读/完整性、两批去重/保留及实际 APP 展示核验通过。未重跑全部产品测试，未生成新应用包；此前 22 文件、217 项通过仍是 9 月 30 日提交时的历史验证。

本轮改动和证据留在工作区，未提交或推送。后续继续按项目规则，先证明真实字段和归属，再推进产品自动化；完成本轮后等待用户指令。
