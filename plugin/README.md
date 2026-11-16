# Uta 宿主侧插件

把桌宠的角色能力接入各类 Agent 宿主。本目录**不含桌宠本体**，只负责在宿主与运行中的
Uta 桌面应用之间转发事件和角色指令。

## 目录结构

```
plugin/
├── shared/
│   ├── uta-runtime-client.mjs        # 共用传输层：端点发现 + Bearer 鉴权 + 指令投递
│   ├── uta-host-hook.mjs             # Claude Code / ZCode / Codex 共用 hook 核心
│   └── uta-commentary.mjs            # 工作中助手正文提取与短汇报（transcript）
├── plugins/
│   ├── deskpet-mcp/                  # 通用 MCP 服务器（任意 MCP 宿主，L0 工具）
│   ├── deepseek-harness/             # DeepSeek Harness 原生插件（审批卡片 + 状态 + RP 注入）
│   ├── qoder/                        # Qoder 插件（MCP 工具 + hooks 状态映射）
│   ├── antigravity/                  # Antigravity 插件（MCP 工具 + hooks + 审批）
│   ├── claude-code/                  # Claude Code 插件（MCP 工具 + hooks + 审批）
│   ├── zcode/                        # ZCode 插件（MCP 工具 + hooks + 审批）
│   ├── codex/                        # Codex 插件（MCP 工具 + hooks + 审批）
│   └── opencode/                     # OpenCode 原生插件（状态 + 审批）
├── scripts/
│   ├── build-qoder-plugin.mjs        # 组装 Qoder 插件目录与 ZIP
│   ├── build-antigravity-plugin.mjs  # 组装 Antigravity 插件目录与 ZIP
│   └── build-host-plugins.mjs        # 组装 Claude / ZCode / Codex / OpenCode 与本地市场
└── tests/
```

宿主插件在安装时会被整体复制走，因此**每个插件产物必须自包含**。共用代码放在
`shared/`，打包时复制进产物的 `runtime/` 并改写 import（见 `build-qoder-plugin.mjs`）。

## 数据流

```
宿主 ──(MCP stdio / hooks)──> 插件 ──HTTP 127.0.0.1 + Bearer──> Uta Runtime ──> 角色
```

配对文件位置（按顺序尝试）：

1. 环境变量 `DESKPET_ENDPOINT_FILE`（兼容旧名）或 `UTA_ENDPOINT_FILE`
2. `%APPDATA%\uta\runtime-endpoint.json`（当前应用 Uta）
3. `%APPDATA%\MaiBot Deskpet\runtime-endpoint.json`（旧版安装包）
4. `%APPDATA%\maibot-deskpet\runtime-endpoint.json`（旧版开发态）

## 各宿主能力对照

| 宿主 | 状态跟随 | 角色工具 | 双向输入 | 审批卡片 |
|---|---|---|---|---|
| Qoder | hooks（会话/思考/工具/完成） | MCP 角色工具 | 桌面版否；Qoder CLI 会话可注入（试验通道） | 是（批准/拒绝生效，Qoder 自身权限框仍需手动关闭） |
| Antigravity | hooks（会话/思考/工具/完成） | MCP 角色工具 | 否（无官方外部注入通道） | 可选开启（需 `UTA_APPROVAL_ENABLED`，其余工具交回宿主原生审批） |
| Claude Code | hooks（会话/提问/工具/完成/结束） | MCP 角色工具 | 是（`-p --resume`） | 是 |
| ZCode | hooks（7 个官方事件） | MCP 角色工具 | 是（`--prompt --resume`） | 是 |
| Codex | hooks（会话/提问/工具/完成/结束） | MCP 角色工具 | 是（`queue --thread --message`） | 是（首次需在 `/hooks` 信任） |
| OpenCode | 原生插件事件（状态/消息/错误） | 可选接入 MCP（默认是事件插件） | 是（原生插件排队注入，不回退命令行） | 是（`permission.ask`） |
| DeepSeek Harness | 原生事件 | 原生工具 | 是（原生桥明确不可用后可尝试用 `--session-id` 续接原会话） | 是 |
| 任意 MCP 宿主 | 无 | MCP 角色工具 | 否 | 否 |

> 表格描述连接器提供的接口。状态跟随依赖宿主的生命周期事件，审批依赖宿主的权限 hook。
> 安装或更新后，需重开会话分别验证工具、状态和审批。双向输入使用相应宿主的 headless、resume、queue 或原生桥。
> 已执行的隔离测试与真实会话范围见 [宿主验收记录](../docs/workflow/results/host-adapters-20261105.md)。
> 通用 MCP 注册 `deskpet_get_capabilities` / `deskpet_notify` / `deskpet_set_emotion` /
> `deskpet_set_preset` / `deskpet_play_animation` / `deskpet_update_plan` / `deskpet_motion`。


