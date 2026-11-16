# Uta 交接现场

更新于 2026-11-05。上一轮见[待办设置与会话标题归档](archive/HANDOFF-todo-settings-titles-20261105.md)。

## 1. 仓库与版本

- 主目录 `D:/Frankenstein/Uta`，分支 `main`，基线 `e8b395f`。用 `git status --short --branch` 与 `git log -4 --oneline` 核对现场。
- 本轮完成 Live2D 标定 skill 与实验帧校验、工坊滑块换向与原生循环释放、宿主动作时间线能力。详见[验证记录](results/live2d-host-choreography-20261105.md)。

## 2. 运行现场

- 实窗使用复制的模型、独立 Electron 配置和端点。用 `Get-CimInstance Win32_Process` 核对当前实例与实验进程。现用开发配置、原始模型和各宿主全局安装均保留。

## 3. 验证状态

- 隔离构建、类型检查、应用与插件测试通过。Codex 形态的 MCP 实窗覆盖双轨播放、宿主完成事件、显式停止、跨宿主与跨会话拒绝及切模失效。OpenCode 1.14.31 隔离服务器确认 MCP 自动挂载。
- 六个兼容性样本关闭工坊后，Cubism 队列都已结束，等过下一轮也未续播。

## 4. 已知未修问题

- 大贴图模型可由实验工具生成实验指纹。Uta 正式性能档案仍受现有资源扫描上限约束。

## 6. 下一步建议

- 在更新后的宿主连接器与日常 Uta 发行包中验证自然语言编排、播放和停止。

## 7. 未核实项

- Claude Code、Qoder、ZCode 和 Antigravity 已核对随包 MCP 的工具发现。DeepSeek Harness 已核对原生技能和工具注册及精确会话请求。真实账号对话和日常发行包仍需分别验收。
