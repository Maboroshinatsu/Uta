# DSH 宿主兼容性验收

执行平台：DeepSeek Harness。性质：仅测试。状态：测试区已准备，尚未启动测试会话。Codex 审查报告并安排修复。

## 开工

读取 AGENTS.md、CURRENT.md、OPERATIONS.md 与本机 operations/assignments/harness-dsh-compatibility.json。核对该记录的 directory、branch、base、profile。此 worktree 用于固定被测版本和放置报告，不承担日常开发。

## 测试范围

只验证 Uta 在 DSH 上能否使用：插件加载、端点连接、会话绑定、工作状态、公开回复、气泡、模型预设/动作、取消及审批交回宿主。仅测试宿主实际支持的能力，不测试或改造 Codex、Qoder、Antigravity。

使用 Codex 指定的构建和 DSH 插件产物，连接独立测试 profile。测试实例停止后，确认该配置失败且不转连日常 Uta。需要安装插件或调整真实 DSH 配置时，先给出具体配置范围，由 Codex 安排；不覆盖日常或全局配置。

## 禁止范围

- 不修改 app、共享 SDK、插件业务源码或构建脚本，不自行修复发现的问题。
- 不修改其他任务区，不安装其他平台插件，不承担跨平台调度或全平台验收。
- 不自动点批准，不复用不明的最近会话，不记录隐藏推理、端点 token、凭据或无关对话。

可以在自己的测试区创建必要的临时夹具，保存脱敏证据，并填写报告。涉及付费服务或用户实际审批的场景应注明条件，未执行的明确标记“待验证”。

## 交付

报告写入 `docs/workflow/results/dsh-compatibility.md`，逐项标明通过/失败/未执行；列清 Uta 构建提交、DSH 与插件版本、profile、复现步骤、实际与预期结果、脱敏日志位置以及本测试启动的进程。

只提交测试报告和必要的脱敏证据。发现缺陷交给 Codex 归因、分配修复、合并后再回到 DSH 复测；不得自行合并或发布。
