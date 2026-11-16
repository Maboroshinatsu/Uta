# Uta 交接现场

更新于 2026-11-07。上一轮见 [MaiBot 工具归档](archive/HANDOFF-maibot-tools-20261107.md)。

## 1. 仓库与版本

- Uta 分支 `main`，基线 `4ca0821`。独立 `astrbot-plugin-uta` 分支 `main`，基线 `d87ffcf`，插件提交 `872dbe9`。两边开工时工作区干净。
- Uta 主进程为 MaiBot、AstrBot 按宿主分别派生本机鉴权凭据。AstrBot 2.0 将桌宠私聊送入原生事件队列，按会话回传文字与图片，只允许 Uta 私聊调用角色和表情包工具。表情包由 AstrBot 插件的数据目录提供。

## 2. 运行现场

- 用 `Get-CimInstance Win32_Process` 核对开发实例，用 `Get-NetTCPConnection -LocalPort 8526 -State Listen` 核对 AstrBot 监听。本轮使用隔离回环和真实 AstrBot SDK。

## 3. 验证状态

- AstrBot SDK 测试 6 项通过，覆盖鉴权、原生事件入队、图文回传、工具隔离、换模和本地表情包。MaiBot 回归 22 项通过，Uta 应用测试 1377 通过、6 跳过，类型检查和隔离构建通过。

## 4. 已知未修问题

- 本机部分旧 Codex 聊天的名称只在 SQLite 状态库。Uta 不从 SQLite 补拉缺失的标题。Qoder 等未提供实际标题的连接器仍可能显示未获取标题。
- Codex 连接器共用客户端的逐次 `env` 会覆盖握手默认的 `UTA_HOST`。仅发布宿主共享端点时，握手可达，工作和完成事件可能找不到桌宠。
- Uta 气泡缺少附件发送入口。两类伴侣的部件控制、状态重置、单轮语气、跨设备连接及旧版数据导入仍待实施。截图和摄像头不在当前批次。

## 6. 下一步建议

- 实机复验时同步更新 Uta 与 AstrBot 插件 2.0，使用真实会话验证工具选择和桌宠实窗。宿主固定与自动选择策略待确认。

## 7. 未核实项

- 未在实际 AstrBot 账号和桌宠窗口中端到端验收，未验收发行包。
