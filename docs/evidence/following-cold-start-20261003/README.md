# APP / Chrome 完全关闭后启动连接器的修复证据

原失败：APP 准备超时且 Chrome 进程为 0。真实启动原参数 `--no-startup-window` 289.9ms 即 exit 0；8 秒后仍无 Chrome。改用所选 profile 的账号窗口后，扩展和账号 API 真实准备成功。仅替换自动启动方式，不改变账号配置、身份校验或累计入库。

最终原入口实测：APP 和 Chrome 都为 0 后启动 APP，窗口可用约 630.0ms，完整 ready+按钮可用约 **3840.1ms**。准备服务 3347.0ms，API 549.0ms，两个 GET，无 DOM 查询、点击或刷新。新版扩展 0.5.2 确已重新加载；报告 backgroundStart=true / backgroundWindowState=minimized。Windows API 同时确认账号窗口最小化且不在前台。以上数字属于启动准备，不属于采集总耗时。

原 160 位和所有星标、批注、历史 run 及报告逐行不变，integrity=ok、外键错误 0。本轮没有新增采集。TypeScript、build、package、renderer smoke 通过。没有实际重启电脑或切换另一真实账号/profile。

用户随后确认当前测试通过，但明确保留整机重启结论：后台进程消失、工作区临时调试内容清理后的启动/同步仍需重启电脑验证。本轮3.84秒结果只覆盖APP与浏览器关闭后重开，不能扩展为整机重启验收。工作区目前只留现用包，详见 [整理记录](../workspace-cleanup-20261003/README.md)。

- [原启动命令退出与实际恢复证明](artifacts/browser-launch-probe.json)
- [最终启动与按钮观察](artifacts/final-verified/cold-start.json)
- [最终原生身份与接口证明](artifacts/final-verified/preparation.json)
- [Windows 窗口状态](artifacts/final-verified/browser-windows.json)
- [原目录四表逐行对比](artifacts/database-audit.json)
- 生产构建与打包均成功，重复开发日志已清理，验收事实保留在本页及启动观察JSON。
- [打包界面验证](artifacts/renderer-smoke.txt)

启动观察脚本 `scripts/verify-following-cold-start.mjs` 只观察 prepare、按钮和已有资料，不点击同步；运行前要求 APP/Chrome 已关闭。其计时从操作脚本发起 APP 启动开始，包含启动调用与轮询采样误差，不应宣称为固定的产品性能承诺。
