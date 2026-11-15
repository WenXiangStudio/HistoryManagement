# 最近采集结果标题强调：APP 0.1.30

用户指定标题及时间加大加粗，颜色OrangeRed RGB(255,69,0)／#FF4500。后续明确取消文字下划线，采用参考图中标题与下方新增作品之间的横向分隔线。

仅修改标题样式：字号从10px增至13px，字重700，颜色#FF4500；标题容器底部增加1px灰色实线，标题与线间留7px间距。绿色本轮标记保留其独立样式。

候选包与日常APP实际计算样式验证：标题及时间均为rgb(255,69,0)，字号13px，字重700，textDecorationLine为none，borderBottomWidth为1px，borderBottomStyle为solid。实际页面与1120宽度无水平溢出、渲染错误0，原统计区间与累计记录可展开。生产构建和打包renderer冒烟通过。

日常APP已部署0.1.30，连接器仍0.8.7 online/ready。恢复正常启动且没有调试端口，停留在资料库低频卡片。两库全部原表行哈希、模型凭据、runtime、账号配置保留。未启动新的采集或模型调用。

本地备份、审计及计算样式回执在 `local-data/creator-card-heading-20261013/`。最终app.asar SHA256：`83cb777eb44703947fbba0b0ab90e8c64254af219a3c383f9024ae25cf70bafe`。

[实际卡片效果](saved-card-panel.png)
