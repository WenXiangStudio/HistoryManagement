# 下一窗口：豆包录音文件极速版本地文件集成与单样本转写

**已接续执行：** 本文为编码前交接。后续用户已授权本地集成，APP0.1.22已交付极速版入口；首次真实请求返回401/45000010/Invalid X-Api-Key，未取得转写，见[最新集成交接](signal-desk-doubao-flash-integration-2026-10-12.md)。下文保留当时状态。

用户最后指令：**“我将在下一个窗口进行集成并测试的任务，请你更新交接文档，完成后停止。”** 本窗口只更新交接并做只读状态核实，不继续编码、部署或调用模型。下一窗口恢复时按本文件接续，不重开对象存储讨论。

## 当前任务与用户边界

下一步将**豆包录音文件识别极速版**封装进现有Windows APP，直接读取已保存的本地音轨，测试《数学彻底怒openai了》的转写效果。

- 用户明确**不开通对象存储**。不要再要求TOS/OSS桶、手工上传、临时URL，也不要自行上传到第三方文件托管。
- APP自动读取音频内容、Base64编码并提交。用户不需要自行安装SDK、运行Python或复制Base64。
- 只做本条音频转写，不做画面识别、摘要或扩量测试；不传旧Whisper/Qwen结果、标题、热词或视觉上下文辅助识别。
- 输出保留原始返回文本，完整呈现给用户核对，不纠错、不润色；原始JSON和请求元数据同时保存。
- 保留既有博主、标记、视频、各版转写和云端方案；新转写另存或追加，不能覆盖历史Qwen和本地证据。
- 用户原先优先录音文件识别2.0，后因拒绝对象存储改查极速版，现明确把接下来的集成测试放到下一窗口。新界面和报告应明确标注“录音文件识别极速版”，不能伪称“2.0极速版”。

## 已确认的官方证据，不需再从头研究

先读[本地文件/SDK研究](../../../research/doubao-local-file-sdk-2026-10-12.md)，原始官方文档及示例已下载。

