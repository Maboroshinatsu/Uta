# Qoder 交付：Live2D逐通道仲裁与生命周期纯内核

状态：实现与行为测试完成，已提交，待 `task-handoff submit` 后由 Codex 审查。**本文件不表示交付已验收，也不表示 Live2D 画面已改善。**

## 1. 环境、base/head 与提交

- 任务：`performance-mixer-core`
- owner：Qoder
- 工作目录：`D:\Frankenstein\Uta-Workspace\tasks\qoder-performance-mixer-core`
- 分支：`task/qoder/performance-mixer-core`
- base：`11d2c0e9bfb6d266aff72ca2772dcb6f7d0306ae`
- 实现提交：`4e163c8`（`feat(performance): add deterministic semantic mixer kernel`）
- 交付文档提交：本文件所在提交；`node scripts/task-handoff.mjs submit` 的 `.uta-task/status.json` 记录最终 head。
- profile：`qoder-performance-mixer-core`
- 实际测试运行时 Node：`v24.14.0`（`/c/Program Files/nodejs/node`）
- 模型策略：请求 `DeepSeek-Flash`，显式 `--reasoning-effort max --context-window 1000000`。CLI 未回传后端实际生效的思考档位/上下文上限，故该两项标记为**未验证**；未换模型、未降档。

## 2. 变更范围

仅修改任务允许路径：

- 新增 `app/src/renderer/services/performance/mixer/index.ts`（唯一实现文件，纯计算，无副作用依赖）。
- 新增 `app/tests/performance-mixer-core.test.cjs`。
- 新增 `app/tests/fixtures/performance-mixer-core-v1.cjs`（合成 Profile 与有边界场景）。
- 更新 `docs/workflow/progress/performance-mixer-core.md`。
- 新增本 result。

未改：shared 契约、既有 Profile/意图/快照类型、通用 fixtures、`package.json`/lock、loader、Stage、mouth-motion、设置/IPC、PIXI 依赖、main/stable、总台账；未新增依赖；未合 main、未发布/安装插件。

## 3. 冻结契约与 hash

以下 hash 来自 `.uta-task/assignment.json`，并由 `task-handoff preflight/checkpoint` 实际校验通过（helper 读取 UTF-8 并将 CRLF 归一为 LF 后计算 SHA256）：

| 文件 | SHA256 |
| --- | --- |
| `app/src/shared/first-wave-contracts.ts` | `c0819cebcbc2703cfdff153865f2badb2a9c80827d750dc0b72037ccdfdd9625` |
| `app/src/shared/model-inspection-contracts.ts` | `fec010ba1530c6130782f549701569f06e301fe69b30fa09c1bc59e2b65f02df` |
| `app/src/shared/performance-mixer-contracts.ts` | `8ccfe0aa79f059e95b56ea59110a7abe9ccc0b20baf6ed17351fc55d2cacc024` |
| `docs/contracts/first-wave-v1.md` | `98b60deadf4696bfacc3814aa288210679e76f66618af4e5c1c75013085141a5` |
| `docs/contracts/desktop-wave2-v1.md` | `1554f01b447afb7a7cc1f279cd825ecc95d31198e12e19c333685d4ddd8dc788` |
| `docs/contracts/performance-mixer-v1.md` | `916b48fd804cc11f09dd4e8d70719a99ce2b3d9484b8648b278bf15f57ae4bd1` |
| `docs/design/live2d-performance-plan.md` | `6f9aa4a74d431b82ef3fa574a340f3422486b8bf586dfc7a1a53614101f6c825` |
| `docs/models/ds-control-baseline.md` | `5ae19db92a592d471fef97a16e37607eb79ab2b50d72b54ecad431251af0151a` |
| `docs/workflow/tasks/performance-mixer-core.md` | `b25b13ef4919ac9c569280d1ef5619888ec91da1fe69e1aa05b66bf434ff7f8e` |

## 4. 公共接口与关键语义

导出：

