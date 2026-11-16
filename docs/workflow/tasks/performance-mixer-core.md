# Qoder：Live2D逐通道仲裁与生命周期纯内核

状态：已授权本任务实施；仅实现纯计算模块，交付后等待 Codex 审查。基线与契约SHA以 `D:/Frankenstein/Uta-Workspace/operations/assignments/qoder-performance-mixer-core.json` 为准。工作区使用 `D:/Frankenstein/Uta-Workspace/tasks/qoder-performance-mixer-core` 的独立分支与开发profile。模型请求固定 DeepSeek-Flash，显式请求 `--reasoning-effort max --context-window 1000000`；CLI未回传服务端实际生效上限时如实写“未验证”，不得静默换模型/降档。

## 开始与停止

先读 `AGENTS.md`、本任务、`docs/contracts/first-wave-v1.md`、`docs/contracts/desktop-wave2-v1.md`、`docs/contracts/performance-mixer-v1.md`、`docs/design/live2d-performance-plan.md`、`docs/models/ds-control-baseline.md`、`.uta-task/assignment.json` 和 `docs/workflow/progress/performance-mixer-core.md`，再运行 `node scripts/task-handoff.mjs preflight`。先报告当前目录、分支、base、dirty、profile，然后分阶段开发。

本任务完成行为测试、类型检查（若适用）和结果文档后，运行 `node scripts/task-handoff.mjs submit` 并停在待审。只允许修本任务范围内可重复验证失败。契约缺口、需要改接线/共享类型或需要新任务时写出精确请求并停下，不自行扩大范围。

## 允许修改

- 新增 `app/src/renderer/services/performance/mixer/**`：纯语义通道混合、贡献校验、owner/generation与时间生命周期、诊断输出。
- 新增 `app/tests/performance-mixer-core.test.cjs`，以及确有必要时新增 `app/tests/fixtures/performance-mixer-core-v1.cjs`。
- 更新 `docs/workflow/progress/performance-mixer-core.md` 和最终 `docs/workflow/results/performance-mixer-core.md`。

契约、既有 Profile/意图/快照类型、通用 fixtures、`package.json`/lock、loader、Stage、现有 mouth-motion、设置/IPC、PIXI依赖和真实模型全部只读。禁止修改其他路径；不加入新依赖、不创建子Agent、不调用 MCP/浏览器/网络模型、不写 Core/模型/正式 AppData、不合 main、不发布。

## 实现边界

- 唯一公共接口按 `app/src/shared/performance-mixer-contracts.ts` 和 `docs/contracts/performance-mixer-v1.md`。复用 `first-wave-contracts.ts` 的 SemanticChannel、ModelCapabilityProfile、PerformanceIntent、PerformanceSnapshot；不要复制类型，不引入 Soullink/AIRI 专属公共概念。
- mixer 输入贡献和语义 base，输出分开的 pre-physics/post-physics 语义值及诊断快照。数值为无量纲语义值，不是模型参数值；不得从模块写入 Cubism。
- 每通道 mask/priority 独立；严格执行 replace/add/multiply 公式、范围、owner generation、epoch/binding、单调时钟、smoothstep fade、ttl、dt上限和稳定排序。测试报告中逐项列出契约项与实际用例。
- 不支持/缺失/未确认/physics output能力必须降级且不产生有效参数写入。表达意图不得隐式清零 mouthOpen；mouthOpen与mouthForm独立；眼睑/眨眼在同通道组合。
- 用纯合成能力 Profile fixture。可采用DS鼠控版**已公开的结构摘要**作为有边界合成场景（mouthForm范围 `[-2,1]`、default `-0.5`；mouthOpen范围 `[0,1]`、default `0`），语义映射必须仍由 Profile adapter 定义。不要读取或复制模型文件，不把摘要fixture称真实Core回放。
- 不做director、自然待机、实际语音时钟、预设迁移、Soullink依赖或任何renderer接线；本任务测试通过不代表Live2D画面已改善。

## 必须覆盖的行为

1. replace/add/multiply的数学边界、mask、per-channel priority、稳定tie break；两阶段独立输出与post-physics接续pre结果。
2. capability available、needs-calibration、unsupported/缺失、physics输出的拒绝/降级；非对称模型仅作为语义映射边界fixture，不让mixer输出原始参数。
3. mouthOpen与mouthForm独立；无语音owner时保留base而不被emotion/state自动清零；眼睑贡献与眨眼贡献按同通道规则组合。
4. 新generation替换旧owner；旧cancel/release/update不影响新owner；modelEpoch/bindingGeneration切换清除旧租约并拒绝迟到输入。
5. fade-in、ttl到期、fade-out与清理；单调时钟相同输入可重放，dt=0不前进，100ms大步被限制并有诊断。
6. NaN、Infinity、范围错误、非法owner/phase/priority/模式不会污染其它通道；所有输出finite且在锚点范围内。

测试使用固定输入、seed（如有）、tick顺序和monotonic时间。命令与退出码如实记录；不得把静态字符串搜索、单纯类型编译或一份自写结果说明替代行为测试。

## 交付文档

progress每阶段记录已经完成、现在工作、下一步、实际提交、实际测试/退出码、阻塞与进程现场。result记录任务base/head/提交、变更文件、契约hash、逐项行为证据、真实运行命令、未验GUI/Core事项、风险和未做项。依赖安装与构建临时目录仅使用本任务自己的 `app/node_modules`，不能链接共享依赖或写正式profile。
