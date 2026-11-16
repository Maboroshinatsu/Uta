# Qoder 派单连接验证

日期：2026-10-22。范围：官方 CLI 安装、只读任务投递、结果收取和指定会话续接。未授权执行设置迁移源码任务。

## 已验证

- 使用 [Qoder CN 官方安装器](https://docs.qoder.cn/cli/installation) 安装 CLI 1.1.76，安装器的下载包 SHA256 校验通过；原有 entry/qodercn.cmd 包装器也能返回该版本。安装器更新了用户入口/PATH，新终端才会读取新 PATH，当前调用使用绝对路径。
- CLI 初次投递返回 authentication_failed，未调用模型。随后用户通过官方浏览器流程完成登录，重试成功；没有读取或复制桌面版凭据。
- 工作目录为 `D:/Frankenstein/Uta-Workspace/tasks/qoder-settings-store-migration`，分支 `task/qoder/settings-store-migration`，提交 `3ee3035eafb94ffd52a641759e66f0f9d2b2d990`。Codex 在运行前后独立检查，Git 工作区均干净、HEAD 未变。
- 子进程由分配表注入 UTA_PROFILE、UTA_USER_DATA_DIR、UTA_RUNTIME_DIR、UTA_ENDPOINT_FILE。未整体覆盖 APPDATA，也未启动 Uta 测试实例。模型没有 Shell，因此本轮没有由 Worker 独立读取环境变量或验证 Uta 端点。
- init 事件确认 cwd 正确，仅暴露 Glob/Grep/Read，plugins 和 mcp_servers 均为空；使用默认权限，跳过配置来源并提供本次设置覆盖/空 MCP 严格配置，没有改全局插件配置。覆盖仅对本次禁用自动更新与历史清理。
- Qoder 读取了 AGENTS.md、agent.md、设置迁移任务单和 .git，回报正确任务边界与“先交迁移接口说明，由 Codex 审核”。未安装依赖、修改文件或提交代码。
- 从流式事件取得真实会话 ID；使用 --resume 指向它继续一次只读对话，返回相同 ID，能回忆上轮探针代号。两次成功运行均退出 0、is_error=false，stderr 为空。

## 实测发现与限制

- worktree 的 Git 元数据位于主仓库 .git 目录，Read 被平台拦截。本轮不扩大权限；分支和 HEAD 以 Codex 的 Git 检查为准。
- 首轮模型把分支写成 task/qoder-settings-store-migration，少了一层斜杠。续接时已更正；不能将模型自报分支当作真实 Git 证据。
- 被拒绝的 Read 以 tool_result.is_error=true 返回，但最终 permission_denials 仍为空、is_error=false。未来调度器必须检查工具结果和交付条件，不能只检查退出码或 permission_denials。
- 未测试取消、超时、重复启动互斥、崩溃恢复、正式写入和完整开发交付；尚未实现统一调度器。Antigravity、DSH 尚未投递探针。

## 本机交接

非公开运行记录位于 `D:/Frankenstein/Uta-Workspace/operations/qoder-connect/`：connection.json 登记实际会话 ID、参数摘要、提示校验和、日志位置及前后状态；probe-b-events.jsonl 为成功首轮，probe-c-events.jsonl 为续接。认证失败的首轮记录也保留。日志和认证数据不提交仓库。

验证结束时本轮 CLI 已退出，没有本轮后台 Worker。Qoder、Antigravity 的正式开发任务和 DSH 测试任务仍未启动。日常解压版 Uta.exe 未改动或重新打包。

后续在独立 Codex 任务区实现最小派单器：绑定分配表、运行互斥、持久会话 ID、事件错误识别和可核对的结果；再补取消/超时验证，最后派发小范围开发任务。
