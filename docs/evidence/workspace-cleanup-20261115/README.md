# 工作区整理与 GitHub 提交（2026-11-15）

用户要求整理工作区并推送项目；不存在 GitHub 仓库时停止。本次已验证既有远端 `git@github.com:WenXiangStudio/HistoryManagement.git` 可访问，沿用 `origin/main`，整理前本地与远端均为 `bd107a15309eeba9ae8f1ecaef227865b5381bbb`。

将35个历史打包目录和空的 `.analysis` 目录移至本机 `local-data/archive/release-builds-20261115/`。历史包共5,750个文件、20,848,161,003字节（约19.42 GiB），每个目录的文件数量、体积和应用 EXE／ASAR 哈希均已核对。采用可恢复的本机归档，移动未释放磁盘空间。根目录保留日常程序 `release-following-background-final/win-unpacked/Signal Desk.exe`、开发依赖、模型和运行时目录。

整理前保存了全部1,170个候选项目文件的本机快照和 SHA256 清单，以及既有改动的 Git 补丁。提交范围包括累积的博主基线与恢复、兴趣标记、视频工坊、云端服务相关源码、测试、维护文档和审阅证据。补齐 `.env.*`、各层 Python 虚拟环境和缓存的忽略规则，保留 `.env.example`／`.env.sample` 示例入口。

历史模型输出中的 Markdown 行尾换行和冻结源码模板按原样保留，通过限定路径的 `.gitattributes` 标明其空白规则；维护中的三个文件只移除了文件末尾多余空行。

正式资料位于工作区外的 `%LOCALAPPDATA%/SignalDeskFollowingReview`。两份数据库 `following-directory.sqlite`、`signal-desk.sqlite` 及账号设置 `following-settings.json` 的整理前后 SHA256 一致。本次整理与检查不触发正式采集、模型处理或飞书同步，已有博主、星标、批注与账号资料由原数据库继续保存。

待提交文件没有超过5 MiB的单文件。凭据格式扫描命中27处，经源码和样本上下文逐项复核均为测试断言或合成值；JSON凭据字段复核和浏览器会话参数复核同样只命中合成测试。数据库、凭据、原始运行配置、下载媒体、依赖及打包产物继续留在 Git 忽略区。

本次离线验证通过：

- TypeScript：`npx tsc --noEmit`。
- 应用测试：`npm test`，91组869项。
- 连接器及原型离线测试：31个Node测试文件198项，另有 `test-following-extension.mjs` 8项，共206项。
- Python工作器：`npm run test:worker`，7项。
- Native Messaging：编译、离线消息与代理、稳定扩展身份及隔离安装清单检查。
- 项目边界：`npm run test:project-boundaries`。
- 生产构建：`npm run build`。
- Markdown本地链接核对与 `git diff --check`。

`npm run check` 包含的既有 R8 正式作品／评论前置门禁仍按原设计关闭；本次通过的离线验证不改变该验收边界。未将本机历史包或安装器作为 GitHub Release 发布。最终提交 SHA、推送成功和远端一致性以实际 Git 结果为准。

- [历史包归档清单](cleanup-manifest.json)
- [正式数据保留核对](data-preservation.json)
- [验证结果](validation.json)

完整源码快照、Git补丁、逐文件哈希、归档复核、测试日志和凭据候选复核保存在忽略提交的 `local-data/workspace-cleanup-20261115/`。
