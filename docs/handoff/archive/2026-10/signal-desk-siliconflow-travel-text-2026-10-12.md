# 旅行素材：GLM / DeepSeek 三项文本实验

2026-10-12，用户指定《纯主观｜旅行为何会改变一个人的一生？》，要求硅基流动两模型处理转写文案，沿用三项要求、仅删除第三项“可能相关事件”。禁止代理添加额外提示词的约束继续有效。

**后续用户反馈：** 用户审阅后认为“GLM-5.3-Flash 效果还行，理解更充分”，已在[实测报告与反馈记录](../../../evidence/siliconflow-travel-text-20261012/README.md)保存。评价针对这条素材；未宣布全局文本模型最终选型，不切换APP当前DeepSeek配置。用户要求先记录，接下来由其总结；当前等待用户总结，无新模型请求或产品操作。

已找到画画的Lorenzo🎨作品 `7693007317557726505`，约3分25秒。读取APP保存的faster-whisper small转写，125段/947原文字符；只以换行连接各段，含换行1071字符，未纠错或加标点。这份素材尚无人工100%验收记录，不能沿用数学/OpenAI素材的豆包100%结论；本轮未重新转写或调用本地模型。

两模型各请求1次，均HTTP200、stop、DONE。每个请求只有1条user消息，内容为完整转写＋两个换行＋用户原提示词。第三项改为“根据文案内容和分析，推理推测此段文本内容涉及的领域；”，其余保持原样。无system/developer/assistant历史、额外格式/纠错/核实/检索指令、标题或其他模型答案输入。两款除model字段外，body一致。

结果：[本轮记录与输入全文](../../../evidence/siliconflow-travel-text-20261012/README.md)、[GLM全文](../../../evidence/siliconflow-travel-text-20261012/glm-output.txt)、[DeepSeek全文](../../../evidence/siliconflow-travel-text-20261012/deepseek-output.txt)、[左右并排页面](../../../evidence/siliconflow-travel-text-20261012/review.html)。正文未经编辑，未另做质量评分。

GLM21.463秒、首正文8.623秒、2473字符；输入670/输出2443含思考1025/总3113。DeepSeek32.884秒、首正文7.130秒、1634字符；输入652/输出923/思考0/总1575。本轮2次合计4688 token，输入1322/输出3366含思考1025。独立实验程序全程54.871秒；没有APP点击展示的产品全程计时。未提供单价或账单，不估费用。

参数沿用上轮，两者temperature0、max_tokens16384、enable_thinking false、thinking_budget1024、stream true/include_usage；本轮没有另外启用思考。纯文案SHA256 `8857306fd0e5fe65eb9f72126cbe8fcb11fc4587141ccb510db6221887979e02`，实际全部输入SHA256 `b42a35fb9e87e3ef4c90418090e59cbad7225b4f486cfaefd8b40b6957403909`；两模型消息SHA256 `fef3d13ec9a82e59d042c1087f033356d1f3bdcf8820b889775995b00ff7f05e`。

本机 `local-data/siliconflow-travel-text-20261012/` 保留源JSON、来源核对、原文/提示词/完整输入、每次请求/原始SSE/正文/思考/usage、逐块时间线、一次请求标记、两库前后审计及脚本快照。工具 `scripts/run-siliconflow-travel-text.cjs`、只读导出 `scripts/export-siliconflow-travel-text.mjs`。无自动重发，不删除标记后重跑。

两库53表、方案/当前选择、加密凭据、runtime、APP包前后不变。APP仍0.1.25/PID22008普通单实例、无调试端口、online/ready、使用DeepSeek模型3。结果保存在项目文件，未写APP详情或正式摘要，无产品修改/部署、音视频/图像/本地推理/检索服务。本轮结束后等待用户审阅。
