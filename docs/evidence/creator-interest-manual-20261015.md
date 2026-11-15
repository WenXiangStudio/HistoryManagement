# 兴趣度手动添加：APP 0.1.46

用户要求采用添加制，只将自行选定的博主放入高、中、弱三个分区，不必全量划分。此规则取代0.1.45仅预留框架的状态，不引入基于星标、批注、作品数量或兴趣作品的自动分类。

## 交付行为

- 资料库 → 兴趣度分组 → 高／中／弱 → “＋ 添加博主”，搜索当前账号已有资料库并逐位添加。
- 添加窗口每页最多20条简单行，显示主页身份及当前兴趣分区；已在本区的按钮显示“已添加”并禁用，位于另一区的可移入本区。
- 卡片兴趣度下拉框在活跃度和兴趣度视图均可使用；可直接添加或调整高／中／弱，选择“未添加”或点击“移出”清除成员关系，不删除博主资料。
- 同一账号、同一博主最多属于一个兴趣分区。未添加的博主保留在活跃度资料库，不进入任何兴趣分区。
- 兴趣度与活跃度、加降权、星标、批注互相独立。账号切换会关闭原账号添加窗口，迟到结果不会修改新账号画面或提示保存成功。
- 三个分区刷新按钮更新该分区内具备正常作品基线的已添加博主，包含未到期博主，不受当前搜索影响。异常／缺少基线的成员仍展示，可在卡片单独核验并补齐；按钮提示说明此边界。空分区、无合格成员、连接未就绪或正在采集时禁用刷新。

## 保存与性能边界

`creator_interest_memberships`以`owner_sec_uid + creator_sec_uid`为主键，保存兴趣分区、revision和时间。首次升级只建空表，不写任何博主成员关系。移出保留空分区值及revision以拒绝旧请求；重复选择同一分区不写入，不增加revision。后续同步、昵称改变和空结果不会覆盖手动选择。

主进程校验当前账号、目标主页身份、成员归属和revision后事务保存，发布`creator-interest`局部事件并修补已有读模型；前端等保存确认后更新分区，只禁用正在保存的博主。旧全量读取、其他账号事件及过期revision均有防护。沿用可视范围卡片虚拟化；添加窗口不会全量挂载302张卡片。

代码：`src/shared/creatorInterest.ts`、`src/main/creatorInterestStore.ts`、`src/main/followingSync.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/CreatorsPage.tsx`、`src/renderer/src/CreatorInterestPicker.tsx`。

## 验证

- 全部应用测试：78个文件、656项通过；TypeScript、生产构建、Windows打包、packaged-renderer冒烟通过。
- 新增回归覆盖：默认未添加、添加／移动／移出、账号隔离、重复及过期请求、异常成员、保存失败不提前移动、迟到读取保护、账号切换、分区刷新范围与搜索独立、分页搜索，以及重启和部分／空同步保留。
- 使用更新前正式两库备份的隔离副本，真实鼠标点击添加／移出并验证跨区移动、重启恢复。仅手动选择的2位测试成员有兴趣度，其余300位继续未添加。活跃度人数和全部博主原有字段逐项一致。
- 1120／1464／1680像素宽度下添加窗口均不横向溢出，每页最多20条；原生对话框Esc关闭、搜索和完成按钮正常；无渲染异常。
- 本次隔离副本4次添加／移出操作，从鼠标按下到确认界面已更新并经过两帧的观察值约81～98.4ms。此数据包含自动化50ms轮询检出与两帧等待，仅作为本次环境下交互可用的验证，不等同于精确服务耗时或长期性能保证。
- 日常APP更新为0.1.46.0，无调试端口及强制辅助功能参数，连接器0.8.12在线且ready。通过普通启动下UIAutomation检查三个分区、添加窗口20条、空区刷新禁用和活跃度加降权可用；没有点击正式添加或权重保存。完成后回到任务中心。
- 更新前后正式两库全部原行逐表散列一致，完整性ok、外键错误0；仅增加空`creator_interest_memberships`表。保留302位博主、95条视频、5条兴趣作品、正文报告、星标、批注、手动权重、加密凭据、运行及账号配置。
- 保持`max_tokens=128000`和原研究模型／超时配置。未启动浏览器采集、模型调用或正式兴趣分配。

本机原始记录与备份：`local-data/creator-interest-manual-20261015/`，包括`tests-full.log`、`types.log`、`build.log`、`package.log`、`packaged-renderer.log`、`candidate.json`、`candidate-ui.log`、`interest-high.png`、`interest-picker.png`、`daily-ui.json`、`daily-interest.json`、`deployment/before.json`、`deployment/after.json`及`deployment/before/`。候选包：`release-creator-interest-manual-046/win-unpacked/`。
