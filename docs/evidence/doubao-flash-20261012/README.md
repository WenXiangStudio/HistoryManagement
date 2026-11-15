# 豆包录音文件识别极速版：APP本地集成与首次实测

**后续已成功（15:19）：** 用户说明误填旧版API Key并在APP更正后，指定样本第二次请求已返回200/20000000，点击至原文显示3.093秒，479字符全文已保存。见[更正Key后的成功记录](success-corrected-key.md)。下文保留首次401和当时验证状态；当前不再是鉴权阻断。

**人工验收已通过：** 用户确认本样本转写文字正确率100%，后台显示音频用量1分17秒，换算费用0.017元。计费音频时长与3.093秒APP全程耗时分别记录；费用来源为用户换算，非代理直接读取扣款明细。此次只记反馈，无新请求。

2026-10-12，APP0.1.22已接入本地文件直传；指定样本真实请求被服务端鉴权拒绝，尚未取得豆包转写结果。

## 实际实现

- 设置页“豆包语音 · 录音文件识别极速版”，直接使用已保存语音凭据和本地音轨，无URL输入、对象存储、手工Base64或Python SDK安装步骤。
- 原有视频归属、原片哈希与派生音轨清单校验保留。程序连续完成校验、必要音轨准备、Base64编码、单次HTTP提交、状态保存与界面展示。
- `POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`，资源`volc.bigasr.auc_turbo`。新版`X-Api-Key`，旧版APP ID＋Access Token；生成Request ID和`X-Api-Sequence: -1`。
- 仅音频`audio.data`；`bigmodel`、关闭ITN/语义顺滑，开启标点/分句。不使用标题、热词、旧转写、画面或摘要。
- 极速版独立`app_settings/doubao-speech-flash-trial`和每次Request ID证据目录。旧`doubao-speech-trial`以标准版2.0历史标签保留。正常成功才保存`transcript-original.txt`并展示未经修改的原文。
- 同时检查HTTP、业务码、JSON和返回音频时长；超时/中断保留不确定状态，阻止重复提交，无自动重发或submit/query续查。完成后本条按钮禁用。重启不会把旧结果浏览时间冒充首次处理耗时。
- 成功路径记录点击至原文进入视口并渲染的全程时间，以及本地准备、请求完整回执、结果文件保存分项；真实成功路径本次未验收。

本入口仍是指定单样本测试，不是任意音频文件选择器或批量语音产品。不称“2.0极速版”，不套用标准版2.0价格。

## 唯一一次真实请求

从实际日常APP设置页点击“仅转写这条视频”，使用《数学彻底怒openai了》、作品`7694535682575860393`的已保存MP3。音轨76.933秒、616,812字节，SHA256：

`85579d548c8c457f4689c1632f4d58980631f91ed6294eb809088b6850e4bc48`

| 字段 | 实际值 |
|---|---|
| 本机记录提交时间 | 2026-10-12T07:04:01.820Z（北京时间15:04:01.820） |
| Request ID | b786f2d7-c0b5-4dac-87e5-de3e57200c1b |
| Log ID | 20261012150341278A9D7C99D8D01297C8 |
| HTTP | 401 |
| 业务码 | 45000010 |
| 服务端消息 | Invalid X-Api-Key |
| 本地准备 | 159ms |
| 请求至完整错误回执 | 562ms |
| 点击至主进程记录失败 | 722ms，非成功识别或原文展示总耗时 |
| 识别原文/返回音频时长 | 无 |
| 实际计费/额度变化 | 未核实，不宣称免费或扣费 |

错误正文：

```json
{"header":{"reqid":"b786f2d7-c0b5-4dac-87e5-de3e57200c1b","code":45000010,"message":"Invalid X-Api-Key"}}
```

用户确认保存的凭据来自火山引擎“语音技术”控制台。核对已缓存官方文档，新版`X-Api-Key`、接口和资源ID与实现一致。401只能证明本次Key未被接受；无法从回执区分复制不完整、已失效、项目等具体原因，也不能判断极速版服务权限。后续需在APP保存有效完整Key并核对控制台状态，再继续有界测试。未打印密钥、未改换鉴权试探、未重试，也没有视觉/摘要/其他模型调用。

## 数据与验证

调用前新备份两库、全部加密凭据、日常EXE及app.asar，备份包含用户本轮前已保存的语音凭据。两库53张表完整性ok、外键错误0；除新增本次极速版试验行外，其他表/行哈希完全一致。加密凭据逐文件哈希不变。79条视频、本地/Qwen转写、博主星标/批注及云端方案未被覆盖。

完整回归62组532项通过；TypeScript、项目边界、构建和候选包renderer冒烟通过。首次真实401后补充精确错误分类并新增测试，极速版10项＋界面3项专项再次通过。打包界面验证包含极速版本地入口和IPC、无URL字段、云端方案/草稿保留。真实日常APP验证：保存凭据可用、音轨已找到、无横向溢出、原始错误可见、renderer错误0。

真实成功转写、准确率、返回音频时长、成功全程耗时和控制台账单仍待有效凭据后的实测；不能用上述合成测试声称已识别成功。

最终鉴权文案修正版再次通过隔离打包renderer冒烟和真实设置页只读检查。15:13从原桌面快捷方式恢复普通启动，单主实例PID1448、无调试端口、连接online/ready，最终两库和凭据审计再次通过。日常app.asar SHA256为`a6d0859d6f9900517c3f5a60e819ccca0446d2ed7ddad4fc06f9fc2c50270d6c`。最后打包复用本机同版本Electron39.8.10，记录在`final-package-local-runtime.log`。

## 本机证据

- `local-data/doubao-flash-integration-20261012/`：before/after审计、数据库/密钥/包备份、测试/打包日志、实际按钮记录、设置页/失败截图。
- `%LOCALAPPDATA%/SignalDeskFollowingReview/speech-tests/doubao-flash/b786f2d7-c0b5-4dac-87e5-de3e57200c1b/`：`request-metadata.json`、`response-original.json`；没有生成转写文本。
- `release-doubao-flash-022/win-unpacked/`：候选包；日常仍为`release-following-background-final/win-unpacked/Signal Desk.exe`。
- [官方极速版HTTP](https://www.volcengine.com/docs/6561/1631584)、[已有SDK研究](../../research/doubao-local-file-sdk-2026-10-12.md)。
