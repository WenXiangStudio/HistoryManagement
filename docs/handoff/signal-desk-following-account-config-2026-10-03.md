# Signal Desk 账号与浏览器配置最新交接（2026-10-03）

后续最新交接：[浏览器完全关闭后的启动修复，扩展0.5.2](signal-desk-following-cold-start-2026-10-03.md)。以下保留本轮账号配置完成时的历史状态。

最新入口，接续 [无DOM结构化通路](signal-desk-following-structured-2026-10-03.md)。用户认为账号/连接器相关参数应在APP配置，方便更换登录账号；本轮已新增真实设置页、原生账号绑定/选择以及Chrome profile对应连接器隔离。

## 当前入口与数据

原入口 `release-following-background-final\win-unpacked\Signal Desk.exe` 已完整更新；另留 `release-following-account-config-final`。Profile仍 `C:\Users\Administrator\AppData\Local\SignalDeskFollowingReview`，扩展 **0.5.1** 已重载，ID/目录不变。当前APP原入口已重开、自动准备通过、设置页“关注账号与浏览器”置前。

产品库仍 **160 位**，本轮没有新采集run、没有新增博主；原四个目录表及所有作者字段、星标、批注、历史报告逐行不变。只扩展账号元数据表，现账号 无限♾️进步绑定Default并保存160位显示。正式业务库/standalone历史40位不参与。

## 配置与切换行为

- 固定代码的是平台公共API path；账号owner身份由self/following响应读取，并未硬编码用户。账号设置不应让用户手填Cookie/Token、NativeHost地址或扩展ID。
- 设置页选择Chrome用户配置（显示名字、Default/Profile N和扩展安装状态）、修改本地账号备注，保存后作为启动/登录/连接目标。
- 已保存账号下拉按明确选中的原生sec_uid列出各自资料数量；切换锁定同步并重新验证浏览器账号。没资料的新账号显示空目录，不能回退显示最近其他账号；原账号可以切回，库内资料不删除。
- 绑定新账号：保存profile→在该Chrome配置登录目标抖音账号→APP填写备注和可选具体主页链接→“读取并绑定当前登录账号”。主页链接只作目标核对，原生uid/sec_uid从接口读取。绑定只通过prepare、不产生作者报告；失败可取消绑定，当前目录及旧账号保留。昵称相同也按sec_uid分开。
- 浏览器切换到未绑定profile时一次打开该profile连接页；若该profile未安装扩展，页面提供现扩展目录与加载说明。每个profile的扩展产生并保存独立connectorId，APP记住profile→connectorId，只接受所选profile连接；其他profile不能抢准备任务。一次连接页面nonce确认后，后续直接自动重连，不需每轮配置页。
- 账号备注不影响身份匹配；平台昵称由接口更新；账号绑定优先sec_uid，不用备注/昵称作为新账号边界。原legacy_label保留旧目录来源，只有第一原账号可继承原显示名历史，后续同名新owner没有legacy自动继承。
- `following-settings.json` 保存profile/activeOwnerSecUid/各profile的连接器ID，不存登录凭证。APP重启恢复这些配置并启动准备。账号及浏览器选择变更不允许在活跃采集里执行。

## 已验证与边界

当前真实账号已验证备注保存再恢复、具体主页链接目标核对、重新绑定、ready解锁、APP原入口重开配置持续有效。原160位IPC记录及原目录表精确一致。未使用用户未提供的另一个真实登录账号；多账号同名/共享博主/独立星标批注通过临时库验证，其他Chrome profile安装/enroll逻辑尚无第二真实profile验收。不要宣称跨真实账号或跨profile实测已完成。

相关检查13项：目录9、结构化受理/同名账号隔离3、配置持久化1；TypeScript、构建及最终打包界面通过；真实设置页截图视觉核对通过。没有新增采集或全项目/媒体/云回归。最新证据 [账号配置](../evidence/following-account-config-20261003/README.md)。

源码 `followingPreferences.ts`、`followingSync.ts`、`followingDirectoryStore.ts`，shared配置类型、IPC/preload及App设置卡，关注background connectorId和setup-content enroll，版本followingConnection/manifest 0.5.1。目录依旧使用原事务/字段来源/头像回执，无DOM定位路径保持不变。代码/证据未提交推送，未发布安装器；作品/评论能力门false。
