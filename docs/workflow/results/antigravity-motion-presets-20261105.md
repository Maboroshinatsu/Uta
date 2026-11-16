# Antigravity 动作编排和默认预设草稿

- 工作区插件升级至 `0.1.8`。旧安装从插件发现目录移到备份目录。全局插件保留。
- 插件 ZIP 内含 `uta-live2d-motion` skill 与 `deskpet_motion`。Uta 安装器使用 Antigravity 的全局插件目录，并显示实际安装版本。发现安装文件时工具状态仍待宿主确认。
- `capabilities` 返回当前角色通道和内置默认预设槽位。`compile_preset` 沿用槽位 ID 和分组，校验当前模型版本、通道、时序及循环终点，返回可合并的 `uta-user-presets` 草稿。编译过程没有播放或写入动作库。
- 用工作区安装目录的 MCP 连接 Antigravity 绑定的隔离 Uta，实窗验证 miku 双轨动作和停止回正。切到 RetrynowMiku 后旧版本请求被拒绝。使用现有编排计划编译 20 条草稿，覆盖 16 个分组，合并后通过 Uta 导入。
- Node 与 Web 类型检查、隔离 Electron 构建、Antigravity ZIP 构建通过。应用测试 1350 通过、6 跳过，插件测试 133 通过。真实账号会话中的自动 skill 选择尚未验收。
