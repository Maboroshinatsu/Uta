# Uta 项目协作规则

本规则适用于 Codex、Qoder、DeepSeek Harness、Antigravity 以及其他开发会话。与上级 `D:/Frankenstein/AGENTS.md` 一起执行；用户最新指令优先。

## 角色与工作区

- **2026-10-24 用户决定：当前由 Codex 单独负责全部开发、测试、整合与交接。暂停 Qoder、Antigravity 的默认任务分工，不再自动派单、续接或启动监听。** 用户以后明确重新授权时才恢复分工；本规则覆盖历史任务单、交接入口和旧计划中的执行安排。
- DeepSeek Harness（DSH）仅用于验证 Uta 在 DSH 上的兼容性，不承担日常开发。四个平台仍是 Uta 需要支持的宿主，暂停开发分工不等于移除宿主支持。
- 主目录 `D:/Frankenstein/Uta` 是统一开发版的源码与体验入口。同一时刻只允许一个实施会话写入；Codex 核对未提交内容后可直接在主目录小步开发，不再要求每个小功能新建 worktree。
- 确有高风险迁移、构建或验收隔离需要时，可使用一个明确的 Codex 工作区；验证后及时合回主目录。不要预先为各平台准备新任务目录，不在已结束的旧任务目录继续开发。
- 工作开始报告工作目录、分支、base SHA、未提交状态、运行 profile。目录或任务不符先报告，不继续相关修改。
- 不覆盖、不暂存、不提交其他会话的改动。依赖安装、out/dist、TypeScript 缓存各任务独立，不共用目录链接。
- worktree 是协作隔离，不是权限沙箱；不能据此声称其他目录在技术上不可访问。

## 任务与合并

- 当前状态入口：`docs/workflow/CURRENT.md`。早期工作流方案 `docs/DEVELOPMENT-WORKFLOW-PLAN-2026-10-22.md` 保留作历史参考。
- 当前产品顺序以 `docs/ROADMAP-TO-1.0.0.md` 为准，后续会话先读 `docs/workflow/HANDOFF.md`。早期工作流、批次计划与桌面投递说明均为历史，不构成当前派单授权。
- 产品化、Live2D 表现与主控不在线时的任务规划：`docs/PRODUCT-PLAN-2026-10-23.md`；实施任务包：`docs/workflow/product-task-catalog.md`。该目录的未来任务不是自动授权，必须有确切基线/契约/批次；未 armed 不可自行启动。
- 任务记录位于 `docs/workflow/tasks/`，交付位于 `docs/workflow/results/`。只写本任务交付，不并行修改总台账。
- 每轮工作明确当前目标、源码提交、改动范围、profile、可见结果和验收条件。单人开发不额外生成平台 assignment/progress/result 套件；更新 CURRENT 与 HANDOFF 即可。
- 用户指定的 Qoder 派单模型固定为 DeepSeek-Flash，包括探针、新任务和续接；每次显式传入 --model DeepSeek-Flash --reasoning-effort max --context-window 1000000，子 Agent 的可配置模型也保持 DeepSeek-Flash。不得静默回退 Auto、换模型或降低参数；平台拒绝时报告。当前已实测请求成功且返回模型名一致，但 CLI 未回传实际生效的思考档位/上下文，不能据此声称服务端绝对上限已验证。本机策略记录于仓库外 operations/qoder-dispatch-policy.json。
- 用户使用桌面应用开发时，按 `docs/workflow/DESKTOP-HANDOFF.md` 交接；上述 CLI 参数只适用于 CLI。Qoder 桌面仍固定 DeepSeek-Flash，可见思考/上下文选项设最大；不存在或不可验证的选项如实记录，不假装 CLI 参数已应用于桌面，不另启 CLI 替代桌面任务。一个任务目录同时只运行一个开发会话。
- 阶段性提交，汇报检查结果与下一步。交付列明 head SHA、测试、风险、日志及本任务进程。
- **提交与交接纪律见 `docs/workflow/HANDOFF-DISCIPLINE.md`（2026-11-03 起生效）**：一轮改动一个提交、文档随该轮一起提交而不另发纯 docs 提交、一个提交只做一件事、`docs/workflow/HANDOFF.md` 只写「当前现场」并原地覆盖（历史进 `archive/`）、现场不记录 PID 而记录探测命令、文档一律 UTF-8 且禁止用 shell 重定向写中文。
- 其他平台未经用户新授权不得修改或合并 main。发布、全局安装插件、修改其他平台配置与停止其他进程仍需明确属于用户授权范围。
- Codex 完成实现、复核与对应验证后提交并整合到 main，交用户体验。源码合入不等于已发布日常 exe。
- Codex 额度不足或会话结束时，留下可继续的 HANDOFF，不自动将剩余任务转交其他平台。历史派单参数只在用户重新授权派单时适用。

## 日常版本与运行数据

- **已验收日常版本必须是打包 ZIP 解压后直接启动的 `Uta.exe`。** 运行目录独立于源码和任务区。不能把 `node_modules/electron.exe .`、Vite 开发页面或 app/out 称为日常发布版本。
- 用户继续使用现有正式数据；开发、集成各用独立 profile。ZIP 解压运行不表示设置写在 exe 旁边，正式设置默认仍在 `%APPDATA%/uta`。
- 开发时必须核对 profile/userData/端点，不得写日常设置，不得自动迁移或删除日常模型，不得为了隔离 Uta 整体覆盖 APPDATA。
- 测试指定端点不可用就报告失败，禁止降级连接日常实例或旧版桌宠。
- 密钥、端点 token、个人设置、日志、模型资产不得写入任务文档或提交 Git；备份只放本机受控目录。
- 任务区只生成插件测试产物；Codex 统一管理真实平台安装。源码、打包产物、平台缓存必须区分。

## 验证和交接

- 按影响运行对应测试、类型检查和构建。纯文档改动无需应用测试；有集成风险时检查最终合并版本。
- 分别证明平台发现工具、MCP 握手、桥接受、会话归属与实际渲染。HTTP accepted 不能替代画面验证。
- 修改 profile/路径/存储时必须测试不串写、缺失目标不回退和退出清理。
- 历史交接只是历史记录；新会话以 CURRENT、当前 Git 状态和实际进程为准。
- 不确定的平台外部控制接口先核实。Uta 角色 MCP 不等于开发任务派单 API，不能把最近会话当成派单目标。
