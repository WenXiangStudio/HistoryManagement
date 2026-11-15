# 视频内容处理：本地优先可行性调查

调查日期2026-10-10。区分源码证据、合成验证与真实视频验收。本文件不把 stars、README 或旧R7合同视为本项目生产能力。

## 本机事实

i5-12600K（10核16线程）、约31.7GiB内存、Intel UHD770，未发现NVIDIA独显。D:/Python311存在3.11.9；系统默认Python为3.14；所检查环境未安装faster-whisper/PaddleOCR/推理依赖。项目runtime/python311仅占位，不等于已打包解释器。随包FFmpeg/FFprobe可运行。

合成验证：内存中生成10分钟视频并执行旧fps=1/2、frames=120配置，输出于4分钟结束；合成音频提取/探测成功（16kHz单声道PCM）。这不是实际抖音下载或中文转写验收。

## 借鉴对象与固定版本

星数为此次GitHub页面近似读数，随时间变化。API匿名额度不足时改读公开页面与固定提交raw源码。

| 对象 | 约stars | 固定commit | 用途 |
|---|---:|---|---|
| yt-dlp/yt-dlp |196585|51bab8a0116f4d8004c315706d809782607d5847|媒体/字幕适配；抖音仍有会话限制|
| SYSTRAN/faster-whisper |25793|a52b026ac844c02117865e61968547639b60a6f8|CPU INT8基线、VAD和时间片段|
| ggml-org/whisper.cpp |54266|d1be6fde11ac6e0407606b4e42fe72d34add8037|CPU量化与Intel/OpenVINO备选|
| PaddlePaddle/PaddleOCR |90877|dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf|画面文字；模型默认会变，需固定|
| ggml-org/llama.cpp |130713|781dbc5ac98921dbdb5e5b2ec5b7a50960e937d4|本地量化模型服务与JSON schema|
| ollama/ollama |182601|eab97e9f92b9a25c2d52d2cc6c1b1c99bd9fae21|模型管理备选|
| NanmiCoder/MediaCrawler |66594|156c602c8d689266e6c5e9130b36f0b70495f5f0|作品分页与字段；只借鉴行为|
| JoeanAmier/TikTokDownloader |16644|473c90ff70c663cfb69310fff2b8d5192f200661|日期过滤与分页；游标含义仍须实测|
| modelscope/FunASR |20631|e7e61293d308f4342ab9307895e710e4b51b949c|SenseVoiceSmall CPU中文对照|
| QwenLM/Qwen3-ASR |3674|7c6daf77a2421100f5fb066495372c00129d39ff|候选ASR，不能套用GPU吞吐|
| QwenLM/Qwen3-VL |20057|96588727e44c78b25ba03ea03b8e12f7e64fd0da|视觉/时间定位参考，未本机实测|
| JefferyHcool/BiliNote |7487|90940fde4d224d0f69ad99674f4af0a1ea52d3c4|分阶段缓存、模型复用、笔记与截图定位|
| WEIFENG2333/VideoCaptioner |16205|95842ecb5618c0b6a548a336bdfb0eb859bdb501|多引擎与重叠分段合并，GPL源码不直接复制|
| Huanshere/VideoLingo |18734|01f843492759be9bbfd1a5cb697b799cc9de1609|阶段恢复；辅助翻译总结截取开头，不作全文概览|
| Johnserf-Seed/F2 |2691|f6be8c0ffba9a127075bbeafe4838716650b6325|日期游标/分页边界参考|

源码重点：BiliNote backend/app/services/note.py、transcriber/transcriber_provider.py、gpt/request_chunker.py；VideoCaptioner core/asr/chunked_asr.py；VideoLingo core/_4_1_summarize.py；TikTokDownloader src/interface/account.py；MediaCrawler media_platform/douyin/client.py。原有ai-boshu的原文哈希/证据画像与Ether_vs常驻工作器继续参考，详见既有目录与固定索引。

## 当前实现缺口

1. 当前视频入口仅首屏一条已知作品，无历史日期分页；媒体定位信息未在合同中传递。
2. 旧media_worker每次重新加载Whisper；抽帧最多覆盖开头约4分钟；重跑删除工作目录，不适合恢复。
3. 旧cloudService读的是旧works库，证据引用主要落到发布文案，不能直接接入日常视频库。
4. 旧快照以run_id为主键，多作品任务必须先兼容迁移。

## 首轮路线和证据要求

保留Electron/连接器/SQLite，CPU转写优先；faster-whisper small → 必要时FunASR对照；PaddleOCR；llama.cpp + Qwen3-4B-Instruct-2507 Q4_K_M全文分段摘要。云端补充通过独立适配器，不假设已有服务预算。

先一条真实作品，后多类型，最后批量与自动化。逐条核对归属、全程时长、首中尾内容和关键观点。真实准确率、吞吐和云端成本尚待记录；此处没有性能保证。

执行依据：[实施清单](../architecture/video-content-triage-plan-2026-10-10.md)。


## 真实实现后的选型结论

small CPU INT8已真实运行，转写错误原样保留；PaddleOCR CPU也已运行。新增Qwen3.5-4B Q4_K_M对照，ModelScope unsloth/Qwen3.5-4B-GGUF，文件SHA256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`；两个4B路线均未通过忠实性抽检。JSON有效和引用ID有效不能代替语义正确；正式路径保留质量门关闭，转写/OCR与待生成摘要状态分开。

SenseVoiceSmall（iic/SenseVoiceSmall，model.pt SHA256 `833ca2dcfdf8ec91bd4f31cfac36d6124e0c459074d5e909aec9cabe6204a3ea`）本机单样本更快但漏掉部分内容，暂作对照而非默认。用户已有云端服务、稍后配置；模型摘要与复杂画面交由独立云端接口补充，真实质量/费用验收仍待进行。
