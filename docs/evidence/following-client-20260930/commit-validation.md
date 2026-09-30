# 提交前核验 · 2026-09-30

用户授权整理合适的内容提交并推送。第一次检查发现 `followingDirectoryStore.test.ts` 的表清单断言未更新，主测试 213 项通过、1 项失败；当时未暂存、提交或推送。用户随后明确授权修正测试，通过后继续提交推送。

## 修正

目录初始化包含网络与可见页面两条资料路径，共四张目录表；测试原先只列出两张。更新断言以涵盖全部目录表，并补充三项可见目录行为检查：

1. 按不同顺序保存十位作者，关闭并重开真实 SQLite 文件后，头像、主页和昵称仍对应同一位作者，顺序正确。
2. 最新可见 run 可被列表读取、搜索和编辑；旧 run 的批注不误带到新 run，原生 uid 未取得时不伪造。
3. 主页归属不一致、头像被篡改导致 hash 不匹配、同 run 不同报告均不改动已保存资料。

## 实际执行结果

| 检查 | 结果 |
|---|---|
| `npm test` | 22 个文件、217 项通过；退出码 0 |
| `npx tsc --noEmit` | 通过；退出码 0 |
| `node --test scripts/test-following-extension.mjs` | 原网络 runner 模拟 8 项通过；退出码 0 |
| `npm run test:r8-harness` | 28 项通过；退出码 0 |
| `npm run test:project-boundaries` | 通过；退出码 0 |
| `npm run build` | 当前源码构建通过；退出码 0 |
| 本地 Electron 打包至 `release-commit-review` | 通过；退出码 0 |
| `node scripts/test-packaged-renderer.mjs 'release-commit-review/win-unpacked/Signal Desk.exe'` | preload、renderer、IPC、隔离结果接收、关注入口、正式作品门禁及原有功能通过；退出码 0 |
| 原十位作者 SQLite 只读回读 | 10 条、10 个头像，与 Chrome 归属记录逐项一致；完整性 `ok` |
| `git diff --check` | 通过 |

上述检查没有启动新的抖音采集。原扩展自动关注流程仍未真实验收；生产作品连接器已知缺口和生产能力关闭状态均保留，未删除相关先决条件检查。

## 提交范围

纳入项目规则、独立关注/作品/评论任务边界、可见目录与 APP 展示、R8 隔离试跑接线、桌面采集及准确头像绑定脚本、相关测试、交接文档和可复核的 JSON/HTML/截图证据。

本机 SQLite、构建输出、缓存和外部辅助系统的待同步报告不纳入 Git；这些文件留在本机，实际数据库仍需单独备份。
