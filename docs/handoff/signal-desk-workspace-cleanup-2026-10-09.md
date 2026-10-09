# 项目清理、回归与Git提交（2026-10-09）

用户要求清理无关、过期及不再使用的文件和内容，然后提交并推送GitHub。本轮保留已实现的博主频率、异常补齐、数据库/图表、飞书与性能改动，将此前尚未提交的完整功能和本次整理一并纳入提交。

## 清理结果

- 删除255项重复或过期构建/临时目录，共72,683个文件，逻辑大小30.57GiB。包含历史asar、重复exe/FFmpeg、解包stage、已完成的隔离验证profile，以及旧`release/`、`release-stable-20261005/`。
- 单独保留日常`release-following-background-final/`，桌面快捷方式与用户资料目录不变。
- 剩余2,777份必要原始捕获、数据库备份、故障截图及复现资料合并为本机ZIP：原约929MiB，压缩后约144MiB；逐项验证长度和SHA256后才移除散落副本。归档路径及完整索引只留本机，不进入Git。
- 两步记录的磁盘可用空间净增加约24.98GiB；删除文件逻辑大小较大，是因为部分旧二进制共享硬链接。
- 38份按日期的交接报告移至`docs/handoff/archive/2026-10/`，调整相对链接并重建索引。当前首页只保留最新规则、入口和实际边界。
- 重写README与当前架构说明，移除旧三档、旧本周配色、过期任务及发布包说明；飞书字段文档同步四档名称。
- 移除两份已失效的旧界面验收工具：`verify-creator-activity-sections.mjs`、`verify-creator-card-layout.mjs`；移除未再被产品调用的旧今日/本周/暂无更新分组函数及对应旧断言。仍使用的北京时间与周统计投影函数和测试保留。
- 保留仍被打包、隔离入口及回归引用的`poc/r8`、协议合同和诊断工具。历史报告保留事实，不能作为当前操作要求。
- 验证结束后再次清除可重建的`out/`和本轮Python缓存。依赖目录与日常包仍为本机开发/运行所需，保持Git忽略。

Windows所有递归删除均先核对绝对路径落在明确的工作区目标内，排除当前运行包、用户目录及重解析点；未使用`git clean -fdx`，未重置任何未提交功能。

## 数据和运行保留

清理前一致性备份当前两份日常数据库，记录各表每行的SHA256以及设置、exe、asar、桌面快捷方式哈希。清理后全部一致，数据库完整性ok、外键异常0。未启动真实平台采集、修改日常权重或调用外部同步写入。

删去无人调用的旧分组函数后重新构建，600份产物逐字节与已部署日常asar一致，证明这项源码清理没有改变已部署运行行为。

本机资料位置见`local-data/README.md`。旧报告的原始`local-data/...`路径，除已明确淘汰的生成物外，可在本机归档中按原相对路径查找。当前恢复备份留在`local-data/workspace-cleanup-20261009/recovery/`。

## 提交前验证

- TypeScript检查通过。
- 全部46组应用测试437项通过。清理前443项同样通过，减少的6项仅断言已删除的旧三区分组，当前四档/30天规则、异常、保留与界面测试仍在。
- 浏览器状态读取、异常连续性、关注流程及计划测试109项通过。
- Python工作器2项通过；Native Messaging、manifest、连接器content/background、网络观察器、phase-b及R8隔离harness检查通过。
- 项目边界检查、构建、原日常包renderer冒烟和600文件构建一致性检查通过。
- 正式作品/评论的`check:r8-prerequisites`仍因既有四项缺口退出1：uid/sec_uid未独立绑定、逐候选作品导航、生产链路未接有界主页采集、生产命令缺少独立作者sec_uid。功能门继续关闭，未放宽检查；不能将整条`npm run check`表述为通过。
- 提交候选中不包含数据库、运行令牌、凭据或本机归档；凭据扫描命中仅为测试专用假值。文档本地链接与Git差异空白检查通过。

验证及清理摘要：[validation.json](../evidence/workspace-cleanup-20261009/validation.json)、[cleanup-manifest.json](../evidence/workspace-cleanup-20261009/cleanup-manifest.json)、[data-preservation.json](../evidence/workspace-cleanup-20261009/data-preservation.json)。

## Git目标

沿用`origin`：`git@github.com:WenXiangStudio/HistoryManagement.git`，分支`main`。正常快进推送，不强推；最终提交SHA、远端一致性和工作树状态以实际Git结果及本轮最终回复为准。
