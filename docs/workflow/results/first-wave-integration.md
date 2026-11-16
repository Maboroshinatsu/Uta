# 首批源码集成验收

日期：2026-10-23。主控：Codex。用户已授权全项目复查、制定计划、按需派发并开始实施。本记录只证明源码候选验收，日常发布包未变化。

## 分支与交付来源

- 集成目录：`D:/Frankenstein/Uta-Workspace/tasks/codex-first-wave-integration`。
- 分支：`task/codex/first-wave-integration`，base `70effe11a3f28332322335c613ccdb618e9ea7e6`。
- profile：`codex-first-wave-integration`，userData/runtime 均在仓库外独立 profile 目录。
- Codex“会话与说话状态收尾修复”：代码 `ac5d162ecd24804a9f8bd29c3de69a17fb93a91c`，任务交接 `6f162df`。
- Qoder“工坊编辑锁的外部预设入口修复”：`c94a3b4a67c6c381d692ecd3dc1c309822bac15d`。
- Antigravity“运行环境身份与诊断界面”：`1e04ca268d89e8fe1ce79f005df6957b8317a1bc`。
- 上述任务分别经范围审查、修改反馈、专项测试后合并到集成分支；`fcc34c6` 注册三组专项回归，本次再注册五项真实 Vue 组件生命周期测试。Worker 没有自行合并 main 或发布。

## 实际结果

会话/宿主切换会结束旧聊天流、清空回复语音缓冲、取消 TTS 与旧说话脉冲；流标识包含宿主和会话，同名 requestId 不再混写。表现控制器卸载时清理看门狗与旁白定时器，旧 notify 计时器不再关闭后来的回复口型。

工坊编辑锁覆盖宿主预设、分组、情绪 fallback 与控件入口回退路径，在任何预设副作用之前拒绝；手动控件、滑杆与显式工坊预览保留。主控纠正了一项测试调用参数后，13 项专项测试全部通过。

设置面板底部增加运行环境诊断，显示实例 profile、运行来源、版本/构建与路径。字段白名单、固定错误文案和未知构建回退经审查；不读取端点正文、不声称桥在线。主控补充真实 Vue SFC 的挂载、错误重试、折叠策略、卸载和并发旧响应保护测试。

## 验证证据

在集成任务的独立依赖中运行：

| 验证 | 结果 |
| --- | --- |
| `npm test` | 288/288；包含新增运行组合 6 项、工坊锁 13 项、诊断辅助 11 项、真实诊断组件 5 项及原控制器 dispose 回归 |
| `npm run test:plugin` | 104/104 |
| `npm run typecheck` | node/web 均通过 |
| `npm run build` | 通过；现有 Vite CJS/Cubism 提示仍在 |
| 真实 Electron 页面 | 下列六项通过，Hiyori 模型已加载 |

真实页面通过 CDP 检查实际 Vue/Pinia 状态和界面布局，桥指令走测试实例自己的认证端点：

1. 真实环境 IPC 返回独立 profile/路径，源码来源和缺失构建信息正确显示。
2. 328px 设置面板内诊断区宽 300px，长路径/长 profile 不横向溢出；已查看截图。
3. 会话 A 的部分回复后绑定 B，拒绝 A 后续碎片，B 复用 requestId 仍形成独立完整消息。
4. 在回复流开始前与流中触发 notify，等待旧计时器后回复口型仍保持；结束流后正确收尾。
5. 点击真实宿主选择器会清理旧流。
6. 实际桥的外部预设指令不能覆盖已锁定工坊。

日志、截图与脱敏结果位于仓库外 `D:/Frankenstein/Uta-Workspace/operations/project-review-20261022/`：`integration-app-tests-final.log`、`integration-plugin-tests.log`、`integration-typecheck.log`、`integration-build.log`、`ui-smoke-result.json`、`integration-diagnostics.png`。验证脚本也留在该目录，不含 token 输出。

Electron 引擎验证说明：任务区引擎的 Windows Low integrity 副本启动异常；未修改 ACL，改用主工作区同版本、SHA256 完全相同的 Medium integrity Electron 引擎执行集成任务 app/out。应用代码、依赖与 profile 仍来自集成任务，未借用日常 exe 或日常数据。这是源码 GUI 验证，不是 ZIP 解压版验收。测试 PID/端口的启动与关闭状态以 `ui-process.json` 为准，不把历史 PID 写成实时状态。

## 派单与后续边界

Qoder 官方 CLI 的真实任务会话为 `6b89da85-544c-425d-8be8-54273dafba89`；各次派单均明确请求 DeepSeek-Flash、max 思考和 1,000,000 上下文，后端未回报实际档位/窗口上限。首次写权限拒绝后使用官方 accept_edits 模式续接，未绕过拒绝或静默换模型。Antigravity 官方 CLI 会话为 `fdabf52b-2837-4b66-ab1d-8444df45d2e6`，沿用 Gemini 3.8 Flash (High)。每次推理临时停用旧 Uta 插件并在 finally 恢复，避免其连接日常实例。逐次记录在 operations/runs。

第一阶段完成后优先实施 [持久设置统一设计](settings-migration-design-review.md)：先锁定 IPC、启动顺序、schema/revision、原子写、迁移备份/冲突和回退；共享模型旁车只作旧来源/默认值，不自动写回。之后完善派单互斥、超时/取消/防重与插件隔离，再逐宿主验收。DSH 仍只承担 DSH 兼容性测试，本轮未启动其验收。

未声称完成四平台全链路、真实 TTS 听音、麦克风、打包候选与日常提升。日常仍使用 dcf1b3f 的 Uta 0.1.1 ZIP 解压 exe。主工作区三份既有未提交文档不在本批提交范围内。
