# 阿里百炼 qwen3.8-omni-flash 连接验证

2026-10-11 17:13:55（北京时间），用户已在APP保存新方案，要求验证能否正常连接。**当前保存的阿里百炼 `qwen3.8-omni-flash` / Responses 连接成功。**

- 使用当前生效方案“新方案”的地址与独立加密密钥；未切换方案、修改参数或借用旧厂商凭据。
- 实际接口路径：`/compatible-mode/v1/responses`。
- 发送1条简短合成文字，请求返回固定JSON校验内容；没有上传真实作品、图片、音频或视频。
- HTTP 200，`text/event-stream`，出现 `response.completed`，返回模型标识 `qwen3.8-omni-flash`。
- 正确回复：`{"ok":true,"check":"QWEN-CONNECT-7319"}`。
- 响应头约698毫秒；从探测初始化到完整结果约1,334毫秒。此时间不是视频处理全程。
- 服务报告输入118 token、输出63 token（其中思考41 token），合计181 token。没有估算费用。
- 原有 `gpt-6.1-sol` 方案仍保留；日常APP连接online/ready，无需重启或修改接口协议。

可核对[脱敏请求结果](connection.json)。原始返回与官方文档缓存存于本机 `local-data/qwen-connection-20261011/`；未提交密钥、私人完整接口地址或凭据profile。

同时实际读取了[阿里百炼官方 Omni 文档](https://help.aliyun.com/zh/model-studio/qwen-omni)。该页列明 `qwen3.8-omni-flash` 支持文本、图片、音频、视频输入及文本输出，支持 Chat Completions 和 Responses。**本次只实测了文本连接，不等于音视频转写、画面理解或摘要质量已经通过。** 后续媒体试验应按该模型的官方请求结构接入，不能因同为Responses就照搬旧服务拒绝的字段形式。
