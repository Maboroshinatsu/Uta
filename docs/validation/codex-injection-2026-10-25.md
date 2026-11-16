# Codex 新安装与适配专项验收

日期：2026-10-25。基线：`main/74d971b58d24740d962d21eae78d7b3b57802d7a`。本轮检查安装与适配，不修改业务实现。

## 结论

**新配置下的自动安装有效；单会话的 MCP、工作状态、完成摘要和审批协议基本可用，但还不能评价为完整、稳健的 Codex 适配。** 本轮新确认 3 项问题：无会话身份的 MCP 可以影响已绑定聊天；拒绝发言工具仍抑制最终回复；只信任一个 hook 就被 Uta 判断为 hooks 已信任。

首次使用不是零操作接入：需要系统 PATH 中的 `node`，安装后新建 Codex 会话，并由用户审查、信任 hooks。这符合 [OpenAI 插件信任规则](https://developers.openai.com/plugins/build/plugins) 和 [hooks 文档](https://learn.chatgpt.com/docs/hooks)，安装器不能把安装成功当成已获得 hook 信任。

本轮验证的是实际 Codex 进程、随包插件以及生产桥接模块。**没有操作候选 Uta.exe 的安装按钮，没有验证新一轮真实角色画面或声音，也没有完成反向输入的端到端验收。**

## 对象与隔离

| 对象 | 本轮现场 |
| --- | --- |
| 候选 | `0.2.0-alpha.11` ZIP 解压版 |
| ZIP SHA-256 | `68143ab8c33600a16854d8136969ec2a5021bad0a791688a08066ec1d8ffe86a` |
| 包来源 | `3dd17fe8749a17011754e812520ef37fb76b30fb`，干净构建；有关生产源码至本轮基线无变更 |
| 安装资源 | `app/release/Uta-0.2.0-alpha.11-win-x64/resources/uta-plugins/codex-marketplace` |
| 插件 | `uta-deskpet@uta`，`0.2.2`；MCP server `deskpet-mcp/0.4.0` |
| 实际 Codex | `codex-cli 0.164.0-alpha.11.1`，本机桌面应用附带的原生 exe |
| Uta 测试 profile | `codex-check-20261025` |
| 独立环境 | `.tmp/codex-injection-20261025/codex-home`、`uta-data`、`dsh-home` |

独立 CODEX_HOME 初始 `plugin list --json` 的 installed/available 均为空。未复制日常认证或私人配置；未使用真实模型 API。生命周期测试使用只监听 `127.0.0.1` 的固定 Responses 输出，让真实 Codex 处理消息、执行 MCP、发出 hooks；这证明客户端接入链路，不证明远端模型的调用意愿或回答质量。

实际 MCP 测试清除了外层开发会话继承的 `UTA_SESSION_ID`、`CODEX_THREAD_ID`、`CODEX_SESSION_ID`，避免把父会话身份误当成新聊天身份。第一轮保留父环境的探针已单独存档，不用于新安装会话归属结论。

## 已验证的链路

| 检查 | 结果与证据边界 |
| --- | --- |
| 首次自动安装 | 使用生产 `createHostOnboarding()`，不替换其命令执行器，调用真实 Codex CLI，资源来自候选包。首次返回 `ok:true`，实际安装并启用 `uta-deskpet@uta/0.2.2` |
| 重复安装 | 返回“无需重复安装”；独立 config.toml 字节哈希未变化 |
| 安装状态措辞 | MCP 登记后仍标为 pending，并提示新会话、hooks 信任；没有把配置存在冒充握手通过 |
| 插件与 hook 发现 | 实际 app-server 识别随包插件及 8 个 hook，无加载错误；初始全部 untrusted |
| 默认未信任行为 | 真实 Codex 完成一轮固定回答，Uta 桥未收到任何 hook 指令，符合跳过未信任 hooks 的约定 |
| MCP 握手与工具注册 | 新建真实 app-server thread 后，`mcpServerStatus/list` 返回 `connected`，5 个工具齐全，`toolsError:null` |
| 5 个 MCP 工具 | 通过真实 app-server 的 MCP 调用接口逐个调用能力查询、通知、表情、预设、动作；能力查询读到测试模型上下文，其他 4 项到达真实生产 HTTP 桥。接收端是受控回调，不据此声称角色已渲染 |
| 信任后的工作状态 | 在独立测试配置里为已审阅的 8 个 hook 写入当前定义信任，实际 hooks/list 全部 trusted；未使用全局绕过信任参数 |
| 普通完成摘要 | 真实 SessionStart → UserPromptSubmit → Stop；桥收到正确的 session/turn 身份、idle/thinking/completed 及固定回复的 rp_reply |
| 工具执行前后 | 由固定模型输出发起真实 MCP 调用；实际 PreToolUse → PermissionRequest → PostToolUse 事件执行完成，工作状态进入执行中再回到处理结果 |
| 审批允许与拒绝 | 生产桥用受控审批回调返回 allowed-once / rejected，真实 Codex 分别执行 / 拒绝工具；审批请求带正确 sessionId。没有点击真实审批卡片 |
| 应用相关回归 | 83/83：安装检测、host bridge、插件适配、会话偏好/作用域、运行指令、运行时会话与 HTTP 桥 |
| 插件回归 | 103/103，0 失败、0 跳过 |

## [P2: 无会话身份的 Codex MCP 绕过已绑定聊天]

位置：`plugin/plugins/deskpet-mcp/server.mjs:20–26`、`app/src/renderer/services/session-scope.ts:28–31`。

MCP 在进程启动时只从环境变量取得 sessionId。实际 app-server 新建的干净聊天没有为它提供这三个变量，所以 MCP 指令只有 `hostId: codex`，没有 sessionId；生产 `SessionScope` 对这种指令按宿主直接放行。

复现：

1. 安装随包插件，清除父会话变量，启动真实 Codex app-server。
2. 建立测试聊天 A，走过一轮正常会话并收到带 A 身份的 hook。
3. 创建另一个真实聊天 B，通过 app-server 的 `mcpServer/tool/call`，明确指定 B 调用 `deskpet_notify`。
4. 桥收到通知，但元数据无 sessionId；将生产 `RuntimeCommandController` 绑定到 A，再交入该实际通知，`chat.showChatMessage` 仍被调用。

结果：另一个聊天能影响已经绑定 A 的气泡。真实模型发起的 MCP 通知也同样缺少 sessionId，所以不只是在测试调用接口里出现的元数据形状。相比之下，hooks 和审批请求都能携带正确的 sessionId。

应为 MCP 补上可靠的逐次调用归属，或在已有明确绑定时保守处理无法确认归属的命令。不能用“最近聊天”文件猜身份，也不能把外层环境中的旧会话 ID 当作当前聊天。

本复现直接验证了生产控制器的绑定过滤；没有声称完成设置页“固定会话”按钮或真实气泡画面的验证。

## [P2: 被拒绝的桌宠发言工具仍抑制最终回复]

位置：`plugin/shared/uta-host-hook.mjs:530–535、549–554`；最终抑制在同文件 `294`。

`PreToolUse` 就写入“桌宠已经说话”的标记，尚未等工具成功。Stop 随后消费标记，跳过最终回复摘要。

复现：

1. 信任测试环境里的 hooks，新建审批策略为 on-request 的真实 Codex 聊天。
2. 固定模型输出依次请求能力查询和 `deskpet_notify`。
3. 受控审批回调返回 rejected，实际 Codex 的两个工具状态均为 failed，错误明确为用户在 Uta 审批卡片拒绝。
4. 模型随后仍输出固定的最终回答，实际 agentMessage 和 Stop 正常完成。

结果：桥既没有收到成功通知，也没有收到任何 rp_reply，只剩 completed 状态。普通不调用发言工具的对照组有 rp_reply；成功通知组只说一次是预期去重。

应只在确认发言成功后记录去重标记；拒绝、工具错误或投递失败不能算已发言。修复时同时回归成功通知不重复、拒绝后保留最终摘要、离线失败后恢复。

## [P2: 单个 hook 的信任记录使整组状态误报]

位置：`app/src/main/host-onboarding.ts:194–211、337–339`。

`codexHooksTrusted()` 找到任意一个 Uta hook 段含 trusted_hash 就返回 true，没有检查其余 hook 或当前定义是否仍被 Codex 信任。

复现：只为 SessionStart 写入本机 Codex 报告的当前信任哈希，其他 7 个保持未信任，重新启动实际 app-server。

结果：Codex hooks/list 为 **1 trusted + 7 untrusted**；Uta 的生产检测函数却返回 true，检测页面会显示“hooks 已信任”。用户会遇到“会话启动有效，但思考/完成/审批没有同步”，同时 Uta 没有继续提示信任。

应以 Codex 返回的逐项信任状态为准，至少区分未信任、部分信任、定义变更与所需项全部已信任。配置里存在旧 trusted_hash 本身不能证明当前 hook 可执行。

## 限制与保留事项

- **反向输入未完成实机闭环**：Uta 的 `queue --thread <id> --message <text>` 参数确实被本机 CLI 支持。但在独立 CODEX_HOME 启动 daemon 时，该桌面附带 exe 返回“this CLI has no complete local package”；尝试独立 Unix transport 也未在限定时间内取得可连接的控制端点。没有把消息发到日常聊天，也没有安装/替换用户 CLI。此项记为当前测试环境阻塞，不作为已经确认的 Uta 缺陷，也不能标为通过。
- **GUI 与声音未覆盖**：安装器调用的是生产服务与真实 CLI，但不是本轮真实首次引导点击；桥接回调不是 Electron 角色窗口。真实动画、气泡、TTS、审批卡片点击仍需在候选实例验证。
- **只验证当前 Codex 版本和本机环境**：没有证明所有旧版 Codex、无 Node 的新电脑或其他系统都支持插件。缺 Node 时，安装器会明确中止；候选包没有为 Codex 自动部署 Node。
- **退出与中断**：8 个 hook 的发现/信任均已验证；本轮真实执行覆盖 SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、PostToolUse、Stop。SessionEnd、Interrupt 的实际宿主触发未单独完成，只有既有插件回归通过。
- **两项兼容告警**：清单中 SessionEnd/Interrupt timeout=5，当前 Codex 自动裁到 3 秒并警告，没有导致插件加载失败。可按官方上限清理清单。
- **已知安装并发缺口仍保留**：[alpha.11 独立验收](../ACCEPTANCE-2026-10-25-ALPHA11.md) 的 `[P1: 安装互斥按 Uta profile 隔离，不能保护共享 Codex 配置目录]` 未在本轮修复；本次单实例安装通过不能覆盖该结论。

## 现场与后续

探针与日志仅在忽略目录 `.tmp/codex-injection-20261025/`：`install.cjs`、`app-probe.cjs`、`lifecycle.cjs`、`queue.cjs`、`rpc.cjs`，以及各自结果和测试日志。它们包含本机路径或测试会话记录，不提交仓库。

结束时已核对：本轮 Codex app-server、MCP 与 Node 服务没有遗留进程；Uta 测试端点已删除；测试配置已恢复为安装后状态；日常 Codex config.toml 哈希与开始时一致；日常 Uta 设置和实例未改动。用户原有 `docs/AGENT-PORTABILITY-PLAN.md` 的修改保留，未暂存。

下一步先修复上述会话归属、失败去重和信任状态三项，再处理已知共享安装锁；最后使用完整 Codex 安装环境补反向输入，并在打包候选完成安装、实际气泡和审批点击验收。本轮只提交专项验收文档与交接入口。
