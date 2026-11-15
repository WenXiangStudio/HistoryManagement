# 豆包语音配置入口与单样本转写准备（2026-10-12）

**后续方向已更新：** 用户拒绝对象存储，已撤回下文TOS/URL准备安排。见[最新SDK与极速版核对](../../../research/doubao-local-file-sdk-2026-10-12.md)：极速版直接上传本地文件内容可行，尚未接入0.1.21。语音凭据后续已由用户保存；不要沿用本页“尚未填写”的旧状态，操作前只读核对。以下保留当次标准版交付事实。

用户要求查官方文档、对比豆包录音文件识别2.0与流式语音识别2.0，优先转写《数学彻底怒openai了》。用户已开通录音识别，尚未填写凭据；没有对象存储，要最少步骤。完整接入依据和用户操作说明见[研究记录](../../../research/doubao-asr-2-2026-10-12.md)。

## 交付

- APP0.1.21、关注连接器0.8.6，原桌面入口`release-following-background-final/win-unpacked/Signal Desk.exe`与用户目录不变。
- 设置页顶部新增“豆包语音 · 录音文件识别2.0”，支持新版API Key、旧版APP ID＋Access Token，独立凭据与配置，原百炼/GPT不变。
- 固定`volc.seedasr.auc`及标准submit/query。当前极速版`volc.bigasr.auc_turbo`不能当2.0，未自动替换。
- 可导出指定视频MP3、填写TOS/OSS/COS官方HTTPS音频链接、只做转写、续查原任务、显示原始文本。链接文件必须与导出MP3哈希一致。无图像/摘要/本地语义模型请求。
- 原文留在专用试验结果/设置页，不覆盖视频正式转写阶段。当前是指定样本入口，不是通用批量ASR产品。

## 当前待用户操作

1. 在新设置卡保存语音API Key（新版）或APP ID/Access Token（旧版）；不要求在聊天发密钥。
2. 上传已导出的`C:/Users/Administrator/AppData/Local/SignalDeskFollowingReview/speech-tests/math-openai/math-openai-77s.mp3`至自己的私有对象存储。
3. 在TOS文件详情复制HTTPS下载URL（默认1小时有效），填APP临时链接栏，及时点击仅转写；也可填好后告知代理继续操作。尚未提交真实豆包请求，不能称已连通。

如果用户不想准备TOS，官方语音控制台上传音频能先体验2.0，但这与APP API测试不同；不要自行上传到不相关托管站点。也不要请求云账号AK/SK，本次只有语音凭据和单文件URL足够。

## 验证与文件

TypeScript、60组520项测试、项目边界、构建、打包renderer冒烟通过；日常包设置与导出测试通过，截图和`verification.json`位于`local-data/doubao-asr-integration-20261012/`。后者记录两库53张表逐行不变，完整性ok、外键0，凭据未填，API请求0。旧R8门继续关闭。

新增模块：src/main/doubaoSpeech.ts及test，src/shared/doubaoSpeech.ts，src/renderer/src/DoubaoSpeechSettings.tsx；index/preload/App/styles接入，settingsDraft测试补充独立凭据草稿保护。使用既有CredentialStore DPAPI，加密文件为credentials/doubao-speech-<uuid>.bin；数据库app_settings独立key为doubao-speech、doubao-speech-trial，旧settings/cloud-profiles未改。

MP3：76.933秒，616,812字节，SHA256`85579d548c8c457f4689c1632f4d58980631f91ed6294eb809088b6850e4bc48`，与Qwen对照音频相同。当前包app.asar SHA256`1f82594cc17ad77ec6cd19ff282a5e0010a35f2d09ce33e9d81476aa8873442d`。候选打包目录release-doubao-asr-021/win-unpacked，备份在local-data/doubao-asr-integration-20261012/before。

APP已恢复普通参数单主进程，最后PID12232（需重新核对），无调试端口。已打开窗口，用户可从左下角设置进入；重启不会保持设置路由。导出时文件夹已打开。

后续只操作用户授权的这一条录音识别2.0测试。service start提交一次，网络不确定保留RequestID只续查；不要为排错重复点击新提交。成功核对业务状态、返回音频时长和原文，记录Logid、请求/查询耗时及用户账单，禁止把HTTP200当识别完成。预估后付费0.8元/小时，单样本约0.017元；实际额度/套餐和扣费待核对。
