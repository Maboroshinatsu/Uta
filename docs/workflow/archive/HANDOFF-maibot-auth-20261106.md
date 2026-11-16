# Uta 交接现场

更新于 2026-11-06。上一轮见[小面板宿主切换归档](archive/HANDOFF-quick-host-switch-20261106.md)。

## 1. 仓库与版本

- 分支 `main`，本轮基线 `868d3f7`，开工时工作区干净。用 `git status --short --branch` 和 `git log -4 --oneline` 核对。
- MaiBot 适配器的就绪检查和写入接口要求派生 Bearer 凭据。Uta 主进程只给已绑定 MaiBot 的桌宠发起本机回环请求。具体契约见 [MaiBot 适配器](../../maibot-adapter/README.md)。

## 2. 运行现场

- 用 `Get-CimInstance Win32_Process` 核对开发实例，用 `Get-NetTCPConnection -LocalPort 8524 -State Listen` 核对 MaiBot 监听。验证使用隔离端口和模拟消息网关。现有开发实例及日常配置未操作。

## 3. 验证状态

- Node 请求实现直连 Python 回环入口，错误凭据被拒绝，正确凭据通过就绪探测和全部写入路由。适配器 19 项测试通过，应用测试 1374 通过、6 跳过，Node 与 Web 类型检查及隔离构建通过。

## 4. 已知未修问题

- 本机部分旧 Codex 聊天的名称只在 SQLite 状态库。Uta 不从 SQLite 补拉缺失的标题。Qoder 等未提供实际标题的连接器仍可能显示未获取标题。
- Codex 连接器共用客户端的逐次 `env` 会覆盖握手默认的 `UTA_HOST`。仅发布宿主共享端点时，握手可达，工作和完成事件可能找不到桌宠。
- MaiBot 适配器保留截图注入接口。Uta 气泡缺少附件发送入口，MaiBot 回推仅转发文本。

## 6. 下一步建议

- 实机复验时同步更新 Uta 和 MaiBot 插件。宿主固定与自动选择策略待确认。

## 7. 未核实项

- 未在真实 MaiBot 聊天中验证，未验收发行包。
