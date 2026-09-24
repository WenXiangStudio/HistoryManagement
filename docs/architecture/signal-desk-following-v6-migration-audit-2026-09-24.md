# 关注目录 v6 迁移草案与回滚审计

> 2026-09-24。仅供隔离库审查；没有加入 `src/main/schema.ts` 的正式迁移列表，不能对 `%APPDATA%/Signal Desk` 执行。

## 目标模型

草案 SQL 在 [`poc/r8/following-schema-v6-draft.mjs`](../../poc/r8/following-schema-v6-draft.mjs)。现有 `creators.platform_creator_id` 保持原义，新增独立 `sec_uid`、身份验证时间与来源。`owner_accounts` 增加经浏览器确认的 `platform_sec_uid`、验证时间与来源。关注状态移到 `creator_owner_relationships`，同一公开作者可以属于多个 owner，各自独立记录 `active`、`stale`、`unfollowed` 或 `identity_conflict`、首次发现时间、最近验证时间和最后一次完整刷新 ID。新版检查点另表保存 owner、目标、适配器版本、分页状态及安全的游标类别；旧 `collection_checkpoints` 原样保留供历史审计。

旧作者行的 `sec_uid` 和身份验证字段在升级后保持 `NULL`，不创建新关注关系。旧主页 URL、昵称和 `platform_creator_id` 不足以证明 `uid/sec_uid` 配对。正式运行只能把后续结构化关注响应独立验证的配对升级为可同步目录项；同一 `uid` 或 `sec_uid` 与已验证配对冲突时进入待核对状态，不自动合并。

正式应用切换时，作者列表、关注数量和任务选择必须从当前 owner 的 `creator_owner_relationships` 读取；旧 `creators.is_following` 只保留为历史字段，不能继续代表今天的关注状态。正式作品写入也须先核对 `creators.sec_uid` 与任务目标，不能通过旧 URL 猜测并补全。

## 迁移前置核验

1. T2 六作品结构化结果及人工 shadow 对照通过；T3 20～30 作品、第二轮已保存作者直达、新关注自动发现和完整快照取关均通过。保留原生 ID、来源摘要、真实请求数、耗时及安全报告。
2. 正式数据库完整备份与备份校验单独批准。只读确认 `PRAGMA user_version=5`、`PRAGMA integrity_check`、`PRAGMA foreign_key_check`、owner/作者/作品/评论/任务/检查点行数，以及活跃任务状态。记录数据库文件与 WAL/SHM 状态和恢复演练位置。
3. 审核 SQL 与应用代码的同一版本。正式迁移必须在单一事务中执行，迁移后重复完整性、外键、行数、旧行 `NULL` 身份、新表空关系、唯一索引及代表性历史记录核验；随后才允许受控导入真实已验证目录。

## 回滚与能力门

若 SQL、校验、导入或生产合同切换失败，停止采集与写入，保留失败 run 和诊断；使用迁移前**完整备份**恢复数据库，并复核 user_version、完整性、外键和行数。不把不可逆的 schema 降级 SQL 当成回滚。生产同步能力门在正式迁移和独立验收批准之前保持关闭；本草案没有修改该开关。

隔离测试 [`src/main/followingSchemaV6Draft.test.ts`](../../src/main/followingSchemaV6Draft.test.ts) 以临时内存 v5 库验证旧行待核对、owner 隔离、任务保留及外键完整性。它不能替代正式库备份与迁移后核验。
