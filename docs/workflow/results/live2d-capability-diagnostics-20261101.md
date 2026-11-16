# Live2D 能力事实与只读诊断实施结果

日期：2026-11-01
状态：已完成
基线：`8791928025490ca2e803ed1bc6c96d128d223540`

## 交付结论

本轮完成了“能力事实与只读诊断”，没有修改动作播放、优先级、预设执行、设置 UI 或默认表演谱。

- inspection 现在按动作导出 `durationMs`、`Meta.Loop`，并将 `Parameter`、`Model`、`PartOpacity` 的曲线数量和目标 ID 分开保存；旧 `parameterIds` 继续保留。
- 表情继续保存 `Add`、`Multiply`、`Overwrite`，能力事实同时带物理输出、有效 focus、口型和 adapter 绑定来源。
- 新增只读诊断：缺失动作/表情/参数、未映射标准动作、共用动作资源、逐语义画面待验收、口型张嘴参数争用、motion 与手写参数重叠。
- 新增控制台入口 `deskpetInspectModelFacts()`。旧 `deskpetInspectModel()` 保留为兼容简表，但不再推荐作为 AI 适配输入。
- 诊断只证明资源和参数结构，不宣称动作“看起来像”某个语义。

## 收尾补全

补全提交 `297df13`，仍不改播放、UI、优先级或默认谱：

- `deskpetInspectModelFacts()` 现在同时导出 `modelUrl`、`motionGroups`、`unregisteredExpressions`、`parts`、`poseGroups`，以及 adapter 的 `baseParameters`、`hiddenParts`、`hiddenDrawables`、`controls`；应用内导出还带 `resolved.baseParameters/controls`，控件包含 `defaultActive`、`hiddenParts`、`shownParts` 和 `held`。
- 未注册 exp3 按与旧 adapter 校验器相同的规则参与表情存在性判断，不再把同目录可用的 `.exp3.json` 误报为缺失。
- 新增 `missing-part` 诊断；口型默认参数缺失改回 warning，自定义口型参数缺失仍为 error。
- `capability-diagnostics.test.cjs` 已加入 `npm test` 主列表，不再只靠专项脚本。
- `MODEL-ADAPTER-SPEC.md` 已改成真实字段：`defaultValue`、`unregisteredExpressions`、`parts/poseGroups`、`bindings` 和 `resolved`。

## 实现提交

- `637315c`：建立任务边界和验收记录。
- `29f29df`：实现动作事实导出、能力事实、只读诊断和测试。
- `a43ca9a`：登记专项测试脚本并更新 AI 适配导出入口与规范。
- `297df13`：补全能力事实、未注册 exp3、部件诊断、口型严重级别和全量测试入口。

主要实现：

- `app/src/renderer/services/performance/inspection/index.ts`
- `app/src/renderer/services/performance/capability-diagnostics.ts`
- `app/src/renderer/services/performance/model-runtime.ts`
- `app/src/renderer/composables/useStageModelLifecycle.ts`
- `app/tests/capability-diagnostics.test.cjs`

## 真实模型导出

隔离 profile：`D:/Frankenstein/Uta-Workspace/runtime/profiles/live2d-capability-diagnostics-20261101`
证据目录：`D:/Frankenstein/Uta-Workspace/operations/live2d-capability-diagnostics-20261101`

### Hiyori

加载应用内模型 `./models/hiyori_pro_zh/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json`，通过真实 Cubism Core 和 Electron 运行时导出：

- 模型签名：`uta-live2d-assets-v1:7de06ee919851e03bacda219786309a8189c90cc296c0edafaad836724230e42`。
- 70 个参数、10 条动作。
- `Tap#1`：`2100 ms`、`loop: true`；33 条 Parameter 曲线/33 个目标；0 条 Model 曲线；2 条 PartOpacity 曲线，目标为 `PartArmA`、`PartArmB`。
- adapter 将同一资源分别绑定为 `emotion:happy`、`animation:wave`、`animation:cheer`。导出对三个语义分别产生画面待验收项，并额外报告共用资源；没有把三者合并成一个语义。

这只完成结构验收。`Tap#1` 视觉上到底是挥手、欢呼还是其他动作，仍需工坊逐语义看画面。

### 大肥鱼

读取日常模型目录 `C:/Users/Administrator/AppData/Roaming/uta/models/imported-character-072c7e1cdc`，只在隔离 profile 中配入仓库的 `docs/adapters/dafish/deskpet-adapter.json`；未修改日常模型或设置。

- 模型签名：`uta-live2d-assets-v1:725cd62b590e8c1efa666b1873d2cb1aeab6f66e4a3ae44e0917a66f2e1983bb`。
- 当前目录有 509 个参数，但没有 `.motion3.json`、`.vtube.json`，`model3.json` 也没有 `Motions`；真实运行时导出为 0 条动作、0 个动作组。
- 因此先前“已注册 8 个组且 IDLE 可用”的前提与当前日用模型不符。仓库示例 adapter 的 `idleMotions: ["IDLE"]` 被正确报告为缺失 `IDLE#0`，不能宣称可用。
- `wave` 及其他 7 个标准动作语义都没有绑定。
- `happy`、`surprise`、`curious` 都写入 `ParamMouthOpenY`，分别报告为与口型张嘴参数可能争用。
- 收尾后仍未改动该目录。下一次验证前必须在隔离 profile 用当前导入器重导源模型，确认 23 个表情和 8 个动作恢复；仓库草稿 adapter 不能直接当成当前日用目录的可用适配。

## 验证

- 收尾后 `npm test`：1173 项；1167 通过、6 跳过、0 失败。
- 收尾后 `npm run test:live2d-capabilities`：163 项；158 通过、5 个既有真实 DS 样本条件跳过、0 失败。
- 收尾前原提交验证为 1165 项（1159 通过、6 跳过）和专项 160 项（155 通过、5 跳过）。
- `npm run typecheck`：Node/Web 均通过。
- `node scripts/check-first-wave-contracts.cjs`：通过。
- `npm run build`：原提交通过；收尾提交只改事实导出、诊断和测试，未重新打包。
- 隔离 Electron 真实加载 Hiyori 与大肥鱼并导出 `hiyori-facts.json`、`dafish-facts.json`、运行时简表和 `summary.json`；最终 stderr 只有调试器启动/结束信息。收尾新增字段由专项测试覆盖，未重新启动 Electron。

## 当前现场与边界

- 隔离 Electron PID `30928`、`33916` 已退出；9360、9361 无监听。
- 隔离 profile 和证据目录保留，便于复核；日常 profile、模型与宿主安装未写入。
- 本轮没有做动作语义画面验收，也没有证明 DS 的“轻开心/思考被打断”表现已经改善，因为播放层尚未改动。
- 大肥鱼重导与验证已完成，结果见 [重导验证](dafish-reimport-20261101.md)：23 表情、8 动作、509 参数、147 部件已恢复，真实 Electron 加载并启动 `IDLE`；生成的 adapter 仍只绑定 idle/focus/口型，表情和标准动作语义尚未接上。
- 下一步是“统一解析的影子对照模式”：先把 adapter 和预设投影为同一种计划，只记录选择与占用，不切换实际播放。需在本结果获确认后另行开工。
