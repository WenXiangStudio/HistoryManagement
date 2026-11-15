# 仅用户原始提示词：两模型重做完成

2026-10-12，用户明确禁止代理加入任何非用户指定的提示词/指令，要求重做同素材。此要求优先于此前代理提出的提示词设计建议；后续不得自行新增system/developer角色、审核/格式/检索/纠错要求或其他模型指令。

已对硅基流动 `zai-org/GLM-5.3-Flash`、`deepseek-ai/DeepSeek-V4-Flash` 各请求1次。两者每次仅一条user消息：原始479字人工验收豆包转写＋两个换行＋用户此前三项提示词。无system/developer/assistant历史、额外指令字段、外部资料或旧模型答案；除model字段不同，body其余内容及参数一致。

实际发送的全部文本、消息和请求JSON可直接核对。见[本轮结果与记录](../../../evidence/siliconflow-text-user-prompt-only-20261012/README.md)、[GLM原始回答](../../../evidence/siliconflow-text-user-prompt-only-20261012/glm-output.txt)、[DeepSeek原始回答](../../../evidence/siliconflow-text-user-prompt-only-20261012/deepseek-output.txt)、[左右并排](../../../evidence/siliconflow-text-user-prompt-only-20261012/review.html)。原始正文未经编辑，不新增评判或复用上轮自加格式规则。

GLM24.223秒，首正文12.066秒，1960字符；输入346/输出2183含思考1025/总2529。DeepSeek147.881秒，首正文118.940秒，1790字符；输入325/输出1057/思考0/总1382。均200、stop、DONE，本轮2次总3911 token。DeepSeek等待响应头118.932秒，没有服务端证据解释原因，不断言排队或纯推理耗时。

两者参数一致：max_tokens16384、thinking_budget1024、enable_thinking false、temperature0、stream true/include_usage。GLM实际仍有1025思考。独立实验程序全程172.611秒；未在APP任务按钮运行，无APP点击展示全程计时，结果未入正式视频摘要或视频详情。

输入全文SHA256 `b0e4a8f355ece529bfee8232e99bb7c297734086990a767d26db19c308a3c47c`；消息SHA256 `9b6ab9806aab31856514d587dc86caccdbea673273860969e03b74adfe3fbcb9`。原文哈希仍`316798ba2ceeccd1901a7f2963c78a2dc1b26da810942c3be2c5bd4fbb95c5f3`。

工具为 `scripts/run-siliconflow-user-prompt-only.cjs` 与只读 `scripts/export-siliconflow-user-prompt-only.mjs`。本机 `local-data/siliconflow-text-user-prompt-only-20261012/` 保留一次请求标记、全文SSE、逐块时间线、请求/报告/正文/思考、前后审计及脚本快照。不得删除标记重发，无自动重试。

两库53表、当前方案、凭据、runtime、APP包前后不变；日常APP0.1.25/PID22008普通启动无调试端口、online/ready，仍DeepSeek模型3。无APP产品修改、打包部署、ASR、抽帧/看图、本地模型或检索服务。未加禁止联网指令，也未提供搜索工具。等待用户审阅和下一步，不继续付费调用。
