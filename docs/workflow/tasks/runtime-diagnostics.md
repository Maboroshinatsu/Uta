# 运行环境身份与诊断界面

执行平台：Antigravity。状态：已准备任务单，尚未派发/启动。Codex 审查后决定集成。

本轮实施补充（2026-10-22）：用户已授权主控按全面计划开始实施，Codex 分配本任务后可在指定工作区实现，无需再次向用户确认。只改独立 RuntimeDiagnostics.vue、services/runtime-diagnostics.ts 纯展示辅助、SettingsTab.vue 的最小挂载、组件 scoped 样式、新增 app/tests/runtime-diagnostics.test.cjs 与本任务结果。SettingsPanel.vue/main/preload/env.d.ts/deskpet store/DeskpetStage 不改；getEnvironmentInfo 返回类型以现有声明为准。app/package.json 测试注册由 Codex 统一处理。必须有加载、失败后重试、普通浏览器无 API、未知构建、长路径换行、组件卸载后异步返回保护；仅展示字段白名单，不显示/导出 token、key，不新增复制/导出功能或“桥在线”结论。stable 默认折叠内部路径，非 stable 默认展开。Shell 不可用时交 Codex 跑检查，不反复换方式尝试被拒操作。不可访问主仓库 .git 时由 Codex 提供分支/base 核验，跳过该非必要预检。

## 开工

读取 AGENTS.md、CURRENT.md、OPERATIONS.md 与 operations/assignments/antigravity-runtime-diagnostics.json。按指定 worktree/profile 工作，报告 branch/base/dirty 状态。

## 目标

让维护者清楚当前是哪份 Uta：正式/测试环境、profile、版本与构建提交、数据目录和连接诊断。普通日常界面保持简洁，不把开发细节堆在角色主界面。

## 已有接口与允许范围

- preload 已提供 utaAPI.getEnvironmentInfo()，返回 profile、packaged、version、build、sourceDir、userData/runtimeDir/endpointFile。优先使用这一接口；主进程窗口与托盘已有非 stable profile 名称。
- 允许修改设置面板的独立诊断组件与挂载点、局部样式、必要 renderer 类型和本任务交付。不要再次大范围拆分 SettingsPanel.vue。
- 主进程/preload IPC 与持久设置接口不归本任务；接口确有缺口先向 Codex 提出，不与 Qoder 并改共享文件。
- 不读取端点文件正文，不显示 token、API key 或聊天正文。若导出诊断，路径可识别个人信息，应由用户主动操作并给出清楚预览。

## 验收

stable 与 task profile 清楚区分；构建信息缺失时显示未知而非伪造；普通浏览器无 utaAPI 时不报错；长路径不撑坏面板。只在自己的 profile 调试，不改日常设置，不安装全局插件。

## 交付

提交实现和 docs/workflow/results/runtime-diagnostics.md，列 base/head SHA、验证命令、界面证据及剩余问题。不得自行合并或发布。
