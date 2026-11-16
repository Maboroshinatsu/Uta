# 结果：模型能力识别纯模块

状态：**已提交待主控审查**（不等于 Codex 已验收，也不代表整个 Q04/C02 完成）。

## 交付信息

- 任务：`model-capability-core` / `docs/workflow/tasks/model-capability-core.md`
- owner：Qoder
- 分支：`task/qoder/model-capability-core`
- base：`edca60b8f7f31dbbac4d607a4bb4e6ca64102bfe`
- 交付 head（本结果文件提交前）：`88d7837`
- 最终 head：以 `node scripts/task-handoff.mjs submit` 回执与 `git log` 为准（本结果提交后即为最终 head）
- 任务提交：
  - `c48141a` docs(workflow): start model capability core progress
  - `2f4ce83` feat(profile): add pure model capability profile builder
  - `88d7837` test(profile): cover validation, degradation and determinism
  - 本条结果与 progress 收尾提交

## 改动文件

- `app/src/renderer/services/performance/profile/index.ts`（新增）
- `app/src/renderer/services/performance/profile/README.md`（新增）
- `app/tests/model-capability-core.test.cjs`（新增，未改 `app/package.json` 测试清单）
- `docs/workflow/results/model-capability-core.md`（本文件）
- `docs/workflow/progress/model-capability-core.md`

未修改 loader、emotion-adapter、Stage、store、`app/src/shared/first-wave-contracts.ts`、`app/tests/fixtures/first-wave-v1.ts`、`docs/contracts/first-wave-v1.md`、`app/package.json`/lock、main 或其他任务。

## 实现内容

- 导出 `buildModelCapabilityProfile(input: ModelInspectionInput): ProfileBuildResult`，以及 `SEMANTIC_CHANNEL_ORDER`、`STANDARD_PARAMETER_IDS`。
- 类型只从冻结契约 `app/src/shared/first-wave-contracts.ts` 导入；无 PIXI/Vue/fs/网络/持久化依赖，不读模型、不算哈希、不写 Core。
- 严格校验：
  - 根对象、`schemaVersion === 1`、未知顶层字段拒绝；
  - 参数 `id` 非空唯一，`min/max/defaultValue` finite 且 `min ≤ default ≤ max`，`physicsOutput` 布尔，未知字段拒绝；
  - 表达式 `name` 非空唯一，`blend` 仅 Add/Multiply/Overwrite，值 finite，结构未知字段拒绝；
  - motion `group` 非空、`index` 非负整数、`group#index` 唯一、`parameterIds` 为非空字符串数组、未知字段拒绝；
  - override channel/direction/confirmed 严格校验，未知目标报 `unknown-override-target`，同通道重复报 `invalid-override`。
- 映射优先级：已确认 override → 标准 ID → 唯一明确标签别名 → 未确认 override 兜底 → unsupported；能力列表始终按 15 通道固定顺序输出。
- 降级：标准参数物理输出/零范围不标 available；物理输出 override 保留 manual 映射但 `needs-calibration/physics-output`；零范围用 `ambiguous`；标签猜测永远 `confirmed: false` 且 `needs-calibration`；候选多义时不猜，列出候选 ID。
- 原生表达式和 motion 原样保留；未知参数只产生 `unknown-expression-parameter` / `unknown-motion-parameter` warning，不创造参数。
- 纯函数：不修改输入（含深冻结输入），输出与输入不共享可变数组/对象，重复调用结果确定，无时间/随机源。

## 验收矩阵与证据

- standardModel / minimalModel / privateModel：见 `standard fixture...`、`minimal fixture...`、`private fixture...` 三个用例；能力方向、manual reversed、15 通道顺序均有断言。
- 全 15 标准参数：`a full standard parameter set makes every channel available`。
- null / 数组 / 错误类型 / 未知 schema / 未知字段 / 空签名 / 参数重复 / NaN / Infinity / min>max / default 越界 / 非对象项：`non-object inputs...`、`root schema...`、`parameter rejection: ...` 共 9 类。
- override：未知目标、非法 channel/direction、重复 channel、未知字段、非布尔 confirmed 共 7 类；物理输出/零范围降级、未确认 override 兜底均有独立用例。
- 原生资源：Add/Multiply/Overwrite 与值完整保留；未知参数 warning；非法 name/blend/结构、重复 group#index、非法 index 均拒绝。
- 深冻结输入、输出隔离、确定性、无 Date.now/Math.random：4 个独立用例。
- 不写真实 Core、不触发 Uta 实例：模块无副作用；本任务无运行进程。

