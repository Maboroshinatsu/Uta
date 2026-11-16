# Uta 交接现场

更新于 2026-11-05。上一轮见 [Antigravity 动作编排归档](archive/HANDOFF-antigravity-motion-presets-20261105.md)。

## 1. 仓库与版本

- 主目录 `D:/Frankenstein/Uta`，分支 `main`，本轮基线 `33d740f`。用 `git status --short --branch` 与 `git log -4 --oneline` 核对现场。
- 本轮修复两个设置窗口之间的模型同步、模型列表折叠和通用视线跟随。详见[验证记录](results/model-picker-gaze-20261105.md)。

## 2. 运行现场

- 实窗使用复制模型、独立 Electron 配置和端点。日常实例需通过开发入口重新构建并启动后才能使用本轮代码。用 `Get-CimInstance Win32_Process` 核对实例。

## 3. 验证状态

- Electron 实窗完成双窗切换、短列表和长列表收起，以及冰糖、RetrynowMiku、miku、大肥鱼的跟随检查。类型检查、隔离构建和应用测试通过。

## 4. 已知未修问题

- 正式模型性能档案仍受资源扫描上限约束。未能确定身体输入的模型需要显式 `focus` 映射才能控制对应的身体轴。

## 6. 下一步建议

- 用实际日常运行配置验收模型切换。遇到新的模型跟随问题时，先检查模型 Core 参数与物理输入，再确定是否需要模型专用映射。

## 7. 未核实项

- 日常实例与发行包尚未更新。上一轮的 Antigravity 客户端技能发现和真实账号对话尚未验收。
