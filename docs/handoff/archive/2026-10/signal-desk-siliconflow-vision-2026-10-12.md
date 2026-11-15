# 硅基流动两模型连通与云端Qwen抽帧：APP0.1.24

用户已填好两款多模态模型，指定GLM5.3Flash用于后续文本处理（本轮只测连接），Qwen3.5-4B替代本地模型处理画面；本次严禁调用本地Qwen3.5-4B，只能使用硅基流动API。用户选择《数学彻底怒openai了》作为样本。本轮已完成，并恢复普通日常启动。

## 真实完成情况

- 两个最小连接通过：`zai-org/GLM-5.3-Flash`文本HTTP200/指定标记/2.159秒；`Qwen/Qwen3.5-4B`合成纯红图片HTTP200/RED/14.358秒。GLM图片能力未实测，不声称通过；没有GLM正式文本任务。
- 日常APP新增“仅云端识别画面”独立入口，实际按钮处理作品`7694535682575860393`。原片身份/哈希检查后，FFmpeg抽取12张全时间轴代表帧，每3帧一次，共4次硅基流动Qwen请求成功。
- 输出12条文字/画面描述及原图，11帧有文字，共285字符。全文保持API原样。画面用量输入11474/输出755/思考0，总12229；本轮另有两个连接共231tokens，总12460。费用尚未核对。
- APP全程渲染确认39.629秒；本地准备1.702秒、4请求完整响应合计23.554秒、后端25.320601秒。不能将后端称全程。
- APP详情中“云端画面文字与内容”图片/文字并排，精确标注“硅基流动 · Qwen/Qwen3.5-4B”，图片可放大，时间戳与不确定项保留。12图、原文显示及1120宽度无溢出验证通过。
- 仅新增此作品visual阶段及一个云端画面batch；已有本地OCR/语音/Qwen转写/豆包结果/摘要历史保留。没有本地模型运行、音频转写或摘要。当前选中云端Qwen方案，原配置与凭据不变。
- 样本batch `content-0cbf2386-3dad-47ba-bee0-d143e9a90527`，最新完成visual行98。中间运行行97在正常重启时标interrupted不影响最新完成结果。

详见[实测报告](../../../evidence/siliconflow-vision-20261012/README.md)、[逐帧原文与图片](../../../evidence/siliconflow-vision-20261012/frame-readings.md)。画面文字准确率仍待用户人工评价；12帧抽样不能说已提取全部视频字幕或理解所有动作。不把豆包音频100%准确率迁移给视觉结果。

## 本轮实现

- `src/main/cloudFrameRecognition.ts`：严格限制硅基流动`Qwen/Qwen3.5-4B`，原片校验、12帧FFmpeg、每3图JSON读取、精确帧归属/模型/finish_reason检查、原始回执和成功缓存。请求不含旧音频/OCR文本、标题或摘要材料。
- `VideoContentService`新增provider=`cloud-frames`独立分支，在本地模型路径之前返回；没有ASR/OCR/摘要fallback。该有界入口只接受一个作品。
- `CloudFrameReadingPanel`逐帧原图、原始文字和描述，图片加载绘制后确认可用计时；`VideoInformationPage`增加按钮并保留旧能力入口。
- `scripts/probe-siliconflow-models.cjs`仅为本轮有界探测；`scripts/verify-siliconflow-vision-app.mjs`通过实际APP按钮操作；有一次性标记，不要不分析地删标记重跑。
- `scripts/audit-siliconflow-vision.mjs`检查历史表/阶段/batch、全部凭据/profile、本地配置保留；`scripts/export-siliconflow-vision-evidence.mjs`只导出已保存证据。

66组553项、TS、边界、构建、打包renderer及并排布局专项通过。候选`release-siliconflow-vision-024/win-unpacked`，原桌面入口不变，用户目录不变。备份为`local-data/siliconflow-vision-20261012/before`，包含用户已填写的硅基流动模型与凭据；不要用之前空模型位的旧备份覆盖。

18:02已恢复普通单实例启动，PID19292，无调试端口，online/ready；下次须重新核对PID/空闲状态。APP0.1.24，连接器0.8.6，app.asar SHA256 `648132d37f867a40b8ef8ff1ce3686cf23ba4351241bf972c7211dc368fc05ec`。未提交或推送。

## 后续边界

用户先核对APP内这条素材的图片、文字和描述效果。GLM正式文本处理按用户后续要求开展；不擅自开始摘要或批量。云端纯音频转写首选豆包极速版的既定方向不变。本地Qwen本轮禁用，不能把本地权重安装存在当作本次云端结果来源。访问保存结果不产生新云请求，不需要为了截图重跑。
