# Signal Desk 0.2 阶段 B：隔离抖音评论 PoC

此目录只用于阶段 B 的真实只读验证，不接入 Signal Desk、Native Messaging、正式 SQLite 或正式任务队列。

## 安全边界

- 用户只选择 20～30 的目标样本数（默认 24）；扩展自动从本人真实抖音关注关系中发现并随机抽样公开作品，不要求用户整理、复制或粘贴 URL。
- 自动发现只接纳本人主页真实关系弹窗：唯一活动“关注（数字）”页签、唯一 `data-e2e="user-fans-container"`，以及每位博主卡片上的“已关注/相互关注”标记。粉丝、推荐、侧栏、搜索结果和任意全页 `/user/` 扫描均被拒绝。
- 作品候选必须同时绑定已验证关注博主、该博主的精确主页路由，以及活动作品页签所控制的面板或唯一作品列表容器；最终样本使用每次生成的 256 位随机种子确定性打乱，优先跨博主覆盖，单博主最多 3 个作品，并在候选允许时覆盖视频与图文。
- 若已验证范围不足 20 个合格公开作品，返回 `INSUFFICIENT_ELIGIBLE_SAMPLES`，不会放宽到推荐内容。
- 使用用户当前 Chrome 登录态；不读取、打印、传输或持久化 Cookie、Authorization、完整请求头、签名值或浏览器配置。
- Network/CDP 捕获只读取评论响应正文；完整请求 URL 只在扩展内存中短暂作为模板，写报告前删除。
- 页面上下文请求仅为 GET，只访问 `/aweme/v1/web/comment/list/`，使用浏览器自身的 `credentials: "include"` 和页面自身签名能力。
- DOM 结果仅作为 shadow 对比，不写正式业务表。
- 每个 PoC 创建的后台标签页在样本结束后关闭；不会关闭用户已有标签页。
- 单样本最大 API 页数、评论数、等待时间和整体样本数均有硬上限。
- 登录、验证码或安全验证会触发全批次停止；不会自动绕过。
- 控制器 `/v1/stop` 会写入当前会话专属的 `runtime/STOP-<token-hash-prefix>`，作为即时停止开关；旧会话的停止文件不会影响新会话。

## 文件布局

```text
extension/       独立 Manifest V3 扩展
test/            纯本地单元测试
runtime/         运行时会话与会话专属 STOP 文件；不提交 Cookie
runs/<run-id>/   固化发现合同、来源证明清单、每样本脱敏 JSON 与汇总报告
```

`runtime/` 和 `runs/` 由控制器按需创建。控制器会拒绝包含已知敏感键或敏感值模式的报告。

## 使用方式

1. 启动控制器：

   ```powershell
   node poc\phase-b\controller.mjs start --port 43827
   ```

2. 在 `chrome://extensions` 开启开发者模式，选择“加载未打包的扩展程序”，加载：

   ```text
   D:\AI_WorkSpace\SpatialWarehouse\AI_InformationWorkflowCreationCenter\poc\phase-b\extension
   ```

3. 当本机控制器正在运行时，加载或重新加载该独立扩展就是本次已授权 PoC 的一次性启动信号：扩展会自动配对并按默认 24 个样本开始。无需再点击开始、粘贴 token 或提供作品 URL。扩展弹窗保留 20～30 数量选择和手动重试入口。
4. 扩展会自动打开本人主页、从真实关注关系中发现博主、从其公开作品中随机/分层抽样并固化清单，然后逐个采集 Network/API/DOM shadow 结果。
5. 如需停止，点击扩展中的“立即停止”，或另开终端运行：

   ```powershell
   node poc\phase-b\controller.mjs stop --port 43827 --token <session-token>
   ```

6. 控制器先通过 `/v1/discovery-start` 固化目标数、随机种子及硬上限，自动发现完成后再通过 `/v1/start` 固化带来源证明的最终清单。收到全部样本或停止后生成 `summary.json` 和 `report.md`。

Chrome 不允许普通程序静默安装带 `debugger` 权限的未打包扩展。因此首次运行最多仍需在 `chrome://extensions` 完成一次“加载未打包的扩展程序”安全确认；这不是让用户手工采样或搬运业务数据。

不要把 `runs/` 中的 PoC 结果导入正式数据库。阶段 C 只有在阶段 B 报告通过人工审查后才能开始。
