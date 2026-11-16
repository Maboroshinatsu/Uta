# Soullink纯引擎选型：进度

状态：implemented-pending-submit（待主控审查）。本会话只改 `experiments/soullink-engine/**` 与本 progress/result；未改 app/plugin/依赖/lock/main/公共文档。

## 模型与运行标识

- 模型请求：DeepSeek-Flash，显式请求 max 思考与 1,000,000 上下文；CLI 未回传实际生效档位/窗口，**不声称已验证服务端上限**，未回退 Auto。
- 工作区：`D:/Frankenstein/Uta-Workspace/tasks/qoder-soullink-engine-spike`；branch `task/qoder/soullink-engine-spike`；base `aba335d914fac58cc2c35fa0e7fc40e139fa51f3`；profile `qoder-soullink-engine-spike`。
- preflight：`node scripts/task-handoff.mjs preflight` 退出 0，branch/base/范围/契约 hash 通过。

## 输入

- Soullink 受控快照来自本地 HEAD `02cd75ac0a085a87d84d1a885f1b33eca8742d53`；`.uta-task/reference-inputs/manifest.json` 逐文件 sha256/字节校验通过：88 个文件、411,844 字节、manifest sha256 `f949b9807ea4e22d64041c42f3e4d1dfa009760307705f12e3fce57d00f7719a`。
- 许可：根与 `packages/engine/LICENSE` 均为 Apache-2.0，sha256 `9838629be61bce3130144bc684e0579f687a3cddd024f67de5340a4f25cc5626`；快照内**没有**独立 NOTICE 文件，未虚构版权人。
- DS 真实样本仍在忽略的 `.uta-task/model-input`，未入 Git；阶段3已用已合并适配器复核完整性并释放 Core。

## 阶段1：公开 API / 版本 / 许可 / 最小构建（完成）

