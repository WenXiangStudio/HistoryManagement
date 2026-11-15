# 豆包本地文件接入：SDK与极速版核对

**续接安排：** 用户已指定在下一窗口完成极速版本地文件集成与测试，本窗口更新交接后停止。执行入口见[下一窗口专用交接](../handoff/archive/2026-10/signal-desk-doubao-flash-next-window-2026-10-12.md)，当前APP仍未新增极速版路径。

2026-10-12，用户明确拒绝开通对象存储，要求核对官方SDK能否封装到Windows APP中读取本地音频。用户随后纠正自己看到的是流式语音识别SDK，并要求进一步查录音文件识别极速版。

**结论：录音文件极速版支持APP读取本地文件并直接上传音频数据，无需对象存储或公网音频URL。官方提供Python调用示例，不必依赖Windows原生SDK；Electron/Node.js可按同一HTTP协议实现。** 本轮完成文档与官方示例代码核对，尚未将极速版接入APP或调用识别服务。

## 已直接核验的官方证据

1. [录音文件极速版识别HTTP](https://www.volcengine.com/docs/6561/1631584)，本文再次获取官方正文：
   - POST `https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`。
   - 资源ID固定`volc.bigasr.auc_turbo`，需开通对应权限。
   - `audio.url`与`audio.data`二选一，后者为Base64编码的音频内容。
   - 一次请求返回完整识别结果，无需submit/query轮询。
   - 支持WAV/MP3/OGG OPUS，音频不超过2小时、100MB；文档另建议直接传数据时尽量20MB以内。
   - 新版控制台用`X-Api-Key`，旧版用APP ID/Access Token；需记录业务状态与Logid，不把HTTP200等同于识别成功。
2. 从[标准版文档的官方Demo附件](https://www.volcengine.com/docs/6561/1354868)下载`auc_python.zip`，只解包阅读源码，未执行：
   - 包内`auc_flash_demo.py`定义`file_to_base64(file_path)`，以`open(file_path, 'rb')`读本地文件。
   - `recognize_task(file_url=None, file_path=None)`支持文件路径参数；有`file_path`时生成`audio_data = {"data": base64_data}`。
   - 示例POST与极速版文档相同的`recognize/flash`，资源为`volc.bigasr.auc_turbo`。
   - 这是普通Python HTTP示例，没有Windows不支持的原生SDK依赖。包内标准版`auc_http_demo.py`仍明确使用在线`file_url`，不能用极速版示例证明标准版2.0支持直接文件上传。

本地路径由APP自己读取，服务器收到的是文件内容，不是让火山读取用户电脑上的`C:/...`路径。Electron/Node.js已有文件读取、Base64与HTTPS能力，可按官方格式封装，用户无需手动转换或复制音频数据。

## 官方SDK的环境限制如何理解

[大模型流式识别SDK](https://www.volcengine.com/docs/6561/1395846)及[新版Android流式识别SDK](https://www.volcengine.com/docs/6561/2604754)、[iOS流式识别SDK](https://www.volcengine.com/docs/6561/2604753)确实说明`RECORDER_TYPE_FILE`和PCM本地文件路径，但这些页面针对相应平台的SDK。没有Windows原生SDK不等于Windows不能使用服务。

官方[流式API](https://www.volcengine.com/docs/6561/1354869)另提供`sauc_python.zip`示例，README明确`python3 sauc_websocket_demo.py --file /.../eng_ddc_itn.wav`；可在Windows用受支持的运行时/协议实现文件发送。它仍属于流式识别模型，不能称录音文件识别2.0。官方Demo可能包含删除输入文件等不适用本项目的操作，只作协议参考，不能原样运行在已有原片上。

## 本项目下一步边界

- 用户已明确“不开户/不开通对象存储”；停止上一轮让用户建TOS桶、上传对象、填写临时URL的接入安排，不再重复要求这些步骤。
- APP0.1.21仍是标准版2.0的URL入口；“极速版直接本地文件”本轮已确认可行，但尚未交付。不能说配置入口已经切换。
- 待集成时，直接读取已核验的`math-openai-77s.mp3`（76.933秒、616,812字节），沿用独立语音凭据，加显式极速版资源与单次请求路径。保存原始回执、时间和音频时长，只转写，不传图片、热词或旧转写答案。
- 已保存的语音API Key是否有`volc.bigasr.auc_turbo`权限仍未实测；标准版2.0开通不证明极速版权限已开通。
- [官方产品对比](https://www.volcengine.com/docs/6561/2678884)当前将极速版归到1.0列，资源也区别于2.0标准版的`volc.seedasr.auc`。后续应明确记录“豆包录音文件识别极速版”，不得称“2.0极速版”或套用2.0报价。
- 本轮仅研究、记录，不新发模型请求，不切换到流式识别、不改APP配置、不删除原片或旧模型结果。

原文与官方示例文件保存在`local-data/doubao-sdk-research-20261012/`，最新接口正文为`fresh-1631584.json`，产品对比为`fresh-2678884.json`。此前研究保留在[2.0接入核对](doubao-asr-2-2026-10-12.md)，对象存储方案已被本次用户指令撤回。
