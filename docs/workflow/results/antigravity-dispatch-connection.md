# Antigravity 派单连接验证

日期：2026-10-22。范围：官方 CLI 安装、模型/认证可用性、只读探针、结果收取和指定会话续接。未授权诊断界面源码实现。

## 入口选择与安装

- 桌面 Antigravity 2.25.0 的 agentapi 帮助仍可用，但本机仅有 Frankenstein 桌面项目，绑定 `D:/Frankenstein`，没有专用任务项目或已启用 Sidecar。没有猜测 projectId/--profile 含义或修改项目 JSON 来冒充可靠绑定，也没有向原桌面聊天发送消息。
- 使用 [官方 Windows CLI 安装器](https://www.antigravity.google/download) 安装 agy，检查过安装脚本；脚本按官方 manifest 校验 SHA512 后安装。实际版本 **1.4.5**，路径 `C:/Users/Administrator/AppData/Local/agy/bin/agy.exe`。安装器向用户 PATH 增加 `%LOCALAPPDATA%/agy/bin`；当前调用使用绝对路径，新终端才会取得新 PATH。CLI 支持自动更新，派单须记录实际版本。
- CLI 直接读取已有认证并完成模型请求，没有再次登录或复制凭据。模型命令返回六个选项：gemini-3.8-flash-high、gemini-3.8-flash-medium、gemini-3.8-flash-low、claude-sonnet-4-6、claude-opus-4-6-thinking、gpt-oss-120b-medium。
- `/model` 显示当前默认为 Gemini 3.8 Flash (High)；两轮探针显式使用相同 slug gemini-3.8-flash-high。没有改平台全局模型；Qoder 的 DeepSeek-Flash 约定不套用于 Antigravity。

## 已验证的调用

- 子进程 cwd 为 `D:/Frankenstein/Uta-Workspace/tasks/antigravity-runtime-diagnostics`，从分配表注入独立 Uta 环境变量。Codex 在前后独立核验分支 `task/antigravity/runtime-diagnostics`、HEAD `3ee3035eafb94ffd52a641759e66f0f9d2b2d990`，工作区均干净、HEAD 不变。
- 使用 [官方 headless 流式输入输出](https://www.antigravity.google/docs/cli/headless/)，一条 user 事件经 stdin 输入后关闭输入；配置 --mode plan、--print-timeout 2m，不跳过权限。init 确认实际 cwd 与模型正确，permission_mode=request-review。
- 首轮只读 AGENTS.md、agent.md 和 runtime-diagnostics 任务单；事件中的实际工具名为 read_file。正确报告任务“运行环境身份与诊断界面”、允许修改范围和共享接口边界。没有写计划文件、安装依赖、运行 Shell、调用 MCP 或派生子 Agent。
- 从事件取得真实 conversation_id，使用 --conversation 指向它续接。两轮返回同一 ID，第二轮能回忆首轮代号；num_turns 从 1 增为 2。两轮退出 0、status=SUCCESS、stderr 为空，无工具错误；续接没有调用工具。

## 发现的问题与权限边界

- CLI 与桌面共用安装的 uta-deskpet **0.1.5**。该版 hook 仍写 `%APPDATA%/uta/hooks`，端点候选还会在指定文件缺失时回退日常实例，不能视为已完成 profile 隔离。每轮推理前通过官方 plugin disable 临时停用此插件，finally 中 plugin enable 恢复；最终 plugin list 确认 enabled、版本未变。未覆盖新版插件、改 APPDATA 或启动 Uta 实例。临时开关属于共享插件配置，后续应避免与其他 Antigravity 会话并发切换。
- plan 模式是执行指令，不是权限沙箱；init 中写入、Shell、浏览器等工具仍可见。本轮证明实际仅只读，不声称已在技术上隐藏/封锁其他工具。正式调度应增加任务范围内的权限约束并核对实际工具调用。
- CLI 自动建立 default-cli-project（名称 CLI Project，projectResources 为空），探针的实际 cwd 正确。尚未绑定专用项目，不能把这次 CLI 验证算作桌面 Sidecar 验收；未来恢复也须再次检查 init.cwd 和实际 Git。
- Worker 未独立读进程环境或检查 Uta 端点。取消、触发超时、防重复启动、崩溃恢复、正式写入和代码交付尚未验证；仅配置超时参数不算已验证超时行为。

## 本机记录与下一步

记录位于仓库外 `D:/Frankenstein/Uta-Workspace/operations/antigravity-connect/`：connection.json 保存会话 ID、版本、目录、模型、提示校验、日志及前后状态，probe-events.jsonl/resume-events.jsonl 保存事件。原始日志与账号信息不提交 Git。

验证结束时两轮 CLI 已退出，未见 agy.exe 进程，Uta 插件恢复启用；日常 Uta.exe 与业务源码未修改。后续先统一升级/隔离 Antigravity 插件并绑定专用项目，再补派单器的权限、状态、防重派与取消验证，最后发正式诊断界面任务。
