# DSH 宿主身份统一整合（2026-11-05）

本轮接续进入工作区时已有的 DSH 改名改动，基线 main@c6f4f13。统一协议、绑定、发现、发送和审批使用 `deepseek-harness`。

- 旧磁盘绑定、localStorage 和启动参数中的 `harness` 读取时归一化；bind/rebind 也不会再写回旧 ID。
- 原生桥改用 `deepseek-harness-native-bridge.json`，与主进程按宿主 ID 推导的路径一致。
- 保留 `harness-session.json`、`deepseek-events.jsonl`、路径配置键和环境变量；旧、新 ID 都映射到已有 `dsh-todo` 计划源。
- 原先未提交的现场说明已保存在 `../archive/HANDOFF-host-id-before-20261105.md`，其中旧进程和测试结果仅作历史。

验证：安装归档里的 `@deepseek-ai/cordis` 4.0.5 实际加载插件，真实事件总线 `approval/request` 返回单次批准，并正确携带宿主 ID 与指定会话。证据：[dsh-cordis.json](../../validation/host-adapters-20261105/dsh-cordis.json)。

独立 Uta 窗口验证了旧启动参数迁移、状态/回复可见、审批按钮回执、其他宿主指令被拒，以及受控原生桥仍投递指定会话。

这不代表 DSH 桌面真实模型回合或日常打包版已验收；本轮没有改写日常 profile，也没有重启用户宿主。