命令（工作目录 `experiments/soullink-engine`；TEMP/TMP 指向任务内 `.uta-task/tmp`）：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node scripts/verify-inputs.mjs` | 0 | 88文件/411,844字节逐文件hash通过；sourceHead 02cd75a；无 NOTICE |
| `node scripts/build-engine.mjs` | 0 | app TypeScript 5.9.3 对快照源码 `--noEmit` 通过；app esbuild 0.21.5 构建 public/internal/Uta adapter |
| `node scripts/analyze-surface.mjs` | 0 | 包元数据、导出面、模块闭包、许可/README 报告 |
| `node --test test/*.test.mjs` | 0 | 6/6 通过 |

构建产物仅在忽略目录 `.uta-task/soullink-build/`，不是官方 npm 发布包：

- public bundle：245,661 字节、65 个输入模块、sha256 见 build-report。
- internal bundle：249,326 字节、64 个输入模块，仅用于表面比较，实验运行时不得导入。
- Uta Core inspection/profile adapter bundle：38,466 字节、3 个输入模块。
- `@soullink-emotion/engine@0.2.0-beta.1`，`type=module`，`sideEffects=false`，运行时/peer 依赖均为 0；exports 仅 `.` 与 `./internal`。
- public 导出 30 个运行时符号，internal 100 个；public 是 internal 严格子集，`ModelProfileAdapter`/`LipSyncController`/`LayeredParameterMixer` 等只在 internal。
- 源码闭包：public 65/66 文件、9,220 行；仅 runtime 入口也要 61 文件、8,762 行；无外部包 import — 裁剪移植并不能显著缩小范围。

## 阶段2：自有中立 driver 与白名单过滤（完成）

`experiments/soullink-engine/src/driver.mjs`：

- 只接收 public bundle 命名空间，不导入 `/internal`；把已合并首批 `ModelCapabilityProfile` 转为 Soullink `ModelProfile`（schemaVersion 2）。
- 只映射 `status=available`、`confirmed=true`、参数存在、非物理输出、范围有效的通道；未确认/缺失/物理输出全部记录为 skipped。
- `ParamMouthForm` 使用模型真实 min/max/default 生成两个贡献：mouthSmile 加向 max，mouthFrown 减向 min；默认 -0.5 原样保留，不按 0 或 ±1 归一化。
- 输出白名单只含已确认目标；私有参数如 `ParamCheek38` 保持模型事实但不进入驱动白名单。
- 包装器自有能力：whitelist/physics/finite/range 过滤、generation 拒收旧 update/trigger、cancel 后 180ms 可配置 release tail、动作 handle 的 generation 校验。
- 明确记录引擎缺口：`mouthOpen` 在无语音播放时被强制归零（manual FACS 也受影响）；无原生 cancel/generation；无逐通道 owner/release；原生动作 directive 不代表播放完成/取消。

命令（工作目录 `experiments/soullink-engine`）：`node --test test/driver.test.mjs` 退出 0，8/8 通过。

## 阶段3：固定 seed/dt 场景、真实 DS 输入与对照基准（完成）

真实输入（只读、已释放）：用已合并 Core inspection/profile adapter 读取任务内 DS 快照，manifest/逐文件 hash 与签名 `8f6042a7...5341c9` 一致；Core 5.1.0 实读 247 参数/92 parts/269 drawables，Core report matches=true；44 表情、8 动作；12 个通道 available，bodyX/Y/Z 因 56 个物理输出保持 needs-calibration，未驱动；`ParamMouthForm` [-2,1]/default -0.5、`ParamMouthOpenY` [0,1]/default 0。读取后 `release()` 并断言已释放。

场景（synthetic 7 项 + real profile 7 项全部通过）：

| 场景 | 实测摘要 |
| --- | --- |
| neutral→正/负渐变、hold、衰减 | happy 峰值 valence 0.6015、3s hold 0.6007、10s 衰减到 0.2630；sad 峰值 -0.5213、hold -0.5206、衰减到 -0.2279；mouthForm happy 最高 0.5548，sad 最低 -1.3732，均在 [-2,1] |
| 无语音惊讶张嘴 | 引擎把 mouthOpen 强制为 0（surprise max=0）；manual FACS 0.9 仍为 0；voice active 时最大 0.5977；静音末值 0.000378；结束 2.3e-9。确认为引擎原生 gate 缺口，wrapper 不覆盖、不冒充支持 |
| 语音中静音/结束/取消 | 说话最大 0.5977；静音末值 <0.01；结束 <1e-4；取消后 200ms wrapper release tail，最终 released、mouthOpen=0、旧 action 清除 |
| 动作替换/释放/旧 generation | happy→sad directive token 递增，旧 action handle 立即 stale；cancel 清空 action；generation 切换后旧 update/trigger 返回 stale，不再输出旧值 |
| dt=0/1/60/100ms/2.5s | dt=0 参数无变化（maxStep=0）；其余 dt 全部 finite/白名单/范围内，2.5s 单步最大变化 2.479（指数平滑饱和、未越界）；不是帧率保证 |
| 确定性 | 同 seed/dt 的 300 帧 happy/sad trace 字节一致；sha256 happy `f41fdd44...caf504`、sad `4f82a46f...ced3b7` |
| 缺参数/私有/物理/非对称嘴形 | 仅 6 个 synthetic/12 个 real 目标可输出；body/ParamCheek38 从不出现；默认 mouthForm 保持 -0.5；white-list/finite/range 过滤计数均为 0 丢弃 |

CPU/输出基准（真实 DS profile，Node v24.14.0，Win32 x64，AMD Ryzen 5 5600，12 logical cores；1000 帧 warm-up，5×2000 帧，dt=1/60，`process.hrtime.bigint` 单次 update）：

- 引擎：mean 0.0540ms、median 0.0429ms、p95 0.0982ms、p99 0.1932ms、max 0.596ms；5 批 median 0.0405–0.0463ms。
- 最小线性基线（同 12 参数、Uta 自有指数平滑，不是完整导演）：median 0.0008ms、p95 0.0014ms。
- 输出近似：12 参数、平均 415.02 bytes JSON/帧；基线 420.67 bytes。heap/RSS 差值受 JIT/GC 影响，仅记录不作为分配保证。
- 原始结果：`.uta-task/soullink-runs/latest.json`（忽略目录）；本轮 run sha256 `0a215f49...938972`。

命令（工作目录 `experiments/soullink-engine`）：`node scripts/run-experiments.mjs` 退出 0；`node --test test/*.test.mjs` 退出 0，26/26 通过（含 4 项真实 DS 测试）。

## 阶段4：ADR、结果与收尾（完成，待submit）

- `experiments/soullink-engine/ADR-001-engine-selection.md`：三路线对比；结论为本轮不接入产品默认路径，未来若需要优先公共依赖 + Uta wrapper，不推荐直接裁剪移植，自研只吸收思想。
- `experiments/soullink-engine/README.md`：构建/测试/实验复现命令与口径。
- `docs/workflow/results/soullink-engine-spike.md`：完整交付、命令/退出码、场景/指标、许可、风险、未验项、现场。
- 附加检查（任务根）：`node scripts/check-first-wave-contracts.cjs` 退出 0；`node scripts/check-desktop-wave2-contracts.cjs` 退出 0；`node --test app/tests/model-inspection-adapter.test.cjs app/tests/model-capability-core.test.cjs` 退出 0，150/150、0 skipped；`git diff --check` 退出 0。
- 未运行无关全 app 构建/GUI/桌宠/长期服务。

## 最近提交

- 阶段1：`56aa01d` build pinned Soullink public engine surface。
- 阶段2：`6302de8` bridge public engine output to Uta profile whitelist。
- 阶段3：`0bb2285` deterministic engine scenarios and CPU baseline。
- 阶段4：本 progress/result/ADR 收尾提交（待 submit 回执确认最终 head）。

## 缺口 / 下一步

- 嘴部 gate、无原生 cancel/generation、无逐通道 owner/release、原生动作无完成/取消回调均未由引擎解决；当前由 Uta wrapper 补 generation/cancel release，其余明确列为缺口。
- 原生 exp3/motion 未映射到 DS 真实资源；action 场景只用自有合成 map 验证引擎机制，不声称 44 表情/8 动作可用。
- 尚未验证官方 npm 发布包、GUI/画面/音频、真实 TTS、物理反馈；所有结论只针对该本地快照源码构建。
- 下一步：`node scripts/task-handoff.mjs submit` 后交主控审查；不合 main、不发布、不自动进入 mixer/renderer 接线。
- 未调用桌宠 MCP/浏览器/网络/消息工具/子 Agent；未写真实 AppData/模型；无 GUI 验收。
