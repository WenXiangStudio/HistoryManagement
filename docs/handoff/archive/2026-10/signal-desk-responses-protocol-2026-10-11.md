# 文本服务切换 Responses

用户在服务商后台确认此前调用成功，要求不再关注单价，并将Completion改为Responses。已实现、验证并交付APP0.1.18，连接器仍0.8.6。用户接口地址、密钥不在本报告中保存，也不向用户在聊天索取。

## 实现

- AppSettings新增textApiProtocol，设置页可选Responses / Chat Completions。旧配置缺字段时保留Chat Completions，不擅自更改其他服务。
- requestResponsesText统一承担文本Responses传输：`/responses`、developer任务指令与user材料、`store:false`、`stream:true`、JSON模式。没有工具或服务器会话继承。
- 正确处理SSE分段、UTF-8、CRLF与末尾未换行事件；确认response.completed，拒绝中断、失败、拒答和过大内容；服务错误不回显原始响应体。不会自动退回/chat/completions。
- 视频摘要和共用文本配置的旧作品/评论分析使用选定协议；视觉仍走独立配置，旧R8门未开启，本地摘要质量门仍关闭。
- 摘要缓存身份包含协议，保存结果增加可选protocol字段。旧摘要可读。未改变兴趣标记或资料累计规则。

## 真实验证

本轮共5次Responses请求，全部使用合成文字，未外发真实作品材料：

1. 最小连接请求HTTP200，正常输出JSON并出现response.completed。
2. 初次摘要请求仅将任务合同置于顶层instructions，返回JSON但缺少要求的摘要字段，被程序拒绝。
3. 一次诊断复测确认返回自选summary/steps等结构，未通过原有schema。不是HTTP连接故障。
4. 将实际任务合同放入developer输入后，通过同一generateVideoSummary函数、结构与证据引用检查。
5. 用APP实际保存的responses配置最终复测，路径`/backend-api/codex/responses`，概览/主题/观点/证据引用通过，耗时13,673ms。此时间只是合成摘要测试，不是完整视频处理性能。

上述观察说明当前服务的指令传递方式需要适配，不据此断言所有Responses服务会忽略顶层instructions。官方文档本轮读取返回403，兼容性结论以服务实测与应用测试为依据。

## 验证与交付

TypeScript、57组490项应用测试、项目边界、构建和打包renderer冒烟通过。相关测试覆盖Responses长文分块与合并、引用拒绝、协议缓存区分、取消、错误结束、文本/视觉独立路由；设置协议选择在打包程序中等待6.5秒仍保留，保存后重开正确。

核对任务空闲并备份后更新原日常路径。使用短暂APP专用调试会话，通过APP settings:save接口仅修改textApiProtocol为responses，并核对设置下拉框、原地址/模型及密钥状态。随后恢复原桌面快捷方式普通参数启动；单主实例，无调试端口，连接online/ready。

2026-10-11 02:16:39：两库完整性ok、外键错误0；following-directory.sqlite全部原有表逐行一致；signal-desk.sqlite仅app_settings变化，设置正文除新增textApiProtocol外完全一致；密钥文件完全一致。视频78条、正式摘要0份，本轮未向正式作品库保存测试摘要。

app.asar SHA256：`9bd734908d70aabec84d12147da2e299d8c31915443a7bfb907207ca52d775e2`。

本机证据：local-data/responses-protocol-20261011（两库/旧包备份、配置与交付核对）、local-data/cloud-text-check-20261011（真实合成请求与被拒绝输出）。不提交这些个人配置或凭据profile。所有原有未提交改动保留，本轮未提交、未推送。

下一步仍为真实作品摘要质量验证。Responses是传输协议变化，不代表内容准确率已提高或本地摘要已经验收。
