# APP内账号、浏览器配置与资料隔离 · 2026-10-03

用户希望账号/连接相关配置可在APP管理，避免以后换账号修改代码。本轮保留已实测的无DOM数据通路，新增设置卡、显式当前账号与浏览器profile配置，并验证当前真实账号配置及资料保留。

## 产品入口

APP 设置 → **关注账号与浏览器**。

| 项目 | 用户操作 |
|---|---|
| Chrome用户配置 | 从本机Default/Profile列表选择并保存；显示扩展是否已安装 |
| 当前资料账号 | 从已经绑定的原生账号选择，各账号有独立数量和资料 |
| 账号备注名 | 用户填写本地备注，重开保留 |
| 接口确认昵称 | 自动显示当前原生账号昵称 |
| 绑定新账号备注 | 可填，留空使用账号昵称 |
| 目标主页链接 | 可选；填写后校验接口返回的sec_uid确为目标 |
| 登录/切换账号 | 打开所选Chrome profile账号页，由浏览器完成登录 |
| 浏览器连接 | 新profile首次绑定其扩展连接，后续自动恢复 |
| UID、主页、扩展版本及目录 | 自动显示，供核对；不是手填登录凭证 |

平台API path为公共接口，不随登录账号改变。用户切换的是浏览器会话和原生账号，而非API URL、Cookie、session token或扩展ID。结构化接口仍为self→following身份绑定，账号配置不能绕过真实身份验证。

## 实现与保存

浏览器profile选择和活动账号存入产品profile的`following-settings.json`；扩展为每个Chrome profile生成持久connectorId，APP按选中的profile接受对应连接，切换陌生profile通过该profile的本机连接页一次绑定。账号native uid/sec_uid、nickname/本地label和chrome_profile保存到已有账号元数据表。

切换或绑定时按钮重新锁定，接口准备通过后解锁。绑定失败可取消。资料store改为按明确选择的账号查询，拥有相同昵称或共同关注博主的不同账号不能混用作者ID、星标和批注。旧账户所有资料留库并可以选回；新账号暂无run时返回空资料而非其他账号最近结果。当前旧目录的legacy来源保留；新账号不按昵称自动继承旧数据。

## 真实验证

使用当前 无限♾️进步，原资料160位，Chrome Default。先保存“配置验证”备注，再通过接口按该账号具体主页重新绑定并恢复原备注；接口返回原生uid/sec_uid一致，按钮解锁。重开原APP入口后profile选择/原生账号/connector映射恢复，设置页能显示当前账号和160位。

原四张目录表、160位作者原字段及星标/批注、历史run/report逐行一致；数据库integrity ok、外键违规0。本轮没有新增博主、没有新的采集run。只变更账号元数据与配置文件。

相关13项通过：目录9、结构化/账号隔离3、配置文件恢复1。临时库验证两个昵称相同账号关注同一组作者，彼此作者ID、星标、批注不同；切回原账号恢复原批注。TypeScript、构建、最终packaged renderer及实际设置页视觉核对通过。

实际登录另一个账号或在另一Chrome profile安装连接尚未实测，因没有用户提供的第二登录会话；本轮没有替用户登出当前账号。可操作入口已具备，不把临时库检查称作第二真实账号验收。

当前原入口`release-following-background-final/win-unpacked/Signal Desk.exe`，扩展0.5.1已加载，APP设置页置前；另留`release-following-account-config-final`包。代码/证据未提交推送，未发布安装器。

- [真实配置保存/绑定与界面检查](artifacts/configuration-validation.json)
- [原160位及历史表核对](artifacts/verification.json)
- [设置页截图](app-settings.png)