- `createPerformanceMixer(): PerformanceMixer`
- `PerformanceMixer.step(tick: PerformanceMixerTick): PerformanceMixerResult`
- 常量：`MIXER_MAX_DT_MS=50`、`MIXER_MAX_FADE_MS=5000`、`MIXER_MAX_TTL_MS=60000`、add/multiply 输入边界、`MIXER_FRAME_GAP_REASON`、`MIXER_SEMANTIC_CHANNELS`（由 `SEMANTIC_CHANNEL_ANCHORS` 顺序派生）。

关键实现语义（供审查）：

- 贡献是跨 tick 的租约；`contributions` 是新增/更新输入，未出现在本 tick 的已接受租约仍持续，直到 release/TTL/epoch 变化。
- 首次接受时记录内部单调时钟 `acceptedAt`；同一租约后续更新保留 `acceptedAt`，因此持续重发的贡献不会无限刷新 TTL。TTL 从首次接受起算。
- 每个通道独立按 priority→accepted time→ownerId→generation→contributionId 排序，后应用者生效。replace/add/multiply 按契约公式；add 输入限制 `[-2,2]`，multiply 输入限制 `[0,2]`，replace 越界直接拒绝贡献；组合结果最终按 anchor clamp。
- `effectiveWeight = strength × smoothstep(fade-in) × (1 - smoothstep(fade-out))`，再限制 `[0,1]`。
- 时钟按 tick 前进，单步最多 50ms；重复/倒退样本不推进；超过 50ms 记录 `frame-gap-clamped`。epoch/binding 切换会清空租约、owner generation 记忆、墓碑和时钟状态，并以新 tick 样本重建时间基线。
- 新 owner generation 立即清除该 owner 全部旧租约；旧 generation 的 update/release 被拒绝或找不到租约。release/expiry 完成后该 `(owner, generation, contributionId)` 进入租约墓碑，同一 generation 不能复活，必须使用更新 generation；墓碑在新 generation 或 epoch/binding 切换时清理。
- 仅 Profile `status='available' && reason='mapped'` 的通道可输出；needs-calibration、unsupported、缺失 capability、physics-output 原因均逐通道降级，不生成 pre/post 输出。
- `intents` 只作为冻结输入词汇接受，**不解释** state/emotion/cancel（本任务不做 director）；生命周期释放入口是 `releases`。因此 state/emotion 不会隐式清零 mouthOpen。
- 诊断：`channels[].base` 为本阶段输入 base；`target` 为全部贡献组合后的有限期望值（可超出 anchor）；`current` 为最终 clamp 后实际输出；`clamped` 表示该通道/阶段发生过输入限制、base clamp 或最终 clamp；`clampCount` 是 `clamped=true` 的通道/阶段诊断数。`prePhysics/postPhysics` 中的所有键值均 finite 且位于 anchor 内。
- 未生成可选的 `PerformanceSnapshot` 投影，避免在本任务引入 director/state 语义。

## 5. 必测行为与证据

`app/tests/performance-mixer-core.test.cjs` 共 36 项，全部行为断言，不做源码字符串匹配。对应关系：

