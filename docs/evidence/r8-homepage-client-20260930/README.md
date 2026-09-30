# R8 客户端隔离真实单作品试跑证据

运行 ID：`r8-homepage-client-20260930065027-7ce58f08`。执行于 2026-09-30 14:52（北京时间）。目标来自此前已验证的隔离作者目录：作者“AI，我俩和一百万”，公开 `uid=7606571592415511601`，独立 `sec_uid=MS4wLjABAAAALN2m1ZOlREINNiPMLT__94ERrkgQFup9W5rheGFwoKB9hBiUlFOyez0hL63bwwUs`。

## 实际结果

- 扩展报告为 `verified`。主页显示 6 个作品候选，仅作品 `7662218043044416811` 同时取得页面自然加载的作者作品列表和作品详情响应；两处原生作品 ID 以及 `author.uid`、`author.sec_uid` 与目录目标一致。
- 最多 3 次页面导航，本轮实际为 3 次；扩展主动 API 请求 0 次。整个运行约 16 秒。页面本身仍会按正常行为发出网络请求，0 次仅表示扩展未主动补发接口 GET。
- 用户在保留的作品页人工确认了 URL `/video/7662218043044416811`、作者名称和标题三项均与报告一致。此反馈来自本轮对话；没有把人工核对伪装成自动断言。
- 客户端临时 schema v6 库中恰好写入 1 个作品、1 条双来源证明和 `scope-limited` 检查点。作品任务 `completed`；独立关注刷新任务 `paused` 且未执行。评论数为 0，媒体与云任务数为 0。
- 对临时库运行 `PRAGMA integrity_check` 得到 `ok`，`PRAGMA foreign_key_check` 无违规。报告与临时库的 run ID、作者双 ID、作品 ID、标题及两段投影 hash 一致。使用 [`audit-r8-client-run.mjs`](../../../scripts/audit-r8-client-run.mjs) 核验。
- Observer 另外记录 `RESPONSE_BODY_UNAVAILABLE`、`RESPONSE_TOO_LARGE`、`UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA`。这些未用于证明目标作品，当前只保留诊断码，不据此声称其它路径可用。

## 归档文件

- [`pilot-report.json`](pilot-report.json)：原始安全投影报告。
- [`manifest.json`](manifest.json)：隔离控制器生成的范围与结果摘要。
- `isolated-sync.sqlite`：通过 SQLite backup API 从本轮系统临时数据库生成的一致性副本。仓库 `.gitignore` 忽略 `.sqlite`，该文件仅在本地工作区保留。
- [`checksums.json`](checksums.json)：上述三份文件的 SHA-256；报告的 SHA-256 为 `5d81a1b2865f90ecf7be53572c42e34a0a1b2c32f698dfd34960919613165bf5`。

## 验收边界

此运行只通过了**客户端接线后的单作者单作品真实闭环与人工页面对照**。它不证明自动关注发现、多页推进、多作者、六作品 T2、评论和回复归属、T3 吞吐、正式数据库迁移或生产同步门。旧批量 T2 的 2/6 和安全验证仍保持原结论。正式 SQLite 未参与本轮 R8；生产结构化同步开关保持关闭。

这份 run 在随后任务解耦修正之前生成，临时库中那个 `paused` 关注刷新任务是真实的历史记录。修正后的单作品试跑只创建作品任务；本归档不作追溯修改。
