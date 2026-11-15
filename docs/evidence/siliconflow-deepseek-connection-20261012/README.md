# 硅基流动 DeepSeek-V4-Flash 连通实测

2026-10-12 20:12:34（北京时间），用户已在APP填写并点击使用模型3，授权测试连通状态。**`deepseek-ai/DeepSeek-V4-Flash` 文本接口连接成功。**

本次只读使用APP当前方案及对应加密凭据，向 `https://api.siliconflow.cn/v1/chat/completions` 发送1次简短合成文字请求。日常APP无需重启，没有配置或数据库写入。

| 核对项 | 实测结果 |
| --- | --- |
| 当前方案 | 硅基流动 · 模型 3 |
| 配置与返回模型 | `deepseek-ai/DeepSeek-V4-Flash` |
| HTTP状态 | 200 |
| 完成标识 | `finish_reason: stop` |
| 响应头耗时 | 3,502毫秒 |
| 完整请求及响应读取 | 3,504毫秒 |
| 输入 / 输出 / 合计 | 22 / 16 / 38 token |
| 服务报告思考 / 缓存命中 | 0 / 0 token |
| 请求数量 | 1，无重试 |

请求要求只输出固定校验短语，实际原文为：

```text
SF-DEEPSEE
SF-DEEPSEEK-CONNECT-7319
```

模型返回了完整校验短语，但多输出首行。**连接、鉴权、模型调用及完整响应成功；严格全文格式匹配未通过。** 原始探测报告里的 `ok: false` 表示其全文等于校验短语这一检查失败，不表示接口连接失败；保留报告原样，并另存[判定说明](assessment.json)。没有为了消除格式差异重复请求，不能称严格格式或业务质量已验收。

请求设置 `max_tokens: 256`、`enable_thinking: false`；本次服务报告思考0 token，不外推其他任务。3.504秒是最小API请求等待时间，没有进行视频处理或测量APP点击到业务结果展示的全程时间。未提供价格或账单，不估算费用。

原始[探测报告](connection-report.json)与[API响应](response.json)已保留；响应ID `01a1300721539e94ce17ed08a1af736e`。本机原始记录在 `local-data/siliconflow-deepseek-connection-20261012/`，一次请求标记禁止脚本无意重发。

未上传真实作品、图片、音频或视频，未运行本地模型。APP仍0.1.25、日常主进程PID22008、无调试端口、连接online/ready。当前模型3仍为生效方案；旧GLM/Qwen及豆包纯转写选择保留。未测试图像、转写、摘要或其他业务能力。