## 验证命令与真实结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node scripts/check-first-wave-contracts.cjs`（根目录） | 0 | 正样例通过，3 个预期非法形状被拒绝 |
| `node --test tests/model-capability-core.test.cjs`（app） | 0 | 56 tests / 56 pass / 0 fail |
| `tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler src/renderer/services/performance/profile/index.ts`（app） | 0 | 单文件严格类型检查通过 |
| `npm run typecheck`（app） | **2** | `typecheck:node` 通过；`typecheck:web` 报 TS6307，见下 |
| `npm run build`（app，默认 TEMP） | **1** | esbuild 删除系统 Temp 临时文件 `Access is denied`，与本模块无关 |
| `npm run build`（app，`TEMP/TMP=app/node_modules/.uta-build-tmp`） | 0 | 主进程、preload、renderer 全部构建成功 |

### 类型检查阻塞与建议修复

`npm run typecheck` 的 `typecheck:web` 失败信息：

```
src/renderer/services/performance/profile/index.ts(18,8): error TS6307:
File '.../app/src/shared/first-wave-contracts.ts' is not listed within the file list of project '.../app/tsconfig.web.json'.
Projects must list all files or use an 'include' pattern.
```

原因：`app/tsconfig.web.json` 设置了 `composite: true`，include 仅覆盖 `src/renderer/**`；新模块按契约从共享契约文件导入类型，触发了 composite 的“所有文件必须被 include”检查。已确认三方约束冲突：

- 契约要求只能用共享类型，不能复制一套；
- 任务允许修改范围不含 `app/tsconfig.web.json`；
- `task-handoff.mjs submit` 会拒绝任何范围外文件。

**已做的诊断**：临时在 include 追加 `"src/shared/**/*.ts"`，`npm run typecheck` 退出码 0；随后原样还原，未留在工作区/提交中。

**请求主控**：把 `"src/shared/**/*.ts"` 加入 `app/tsconfig.web.json` 的 `include`（或改为项目引用），再复跑 typecheck。除此之外模块本身在官方配置下无类型错误。

### 构建环境说明

默认 `npm run build` 两次稳定失败在 esbuild 删除 `C:\Users\ADMINI~1\AppData\Local\Temp\esbuild-*` 的 `Access is denied`。本模块尚未被任何入口 import，故与代码无关；把 `TEMP/TMP` 指向任务内可写目录后构建成功。该临时目录已清理。

## 测试注册

`app/package.json` 的 `test` 清单未修改（范围外）。主控可运行：

```
cd app
node --test tests/model-capability-core.test.cjs
```

如需并入全量 `npm test`，请在 `app/package.json` 的 `test` 脚本中加入 `tests/model-capability-core.test.cjs`。

## 待主控确认的语义判断

1. **未确认 override 的优先级**：按契约“先取已确认 override → 标准 ID → 标签建议”实现；未确认 override 只在没有其他来源时兜底成 `needs-calibration/unconfirmed`，不抢占可用标准映射。若希望它优先，需要明确契约语义。
2. **零范围的 reason**：`reason` 联合类型没有零范围专用值，当前使用 `ambiguous`；若需区分，需变更共享契约。
3. **标准参数存在但为物理输出**：不创建映射，只输出 `needs-calibration/physics-output` 并在 `parameterIds` 中列出该标准参数；符合“physicsOutput 默认不自动映射”。
4. 标签别名是刻意保守的精确中英匹配（见模块 README）；真实模型若要扩充，应按实际 label 追加，不做模糊猜测。

## 未做 / 风险

- 未接线 loader、Stage、store、UI，也未写真实 Core；本批按契约只做纯数据子任务。
- 未改全局文档、插件、日常设置；未合并 main、未发布、未调用桌宠。
- 类型检查需主控补 tsconfig include 后才能全绿；其余验证已通过。
- 默认 TEMP 下的 esbuild 权限问题是本机环境风险，不影响产物逻辑。

## 现场与进程

- 工作区：干净（本结果提交前仅本文件与 progress 的收尾改动）。
- 无 Uta 应用/桌宠进程；未使用 `qoder-model-capability-core` runtime profile 启动任何实例（纯模块不需要）。
- 模型：DeepSeek-Flash；桌面思考/上下文档位不可设置/未验证（未另启 CLI）。
