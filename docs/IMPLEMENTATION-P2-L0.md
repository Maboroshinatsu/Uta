# P2 实施记录：Codex L0 角色工具

日期：2026-10-11。基线：P1（U3-01）之后的源码。

**状态：代码与自动化测试完成。未安装到用户 Codex，未修改用户 config.toml，未启用 hooks，未触碰麦克风/录音/VAD/PTT。**

## 1. 范围

按用户选择，只做 **P2 的 L0 部分**（MCP 角色工具）。不含 L1 hooks、不含会话正文、不含双向输入。

## 2. 架构

```
Codex ──MCP stdio──> deskpet-mcp ──HTTP 127.0.0.1 + Bearer token──> 桌宠 Runtime ──> 角色
```

选择这种结构的原因：

- 宿主插件保持**轻量**（一个清单 + 一个 MCP 服务器 + 启动器），符合用户「先发轻量宿主插件」的决策；
- 桌宠 Runtime 不必暴露在网络上，只开一个仅回环的短生命周期端点；
- 将来接 Harness 时复用同一 Runtime 与同一套校验，只需换宿主侧适配。

## 3. 运行时侧（deskpet-app）

| 文件 | 职责 |
|---|---|
| `src/main/runtime-commands.ts` | 白名单校验与文本归一化（纯函数，无依赖） |
| `src/main/runtime-bridge.ts` | 仅回环 HTTP 端点，Bearer 令牌，`POST /command` 与 `GET /health` |
| `src/main/index.ts` | 启动/关闭端点；失败只降级，不阻止桌宠启动 |
| `src/preload/index.ts` + `env.d.ts` | 新增 `onRuntimeCommand` 通道 |
| `src/renderer/components/DeskpetStage.vue` | 订阅并应用角色指令（气泡/情绪/动作） |

安全约束：

- 只绑定 `127.0.0.1`，不监听局域网（有测试验证）；
- 所有路由（含 `/health`）都要求实例级随机 Bearer 令牌，常量时间比较；
- 请求体上限 8KB；路由与方法白名单；
- 指令白名单：`notify` / `set_emotion` / `play_animation`，未知指令一律拒绝；
- 文本去控制字符/零宽字符、压缩空白、截断到 200 字符；标识符只允许 `[A-Za-z0-9_-]{1,32}`；
- **不提供**命令执行、文件读写、URL 访问、审批操作；
- 令牌写入 `userData/runtime-endpoint.json`（权限 0o600），退出时删除。

`/health` 只做无副作用探测——**不发送任何指令**（避免健康检查弹出空气泡）。

## 4. 宿主侧（codex-plugin/）

| 文件 | 职责 |
|---|---|
| `.agents/plugins/marketplace.json` | 本地市场清单 |
| `plugins/deskpet-mcp/.codex-plugin/plugin.json` | 插件清单 |
| `plugins/deskpet-mcp/.mcp.json` | MCP 服务器声明 |
| `plugins/deskpet-mcp/server.mjs` | stdio MCP 服务器（手写 JSON-RPC，无 SDK 依赖） |
| `plugins/deskpet-mcp/scripts/launch_deskpet_mcp.cmd` | 自定位启动器，复用 Codex 自带 Node |

因为项目没有 MCP SDK，服务器**手写 JSON-RPC 子集**：`initialize` / `notifications/initialized` / `ping` / `tools/list` / `tools/call`，并正确返回 `-32601` 方法不存在。

协议版本按客户端请求回显（受支持时），未知版本回落到已知版本。

## 5. 验证结果

| 验证 | 结果 |
|---|---|
| runtime-commands（校验/归一化） | 10/10 通过 |
| runtime-bridge（真实回环 HTTP + 替身 Electron） | 10/10 通过 |
| mcp-server（真实子进程 + stdio + 假端点） | 14/14 通过 |
| test:no-mic 汇总 | **138/138，退出码 0** |
| Node / Vue 类型检查 | 通过 |
| 生产构建 | 通过 |
| 测试临时目录残留 | 0（已加自动清理） |
| 真实 Codex 安装 | **已安装**（用户执行，插件注册成功） |
| MCP 服务器按 Codex 调用方式握手 | 通过（真实子进程 + stdio） |
| L0 真实端到端（Electron + 端点 + MCP） | **17/17 通过** |
| 麦克风/录音/VAD/PTT | 未执行（用户暂停） |

`test:no-mic` 现为：L0 20 + MCP 14 + host 24 + model 27 + trust 46 + imageset 7。

重点覆盖：

- 无令牌 / 错误令牌 / 截断令牌一律 401；
- 未知路由 404、错误方法 405、非法 JSON 400、超大体 413；
- `run_command` / `read_file` 等非法指令**在触达渲染层之前**被拒绝；
- 令牌与端口写入配对文件，关闭时删除；
- 端点**不在局域网地址上可达**（有网卡时实测）；
- 桌宠未运行时工具返回可读错误而不是挂起；
- 启动器从无关工作目录也能定位服务器；
- stdout 只有协议帧，日志走 stderr。

## 5.1 真实端到端验证（2026-10-11）

用**与 Codex 完全相同的调用方式**（`cmd.exe /d /s /c call ./scripts/launch_deskpet_mcp.cmd`）启动 MCP 服务器，配合隔离的真实 Electron 桌宠，验证结果：

| 检查 | 结果 |
|---|---|
| 运行时端点写入（含令牌与端口） | ✅ |
| MCP initialize / tools list（4 个工具） | ✅ |
| 运行时变为就绪 | ✅（221ms） |
| notify / set_emotion / play_animation | ✅ |
| 指令到达渲染层（IPC） | ✅ |
| 聊天 store 收到消息 | ✅ |
| 气泡元素渲染 + 文本出现在 DOM | ✅（bubbleCount=2） |
| 非法指令被拒绝 | ✅ |

期间发现并修复 DP-024（启动期指令被静默丢弃却报成功），详见问题台账。

## 6. 边界与遗留

- 插件已装入真实 Codex 并注册成功；但**尚未在真实 Codex 会话中调用过工具**（端到端验证使用的是与 Codex 相同的启动方式，不是 Codex 本身发起的调用）。
- 桌面应用需处于运行状态；未运行时工具返回可读错误。
- 配对文件路径基于 `%APPDATA%` 与 productName 推断；开发态与安装态的 userData 目录名需在真实安装后核对。
- 只做了事件/指令的**单向** L0；L1 hooks、会话正文、双向输入未开始。
- 端点是**每进程随机端口**，重启后端口与令牌都会变化；宿主插件每次调用重新读取配对文件，因此不受影响。
- 未做多实例桌宠区分；同时运行两个桌宠实例时，后写入者覆盖配对文件。

## 7. 相关文档

- [P0 Codex 勘察](D:/Frankenstein/maibot-deskpet-plugin/docs/P0-CODEX-SURVEY.md)
- [U3-01 宿主边界](D:/Frankenstein/maibot-deskpet-plugin/docs/IMPLEMENTATION-U3-01.md)
- [插件包说明](D:/Frankenstein/maibot-deskpet-plugin/codex-plugin/README.md)
- [可移植方案](D:/Frankenstein/maibot-deskpet-plugin/docs/AGENT-PORTABILITY-PLAN.md)
