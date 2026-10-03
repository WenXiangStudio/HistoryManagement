# 无 DOM 的关注数据通路 · 2026-10-03

用户要求启动时自动连接并检查账号、就绪前禁止同步，并在旧关注入口不断失败时明确要求换到底层、停止DOM定位。本轮遵循先证明真实读取、再接保存/展示与自动化：先最小请求self/following取得真实身份资料，再替换生产路径并验证新十位。

## 当前实现与完整顺序

APP启动 → 同步按钮锁定 → 自动连接授权Chrome profile/关注扩展 → 读取当前登录账号self JSON → 用其sec_uid读取关注列表JSON并比对myself_user_id → 数据合同通过 → ready通知及按钮解锁。

用户同步 → 新run及点击时钟 → 重读self原生身份 → 关注接口按响应游标逐页取得资料、按已保存sec_uid排除旧人 → 同对象字段来源受理 → 追加事务/回读 → APP资料卡/头像实际可用 → 全程计时回执。

扩展0.5.0的日常runner是`structured-runner.js`，manifest不再注入抖音DOM采集脚本，APP正式受理入口不再接受旧DOM capture。使用授权浏览器页面上下文的同源只读GET，浏览器自行带登录会话，程序不导出Cookie、Token或密码。未获取作品/评论响应，无账号关系写操作。

启动准备与同步分别计时。数据接口ready不能由扩展心跳、页面loading=complete或历史结果替代；APP UI和主进程都锁定未准备同步。重新连接/页面变化自动检查，失败保持禁用并提供处理入口。重复刷新循环已撤出最终数据路径。

## 真实准备结果

最小探测：[probe.json](artifacts/probe.json)，两个GET接口阶段550.7ms，得到真实owner `uid/sec_uid/nickname`和20条关注。它只证明底层获取，没有入库。

第一次结构化准备接口575.7ms、服务602.1964ms；窗口检查2.206s，期间包含一次扩展升级。最终交付原入口重开接口592.2ms、服务1008.9242ms，检查工具从窗口可观测开始约0.932s。工具与服务起点不同，不把相互差异误当程序倒计时。完整最终准备：[final-preparation.json](artifacts/final-preparation.json)。

启动观测验证初始按钮disabled；准备前调用同步API被主进程拒绝；native账号/关注数据验证通过后disabled=false；采集run及160位资料数量不变。报告 `domQueries:0/uiClicks:0/pageReloads:0/tabActive:false`。没有为了底层同步切到关注标签，也没有打开弹窗。

## 新十位全程采集

run：`following-20261003081049-f57ba611448f397c`。

| 项目 | 实测 |
|---|---:|
| 已有 / 新增 / 累计 | 150 / 10 / 160 |
| APP点击至全部资料和头像可用 | **2713.5457ms** |
| 独立观测点击至完整结果 | 2810.6ms |
| 平均全程 / 新增博主 | 271.35457ms |
| 结构化接口读取 | 2545.2ms |
| APP校验/归档/保存/回读 | 16.9742ms |
| 列表页 / 全部GET | 8 / 9（另一个为self） |
| DOM查询 / UI点击 | **0 / 0** |

新十位：IT咖啡馆、西瓜的皮、黄阳的学习分享、不自由摄影师Winga、任毅Steven、Richard在加州、投哥不请自来、大又元、圈圈包子（周末更新，偶尔日更）、水球泡。

原150所有原字段、星标/批注及历史报告保持原值；新增schema列在旧行仍NULL，新增记录保留原生uid。新十位与旧重复0，字段逐项等于对应响应作者对象以及APP卡片；160张卡片/头像已加载；新十位空简介0；SQLite完整性ok、外键违规0。作品/评论/指标/任务/分析均0。

当前owner由self响应uid/sec_uid与following请求sec_user_id/响应myself_user_id绑定。历史资料此前只有显示名，本轮账号映射保留旧目录而不重新写历史行；不能据此把历史作者原生uid或过去的owner原生证明说成补齐。新十位原生作者uid是真实响应值。

## 失败、界限及检查

第一次同步2063.5ms后因`INSUFFICIENT_NEW_CREATORS`停止，零写入。实际每页20，最初6页不足以越过150位已有资料；改成连续分页最多20页/21GET后取得足够新作者。失败在 [attempt-1-page-limit.json](artifacts/attempt-1-page-limit.json)。同轮数据不够不写，不无限调用。

中间DOM准备版本多次失败/重复刷新，最终已换成数据接口；那些调试耗时不属于2.71秒同步样本，记录在`docs/evidence/following-readiness-20261003/artifacts`。最终未重启电脑，只验证准备缓存/APP重开后的真实数据路径；全量关注、所有账号、所有平台改版、历史原生身份补齐尚非本次验收。作品/评论能力门保持关闭。

相关受理/资料目录11项、TypeScript、构建及最终packaged renderer通过；启动按钮初始禁用、未准备主进程拒绝、就绪解锁真实观察通过。没有全项目、媒体云回归。最终APP包已更新到原启动路径，profile沿用原目录，0.5.0自动连接，160位及最近2.71秒历史计时可回读。

- [资料/保留核验](artifacts/verification.json)
- [结构化字段及分页来源](artifacts/capture.json)
- [保存合同](artifacts/report.json)
- [全程时间](artifacts/timing.json)
- [浏览器数据路径](artifacts/browser-execution.json)
- [APP点击观测](artifacts/app-benchmark.json)
- [最终准备与按钮解锁观察](artifacts/readiness-observation.json)
- [原入口最终APP截图](app-final.png)
- [新增博主资料截图](app-new.png)