| 任务必测项 | 测试用例 | 断言要点 |
| --- | --- | --- |
| replace/add/multiply 数学边界 | `replace, add and multiply follow...`、`add and multiply inputs are limited...`、`replace values outside...` | 有界插值、增量、乘数公式；add/multiply 输入限制；replace 越界拒绝；最终 anchor clamp |
| channel mask / 逐通道 priority / stable tie | `masks are per channel...`、`stable ties use accepted time, owner and contribution id ordering`、`per-channel composition is independent...` | 缺失键不参与；每通道独立排序；priority、accepted time、owner、contributionId tie-break；输入顺序不影响结果 |
| 两阶段独立、post 接续 pre | `pre and post phases are independent...`、`snapshot exposes per-channel phase diagnostics...` | pre/post 分离；post base=pre 结果；无 post 贡献时保留 pre；诊断 phase/base/target/current |
| capability 降级 | `capability degradation blocks...`、`invalid or missing profiles...` | available 输出；needs-calibration/unsupported/缺失/physics-output 不输出且给出原因；混合 mask 仍应用可用通道 |
| 非对称模型仅语义边界 | `asymmetric DS structure summary stays in semantic units` | `mouthForm` 语义 -0.75 原样输出，不输出 -2/-0.5 或 `ParamMouthForm`；语义 -2 / mouthOpen -0.1 拒绝 |
| mouthOpen/mouthForm 独立 | `mouthOpen and mouthForm stay independent...` | state/emotion 意图不清零；无语音 owner 保留 base；仅 mouthForm 或仅 mouthOpen 贡献互不影响 |
| 眼睑与眨眼同通道组合 | `eyelid and blink combine...`、`a closed-eye expression is not reopened...` | add 后 multiply 按声明顺序组合；闭眼 replace 不被 blink add 重开 |
| 新 generation 替换旧 owner | `a newer generation replaces...`、`a new generation wins inside one tick...` | 新 generation 清旧租约；旧 update/release 无效；同 tick 输入顺序无关；释放后旧 generation 不能复活 |
| epoch/binding 切换 | `model epoch and binding generation changes...` | 清租约与时间状态；拒绝迟到贡献；新 identity 下可重新接受 |
| fade-in / TTL / fade-out / 清理 | `smoothstep fade-in...`、`ttl expiry starts fade-out...`、`explicit releases honor...`、`a release without fade-out...`、`expired leases are tombstoned...` | smoothstep 中点 0.5；TTL 到期开始 fade；显式/默认 fadeOut；尾部分 0 后清理；墓碑阻止同 generation 复活 |
| 单调时钟/dt=0/大步限制 | `repeated and backwards...`、`a large frame gap advances at most 50ms...`、`a non-finite sample holds the clock...` | 重复/倒退不推进；100ms 大步只推进 50ms 并有 `frame-gap-clamped`；非法样本保持时钟且输出 finite |
| 相同输入可重放 | `identical tick sequences replay deterministically...` | 两个独立 mixer 对相同 tick 序列输出 deep-equal |
| NaN/Infinity/范围/非法 owner/phase/priority/mode 隔离 | `malformed contributions are rejected...`、`non-object contributions are rejected by index`、`invalid base values...`、`invalid tick identity...` | 每个非法贡献只进入 rejected 列表并带原因；合法通道/贡献不受污染；base 非法回 neutral；输出全部 finite |
| 冻结输入/输出隔离 | `frozen inputs are accepted...`、`accepted contributions clone values...` | deep-frozen tick 可运行；输出可变但独立；接受时复制 values，不保留调用方引用 |
| 冻结合成 fixture 兼容 | `the frozen synthetic mixer fixture is accepted as-is` | 直接消费 `app/tests/fixtures/performance-mixer-v1.ts` 的 `semanticTick`，无拒绝且输出 finite |
| 契约版本边界 | `unsupported tick envelopes throw...` | 非对象/未知 tick version 抛 `TypeError`，不静默误解释 |

## 6. 实际运行命令与退出码

均在本任务 worktree 内执行，未使用其他任务目录或共享依赖链接。

| 命令（工作目录） | 退出码 | 实际结果 |
| --- | ---: | --- |
| `node scripts/task-handoff.mjs preflight`（任务根） | 0 | 目录/分支/base/head/dirty/profile 与第 1 节一致 |
| `node scripts/task-handoff.mjs checkpoint`（任务根） | 0 | 范围检查通过；untracked 仅为任务允许文件 |
| `node --test tests/performance-mixer-core.test.cjs`（`app`） | 0 | 36 tests / 36 pass / 0 fail |
| `node ../scripts/check-performance-mixer-contracts.cjs`（`app`） | 0 | 冻结 mixer 契约与共享合成 fixture 类型检查通过 |
| 独立严格类型检查（`app/node_modules/typescript@5.9.3`，检查 shared 契约 + mixer，`strict` + `noUnusedLocals/noUnusedParameters`） | 0 | 无诊断 |
| `node --test tests/model-capability-core.test.cjs`（`app`） | 0 | 既有 profile builder 回归 56 tests / 56 pass |

