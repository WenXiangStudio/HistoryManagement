# 排除前六位后的新样本验证交接（2026-10-05）

> 历史记录：这里的版本、构建路径和操作状态属于当时记录。当前运行方式请以[当前交接](../../README.md)为准。

接续[连续停止调查](signal-desk-creator-owner-diagnosis-2026-10-05.md)。用户授权少量真实验证、样本不同于前6位。已按主页身份排除杰森Jason/Xi Xu/口罩哥直播号/Boujoy/外行人搞AI/浙大猫学长；本地历史选每日英语、划水的青蛙、周话多GOGOGO，不为选样访问平台。范围3位/2页/整组额外列表GET2、每位一次、遇错误停止。

**实际仅每日英语一次，run activity-5030c4ac66afc75d640925c4，ACCOUNT_NATIVE_NAVIGATION_MISMATCH、blocked/done0。其余两位未测，未重试/换样本/继续。** 这是0.7.4首次真实持久来源失败记录，无源码/构建变更。

明确字段：账号GET loaderId不同于初始Page.navigate、frameId相同，两项非缺失；document分类first-author、XHR、无子会话；HTTP200/network、JSON有效、绑定账号双ID相符、identity-checked。文档事件先同作者/同frame/相同loader，后同作者/同frame/不同loader，还有其他来源文档。证明触发来自最初loader等值门，非掉线/错账号/403或429。

边界不能越过：事件只记录对初始导航的关系，没有账号loader与后续文档loader彼此等值或提交事件；两个different不能证明同一新loader，Document请求不等于已提交主文档。尚不能断言该账号请求属于后续已提交文档或网页重加载原因。需要补当前已提交主文档关联/同作者切换边界后才修绑定，不删除校验或直接接受新loader。

作者导航1/专用页0/主动self0/额外列表GET0，观察self1/list1、平台API15/全部345（仅附着标签窗口，非总浏览器/传输）。APP停止5.9597秒、独立6.2584秒，无成功新数据全程时间。无账号证明/作者capture/快照/attempt，旧总596、本周待检查保留。

4临时guard测试和语法检查通过；APP EXE/ASAR与当前正常包字节一致，扩展只加允许对象/重复/2页/整组GET2约束，无注入页面/响应或额外Page调试。数据库旧行逐行哈希、配置/星标批注/清单计划/基本字段保留，run30→31仅失败run、snapshot/attempt521不变，integrity ok/外键0。295卡片/头像、pending0。

正常0.7.4恢复/重载、临时guard删；源码/正常包/普通release/验证包/用户扩展哈希一致，正常EXE/ASAR与备份一致。原快捷方式主实例1、无远程调试、online/ready、无采集，库可见295，最新activity=blocked。验证窗口10秒未退出仅终止验证实例子进程，不是正常退出验收。无提交推送/安装器发布。

[证据与诊断](../../../evidence/creator-owner-new-samples-20261005/README.md)，完整备份/APP结果/guard在local-data/creator-owner-new-samples-20261005。下一步先修正有证据的文档来源关联问题再限定复测，不继续换样本。此前两次同作者成功仍有效，不能据此忽略当前泛化失败；正式作品/评论门false，限速/调度/学习策略仍回退。
