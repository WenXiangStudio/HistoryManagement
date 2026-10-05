# 主页“作品”计数证据（2026-10-04）

按用户截图直接读取原生作品页签计数，总数不调用profile计数、不遍历全部作品、不用API数量核对。Boujoy前端18、保存18、APP显示18。

`verification.json`包含DOM最小读取、实际APP单卡保存来源、页面核对及历史数据保留。`frontend-count-card.png`和`frontend-count-compact.png`分别为正常与1120px卡片。200个唯一卡片和三区保留，无横向溢出/简介重叠，已分析—保留。

本次仅一次Boujoy单卡刷新；前端计数已保存，但本周列表JSON异常，run为blocked，仍显示原可信本周1条。原数据库历史行前缀、目录身份、星标批注和账号配置保留；新增一份v4来源和尝试，不改旧行。系统级时间与账号登录态不改变。

255应用测试、9runner测试、TypeScript、build/package、renderer smoke和项目边界通过。旧v3完整遍历未完成且已停止；本轮没有再次全量采集。具体说明见[最新交接](../../handoff/archive/2026-10/signal-desk-frontend-work-count-2026-10-04.md)。
