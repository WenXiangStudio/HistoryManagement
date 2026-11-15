# 研究与借鉴资料

本目录保存技术研究、外部工具对比及用户确认的借鉴方向。研究结论按日期和源码版本记录；待实施方案不表示产品已经具备该能力。

## 可借鉴对象总目录与专题

- [单个抖音博主深度拆解：现成Skills、工具与参考实现（2026-10-15）](creator-account-analysis-tools-and-skills-2026-10-15.md)：新增核查BrandBAI、RedFox账号分析Skill；复查ai-boshu视频画像、duyi五层拆解、XHS主页定位及CreatorHub等供数层，记录实际实现、适用部分、固定提交与未实测边界。
- [十几秒／几十秒视频分析：技术与服务范围（2026-10-15）](video-analysis-speed-and-services-2026-10-15.md)：核对豆包既有3.093秒单样本、Groq转写指标、Gemini／TwelveLabs原生视频输入、预计算与并发；区分首次素材处理、首个结果和全量完成，不把厂商阶段速度当本项目全程。
- [可借鉴项目、工具与 Skills 总目录](reference-project-catalog.md)：长期入口，收录此前讨论的 31 个具名对象及 1 个未识别分享材料占位；标明定位、历史来源、可借鉴环节与能力边界，另列本次发现的 4 个分析子 skills。
- [视频信息提取与结构化总结研究（2026-10-09）](video-information-extraction-and-summary-2026-10-09.md)：逐项分析标题/描述、互动计数、评论、口播转写、OCR 和语义总结，区分原始字段、展示文本与模型结果。
- [固定版本源码与证据索引（2026-10-09）](reference-source-index-2026-10-09.md)：可点击的固定 commit/文件链接、证据级别，以及本机插件/官方网页的核查范围。

2026-10-10 用户已确认[按环节借鉴与分阶段处理的总体方向](video-information-extraction-and-summary-2026-10-09.md#confirmed-direction)，后续按实际使用和验证结果调整。这是设计方向，尚不代表相关功能已实现。今日收件箱的时间口径已由用户撤回，仍待重新讨论；他方项目的时间窗口不作为本项目默认规则。

## CreatorHub 对比（2026-10-09）

先读[已确认共识与后续参考](creatorhub-consensus-2026-10-09.md)：本项目保持轻量、简单、适合个人初期使用的路线，按需借鉴 CreatorHub 更完整的工程设计。优先完成作品详情、评论与完整采集，稳定后再考虑后台监控。

- [功能与实现对比](creatorhub-comparison-2026-10-09.md)
- [浏览器、接口与风控复核](creatorhub-browser-risk-followup-2026-10-09.md)
- [最新关注关系与“取关”分区方案](../architecture/following-relationship-reconciliation-plan-2026-10-09.md)，待实施。

## 既有路线研究

- [社区验证的采集路线（2026-09-05）](signal-desk-community-validated-routes-2026-09-05.md)，保留当时的研究结论，使用前核对当前实现。
# 视频内容理解实施

- [本地优先技术调查（2026-10-10）](video-content-local-first-feasibility-2026-10-10.md)
- [用户确认的需求与实施清单](../architecture/video-content-triage-plan-2026-10-10.md)
