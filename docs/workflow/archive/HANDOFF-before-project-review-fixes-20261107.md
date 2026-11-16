# Uta 交接现场

更新于 2026-11-07。上一轮见 [Windows 全屏避让归档](archive/HANDOFF-windows-fullscreen-20261107.md)。

## 1. 仓库与版本

- Uta 分支 `main`，基线 `352837d`，开工时工作区干净。用 `git status --short --branch` 和 `git log -4 --oneline` 核对。
- 通用默认槽位共八个。Well actually 由大肥鱼动作包单独注册。通用预设迁移至 `default-preset-slots-v3`，清理旧内置 Well actually，保留用户覆盖和已删除的基础槽位。

## 2. 运行现场

- Antigravity 桌面进程正在使用 Frankenstein 工作区的 `uta-deskpet` 0.1.8，包含 `uta-live2d-motion`。`agy plugin list` 枚举的全局版本为 0.1.5。插件安装状态与桌面实际加载来源分别核对。
- 开发版已发布 Antigravity 专属端点，现场模型为大肥鱼。用 `Get-CimInstance Win32_Process` 核对 MCP 进程归属，并用端点文件对 `/health` 与 `/context` 发起只读探测。

## 3. 验证状态

- 工作区安装包的 MCP 握手和 `deskpet_motion capabilities` 通过，实读大肥鱼的九个槽位。隔离隐藏的 Electron 中，Hiyori Pro 返回八个槽位和十个自带动作，`compile_preset` 编译开心槽位草稿成功。
- 应用测试 1382 通过、6 跳过，类型检查和隔离构建通过。

## 4. 已知未修问题

- 本机部分旧 Codex 聊天的名称只在 SQLite 状态库。Uta 不从 SQLite 补拉缺失的标题。Qoder 等未提供实际标题的连接器仍可能显示未获取标题。
- Codex 连接器共用客户端的逐次 `env` 会覆盖握手默认的 `UTA_HOST`。仅发布宿主共享端点时，握手可达，工作和完成事件可能找不到桌宠。
- Uta 气泡缺少附件发送入口。两类伴侣的部件控制、状态重置、单轮语气、跨设备连接及旧版数据导入仍待实施。截图和摄像头不在当前批次。

## 6. 下一步建议

- 用更新后的开发版切到 Hiyori Pro，在 Frankenstein 的 Antigravity 会话里让 Gemini 读取 `deskpet_motion` 的 `capabilities` 并用 `compile_preset` 编排可导入草稿。导入前复核动作观感。

## 7. 未核实项

- Gemini 的真实会话工具选择、整套草稿导入和画面观感尚未验收。开发版原有进程和插件安装保持现场状态。独占全屏游戏、多显示器和发行包仍待验收。
