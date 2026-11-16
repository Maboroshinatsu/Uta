# Antigravity：开发profile设置IPC、启动与Pinia接入

用户已授权CLI实施，沿用gemini-3.8-flash-high。只在 `D:/Frankenstein/Uta-Workspace/tasks/antigravity-settings-runtime-integration`，精确base/profile/hash见`.uta-task/assignment.json`。先读AGENTS、CURRENT、`docs/contracts/settings-integration-v1.md`、第二批契约及第二批审查，再preflight。不开子Agent，不调用桌宠/浏览器/外部服务，不修改插件/认证。

允许文件：main/index.ts、preload/index.ts、renderer/env.d.ts、renderer/main.ts、renderer/stores/deskpet.ts；新增main/settings-ipc/**、renderer/services/settings-client/**；测试settings-runtime-integration.test.cjs、settings-client-integration.test.cjs、settings-pinia-integration.test.cjs；本任务progress/result。其余冻结shared、既有settings-store、package/lock、Stage/loader、模型、UI视觉组件/公共文档不改。需要范围外修复交复现，不暗改。

分四步小commit：主进程注册与权限/生命周期→preload客户端与启动gating→开发模式十二字段Pinia接线→行为测试/回归/文档。先做最小可测试边界，不把整个main/deskpet重写。stable不启用新store、不迁移真实数据，开发失败不默认fallback，renderer不暴露importLegacy。

测试矩阵严格遵循冻结接入契约。使用任务内独立TEMP/fixture，不访问正式AppData，不启动日常exe或任何未登记实例。可用Node/vm/现有Vue SFC测试模式；额外依赖不需要。接口无法满足时写具体progress继续无阻塞部分，不自造协议。测试需验证实际实现，不能仅对mock断言。

根跑两批check-contract脚本；app跑本任务三文件测试、npm run typecheck、npm test、npm run build，构建TEMP/TMP仅指本任务node_modules/.uta-build-tmp。新增测试注册由主控做，结果列准确命令/退出码、base/head、已做/未做/风险/进程、稳定模式零I/O证据。

每阶段更新docs/workflow/progress/settings-runtime-integration.md并commit；完成写docs/workflow/results/settings-runtime-integration.md，干净提交后node scripts/task-handoff.mjs submit。若平台不允许Git写主仓库元数据，不绕过拒绝，保留diff和结果交主控提交。提交不是已验收，不合main/发包，不自动开始设置窗口或真正旧来源迁移。