依赖现场：

- 任务 `app/node_modules` 初始只有部分包（含 `.bin` 但缺 `typescript`）。为运行既有测试约定所需的 TS 转译，从本机 npm 缓存解压 `typescript@5.9.3` 到本任务 `app/node_modules/typescript`；未改 `package.json`/lock，未链接共享依赖，未执行全量 app 依赖安装。
- 未运行 `npm run typecheck` / `electron-vite build`：需要完整 app 依赖（Vue/vue-tsc/Electron 等），超出本任务“纯模块+行为测试”的最小验证；本模块已单独 strict 类型检查。

## 7. 未验证与未做

- 未接 Core/Stage/loader/PIXI/settings/IPC/窗口，未写任何 Cubism 参数；mixer 输出是**无量纲语义值**，不是模型参数值。
- 未读取真实模型文件、正式 AppData、宿主 MCP、浏览器或网络模型；未使用 screenshot/GUI 验证。
- DS 鼠控版只使用公开结构摘要作为有边界合成 fixture（`mouthForm [-2,1] default -0.5`、`mouthOpen [0,1] default 0`），不是 Core 回放，不代表真实模型映射已验收。
- 未做 director、自然待机、语音时钟、预设迁移、Soullink、渲染接线；本任务测试通过不代表 Live2D 画面已改善。
- 未提供产品性能保证；未做 1ms/10% 等运行时性能采样，因为本任务没有渲染接线和固定机器场景。
- 未生成可选 `PerformanceSnapshot` 投影。

## 8. 风险与请审查点

1. **租约与墓碑策略**：release/expiry 后同一 generation 不能复活，需上游使用更新 generation 重新获取；未出现在 tick 的已接受租约持续到 release/TTL。这是对“lease/新 generation 取代旧 owner”的实现解释，请 Codex 确认是否符合后续接线预期。
2. **TTL 起算**：从首次接受起算，更新不刷新 TTL；避免持续重发使 TTL 失效。
3. **诊断字段**：`target` 是有限但可能超出 anchor 的组合期望值，`current` 是最终 clamp 输出；`clampCount` 统计 clamped 的通道/阶段数，不是 clamp 运算次数。
4. **时钟**：内部生命周期时间按 50ms 上限累计推进，`snapshot.sampledAtMonotonicMs` 保留本 tick 的原始有限样本；大步后原始样本可能领先内部状态，这是防止后台恢复跳变的预期行为。
5. **intents 未解释**：本任务不做 director；state/emotion/cancel 意图不会改变通道或释放租约，释放必须走 `releases`。若后续要求 cancel intent 直接释放，需要单独任务定义会话/epoch 匹配语义。
6. **非法 tick 信封**：非对象或未知 version 抛 `TypeError`；其余字段级错误降级并输出有限 base/neutral。此边界请确认是否满足接线层的错误处理约定。
7. **依赖现场**：本任务只补装 TypeScript 以运行测试；未验证全量 app 构建。Codex 集成审查时应在完整依赖环境复跑类型检查/构建。

## 9. 进程与现场

- 本会话只启动短时 `node --test`、`node -e` 类型检查、`task-handoff` 和 `git` 进程，均已退出。
- 未启动/停止 Electron、dev server、Core、MCP、浏览器或其他任务进程；未写正式 profile 或 AppData。
- 任务内临时调试文件已删除；`app/node_modules` 与 `.uta-task/status.json` 为任务本地/忽略产物。

## 10. 下一步

`node scripts/task-handoff.mjs submit` 后停在待审。若权限被拒，保留本 result、提交与 diff，不绕过权限、不重置；由 Codex 审查决定是否合入 main。
