# 设置界面 UI/UX 全面改造方案

日期：2026-10-23。用户明确要求先出成熟全面方案，允许跳出原有布局与组件边界。本任务只做审查、方案和可评审线框，不实施产品改造。

## 主控任务

- Owner：Codex；分支 `task/codex/settings-ux-plan`，base `21583acccda3109b0b1f498c1e3b1945d04e0bf1`。
- 目录 `D:/Frankenstein/Uta-Workspace/tasks/codex-settings-ux-plan`，profile 同目录末段；不启动该 profile 的 Uta，不安装依赖。
- 只允许改本任务单、`docs/design/settings-ux-*`、本任务结果与 CURRENT/路线图/交接的必要链接；禁止改应用、插件和用户数据。
- 基于真实组件与现有独立候选页面核对信息架构、能力与保存逻辑。不能把方案中的能力写成已实现。
- 交付：现状证据、功能迁移清单、主备方案取舍、导航/布局、典型任务流程、保存与草稿语义、宿主能力/连接状态模型、工坊生命周期、可访问性/尺寸/异常状态、组件与多窗口技术路线、迁移/回退、分工/依赖/验收标准，以及可点击线框。

## Antigravity 独立审查任务

- Owner：Antigravity；目录 `D:/Frankenstein/Uta-Workspace/tasks/antigravity-settings-ux-audit`；分支 `task/antigravity/settings-ux-audit`；原始 base 同上，实际任务基线由主控准备任务单提交后登记。
- profile `antigravity-settings-ux-audit`；只读源码，不运行 Uta，不安装依赖，不改存储/全局配置。
- 正式入口 AGENTS.md 与本任务单。主控已核验目录/分支/干净状态；不要为报告 SHA 读取 .git 或越界文件。
- 经官方 agy CLI plan 模式执行；保留当前模型 Gemini 3.8 Flash (High)，禁止 MCP、浏览器、Shell、子 Agent、请求权限或提问工具。若某来源不可读，跳过并注明，不能绕过拒绝。
- 允许读取任务区内 app/src/renderer/components/Settings*、settings-workshop.ts、TtsSettingsSection、SttSettingsSection、AdapterPluginSettings、RuntimeDiagnostics、styles/settings-panel.css，以及 stores/deskpet、adapters、main/preload/env 中与设计有关的 API 和现有 docs；不得读取运行端点正文、个人配置、密钥、认证目录和日志。
- 最终回复一份中文独立审查报告，由 Codex 保存到 `docs/design/settings-ux-antigravity-audit.md`。执行方不写文件、不提交、不合并。
- 不仅提配色/间距。核实当前功能与混乱来源；比较保留窄面板、加宽同窗、独立设置窗口；评估“快捷区/设置中心/工坊”的分层，提出可反对主控假设的理由。给出完整功能归属、至少六条用户旅程、即时/显式保存的清晰规则、连接/能力/离线/不支持状态、预设编辑锁/预览/退出草稿、异常与键盘流程、视觉规范、渐进迁移/测试/风险和分工。
- 不得假称已看真实截图、点过界面或跑测试。本轮 GUI 证据由 Codex 单独补充；源码事实附文件与函数，推断和新提议分别标明。

## 验收与边界

主控审查报告与实际源码一致性；用户能在方案和线框上评审操作逻辑。方案变更不会调整现有日常 ZIP 入口，不承诺原型已有持久化/IPC/真实网络能力。大范围产品实施须待用户确认具体方案后开新任务。
