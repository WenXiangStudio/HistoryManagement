# Signal Desk 公开可见作品计数交接（2026-10-04）

> 历史记录：这里的版本、构建路径和操作状态属于当时记录。当前运行方式请以[当前交接](../../README.md)为准。

已被后续用户指令取代：作品总数直接读取主页“作品”计数。本文件记录短暂的v3全列表方案，200位批次到95位时停止（94成功、1失败），未完成全量验证，不再继续。最新实现与入口见[主页作品计数](signal-desk-frontend-work-count-2026-10-04.md)。下文为当时方案和样本事实，不作为当前流程。

用户明确作品统计只包含实际可见且公开的作品，指出profile接口计数包含隐藏/私密内容。此前“闭关修炼”profile=2、公开列表空、原生主页0，三次同类重试触发WEEK_COVERAGE_INCOMPLETE；现已修正来源和接受规则，APP单卡实际刷新成功，公开总数0、本周0，剩余重试清空。关注扩展0.6.3，原桌面入口已更新。

## 口径与范围

作品总数从目标作者公开作品列表逐页读到has_more=false，按原生作品ID去重、验证uid/sec_uid及publicVisible，包含公开视频和图文。profile只提供作者身份，原计数保留在capture.profile.workCount供诊断；snapshot.workCount才是公开列表去重结果，workCountSource=public-list。

明确private_status>0、is_delete=true、is_prohibited=true分别排除，保留带作者身份的非公开排除记录；未知公开状态停止本作者检查、不估算。外作者只有双ID均不同且有效时单独排除，冲突/缺失身份拒绝。正常结束的空公开列表确认0，profile计数不再作为空态条件。请求/JSON/status_code失败、循环/重复游标、未知公开状态或范围未完成，均不产生完整总数。

每页20、每作者最多200页/180秒、单请求8秒、页间150ms。保留取消、账号检查、遇风控停止和继续剩余。达到上限时显示待完整刷新，不宣称无限量计数。新capture为v3，后端兼容历史v2；从保存列表重新计算，已到末页可补算，只有本周范围的旧profile数不再展示，已确认周条数保留。历史行不改写；失败时保留以前完整公开列表数及其检查时间。

当前周动态及三区仍根据最近可信公开列表快照，未合并历史发布事件；作品变为不可见后，下一次完整刷新公开总数与周条数可减少。发布历史累计和删除状态仍为讨论稿。

## 验证与交付

实现前最小真实读取：闭关修炼0、Xi Xu 16、IT咖啡馆225，分别1/1/12页。曾尝试每页100超过原始响应4MiB上限，生产回到每页20，保持原始响应约束。

252项应用测试（28文件）、8项runner测试、TypeScript、project boundaries、build、package和包renderer通过。覆盖公开空列表与正profile、越过周界继续、去重、非公开/外作者排除、未知状态、超过十页、循环/重复分页、部分结果不估算、旧快照不改写和星标批注保留。

全量公开资料刷新由APP按钮连续执行；代理只点击产品按钮并读取状态，不逐位发采集命令。资料库原200身份/星标批注/配置/旧快照保留，最终批次及截图见[本轮证据](../../../evidence/public-visible-count-20261004/README.md)。

主要实现creator-activity-runner.js、creatorActivity.ts、creatorActivityService.ts、followingSync.ts、App.tsx。动态报告上限8MiB，其他关注报告仍512KiB；契约约束页数和字段。读取时缓存已接受快照，避免每5秒重算完整旧列表。

交付同步resources/app.asar、配套Signal Desk.exe及resources/browser-connector/following-extension的runner/manifest；APP部署到用户目录后重新加载扩展。原桌面入口最终无调试参数重开，不迁移账号或正式业务数据库。Windows完整重启、第二真实账号/profile和正式作品详情/评论/媒体分析边界沿用旧交接。无提交推送或安装器发布。
