# 第二批十位关注博主真实测试 · 2026-10-01

> 用户随后确认昵称、简介、头像均与对应链接相符，并要求恢复第一批展示。已修复累计目录，APP 现显示全部 20 位；见 [修复交接](../../handoff/signal-desk-following-retention-fix-2026-10-01.md)。本文件保留第二批采集时的原始结果。

用户要求继续测试另外十位博主资料，不得与此前重复。

本轮从已登录账号“无限♾️进步”的真实关注弹窗读取资料，按首批保存的 `sec_uid` 排除旧记录。2026-10-01 16:47:22（北京时间）取得十条新资料；run 为 `desktop-following-batch2-20261001084722`。

## 结果与归属

| 本批顺序 | 博主 | 当前列表位置 |
|---|---|---|
| 1 | 木子不写代码 | 1 |
| 2 | 数字生命卡兹克 | 2 |
| 3 | 老袁讲AI | 3 |
| 4 | 躺在废墟里 | 4 |
| 5 | 浩瀚烟火日记 | 15 |
| 6 | 涌现EmergenceHK | 16 |
| 7 | Fateless | 17 |
| 8 | 刺猬星球super-i | 18 |
| 9 | Mx-Shell | 19 |
| 10 | 盐选财经 | 20 |

页面排序已经变化，首批十位现在位于第 5～14 行。因此不能简单取第 11～20 行；本轮按身份跳过十条已保存记录，取得另外十位。

昵称和简介来自同一张关注卡片；主页来自该卡片唯一的 `sec_uid` 链接；头像要求图片 alt 与昵称匹配，且图片已加载。九位头像位于准确主页链接内。“刺猬星球super-i”正在直播，其头像链接指向直播间：已通过同卡片内唯一主页身份、昵称和精确图片 alt 核对归属，没有打开直播间。

本轮简介保留页面图片形式的 emoji，例如“躺在废墟里”的箭头和“Mx-Shell”的丝带。数值 `uid` 和 owner 原生 `sec_uid` 未取得，继续保持 NULL。

## 保存与验证

- 追加到 `local-data/douyin-following.sqlite` 的新 run，并写入 review profile 的 `visible_directory_runs`、`visible_directory_creators`。
- 两库的可见资料均为 20 条；本轮十条与首批重合 0 条，独立 SQLite 中 20 个 `sec_uid` 全部不同。
- 入库前通过 SQLite backup API 保存两库的一致性副本。首批作者记录、APP 首批 run 和原始采集 JSON 保持原样。
- 两库回读的本轮昵称、简介、主页和头像与原始采集逐字段一致；完整性均为 `ok`，外键检查无违规。
- 本轮报告通过现有 `signaldesk-visible-following/v1` Zod 合同。
- APP 实际回读和 DOM 检查：10 张卡片、10 个主页链接、10 个已加载头像；每张卡片的实际图片 URL 与其对应作者采集值一致。上、下部截图已查看。
- APP 当前按已有 `FollowingDirectoryStore.list()` 行为显示最新一批十位；首批仍保存在数据库历史 run 中，当前界面尚不提供两批合并或历史切换。
- review profile 的 `works`、`comments`、`metric_snapshots`、`jobs`、`analyses` 入库前后均为 0。正式业务库不参与本轮操作。
- 操作脚本的 JS/PowerShell 语法检查和 `git diff --check` 通过。没有重跑全部产品回归，也没有重新打包应用。

保存后首次审计的 `deepStrictEqual` 因 Node SQLite 返回的无原型行对象与普通对象原型不同而失败，字段值并无差异。修正比较方式后使用 `--verify-saved` 仅回读已保存结果及原始备份，全部核验通过，没有重复采集或再次插入。

## 原始证据

- [真实采集与卡片归属](artifacts/capture.json)。
- [保存、去重与旧记录核验](artifacts/verification.json)。
- [APP 最终回读](artifacts/app-readback.json)与[APP 归属核验](artifacts/app-verification.json)。
- APP 截图：[上部](artifacts/app-batch2-upper.png)、[下部](artifacts/app-batch2-lower.png)。
- [第二批结果页](artifacts/result.html)。
- 原始 DOM 结构诊断和直播头像卡片诊断保存在同一证据目录。
- `following-before.sqlite`、`app-directory-before.sqlite`、`following-after.sqlite`、`app-directory-after.sqlite` 为本机副本；仍受 `.gitignore` 排除，不能假定 Git 包含数据库。

本轮通过的是桌面页面脚本提取、追加保存与 APP 展示。APP 扩展自动关注采集、全量分页、作品、评论、媒体和云分析没有获得新的验收结论。
