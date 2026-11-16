# 持久设置统一与来源迁移

执行平台：Qoder。状态：已准备任务单，尚未派发/启动。Codex 审查后决定集成。

## 开工

读取 AGENTS.md、CURRENT.md、OPERATIONS.md 和本机 operations/assignments/qoder-settings-store-migration.json。以分配表中的 base SHA、branch、directory 和 profile 为准，先报告核对结果。

## 目标与依赖

开发页和本地构建页在同一 profile 中读取同一份持久设置。先迁宿主选择、模型选择和工坊预设，保留其他 localStorage 兼容行为。运行目录契约已在 plugin/shared/uta-environment.mjs 中完成，禁止另起一套目录规则。

## 实施边界

- 先交一份字段/来源/冲突及迁移接口说明给 Codex，确认后实现分批切换。
- 允许范围：新增主进程 settings-store 模块、必要的 preload 类型/接口、renderer 中上述设置读写、对应测试及本任务交付。
- app/src/main/index.ts 的 IPC 注册点、app/src/preload/index.ts 与 env.d.ts 属共享接口，修改前把确切接口发回 Codex，避免与其他任务并改。
- 不修改窗口诊断 UI，不重做宿主 SDK，不更改全局插件安装，不迁移真实日常目录，不读取/提交任何密钥。
- 只在任务 profile 和临时夹具中验证迁移，不直接操作现有 LevelDB。新接口不能接受任意文件路径或任意设置键写入。

## 验收

初始化完成后再建立宿主与加载模型；导入可重复执行、来源明确、有 schemaVersion；冲突不能按时间静默覆盖；写入失败不丢旧配置。覆盖 dev/file 两种页面来源、相同 profile 复用、不同 profile 不串写、损坏/缺失配置、迁移重试及回退。

## 交付

原子提交；在 docs/workflow/results/settings-store-migration.md 写 base/head SHA、接口、测试证据、未完成项及本任务进程。不得自行合并或发布。
