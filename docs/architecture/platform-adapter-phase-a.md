# Signal Desk 0.2 平台适配器：阶段 A 设计冻结

状态：阶段 A 已实现并通过纯 fixture 测试  
冻结日期：2026-09-05（Asia/Shanghai）  
适用范围：合同、错误模型、脱敏边界、范围指纹与测试基建  
不在范围：真实平台访问、扩展 MAIN world 执行、正式数据库迁移、任务恢复与媒体下载

## 1. 冻结目标

阶段 A 将平台事实获取层的输入输出变成可验证、可版本化的合同。后续适配器不得直接把任意网络 JSON、DOM 文本或完整请求对象交给数据库；必须先完成白名单投影、schema 校验、实体绑定、分页一致性检查和敏感字段剔除。

核心文件：

- `src/shared/platformAdapter.ts`：平台适配器、分页、证明、错误和范围合同。
- `src/main/platformAdapterSecurity.ts`：请求/响应白名单、日志脱敏、canonical JSON 和 SHA-256 指纹。
- `src/shared/platformAdapter.test.ts`：纯本地合同、安全边界和 mock 适配器测试。
- `src/shared/fixtures/douyin-comment-page.mock.json`：完全合成的评论分页 fixture，不来自真实平台。

## 2. PlatformAdapter 合同

每个适配器必须公开稳定身份：

```text
platform + adapterName + adapterVersion + schemaVersion
```

适配器操作固定为：

- `following`
- `creator-works`
- `work-detail`
- `comments`
- `comment-replies`
- `media-resolve`

`PlatformAdapter<TRequest, TItem>` 只接受显式请求和受限执行上下文，返回 `platform-adapter-page/v1`。执行上下文仅声明浏览器 origin、`browser-page` 会话类型、取消信号和时钟；合同中不存在 Cookie、Authorization、浏览器配置或任意请求头出口。

后续阶段 C 可以在扩展侧为该合同实现受控的 MAIN world 执行器，但不得扩大这里冻结的敏感数据边界。

## 3. 分页结果和空结果

每页结果必须同时包含：

- `cursorIn`
- `cursorOut`
- `hasMore`
- `reportedTotal`
- `returnedCount`
- `duplicateCount`
- `completion`
- 版本化 `sourceProof`

强制不变量：

1. `returnedCount` 必须等于标准化后的 `items.length`。
2. `complete` 不允许 `hasMore=true`。
3. 空页且 `hasMore=true` 是协议异常，不能判定成功或空评论。
4. `verified-empty` 必须同时满足 `items=[]`、`hasMore=false` 和 `reportedTotal=0`。
5. 暂未加载、超时、签名未就绪或 schema 不匹配必须生成结构化 issue，不能降格为 `verified-empty`。

这组规则直接解决旧 DOM 路线无法区分“真实 0 评论”和“尚未渲染”的问题。

## 4. 来源证明

阶段 A 新增并冻结以下合同，旧 `douyin-comment-source-proof/v1` 继续保留，当前生产路径不受影响：

- `douyin-comment-api-proof/v1`
- `douyin-work-api-proof/v1`
- `douyin-following-api-proof/v1`
- `media-resource-proof/v1`

抖音结构化 API 证明包含：

- 平台、适配器名称、适配器版本和 schema 版本。
- 页面种类、来源类型和端点种类；不保存包含敏感参数的完整 URL。
- 经过端点级白名单过滤的业务请求参数。
- 输入/输出 cursor、`hasMore`、平台报告总数和返回实体 ID。
- 白名单投影响应 canonical JSON 的 SHA-256。
- 采集时间、浏览器 origin、是否使用浏览器会话和签名提供者类别。
- HTTP、JSON、平台状态、目标实体、schema、分页和敏感字段移除的验证结果。

评论证明额外要求 `aweme_id` 与目标作品 ID 一致。关注/作品证明要求实体 ID 清单与 `returnedIds` 顺序和值完全一致。原生评论 cid 将在阶段 C 作为标准评论 ID 使用；合成 ID 只能作为明确标记的缺失字段降级路径。

`responseBodySha256` 的输入必须是业务字段白名单投影后的 canonical JSON，不能对含 Cookie、响应头、设备秘密或未知字段的原始对象直接做哈希后落盘。哈希不是脱敏手段，脱敏必须先完成。

## 5. Cookie、请求头和参数边界

页面请求应由浏览器通过 `credentials: "include"` 自动使用当前登录态。适配器不得读取或传回 Cookie 明文。

允许由页面上下文请求构造器显式处理的请求头只有：

- `accept`
- `content-type`

Cookie、User-Agent、Origin 和 Referer 等浏览器会话头由浏览器自身管理，适配器不得读取、伪造或通过 IPC 传递。

允许写入持久化诊断的响应头只有：

- `cache-control`
- `content-length`
- `content-type`
- `date`
- `etag`
- `last-modified`

所有头白名单均采用 deny-by-default。`cookie`、`set-cookie`、`authorization`、Bearer Token、`X-Bogus` 和设备标识不会进入结果。

请求头还执行值级白名单：`accept` 仅允许 JSON 响应类型，`content-type` 仅允许 JSON 或 form-urlencoded，并拒绝 CR/LF 和超长值。业务参数按名称执行格式约束：游标/数量为非负整数，实体 ID 为受限的不透明标识，平台枚举为短公共值；不能利用一个合法参数名夹带自由文本秘密。

业务请求参数还必须通过端点级白名单。当前可被证明合同表示的参数名为：

