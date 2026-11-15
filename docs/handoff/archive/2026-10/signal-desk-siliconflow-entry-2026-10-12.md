# 硅基流动双模型配置入口：APP0.1.23

2026-10-12，用户要求先在APP配置硅基流动入口，将来接入两款模型；询问具体模型后，用户明确回复“先做入口”。本轮已交付配置卡与两个空方案，没有代选模型、填写真实Key或调用硅基流动模型。

## 用户入口

设置页豆包语音卡下方新增“硅基流动 · 双模型接入”：

- 服务地址固定预填`https://api.siliconflow.cn/v1`，协议Chat Completions。
- 一个独立API Key输入框，保存后供两个模型位共用。凭据仍由Windows DPAPI加密，数据库仅保存引用。留空保留现有Key，换Key时两个硅基流动模型位使用新引用，旧厂商Key不受影响。
- 模型1、模型2各有完整模型ID输入框，当前两者留空；每个可分别勾选“此模型支持图片输入，用于画面理解”，默认关闭。
- 保存后分别显示为“硅基流动 · 模型 1/2”云端方案；保存不改变当前方案。填好模型ID和Key后，点击“使用模型1/2”走既有云端方案切换，通用设置里未保存草稿继续受保护。
- 配置未完成时专用“使用模型”按钮禁用；不在保存/切换时发送测试请求。模型名单、真实鉴权、各模型JSON/图片/思考参数兼容性尚未验证。

当前使用通用Chat Completions文本/图片通道。不得因为配置好就宣称任意硅基流动模型、音频、视频或其他专用API都已适配。两款具体模型待用户选择；无需重复追问才能完成本次入口交付。

## 实际交付与保留

- 日常APP升级0.1.23，关注连接器0.8.6，原桌面快捷方式和`%LOCALAPPDATA%/SignalDeskFollowingReview`保持不变。
- 已在实际日常APP设置页点击保存，生成两套空硅基流动方案；当前生效的Qwen3.8-Omni-Flash方案不变，GPT旧方案保留，豆包语音凭据与成功结果不变。
- 53张表除`app_settings/cloud-profiles`预期新增两个方案外逐行不变；旧profile对象逐项哈希一致，加密凭据逐文件哈希一致，完整性ok、外键错误0。
- 用户此前已选定：**云端纯语音转写首选豆包极速版**，此次硅基流动文本/图片配置不更改该决策。该选型不等于已完成通用视频纯转写路由改造。
- 17:14恢复原快捷方式普通启动，主实例PID3188、无调试端口、online/ready、无采集/内容任务运行。下次须重新核对PID。
- app.asar SHA256：`199eca22a06210754efd97a9ade974ab6bce57ae08883603f18012763359997c`。
- 候选包：`release-siliconflow-023/win-unpacked/`；备份、测试和审计：`local-data/siliconflow-integration-20261012/`。

## 实现与验证

- `src/shared/siliconFlow.ts`定义安全配置视图和双模型输入。
- `CloudProfiles`增加专用读取/保存，复用已有方案存储，不混用豆包/其他厂商Key；同一Key用一个加密引用；按provider/slot身份找到两个模型，不按可改名称误匹配其他方案。
- 新IPC：`siliconflow:get/save`；renderer新增独立`SiliconFlowSettings`。草稿不被轮询覆盖，通用设置保存不带走专用Key，外部配置改变会阻止过期草稿覆盖。
- 运行中的内容任务及豆包转写阻止修改云端方案；保存不网络调用。
- 64组545项全回归通过，TypeScript、项目边界、构建、打包renderer冒烟通过。实际APP设置页宽屏和1120宽度均无溢出、renderer错误0。
- 打包隔离验证用合成Key/模型确认双位保存、图片标记、激活与旧方案恢复；真实用户目录只保存空位，没有合成值污染。
- 没有真实云端调用、消费或模型推理。无需为本次入口验证重新跑之前的豆包样本。

官方接口说明已读取：https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions ，确认`https://api.siliconflow.cn/v1/chat/completions`、Bearer鉴权和image_url格式。缓存`local-data/siliconflow-integration-20261012/official-chat.html`，不含用户凭据。
