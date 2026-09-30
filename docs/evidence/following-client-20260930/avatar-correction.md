# 十位博主头像绑定修正 · 2026-09-30

用户指出：周话多GOGOGO 与阿星不是程序员显示同一头像；曲木古也显示周话多的头像；oil欧呦只有字母 O。

## 原因与实际差异

此前桌面脚本虽然用昵称定位了图像，但最终通过滚动后的屏幕坐标右键复制图片地址，没有用图片所在主页链接核对身份。真实结果证明这种方法发生相邻行错位；无法仅凭旧日志精确重现每一次滚动的点击位置。

当前直接在 Chrome 已登录账号的关注页执行 DOM 读取，按已保存的十个 `sec_uid` 匹配准确主页 anchor，再读取该 anchor 的 `img.currentSrc/src`。逐条要求昵称、主页 URL、图片 alt（“昵称头像”）匹配，并验证页面图片实际加载。采集没有打开这些博主的主页或读取作品信息。

发现 5 处差异：

| 博主 | 原记录问题 | 当前结果 |
|---|---|---|
| AI，我俩和一百万 | 头像 NULL | 已补齐自己的头像 |
| 浙大猫学长 | 误用了曲木古也头像 | 已修正 |
| 曲木古也 | 误用了周话多GOGOGO头像 | 已修正 |
| 周话多GOGOGO | 误用了阿星不是程序员头像 | 已修正，与阿星不同 |
| oil欧呦 | 头像 NULL，界面字母 O | 已补齐照片 |

## 修改与验证

- 修正 `local-data/douyin-following-20260930.json`、`local-data/douyin-following.sqlite` 和 APP `%LOCALAPPDATA%/SignalDeskFollowingReview/following-directory.sqlite`；原错误数据保留为 `local-data/douyin-following-before-avatar-fix.json`。
- 重新生成 `local-data/douyin-following-result.html`。
- 新增 `scripts/read-following-avatar-bindings.js`、`scripts/capture-following-avatar-bindings.ps1`、`scripts/apply-following-avatar-bindings.mjs`。采集固定使用已保存的十位身份，不按坐标或作者行顺序分配图片。
- 旧 `scripts/capture-following-avatars.ps1` 已替换为新方式的调用入口；`scripts/capture-following-desktop.ps1` 删除了右键图片坐标复制，后续也从准确的主页 anchor 读取头像。
- `browser-connector/following-extension/following-dom.js` 改为从匹配该作者主页的 anchor 中查找匹配昵称的图片。此扩展修改未单独开展新的自动关注试跑，不据此宣称原扩展流程验收通过。
- 当前 Chrome 原始归属数据：`local-data/following-avatar-bindings.json`，10 条、图片加载 10/10。
- SQLite 回读与修改差异：`local-data/avatar-correction-verification.json`，10 个头像 URL，5 处修正，完整性 `ok`。
- APP 实际检查：`local-data/app-following-avatar-readback.json`，10 张卡片、10 个实际加载头像、10 个不同头像地址，逐条与 Chrome 当前页面中的对应主页图片一致。
- APP 上部截图：`local-data/app-following-avatar-corrected.png`；下部截图：`local-data/app-following-avatar-corrected-lower.png`，可查看周话多、阿星与 oil欧呦的照片。
- 当前 APP 作品数和评论数仍为 0。

辅助 SOP 入口返回 `unavailable/SessionNotBound`，没有已读人工反馈的正式 ID 与修订；保存真实本地修正报告并尝试同步，不虚构关联或人工通过。