- [极速版官方接口](https://www.volcengine.com/docs/6561/1631584)：
  - `POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`
  - `X-Api-Resource-Id: volc.bigasr.auc_turbo`
  - 新版鉴权`X-Api-Key`，旧版`X-Api-App-Key`＋`X-Api-Access-Key`。
  - 每次生成`X-Api-Request-Id`，`X-Api-Sequence: -1`，`Content-Type: application/json`。
  - 请求`audio.data`为本地音频的Base64，与`audio.url`二选一；`request.model_name`仍是`bigmodel`。
  - 一次请求返回结果，无需标准版submit/query。HTTP200还需核对`X-Api-Status-Code`；成功20000000，记录`X-Tt-Logid`。
  - 支持WAV/MP3/OGG OPUS，不超过100MB、2小时；直接传数据建议尽量20MB以内。本样本远小于限制。
- [官方版本对比](https://www.volcengine.com/docs/6561/2678884)将极速版列在1.0组，与2.0标准版`volc.seedasr.auc`不同。必须如实标注资源与版本；不要套用之前2.0的0.8元/小时报价，极速版具体计价/额度待确认。
- `local-data/doubao-sdk-research-20261012/auc_python-auc_flash_demo.py`：官方`auc_python.zip`中的源码，`recognize_task(file_url=None,file_path=None)`读取文件、Base64、HTTP POST。已只读核验，尚未执行。
- `local-data/doubao-sdk-research-20261012/fresh-1631584.json`、`fresh-2678884.json`：最新读取的官方正文；动态页面数据来自官方公开`/api/doc/getDocDetail`。
- Windows没有原生SDK不影响用Electron/Node.js调用HTTP接口，不必加入Python SDK依赖。流式也可用WebSocket实现，但本任务不改测流式。
- 不直接运行整个官方示例包：其中流式示例有转换后删除输入文件的代码。只借鉴所需协议，不删除本地媒体。

## 当前现场（2026-10-12只读核对）

- APP **0.1.21**，关注连接器 **0.8.6**；日常路径`release-following-background-final/win-unpacked/Signal Desk.exe`，原桌面快捷方式不变。
- 用户目录：`C:/Users/Administrator/AppData/Local/SignalDeskFollowingReview`。
- APP当前普通参数单主实例，无调试端口；最后PID12232，连接online/ready，活动completed、基础idle，内容运行批次0。下次须重新核对PID与空闲状态。
- 视频79条，正式摘要1条。历史11条本地材料仍存在；数学视频最新转写另有Qwen版本。
- `app.asar` SHA256：`1f82594cc17ad77ec6cd19ff282a5e0010a35f2d09ce33e9d81476aa8873442d`。
- 当前APP设置卡**仍是标准版2.0的URL流程**，极速版尚未集成；不要误点旧按钮或要求填写旧URL。
- **用户已保存新版语音API Key。** 只读确认`app_settings`的`doubao-speech`存在，`authMode=api-key`，凭据引用及对应加密文件存在；未打印或读取明文。不要再告诉用户“密钥未填”，不要要求在聊天里提供密钥。
- 当前`doubao-speech-trial`不存在；尚无任何豆包真实转写请求/结果。极速版资源是否获授权仍未实际验证。
- 状态快照：`local-data/doubao-flash-next-window-20261012/handoff-state.json`，不含秘密。
- 当前源码有大量跨轮未提交修改，全部保留；用户未要求commit/push、清理或reset。

## 指定媒体与对照

- 作者：口罩哥研报60秒。
- 标题：《数学彻底怒openai了》。作品ID **7694535682575860393**。
- 原视频：https://www.douyin.com/video/7694535682575860393 。
- 已导出MP3：`C:/Users/Administrator/AppData/Local/SignalDeskFollowingReview/speech-tests/math-openai/math-openai-77s.mp3`。
- 时长 **76.933秒**，**616,812字节**，单声道16kHz/64kbps MP3。
- MP3 SHA256：`85579d548c8c457f4689c1632f4d58980631f91ed6294eb809088b6850e4bc48`。与Qwen音轨测试逐字节一致，优先复用，不重新获取平台媒体。
- 原片SHA256：`869c1542b94651f778b9e53e96f536f7a20a8c251273645ae88faa1fab2c5f04`；已有prepareAudio会验证原片/作品归属、时长与派生文件。
- 当前清单：用户目录`speech-tests/math-openai/audio-manifest.json`；勿把其中账号身份抄到公开输出。
- 本地Whisper历史：约26.781秒转写，有专名等错误；SenseVoice对照4.782秒但有遗漏。
- Qwen音频原文位于`docs/evidence/qwen-transcript-only-20261012/transcript-original.txt`，用户人工校对本样本正确率100%。只能作为事后比较，不放入豆包请求。
- Qwen同请求费用记录有输入/输出方向差异；API输入794/输出54431，其中思考54156，原文460字符。详见`billing-and-quality-20261012.md`。不要把ASR成本按这套tokens标准套算。

## 已有代码与建议修改点

当前专用模块：

- `src/main/doubaoSpeech.ts`、`src/main/doubaoSpeech.test.ts`：标准版HTTP、独立凭据、原片验证/MP3生成、试验状态持久化。
- `src/shared/doubaoSpeech.ts`：目前resourceId类型固定`volc.seedasr.auc`，状态沿用异步轮询；极速版需明确调整。
- `src/renderer/src/DoubaoSpeechSettings.tsx`：设置页卡片，现有URL/TOS指引需要从极速版流程移除或替换为本地音轨状态。
- `src/main/index.ts`、`src/preload/index.ts`：doubao-speech:get/save/prepare/start/resume/stop IPC。
- `src/renderer/src/App.tsx`、`styles.css`：已有设置卡接入。
- `src/renderer/src/settingsDraft.test.ts`：独立豆包凭据草稿不被轮询或普通设置保存覆盖的检查。

凭据：`app_settings`独立key`doubao-speech`保存模式和引用，DPAPI文件在`credentials/doubao-speech-<uuid>.bin`。继承已有独立存储，不要拿百炼API Key、改变旧cloud-profiles或将明文写数据库/日志。

建议顺序：

1. 核对当前任务空闲、备份两库/日常包及已保存语音凭据，复用已有本地MP3及归属校验。
2. 增加明确的极速版模式或专用分支，让界面显示极速版及本地文件直接提交；保留标准版历史数据。避免把旧的2.0任务凭证/结果标签静默改成极速版。
3. 复用凭据，封装`audio.data`单次请求。仅音频，关闭语义顺滑和数字规整、开启标点/分句（维持当前比较条件）。不传热词、旧答案、图片或摘要要求。
4. 单独处理极速版超时/中断：没有依据就不能沿用标准版“继续查询原任务”，不能自动重发导致重复计费。保留RequestID、状态和错误供对账。
5. 同时核对HTTP状态、业务状态、返回时长、原始text；后台错误信息与结果留证，但不输出鉴权头、密钥或完整请求音频Base64。
6. 跑必要协议/缓存与状态/界面专项、TypeScript、项目边界、构建打包与实际APP入口冒烟，再在APP触发指定单样本。不要用脚本成功冒充产品流程自动成功。
7. 权限不足时保留确切业务码，提示只需核对极速版服务权限，停止该请求；不自行购买服务、重试多次或回退其它型号。凭据已保存，不重复索要。
8. 成功后完整原样展示转写，记录用户点击至结果可读的全程时间，预处理/网络/展示阶段单列。记录账户实际时长/费用或明确未知，请用户核对准确性。

当前0.1.21的既有验证为60组520项通过、TypeScript/边界/构建/打包renderer与日常设置/导出音频冒烟通过。**这些验证没有覆盖尚未实现的极速版。** 旧R8门继续关闭，不声称整条npm run check通过。

## 本机材料与交付惯例

- 0.1.21候选包：`release-doubao-asr-021/win-unpacked`。
- 上次备份、测试日志和截图：`local-data/doubao-asr-integration-20261012/`；该目录before是用户保存豆包凭据前的旧备份，下次必须新备份，不回滚丢失用户凭据。
- 官方文档初次缓存：`local-data/doubao-asr-research-20261012/`；SDK/极速版复核：`local-data/doubao-sdk-research-20261012/`。
- 更新日常包要确认APP单实例与空闲，先备份；必要的审阅调试端口只连显式APP，不连接Chrome CDP；结束恢复原快捷方式普通启动。
- PowerShell 7、`login:false`；专用Python `D:/SDVideoRuntime/python/Scripts/python.exe`用于审计/辅助工具，不用它跑无关语义模型。

**本窗口在写完交接后停止。下一窗口从极速版本地文件集成开始，不继续标准版URL任务。**
