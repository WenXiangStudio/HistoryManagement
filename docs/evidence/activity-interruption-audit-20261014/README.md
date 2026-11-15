# 两轮活跃度采集中断原因核查 · 2026-10-14

用户要求核对302位初采与169位补采中的多次中断。当前日常版本APP0.1.37/连接器0.8.11，普通Chrome154.0.8037.99；本轮完成原因核查、只读现场重现与数据重算，未修改产品采集/恢复规则，未重跑业务批次。

## 结论

两轮各3次停止，共6次：5次`DEBUGGER_NOT_ATTACHED`，1次`TARGET_NAVIGATED_OR_CLOSED`。前5次均在主页读列表阶段，目标附加后约10.3～11.8秒，子框架特殊协议导航后3～5ms触发`debugger.onDetach(reason=target_closed)`；标签页仍存在、目标主页未变、未被discard。故此处`target_closed`不等于用户关闭浏览器标签。

针对“投研小余”做一次单主页被动观察（不主动请求作品列表），复现子框架`bitbrowser://cc/`导航后4ms连接断开，主页仍存在且加载完成。进一步本地对照：空白页不进行协议导航时调试连接保持；相同空白页插入`bitbrowser://cc/`子框架后1ms断开，Chrome返回`Detached while handling command`，空白标签仍存在；此对照无任何平台请求。因此可以确认在本机Chrome中该特殊协议导航足以触发调试连接断开，不需要批量列表GET或频率限制。

历史诊断只保存`custom`协议类别，没有具体协议字符串，因此其余4次不能逐次追认一定也是bitbrowser；但时间顺序、事件间隔及连接/页面状态相同，强烈支持同类机制。协议导航脚本的具体归属/意图没有在本轮验证；不能凭协议名字断言用户使用了BitBrowser或平台有意封控。实际运行程序为普通Chrome。

另外一次“资本论”在主页数量读取的异步执行期间发生主文档web导航，Chrome返回`Inspected target navigated or closed`归类错误；随后读取到主页面仍在但处于loading，作品标签尚未出现，无debugger.onDetach证据。旧日志未保存具体跳转URL和发起者，能确认页面导航打断读取，不能确定是网站自动刷新、重定向还是其他导航来源。

六次现场都没有可见登录/验证/不可用标记；保存的监听与主动请求结果没有401/403/429。五次连接断开此前的主页原生列表为200，部分补读也已200/valid成功。没有账号封控或限流的直接证据；网站可能存在后台环境检测，不能因无可见挑战而声称不存在任何安全检测。

第二层原因位于当前产品容错：`traceActivityCommands`在非预期detach时立即拒绝未完成命令，`active()`继续断开检查；`runCreatorActivityRefresh`外层catch对连接断开、短暂页面导航与安全验证统一调用blocked并结束剩余任务。没有独立的有界重连/同主页重新就绪策略，所以一个作者的短暂执行上下文故障被放大为整轮停止。手动继续后重新准备页面且跳过已保存作者，最终两轮都完成。

## 六次记录（北京时间）

| 轮次 | 时间 | 博主 | 停止前已完成 | 阶段 | 错误 |
|---|---|---|---:|---|---|
|302位初采|12:38:03|刺猬星球super-i|17/302|读取列表|DEBUGGER_NOT_ATTACHED|
|302位初采|13:40:37|刘润|169/302|读取列表|DEBUGGER_NOT_ATTACHED|
|302位初采|13:53:01|资本论|195/302|读取主页计数|TARGET_NAVIGATED_OR_CLOSED|
|169位补采|15:46:58|熠辉Indie|56/169|读取列表|DEBUGGER_NOT_ATTACHED|
|169位补采|16:26:22|杨利辉|136/169|读取列表|DEBUGGER_NOT_ATTACHED|
|169位补采|16:44:28|投研小余|161/169|读取列表|DEBUGGER_NOT_ATTACHED|

均有诊断和截图。部分列表已读完但在最后检查时连接断开，尚未得到入库确认，故本位仍在剩余清单；已保存其他作者未丢失。历史run最终failed=0不表示全过程没有中断，而表示最后一轮无未完成目标。

## 数据完成及保留核查

169位最终run `activity-98c2f8a1721d045f53326c4b`于16:56:34完成，169/169成功，剩余0。加上原始记录复用133位，当前302/302位已有新规则基线，共15030条最新作品统计样本（每位上限60，列表不足时实际条数较少）。

从每份原始页重算v2结果、页序/归属/样本去重均通过；两库integrity_check/foreign_key_check通过。旧302位任务、原始快照、星标/批注/人工权重及其他原始历史保留，视频95/兴趣5、主库及其他非任务表与补采前备份一致。不得把15030解释成302×60，也不将分类准确率宣称为人工验收100%。

## 后续修复方向

连接丢失与可见安全验证/HTTP拒绝分开处理：对本页仍存在、主页身份不变、没有挑战或访问拒绝的连接故障，仅允许有限次数的重新附加/核验；尊重原5～10秒与批间3～5分钟节流，不绕过安全页面，不无限重试。已200确认的页尽量复用，不无条件重新请求全部页。页面导航则重新验证对应主页就绪和计数，不能把另一页面计数写入本博主。连续失败或出现验证码、401/403/429、身份异常仍停止并显示精确原因。

本轮只定位原因，未实现上述恢复策略，也未屏蔽/修改平台脚本、协议导航、浏览器安全策略或其他扩展。暂存诊断模块已删除，installed background字节与仓库相同；扩展重新加载后online/ready、原已完成任务不变。

## 证据

本地目录 `local-data/activity-interruption-audit-20261014/`：

- `events.json`：两轮8段run及6次失败完整诊断（去掉截图正文）；6个`activity-*.jpg`为原失败截图。
- `summary.json`：逐次时间、错误、连接事件、特殊协议到detach延迟。
- `passive-probe-result.json`、`trigger-verification.json`：投研小余单主页被动观察及4ms验证。只保存协议/主机/路径，不保存query、headers/cookies或响应正文。
- `local-control-result.json`：空白页对照及特殊协议触发的1ms断开，平台请求0。
- `restore-verification.json`：临时模块移除、installed background还原、正式规则未变。
- 完成状态见`local-data/activity-count-baseline-20261014/interruption-investigation-status.json`；统计重算与保留见同目录`retention-and-statistics-audit.json`。

相关实现：`browser-connector/following-extension/creator-activity-diagnostics.js`的`traceActivityCommands`；`creator-activity-runner.js`的`active`、`prepareAuthor`及最外层catch；`src/main/creatorActivityService.ts`的blocked状态处理。
