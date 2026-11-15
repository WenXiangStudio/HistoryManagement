# 研究报告输出额度调整：APP 0.1.39

用户反馈今日收件箱中《为啥无论国家怎么印钱，钱都落不到年轻人手里呢？》（7691314015724686635）及《未来12个月，普通投资人要关注的科技资产信号！…》（7693961457989324095）显示研究报告未完成，并要求放宽 APP 的限制。

只读核对正式数据库与两份原始模型响应：两条豆包正文均已完成，分别为 2,544 和 4,850 字符；GLM 请求均 HTTP 200、模型身份正确，completion_tokens 均 12,000，finish_reason 均 length，content 均为空，reasoning_content 分别为 29,544 和 27,277 字符。报告失败时间为北京时间 2026-10-14 10:50:45 和 10:48:10。APP 原请求写死 max_tokens=12000，完整性门拒绝不完整回答，因此没有研究报告入库。

官方 [Rate Limits](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation) 定义 TPM 为每分钟最多允许的 token 数，是账户级、逐模型的服务端额度；20 万 TPM 不能直接当作单次最大输出。官方[文本生成指南](https://docs.siliconflow.cn/docs/userguide/capabilities/text-generation)区分 max_tokens 与上下文窗口，建议预留输入空间，并在输出截断时增加合适的输出额度和客户端等待时间。官方[推理模型指南](https://docs.siliconflow.cn/docs/userguide/capabilities/reasoning)说明除 Qwen3 外，thinking_budget 可能不能强制终止思考。本文未据此声明 GLM 最大单次输出为 65,536，也未确认当前账户实际 TPM。

本次将研究报告的单次 max_tokens 从 12,000 提高到 65,536，客户端超时从 240 秒提高到 900 秒。模型、完整正文、提示词及 enable_thinking 参数沿用原流程，未额外设置思考预算。原始回执增加本次输出额度及等待参数。模型不符、长度截断、空回答分别解释，正文哈希、严格 JSON 和逐字原文引用校验继续执行；不把思考内容当报告入库，不接收 length 响应。

相关 4 组 14 项测试通过，新增 4 项覆盖长报告完整保存、长度截断原因与回执脱敏、模型身份／空正文／原文引用门，以及超过旧 4 分钟等待时仍可由用户即时取消。TypeScript、编译、打包及 packaged-renderer 启动／IPC 冒烟通过。长报告测试使用模拟响应，未发起新的付费模型调用，未重跑两条报告。

实际安装包核对 max_tokens=65536、timeout=900000 的常量与请求引用通过；原程序与两库先备份，再正常关闭并更新日常路径。日常 APP 已正常启动至 0.1.39，无调试端口，收件箱入口与 302 位博主可见；连接 online/ready，任务空闲。两库原表逐行散列全部一致，95 条视频、5 条兴趣选择、已完成正文、博主星标批注、凭据、runtime 与账号配置完整保留，数据库完整性及外键检查通过。原失败报告状态保留，用户可在详情点击“继续生成研究报告”，复用已有正文并使用新额度。

两库、旧程序备份、打包常量核对、日常 UI 与保留审计位于 `local-data/research-limits-20261014/`。官方页面与提取文本保存于 `local-data/siliconflow-*-20261014.*`。
