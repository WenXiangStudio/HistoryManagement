# 当前账号前 10 位关注博主：真实采集与 SQLite 保存成功

完成时间：2026-09-30 17:36（Asia/Shanghai）。采集 run：`desktop-following-20260930093609`。

> 2026-09-30 17:56 修正：原十条昵称与主页正确，原头像采集中 3 位错位、2 位漏采。已按真实 DOM 中各自主页链接内的图片修正，共 10 个正确加载头像；见 [头像修正记录](avatar-correction.md)。下文 8 个头像的描述为修正前历史结果，不能作为当前状态。

用户要求快速获得当前登录账号关注页面的前 10 位博主基础信息及主页链接，保存到本地数据库；允许跳出原有代码策略。

## 实际完成

从 Chrome 中已登录的“无限♾️进步”账号关注弹窗，读取“综合排序”下的前 10 位博主。使用 Windows UI Automation 定位页面上的博主名称，再对各自昵称链接执行 Chrome 自身的“复制链接地址”。没有使用历史作者目录或模拟数据生成结果。

已保存以下 10 位：爱学习的乔同学、雪踏乌云、小涛AI大讲堂、AI，我俩和一百万、浙大猫学长、曲木古也、周话多GOGOGO、阿星不是程序员、每日英语、oil欧呦。

每条记录包含当前顺序、昵称、主页 URL、链接中的 `sec_uid` 和公开简介；8 条有头像 URL。另 2 条没有取得头像 URL，保存为 NULL，APP 使用昵称首字代替。页面没有提供独立数值 uid，因此 uid 保存为 NULL，没有用 sec_uid 伪装 uid。

- SQLite：`local-data/douyin-following.sqlite`。
- 表：`following_runs` 和 `following_creators`。
- 原始可见页面采集：`local-data/douyin-following-20260930.json`。
- 可点击主页的本地结果页：`local-data/douyin-following-result.html`，已打开。
- 原始数据库回读验证：`local-data/douyin-following-verification.json`。
- 同样的数据已写入本次验证 APP 的 `%LOCALAPPDATA%/SignalDeskFollowingReview/following-directory.sqlite` 中 `visible_directory_runs`、`visible_directory_creators`；已打开 APP 的“博主资料库”。
- APP 读取与卡片检查：`local-data/app-following-readback.json`；截图：`local-data/app-following-success.png`。

## 实际验证

- 独立 SQLite 只读回读：10 条记录、10 个不同主页链接；顺序、昵称和 URL 与采集文件逐项一致；`PRAGMA integrity_check` 为 `ok`。
- APP 实际 IPC 回读：关注数量 10，作者记录 10；renderer 有 10 张卡片、10 个主页链接、8 个已加载头像。
- 直接读取本次验证 APP 的作品数据库：`works=0`、`comments=0`、`metric_snapshots=0`、`jobs=0`。
- 本次没有获取关注博主的作品、点赞数、评论或评论内容。没有为了验证而访问这些博主的主页或作品页。

## 本轮实现与范围

新增 `scripts/capture-following-desktop.ps1`、`scripts/capture-following-avatars.ps1` 和 `scripts/save-following-desktop.mjs`；修正 `scripts/inspect-following-live-client.mjs` 的实际导航名称“博主资料库”。

这次完成的是用户要求的真实十条信息采集、本地 SQLite 保存和结果展示。原来的 APP 一键浏览器同步流程仍不能标记为正式验收通过；前几轮扩展错误不因这次桌面采集成功而变成通过。没有继续修改产品采集机制，也没有运行新一轮扩展试跑。

## 原因与依据

此前在连接失败后反复切换扩展策略并打包，没有先利用当前真实可见页面完成小范围需求。已知失败还包含对关注弹窗结构的过严假设。当前采集利用 Chrome 已提供的昵称链接和“复制链接地址”动作，绕开此前错误的调试目标与 DOM 选择器依赖，直接达成本次十条入库。

## 辅助 SOP

任务恢复时辅助入口返回 `unavailable/SessionNotBound`，未读取到该项目规划/反馈的正式 ID 与修订，因此不虚构关联、不声明人工裁决。任务完成前再次读取并尝试提交真实执行报告；若仍 unavailable，本地保留待同步报告。