## 状态解说与语音

- 宿主插件只上报白名单意图（`looking` / `searching` / `reading` / `defining` /
  `editing` / `testing` / `running` / `researching` / `waiting` / `found` /
  `success` / `error` / `retry` 等）和工具名；**不传提示词、工具参数或用户内容**。
- 具体台词、情绪、Live2D/ImageSet 预设与 TTS 播报由 Uta 渲染层统一决定，文案只维护一份。
- Antigravity 的 PreToolUse 只对桌宠自己的 MCP 角色工具和“用户在桌宠卡片上批准过”的操作
  返回 allow；其他工具交回 Antigravity 自身权限流程，审批超时/离线也不会自动放行。
- TTS 默认关闭（`ttsEnabled: false`）。路径是 Uta 设置 →「语音」，声音来源只有两种：
  本地服务（默认 `http://127.0.0.1:9881/tts`，只允许回环地址）与云端服务
  （需要自己填服务与密钥）。机械感很重的系统语音入口已移除，旧配置里残留时设置页会提示重选，
  不会替你改。

## 思考联动

- DeepSeek Harness / OpenCode 的 reasoning 流只在本地做“关键词 → 意图”分类，用来切换
  思考 / 专注 / 好奇 / 惊讶 / 等待 / 测试等视觉预设。
- 最多每 2.5 秒切一次视觉，最多每 20 秒说一句极短状态；**不展示、不记录思考正文**。
- Qoder / Claude Code / ZCode / Codex / Antigravity 的 hook 没有逐字 reasoning 流，
  只能在工具边界随状态/工作汇报切换预设，会有滞后。

## 工作中汇报气泡

- DeepSeek Harness 直接使用原生流式正文；Qoder / Claude Code / ZCode / Codex 从宿主
  transcript 尾部只提取**助手 text 块**；Antigravity 使用 PostInvocation 的模型输出；
  OpenCode 使用助手文本事件。
- 统一压缩成**一两句、约 120 字以内**，去掉 Markdown 表格与代码块；通过 `notify`
  显示，不重置工作状态，并抑制同轮固定解说气泡。
- 同一会话按正文哈希去重；Stop/新提问时清空。
- 不读取用户提示、工具参数或工具结果，不把正文写入日志；transcript 只允许读取宿主自己的
  `.qoder-cn` / `.qoder` / `.claude` / `.zcode` / `.codex` 目录。

## 接入一个新宿主的检查清单

这是接入 Qoder 时总结出来的可复用流程：

1. **先确认宿主开放的接入面**，别假设：
   - 有没有 MCP？→ 直接复用 `deskpet-mcp`，得到 L0。
   - 有没有生命周期 hook？→ 事件名、stdin 字段、stdout 决策字段各是什么？
   - 有没有权限/审批 hook？→ 能否阻塞并返回 allow/deny？
2. **L0 先行**：先让角色工具跑通（端点发现 + 鉴权 + 一条 `notify`），再做状态。
3. **状态映射只做状态**：hooks 里**绝不阻塞宿主**，失败一律 exit 0；超时要远小于宿主容忍度。
   状态事件到桌宠的映射保持纯函数，便于单测。
4. **不确定的字段先观测，不猜**：用一个"探针 hook"只记录事件名、字段名、工具名，
   不记录提示词与工具参数；拿到真实 payload 后再实现审批/正文。
5. **打包要自包含**：插件目录会被复制，不能引用目录外的相对路径；用构建脚本复制并改写 import。
6. **反向验证**：先写会失败的测试（例如离线必须 exit 0、拼接必须等于全文），再修到绿。
7. **写清限制**：README 里明确"哪些能力还没验证"，不要用宿主的名字背书未完成的功能。

## 工具（L0）

| 工具 | 作用 |
|---|---|
| `deskpet_get_capabilities` | 检查桌宠是否在线，并返回当前模型、可用情绪和状态预设分组 |
| `deskpet_notify` | 在角色气泡显示一条短消息（≤200 字符） |
| `deskpet_set_emotion` | 设置情绪；模型不支持时角色自行忽略 |
| `deskpet_set_preset` | 应用当前模型的状态预设或预设分组（支持中文名） |
| `deskpet_play_animation` | 播放动作；模型没有动作时忽略 |

## 安装

从 0.2.0-alpha.12 起，一只桌宠只绑定一个宿主平台。要同时接入多个平台，请使用桌面包
`Pets` 文件夹里的对应启动器；每只桌宠会写自己的
`%APPDATA%\uta\host-pets\<host>\runtime-endpoint.json`，插件优先读取这个宿主专属端点。
同一个平台的所有聊天会共用该平台的桌宠。

