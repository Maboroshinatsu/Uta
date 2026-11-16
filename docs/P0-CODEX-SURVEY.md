# P0 宿主接入面勘察：Codex 桌面应用

日期：2026-10-11（Asia/Shanghai）。范围：仅 Codex；DeepSeek Harness 部分待用户确认安装后再补。

**性质：只读勘察 + 隔离实测。未修改用户的 Codex 配置，未安装任何插件到真实环境，未触碰麦克风/录音/VAD/PTT。**

## 1. 结论摘要

**Codex 侧接入面完整可用，L0 与 L1 均有可行路径，且分发链路已实测打通。**

三条关键链路全部证实：

1. **第三方插件分发**：本地路径与 Git 仓库市场均支持，隔离环境下完整走通「添加市场 → 安装插件 → installed, enabled」。
2. **生命周期 hooks**：12 个事件全部存在于已安装二进制；本机有**已启用的 bundled 插件正在使用 hooks**；存在信任审查机制。
3. **MCP 工具**：`[mcp_servers.*]` 已配置，插件可捆绑 `.mcp.json`，有官方范例。

因此**不必降级为纯工具模式**，原计划的 L0+L1 首期目标成立。

## 2. 目标版本（固定）

| 项 | 值 |
|---|---|
| 桌面应用版本 | **26.1002.52244**（build 13536，prod 通道） |
| MSIX 包版本 | 26.1002.7124.0（系统报告 `restart_required`，有更新待重启） |
| CLI 路径 | `%LOCALAPPDATA%\OpenAI\Codex\bin\9691020b546a15b2\codex.exe` |
| 桌面应用路径 | `C:\Program Files\WindowsApps\OpenAI.Codex_26.1002.7124.0_x64__2p2nqsd0c76g0\app\` |
| 配置目录 | `%USERPROFILE%\.codex` |

注意：桌面应用版本号与 MSIX 包版本号不同源（52244 vs 7124）。实施时以**实际运行版本**为准，并在升级后重新核对。`restart_required` 说明升级会改变宿主行为，P2 前应重启到稳定版本再定稿。

## 3. 插件机制（已实测）

### 3.1 目录与清单格式

插件包（以本机 `codex-app-tools` 为例）：

```
<plugin>/
├── .codex-plugin/plugin.json     # 插件清单（必需）
├── .mcp.json                     # 可选：捆绑 MCP 服务器
├── skills/<name>/SKILL.md        # 可选：捆绑 skills
└── hooks/hooks.json              # 可选：也可内联在 plugin.json
```

`plugin.json` 已证实的字段：

```json
{
  "name": "codex-app-tools",
  "version": "0.1.5",
  "description": "...",
  "mcpServers": "./.mcp.json",
  "skills": "./skills/",
  "hooks": { "hooks": { "<EventName>": [ { "hooks": [ { "type": "mcp_tool" } ] } ] } },
  "interface": { "displayName": "...", "category": "...", "capabilities": [] }
}
```

### 3.2 市场清单

```
<marketplace>/
├── .agents/plugins/marketplace.json
└── plugins/<plugin>/
```

```json
{
  "name": "openai-bundled",
  "interface": { "displayName": "..." },
  "plugins": [
    {
      "name": "computer-use",
      "source": { "source": "local", "path": "./plugins/computer-use" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

本机实际存在三个市场，**全部是 `source_type = "local"`**：

| 市场 | 根目录 |
|---|---|
| openai-bundled | `%USERPROFILE%\.codex\.tmp\bundled-marketplaces\openai-bundled` |
| openai-primary-runtime | `%LOCALAPPDATA%\.cache\codex-runtimes\codex-primary-runtime\plugins\openai-primary-runtime` |
| openai-api-curated | `%USERPROFILE%\.codex\.tmp\plugins` |

### 3.3 配置格式

```toml
[marketplaces.<name>]
source_type = "local"
source = '<绝对路径>'

[plugins."<plugin>@<marketplace>"]
enabled = true
```

### 3.4 CLI 命令（已确认存在）

```
codex plugin marketplace add <本地路径 | owner/repo[@ref] | HTTPS Git URL | SSH Git URL>
codex plugin marketplace list | upgrade | remove
codex plugin add <PLUGIN@MARKETPLACE>     # 或 -m MARKETPLACE
codex plugin list | remove
```

**支持 `owner/repo[@ref]` 与 Git URL，即 GitHub 分发路径可用**，这是轻量宿主插件分发的关键。

### 3.5 隔离实测（关键证据）

在临时 `CODEX_HOME` 中执行，**真实配置零改动**：

```
$ codex plugin marketplace add <本地测试市场>
$ codex plugin add 'deskpet-p0@deskpet-p0'
Added plugin `deskpet-p0` from marketplace `deskpet-p0`.
Installed plugin root: ...\plugins\cache\deskpet-p0\deskpet-p0\0.0.1

$ codex plugin list
deskpet-p0@deskpet-p0  installed, enabled  0.0.1
```

安装后物化的内容：`.codex-plugin/plugin.json` + `skills/deskpet-p0/SKILL.md`。

隔离 `config.toml` 自动写入：

```toml
[marketplaces.deskpet-p0]
source_type = "local"
source = '<测试市场路径>'

[plugins."deskpet-p0@deskpet-p0"]
enabled = true
```

**验证结果：**
- 真实 `config.toml` 无任何 deskpet 痕迹；
- 真实市场列表保持 3 个，未变化；
- 临时目录已清理。

## 4. 生命周期 Hooks（L1 的关键）

### 4.1 事件支持

在已安装 CLI 二进制中检索，**全部 12 个事件均存在**：

| 事件 | 二进制中出现 | 用途（对应桌宠能力） |
|---|---|---|
| SessionStart | ✅ | 会话开始 |
| SessionEnd | ✅ | 会话结束 |
| UserPromptSubmit | ✅ | 用户提交输入 |
| PreToolUse | ✅ | 工具调用前 |
| PostToolUse | ✅ | 工具调用后 |
| PermissionRequest | ✅ | **审批提醒**（用户确认的必备功能） |
| PreCompact / PostCompact | ✅ | 上下文压缩 |
| SubagentStart / SubagentStop | ✅ | 子任务起止 |
| Stop | ✅ | **完成提醒** |
| Interrupt | ✅ | 中断 |

### 4.2 处理器类型

- `mcp_tool`（调用 MCP 服务器上的工具）
- `command`，含 Windows 专用覆盖 `commandWindows`
- 其他已证实字段：`additionalContextLimit`、`statusMessage`、`async`、`timeout`

### 4.3 可用模板变量

二进制中确认存在 `session_id`、`turn_id`、`agent_id`、`hook_event_name`。

**这是 L1 的关键**：hook 能拿到会话与轮次标识，才有可能把状态正确归属到某个会话，而不是只做一个全局指示灯。

### 4.4 本机活证据

`computer-use@openai-bundled` 在真实配置中 **`enabled = true`**，其 `plugin.json` 注册了 hooks：

```json
"hooks": { "hooks": {
  "Stop":           [ { "hooks": [ { "type": "mcp_tool", "server": "node_repl", "tool": "turn_ended", "input": { "session_id": "${session_id}", "turn_id": "${turn_id}" } } ] } ],
  "Interrupt":      [ ... 同上 ... ],
  "SubagentStop":   [ { "hooks": [ { "type": "mcp_tool", "server": "node_repl", "tool": "turn_ended", "input": { "session_id": "${agent_id}", "turn_id": "${turn_id}" } } ] } ]
} }
```

即：**插件捆绑 hooks 在本机是启用状态**，这是 hooks 真实可用的最强本地证据。

### 4.5 信任机制（重要约束）

二进制中存在：`hook_trust`、`bypass_hook_trust`、`allow_managed_hooks_only`（属 `ConfigRequirementsToml`，即企业托管策略）。

含义：

- 非托管 hooks **需要信任审查后才运行**，不是装上就自动执行；
- 企业可通过 `allow_managed_hooks_only` 限制只运行托管 hooks；
- 存在 `bypass_hook_trust` 布尔开关（面向受控环境）。

**影响**：桌宠插件的 hooks 会给用户增加一次「信任确认」步骤。这不影响可行性，但影响首次安装体验，必须在产品设计中明确告知用户，不能静默注册。

## 5. MCP

- 真实配置已有 `[mcp_servers.node_repl]`，证明 MCP 服务器可配置并运行；
- 插件可通过 `"mcpServers": "./.mcp.json"` 捆绑服务器，`codex-app-tools` 为官方范例；
- `.mcp.json` 支持 `command` / `args` / `cwd` / `env` / `env_vars` / `startup_timeout_sec` / `tool_timeout_sec` / `enabled`，以及**按工具设置审批模式**（`tools.<name>.approval_mode`、`default_tools_approval_mode`）。

最后一点对桌宠很有用：**角色类工具可设为自动，敏感工具设为需审批**，与方案里的权限分级一致。

## 6. Skills

插件可捆绑 `skills/`，隔离安装中已实际物化到插件缓存目录。`SKILL.md` 采用 YAML frontmatter（`name` / `description`）。适合承载「安装引导、配对说明、使用帮助」，但**不适合当作可靠事件总线**（与方案一致）。

## 7. 能力矩阵

| 能力 | 对应等级 | 结论 | 证据强度 |
|---|---|---|---|
| 显式角色工具（MCP 工具） | L0 | **支持** | 强：官方插件范例 + MCP 已配置 |
| 显示气泡/表情/动作 | L0 | **支持** | 强：由工具触达 Runtime，与宿主无关 |
| 状态观察（生命周期） | L1 | **支持（机制已证实）** | 中强：事件全在 + 本机有启用中的插件 hooks；**第三方 hooks 实际触发尚未实测** |
| 审批提醒（PermissionRequest） | L1 | **支持（机制已证实）** | 中强：事件存在；未实测 payload |
| 完成提醒（Stop） | L1 | **支持（机制已证实）** | 中强：同上 |
| 会话/轮次归属 | L1 | **支持** | 中强：`session_id`/`turn_id`/`agent_id` 存在 |
| 会话内容展示 | L2 | **未证实** | 弱：未发现公开消息正文通道；需另行勘察 |
| 双向输入 | L3 | **未证实** | 弱：本轮未勘察输入 API |
| 宿主内嵌视图 | L4 | **未勘察** | — |

## 8. 首期结论

**首期目标维持 L0 + L1，不需要降级。**

具体含义：

- L0 走 **MCP 工具**：`deskpet_notify` / `deskpet_set_emotion` / `deskpet_play_animation` 等；
- L1 走 **插件捆绑 hooks**，优先 `Stop`（完成）、`PermissionRequest`（审批提醒）、`SessionStart`/`SessionEnd`、`Interrupt`；
- 两者共用一个本地 Runtime，插件本体保持轻量（清单 + skills + 一个薄 MCP 服务器 + hooks 配置）。

**L2 暂不承诺**：本轮未发现公开的会话正文通道，不应在 P2 之前对外宣称能展示回复内容。

## 9. 待验证项（交给 P1/P2）

1. **第三方 hooks 实际触发**：需安装一个带 hooks 的第三方插件并跑一轮会话，确认事件真的到达、payload 字段与模板变量是否符合预期。
2. **桌面应用 vs CLI 差异**：本轮实测通过 CLI 完成；桌面应用是否同样加载用户添加的第三方市场，需在 GUI 中确认。
3. **信任审查交互形态**：确认用户在何处、以何种方式被要求信任 hooks，以及拒绝后的行为。
4. **Git 市场分发**：`owner/repo[@ref]` 路径本轮未实测（仅确认命令存在）。
5. **hook 失败语义**：hooks 超时/报错是否会阻塞宿主任务——文档倾向 fail-open，但需实测。
6. **版本升级影响**：当前 `restart_required`，升级后需重新核对事件与字段。

## 10. 对方案的影响

1. **原 P1「公共边界 + FakeHost」仍然必要**：hooks 与 MCP 只是宿主入口，桌宠内部仍需解耦，否则每个宿主都要改核心。
2. **新增一条约束**：hooks 的信任审查要写进安装引导，并作为「L1 不可用时的降级路径」——用户拒绝信任时，应自动退到 L0 工具模式，而不是静默失去状态。
3. **MCP 工具审批模式可按工具分级**，与方案第 9 节的权限分级天然吻合，P2 直接采用。
4. **分发形态确定为「本地/Git 市场 + 轻量插件包」**，与用户「先发轻量宿主插件」的决策一致。

## 11. 本轮边界

- 未修改真实 `config.toml`，未向真实环境安装任何插件；
- 未改动 `D:\Frankenstein` 下任何代码；
- 未启动桌宠、未触碰麦克风/录音/VAD/PTT；
- 未读取任何密钥、凭据或会话正文内容；
- 隔离测试目录已清理，真实市场列表已复核未变。

## 12. 相关文档

- [可移植方案](D:/Frankenstein/maibot-deskpet-plugin/docs/AGENT-PORTABILITY-PLAN.md)
- [总路线](D:/Frankenstein/maibot-deskpet-plugin/docs/UPGRADE-ROADMAP.md)
- [阶段性交接](D:/Frankenstein/maibot-deskpet-plugin/docs/HANDOFF-2026-10-11.md)
