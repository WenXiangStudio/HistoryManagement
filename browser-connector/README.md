# Signal Desk 抖音只读连接器

连接器只负责把当前 Chrome/Edge 登录状态下公开可见的关注、作品和评论交给本机 Signal Desk。它不会导出 Cookie、密码、Bearer Token 或签名请求头。

## 稳定目录安装

正式安装器会自动部署连接器并注册 Chrome；Edge 仅在明确需要时通过 `install.ps1 -Browser Edge` 单独注册。源码开发环境先生成轻量控制台 Host（安装包内已经自带）：

```powershell
.\build-native-host.ps1
```

然后在 PowerShell 运行：

```powershell
.\install.ps1 -Browser Chrome
```

脚本把扩展和 Native Host 复制到：

```text
%LOCALAPPDATA%\Signal Desk\BrowserConnector
```

打开 `chrome://extensions` 或 `edge://extensions`，启用开发者模式，选择“加载未打包的扩展程序”（不要选择“打包扩展程序”），加载稳定目录中的 `extension` 子目录。扩展固定 ID 为 `fejndacdabkgahmfpfjaghhedbdehonh`。

安装脚本会把随应用提供的 `SignalDesk.NativeHost.exe` 部署到同一稳定目录，注册为当前用户专用的 Native Messaging Host，并只允许固定扩展 ID 连接。授权清单位于 `%LOCALAPPDATA%\Signal Desk\NativeMessagingHosts\com.signaldesk.bridge.json`；应用主程序即使安装在可移动盘，Chrome 启动和应用覆盖升级也不会再让扩展源目录或 Host 短暂消失。Host 仅负责标准输入输出与本机 HTTP 代理，不持有业务数据；Windows 11 内置的 .NET Framework 4.x 即可运行，不需要 Node、Python 或 .NET SDK。调试自定义 Host 时可增加 `-HostExe 'D:\path\SignalDesk.NativeHost.exe'`。卸载注册项和连接清单可运行 `uninstall.ps1`，业务数据和稳定目录中的部署文件会保留。

连接器 `0.1.6` 支持抖音本人主页顶部“关注数量”打开的关系弹窗。任务首次导航到本人主页后，如果弹窗尚未打开，会进入“需要操作”并保持零入库；用户打开弹窗、确认“关注（数量）”页签处于活动状态后，可在任务中心恢复。恢复不会再次刷新同一页面或关闭弹窗。候选必须同时位于唯一的 `data-e2e="user-fans-container"` 可见容器中，并在所属记录内具有“已关注”或“相互关注”关系标记；粉丝页签、背景作品区和其他任意用户链接不会被采集。

连接器 `0.1.6` 还依据真实抖音作品页 DOM 收紧了评论采集：只从唯一可见的 `data-e2e="comment-list"` / `comment-mainContent` 容器读取精确的 `data-e2e="comment-item"`，要求每条记录同时具有 `comment-item-info-wrap` 公开作者信息和相邻正文节点，并向桌面端提交与目标作品和评论清单绑定的来源证明。评论按钮、输入框、数量、纯数字正文、全局类名模糊匹配和缺少作者结构的候选会安全拒绝，不会入库。

R0～R4（2026-09-06）已经加入通用只读 Network Observer、关注列表离线适配器，以及 `/aweme/post/` 作品列表、`/aweme/detail/` 独立详情复核、statistics 白名单投影和 v2 作品入库门禁。扩展现在先通过 `chrome.debugger` attach 并启用 Network，再导航或触发页面；Observer 只处理允许 host 上的 GET Fetch/XHR 成功 JSON，使用 path + schema 双分类，内存有固定上限，只输出白名单投影和 SHA-256，随后 detach 并清空。当前仍处于离线合成验证阶段：生产连接器尚未把 Observer 投影转换为 v2 following/works envelope，R5 评论业务适配器也尚未实现；旧 DOM-only 关注或作品结果会被桌面端拒绝，`0.2.3/0.2.4` 已永久退役，不能据此恢复真实采集，也不能把本轮结果称为 E3/E4 验收。

## 安全边界

- Host 只读取当前用户 `%APPDATA%\Signal Desk\bridge.json` 中的临时回环地址和会话密钥。
- 桌面端每次启动都会生成新的随机密钥，只监听 `127.0.0.1`。
- 扩展只声明抖音域名，不包含发布、点赞、关注、私信或账号设置操作。
- `debugger` 权限只用于上述 bounded Network Observer；不持久化原始 response、完整 URL、query、headers、Cookie 或签名值。
- 登录失效、验证码、安全验证或频控会使任务暂停，连接器不会尝试绕过。
