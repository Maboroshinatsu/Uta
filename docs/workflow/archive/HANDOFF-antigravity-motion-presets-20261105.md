# Uta 交接现场

更新于 2026-11-05。上一轮见[宿主动作编排归档](archive/HANDOFF-live2d-host-choreography-20261105.md)。

## 1. 仓库与版本

- 主目录 `D:/Frankenstein/Uta`，分支 `main`，基线 `aafc899`。用 `git status --short --branch` 与 `git log -4 --oneline` 核对现场。
- 本轮完成 Antigravity 内置编排 skill、工作区连接器更新，以及默认预设草稿编译。详见[验证记录](results/antigravity-motion-presets-20261105.md)。

## 2. 运行现场

- `D:/Frankenstein/.agents/plugins/uta-deskpet` 已更新到 `0.1.8`，旧目录保存在工作区 `.agents/plugin-backups/`。实窗使用复制的模型、独立 Electron 配置和端点。用 `Get-CimInstance Win32_Process` 核对当前实例与实验进程。

## 3. 验证状态

- 隔离构建、类型检查、应用与插件测试通过。用工作区安装目录的 MCP 连接 Antigravity 绑定的隔离 Uta，验证播放、停止、切模失效和默认预设草稿导入。

## 4. 已知未修问题

- 大贴图模型可由实验工具生成实验指纹。Uta 正式性能档案仍受现有资源扫描上限约束。

## 6. 下一步建议

- 在 Antigravity 中刷新工作区插件，运行包含本轮代码的 Uta 并绑定 Antigravity，再验收自然语言调用。

## 7. 未核实项

- Antigravity 客户端的技能发现和真实账号对话尚未实测。日常 Uta 发行包尚未更新。