```text
aid, aweme_id, channel, comment_id, count, cursor, device_platform,
item_id, max_cursor, min_cursor, sec_user_id
```

即使参数名在全局集合内，如果不属于当前端点也会被丢弃。例如根评论 `comment-list` 不接受 `comment_id`。`X-Bogus`、`msToken`、Cookie、未知设备参数和任何 Token 均不会持久化。

## 6. 日志脱敏

`redactForLog()` 对对象、数组、URL、自由文本和循环引用递归处理：

- 敏感键值替换为 `[REDACTED]`。
- URL 中仅保留允许的业务参数值；未知参数保留参数名但隐藏值。
- URL 用户名、密码和 fragment 被删除。
- 自由文本中的 Bearer、Cookie、Authorization、API Key、Token、`X-Bogus`、密码和 secret 值被替换。
- `sessionUsed` 和 `signatureProvider` 是允许保留的状态描述，不包含实际会话或签名值。

日志脱敏是最后一道防线。生产实现仍必须在数据源处做白名单投影，不能先把秘密写入通用对象再依赖日志层补救。

## 7. 结构化错误模型

错误序列化合同为 `platform-adapter-issue/v1`。调用者只能选择错误码、阶段和安全上下文；`category`、`retryable`、`taskImpact` 与 `userActionRequired` 由冻结策略派生，并由 schema 二次校验，不能被调用者任意改写。

| 错误码 | 分类 | 自动重试 | 影响范围 | 需要用户操作 |
|---|---|---:|---|---:|
| `BROWSER_OFFLINE` | transient | 是 | batch | 否 |
| `PAGE_NAVIGATION_TIMEOUT` | transient | 是 | item | 否 |
| `PAGE_CONTEXT_NOT_READY` | transient | 是 | item | 否 |
| `LOGIN_REQUIRED` | authentication | 否 | batch | 是 |
| `CAPTCHA_OR_SECURITY_CHALLENGE` | challenge | 否 | batch | 是 |
| `RATE_LIMITED` | throttling | 是 | batch | 否 |
| `HTTP_TRANSIENT` | transient | 是 | item | 否 |
| `API_STATUS_ERROR` | protocol | 否 | item | 否 |
| `SIGNATURE_UNAVAILABLE` | transient | 是 | item | 否 |
| `SIGNATURE_REJECTED` | protocol | 否 | adapter | 否 |
| `SCHEMA_CHANGED` | protocol | 否 | adapter | 否 |
| `WORK_PRIVATE` | access | 否 | item | 否 |
| `WORK_DELETED` | access | 否 | item | 否 |
| `COMMENTS_DISABLED` | access | 否 | item | 否 |
| `VERIFIED_EMPTY` | outcome | 否 | item | 否 |
| `MEDIA_URL_EXPIRED` | transient | 是 | item | 否 |
| `MEDIA_DOWNLOAD_FAILED` | transient | 是 | item | 否 |

`VERIFIED_EMPTY` 同时存在于指标/事件分类中，但正常适配器返回应优先使用分页结果的 `completion=verified-empty`，不应将其作为异常抛出。

只有登录失效和 CAPTCHA/安全验证被定义为需要用户操作。暂未就绪、导航超时、临时网络错误和签名对象尚未出现都不能进入旧的宽泛 `blocked_user_action`。

## 8. 范围指纹

`collection-scope/v1` 包含：

- 平台和本地 owner account 标识。
- 操作和目标实体 ID。
- 博主、作品、评论上限。
- `collection-only` / `with-media` 模式。
- 适配器名称与版本。
- 可选时间窗口。

范围对象经严格 schema 校验、键排序和 canonical JSON 序列化后生成：

```text
scope-v1:<sha256>
```

对象键顺序不影响指纹；范围、模式、实体、时间窗口或适配器版本任一变化都会产生新指纹。阶段 D 将使用该指纹替换当前过宽的 completed 去重判断，实现 `1/1/1` 到 `3/5/20` 的差量任务，而不是恢复或覆盖旧任务。

## 9. 阶段 A 测试边界

测试只读取仓库内的合成 fixture，并验证：

- mock 评论适配器的标准化结果、分页和来源证明。
- 原生 cid、作者、正文、计数和时间字段映射。
- 空页/尚有更多数据不能误判为已验证空结果。
- 错误策略不能被调用者篡改。
- 范围指纹对键顺序稳定，对范围和版本变化敏感。
- 请求参数、请求头、响应头采用白名单。
- 嵌套对象、自由文本和签名 URL 中的秘密被移除。
- canonical JSON 哈希不受对象键顺序影响。

测试没有访问浏览器、网络、正式数据库、用户数据目录或历史任务。

## 10. 后续阶段的进入条件

阶段 B 仍需用户单独批准真实访问及样本范围。获准前不得：

- 连接真实抖音或读取真实网络响应。
- 恢复 `#7/#8/#10/#11/#12/#13/#14/#16`。
- 执行新的 `3/5/20`。
- 写正式数据库或迁移 job 状态。
- 启用 `yt-dlp --cookies-from-browser`。
- 启动媒体、ASR、OCR 或云分析。

阶段 B 应写入隔离的临时测试目录，使用另行批准的 20～30 个代表性公开样本，对比 Network response、页面上下文结构化请求和旧 DOM shadow 路线。阶段 C 才实现正式 `DouyinCommentAdapter`，阶段 D 才修改任务系统和数据库状态模型。
