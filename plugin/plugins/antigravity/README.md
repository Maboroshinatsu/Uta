# Uta Desktop Companion for Antigravity

让 Uta 桌宠实时跟随 Antigravity 的工作节奏，并在桌宠上展示思考状态、工具调用动态与交互式操作审批。

## 前置条件

先启动 Uta 桌宠（桌宠图标或运行 `start-uta.bat`）。当桌宠未启动时，本插件会自动保持静默，绝不影响 Antigravity 正常编码。

## 安装方式

### 方式一：工作区插件（当前项目生效，推荐）

将打包生成的插件目录放入当前项目根目录的 `.agents/plugins/uta-deskpet/` 即可发现。
```powershell
node plugin/scripts/build-antigravity-plugin.mjs --install-workspace
```

### 方式二：全局插件（所有 Antigravity 会话生效）

将插件安装到全局配置目录：
```powershell
node plugin/scripts/build-antigravity-plugin.mjs --install-global
```

## 功能特点

### 1. 状态自动跟随（无感联动）

| Antigravity 事件 | 桌宠状态 | 行为说明 |
| --- | --- | --- |
| `SessionStart` | 待命 / 呼出 | 会话开始时准备待命；若开启了呼出选项，桌宠窗口会平滑呼至前台 |
| `PreInvocation` | 思考中 | 智能体分析问题时，气泡显示“思考中...” |
| `PreToolUse` | 运行工具 | 智能体调用外部工具时，角色进入专注状态并提示工具名称（如 run_command） |
| `PostToolUse` | 消化结果 | 工具执行完毕，角色提示处理结果或异常分析 |
| `PostInvocation` | 缓存正文 | 只把最后一次模型输出的短摘要留到 Stop，不逐步骤弹气泡 |
| `Stop` | 任务完成 | 对话结束时，角色做出完成动作，并把最后一次模型输出的短摘要作为本轮最终回复 |

### 2. MCP 角色专属工具（智能体主动调用）

Antigravity 会自动挂载桌宠的 MCP 服务（`uta-deskpet`），模型可在适当情境下调用：
- `deskpet_notify`: 在桌宠气泡中弹出提示消息；
- `deskpet_set_emotion`: 切换 Live2D / 静态立绘表情；
- `deskpet_set_preset`: 应用当前模型的状态预设或预设分组（支持中文名）；
- `deskpet_play_animation`: 播放模型支持的待机/动作；
- `deskpet_get_capabilities`: 查询在线状态，并返回当前模型、可用情绪和状态预设分组。
- `deskpet_motion` 读取当前 Live2D 模型通道、校验和试播动作，也能编译可导入的默认预设草稿。

连接 Uta 并绑定 Antigravity 后，可以直接说「让 Uta 先侧目，再微笑，最后回正」，也可以用 `/uta-live2d-motion` 调用随包 skill。要编排整套默认预设，可以说「给当前模型编排一整套默认预设，输出可导入的 Uta JSON」。生成的草稿通过 Uta「模型与动作 → 用户预设 → 导入」启用。

### 3. 交互式操作审批卡片（可选）

通过在环境变量中设置 `UTA_APPROVAL_ENABLED=true`，当智能体触发敏感工具调用时，桌宠会弹出交互式审批卡片：
- 点击 **批准**：放行工具调用；
- 点击 **拒绝**：阻止操作执行；
- 超时或桌宠未启动：自动 fail-open，交回 IDE 自身弹窗决策。

**网络工具例外：** `read_url_content` / `read_browser_page` 走 Antigravity 的宿主级 gated HTTP
沙箱，第三方 Hook 的 `allow` / `permissionOverrides` 无法豁免，宿主仍会弹原生审批。因此
Uta 不再为这两个工具弹桌宠审批卡，直接交给宿主确认；常用域名请在 Antigravity 的
`/permissions` 白名单里放行，或在原生弹窗里选 Always Allow。命令、搜索和桌宠 MCP 工具
仍保留桌宠审批。

## MCP 常见问题

Antigravity 会用插件目录名拼 MCP 工具名（`mcp_<插件目录>_<服务名>_<工具名>`），并强制工具名不超过 64 字符。

- **把备份放在 `.agents/plugin-backups/`**。安装脚本会把旧版本移到这里，避免 Antigravity 加载到两份插件。
- 安装脚本会把 `mcp_config.json` 的启动命令改写成绝对路径，避免 Antigravity 启动 MCP 时 cwd 不同找不到服务器。
- 刷新方式：Antigravity 设置 → 自定义 → 已安装的 MCP 服务器 → 刷新；或重启 Antigravity。
- 如果面板没有绿点，查看 `%APPDATA%/Antigravity/logs/language_server.log` 里的 `mcp_client_session_instance` 错误。

## 隐私与安全承诺

- 插件所有通信严格限制在本机环回地址（`127.0.0.1`），通过端点文件中的临时 Bearer 令牌鉴权；
- 调试心跳文件（`%APPDATA%\uta\hooks\antigravity-events.jsonl`）仅记录事件元数据与时间戳，严禁写入任何提示词、文件内容或代码。
- 最终回复缓存（`%APPDATA%\uta\hooks\antigravity-pending-*.json`）只保存最后一次模型输出的短摘要，
  用于 Stop 时投递，投递后立即删除；不保存用户提示、工具参数或文件内容。

状态、回复、审批和待办会按 conversationId 归属；只有明确的单个工作目录才登记项目，多工作区不会擅自选第一个。正常结束、错误、取消和未知停止分开显示。本版文字输入与宿主原生问题仍请回 Antigravity 处理。