### Qoder

```powershell
# 生成 dist/uta-qoder-plugin/ 与 dist/uta-qoder-plugin.zip
node plugin/scripts/build-qoder-plugin.mjs
```

桌面版：扩展 → 插件 → 添加插件 → 上传 ZIP。CLI 版：
`qoderclicn plugins install <解压后的插件目录>`。

### Antigravity

```powershell
node plugin/scripts/build-antigravity-plugin.mjs --install-workspace
```

工作区插件会安装到 `<工作区>/.agents/plugins/uta-deskpet`；重启 Antigravity 会话后生效。

### Claude Code

```powershell
cd d:/Frankenstein/Uta/app
npm run plugin:build
claude plugin marketplace add d:/Frankenstein/Uta/plugin/dist/claude-marketplace
claude plugin install uta-deskpet@uta
```

### ZCode

```powershell
cd d:/Frankenstein/Uta/app
npm run plugin:build
node "D:/Zcode/resources/glm/zcode.cjs" plugins marketplace add d:/Frankenstein/Uta/plugin/dist/zcode-marketplace
node "D:/Zcode/resources/glm/zcode.cjs" plugins install uta-deskpet@uta
```

### Codex

```powershell
cd d:/Frankenstein/Uta/app
npm run plugin:build
codex plugin marketplace add d:/Frankenstein/Uta/plugin/dist/codex-marketplace
codex plugin add uta-deskpet@uta
```

Codex 会按 hook 定义哈希记录信任状态。首次使用需要在 Codex 的 `/hooks` 里审查并信任一次；
以后只有插件 hook 内容变化时才需要重新信任。未信任时 Codex 会跳过 hook，但 MCP 角色工具仍可用。

### OpenCode

```powershell
cd d:/Frankenstein/Uta/app
npm run plugin:build
mkdir "$HOME\.config\opencode\plugins" -Force
copy d:/Frankenstein/Uta/plugin/dist/uta-opencode-plugin/uta-opencode.ts "$HOME\.config\opencode\plugins\uta-opencode.ts"
mkdir "$HOME\.config\opencode\uta-deskpet-mcp" -Force
copy d:/Frankenstein/Uta/plugin/dist/uta-opencode-plugin/deskpet-mcp.mjs "$HOME\.config\opencode\uta-deskpet-mcp\deskpet-mcp.mjs"
```

OpenCode 2.x 的本地插件目录只扫描 `.js`/`.ts`，且全局 `plugin` 数组只接受目录；
将插件和 MCP 文件分别放进配置目录的 `plugins/` 和 `uta-deskpet-mcp/`，并确保能运行 `node` 命令。修改后重启 OpenCode 桌面端，或执行 `opencode reload`。

### DeepSeek Harness

```powershell
dsh plugin --profile desktop add d:/Frankenstein/Uta/plugin/plugins/deepseek-harness
```

## 安全边界

- 角色工具只接受预定义操作，参数有长度与字符集限制。
- 只访问本机回环，且必须携带运行时生成的实例令牌。
- stdout 只承载协议帧，日志全部走 stderr。
- 审批只作为展示与决策入口，真正的工具执行始终留在宿主。
- Qoder hook 的调试日志只记录事件名、字段名与工具名，**不记录提示词或工具参数**，
  超过 256 KB 自动重建。

## 测试

```powershell
# 在 Uta/app 下执行（含 Harness、MCP、Qoder、Antigravity、三宿主共用 hook）
npm run test:plugin
```

测试使用自建的假回环端点与沙箱 APPDATA，**不会**连接真实宿主、不会安装插件、
不会读写真实桌宠数据。

## 从宿主会话编排 Live2D 动作

启动 Uta，绑定当前宿主并加载最新版 Uta 连接器。在会话里说「让 Uta 先看向一侧，停一下，微笑后回正」。模型会读取当前角色能用的通道，排出时间线，校验后在桌宠窗口播放。说「停下刚才的动作」可用该动作的任务 ID 停止播放。

共用工具 `deskpet_motion` 会列出当前角色的原生动作、可用部件及档位、参数和默认预设槽位。会话可以先选合适的原生动作，再用部件和参数补充。时间线最长 12 秒，支持校验、播放、停止和生成可导入的预设草稿。切换角色后会重新读取能力。完成状态表示播放序列走到收尾，画面效果以桌宠实窗为准。

建议先让宿主预览「日常」和一个明显的情绪动作，确认头身节奏、抬手和收尾自然后，再编排整套。复杂的连续动作优先尝试角色自带动作；部件和参数补充需要避开它已经控制的位置。生成预设后仍需导入 Uta，检查待机恢复和循环效果。
