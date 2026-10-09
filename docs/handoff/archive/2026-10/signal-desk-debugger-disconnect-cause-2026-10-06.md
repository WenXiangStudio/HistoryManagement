# 作者间隔期间调试连接断开：自定义协议子框架触发（2026-10-06）

接续[混合八位验证](signal-desk-creator-refresh-mixed-eight-2026-10-06.md)。用户要求查找原因，并确认18:00前后没有操作Chrome。调查没有继续剩余6位、没有运行全库，没有改产品代码或浏览器权限。

## 结论和证据范围

已定位到可复现的触发机制：抖音账号/环境检测动态脚本创建隐藏 iframe，尝试导航到 **`bitbrowser://cc/`**。Chrome扩展调试接口将这种自定义协议视为受限地址，网页中的子框架导航触发浏览器强制断开调试会话，事件为 **`target_closed`**；父作者页和其目标ID仍可存在。下一次页面检查报 **`DEBUGGER_NOT_ATTACHED`**，runner外层将其泛化为 **`ACTIVITY_READ_FAILED`**。保存阶段标签没有随作者等待更新，导致原失败诊断仍标 `saving`，实际两位资料已成功保存。

这解释了“用户没有操作、父网页仍正常、调试会话却断开”的现象。原8位运行没有记录子框架导航URL，因此该次精确URL不是直接从原日志读取；结论基于同作者单页复现、已加载脚本静态常量解码、同版本Chromium源码与本地精确触发对照。不能说原日志已经独立捕获了 `bitbrowser://cc/`，也不能据此认定账号已被限制、可见验证码已出现或所有历史断开都同一原因。

## 排查过程形成的事实

1. 原始数据：18:00:03.315收到Chrome `target_closed`，18:00:04.126页面检查被拒绝，trace为 `DEBUGGER_NOT_ATTACHED`。此时处于第二位完成后的6.492秒作者等待，未进入第三位、未到批次边界，不在产品正常detach/remove路径。页面与截图保留。
2. 原页只读检查：主文档 `performance.timeOrigin` 仍为17:59:52.515，navigation=普通navigate、activationStart=0，断开时没有主文档刷新或预渲染激活。窗口事件和Crashpad没有对应时段崩溃记录；这仅为未找到记录，不单独证明所有进程都没有异常。
3. 新渲染进程与断开同毫秒创建曾被作为线索，但Chrome任务管理器显示作者主页面在另一进程，导航记录也未变。该线索不构成“主进程替换”的根因证据。
4. 原页只读附加10秒，调试连接稳定。普通本地网页、删除子框架、子框架跨进程切换均执行3作者完成，说明普通等待与普通子框架变化不是充分触发条件。
5. 第一轮同作者单页诊断：仅加载温义飞主页一次，没有明确作品或账号GET、不入库，约10.371秒内再次出现 `target_closed`。断开前1～4毫秒，网页的动态脚本创建新子框架并发起自定义地址特征的导航；调用栈来自公开 `async/9075.0cabca16.js` 运行的动态模板。目标ID前后完全一致，只从attached=true变false，主网页仍complete。
6. 从第一张复现页只读提取现存动态脚本。仅静态解压其字节码常量表，没有执行字节码，常量77为 `bitbrowser://cc/`，同表有 `createElement`、`iframe`、`src`、`appendChild`、`removeChild`。静态入口显示网页的 `/passport/web/challenge/` 响应提供动态模板进行环境检测。`bitbrowser`不是本机注册的协议，没有外部应用处理器。
7. 第二次同作者单页诊断25.608秒没有断开，观察到blank/srcdoc框架，未出现对应自定义协议导航。说明动态检测路径不是每次相同，也不能以短时未复现否认首次复现。

## 本地浏览器精确对照

使用实际Chrome154.0.8037.98和生产runner的本地地址副本，等待仍用3.326/6.492秒。新建合成页面，所有作者和接口位于127.0.0.1；没有触碰原故障页或日常数据库。

| 本地场景 | 结果 | 调试断开 |
|---|---|---|
| 普通页面 | 3位完成 | 无 |
| 第二页删除普通子框架 | 3位完成 | 无 |
| 普通子框架跨进程切换 | 3位完成 | 无 |
| 隐藏框架尝试file:/// | 3位完成 | 无 |
| 隐藏框架尝试chrome://version/ | 3位完成 | 无 |
| 隐藏框架导航到未注册诊断协议 | 完成2位后blocked | target_closed，父页仍存在 |
| 隐藏框架导航到bitbrowser://cc/ | 完成2位后blocked | target_closed，父页仍存在 |

两种自定义协议场景精确重现原运行的链路：父页匹配且存在 → `target_closed` → `DEBUGGER_NOT_ATTACHED` → APP概括 `ACTIVITY_READ_FAILED`，不执行第三位。没有启动外部处理器，没有调整Chrome权限或关闭安全限制。

Chromium对应版本源码链路：[协议限制](https://chromium.googlesource.com/chromium/src/+/154.0.8037.98/extensions/common/permissions/permissions_data.cc#138) → [扩展调试地址校验](https://chromium.googlesource.com/chromium/src/+/154.0.8037.98/chrome/browser/extensions/api/debugger/debugger_api.cc#818) → [页面导航导致受限会话detach](https://chromium.googlesource.com/chromium/src/+/154.0.8037.98/content/browser/devtools/render_frame_devtools_agent_host.cc#783) → [AgentHostClosed回调](https://chromium.googlesource.com/chromium/src/+/154.0.8037.98/content/browser/devtools/devtools_agent_host_impl.cc#494) → [target_closed事件](https://chromium.googlesource.com/chromium/src/+/154.0.8037.98/chrome/browser/extensions/api/debugger/debugger_api.cc#680)。用户主动取消走 `canceled_by_user`，本次不匹配。

## 后续修正方向

当前0.8.0在作者已保存后仍保持debugger连接，并在等待中每秒检查上一作者页。等待扩大了已完成网页继续运行其环境脚本的时间窗口，页面生命周期变化因此中断整个队列。

下一步应在作者结果成功保存后结束该作者的浏览器读取会话，释放debugger与已完成临时页，再执行本地等待；下一作者开启自己的受控会话。等待阶段只检查APP会话与取消，不对已经完成的上一作者继续读取。读取期间实际遇到断开、验证码、HTTP拒绝仍应停止保留，不恢复业务重试。

同时补齐独立“作者等待/批间休息”阶段、明确的连接断开错误、预期detach日志，以及父/子框架导航协议分类。不要在页面中禁用环境检测脚本、拦截其安全资源、伪造浏览器环境或放宽Chrome协议权限。本次完成原因定位，尚未实施该产品修正或验证修正后8位成功。

## 保留与交付

诊断临时文件已从部署扩展目录移除；原生产代码和manifest未变，0.8.0仍online/ready。保留原故障页及第一张真实复现页，本地合成与诊断标签已清理，Chrome任务管理器关闭，没有结束用户浏览器进程。日常APP原8位run仍blocked/done2，无继续采集。旧資料、星标、批注、配置哈希和数据库完整性核对通过。

已审阅证据：[diagnosis.json](../../../evidence/creator-debugger-disconnect-20261006/diagnosis.json)。原始浏览器事件、提取脚本、静态解码、本地对照记录与调查脚本在 `local-data/creator-debugger-disconnect-20261006`，不作为产品流程。
