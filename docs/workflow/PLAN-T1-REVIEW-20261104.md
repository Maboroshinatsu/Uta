# T1 方案独立复核记录（2026-11-04）

复核对象：`PLAN-T1-CHANNEL-OWNERSHIP.md` 首版（2026-11-03）。基线 `main` @ `3e13fea`。
下方为子代理原始结论；随后是我（主代理）的逐条回验。**两者都有错**，最终采信版本见方案正文。

## 1. 子代理原始结论（verbatim）

> **结论**：P0 的事实基础不成立，不可按原文执行；P1「零行为变化」不成立；P2 会影响全部模型且无回归网。
> 方案整体偏重，建议只做 P0 缩小版 + P4。
>
> 1. 视线：三套并存成立，但漏了第四套——`usePresetController.ts:192` 的 `/^(Param)?EyeBall[XY]$/` 居中逻辑；
>    `sequenceGazeLocked` 恰 11 处（81/102/189/349/407/518/606/740/751/777/802），准确。
>    须纠正 AUDIT §1：`setSequenceGazeOverride` 并非零调用方，实有 6 处（103/350/520/536/597/611），`:809` 守卫有效。
> 2. 归属集：实为 7 处非 5：`loader.ts:803/1188/1197/1716`（4）、`usePresetController.ts:191/545`（2）、
>    `useCompanionDirector.ts:91`（1）。方案把 director 记成 2、loader 记成 1。
> 3. 动作层：`currentLayer = null` 实 7 处且全在 `useMotionPriority.ts`（79/114/123/145/155/167/177），
>    非散落多处，削弱「散落」叙事；5000/8000 在 `:147`，另有 `SCENE_CLEANUP_MS=20000`（`:5/:126`）未计入；
>    `stopLoop` 4 处调用准确。
> 4. 暴露实现：5 个文件 / 6 个站点；AUDIT 路径有误，实为 `app/src/main/vts-import.ts`、
>    `app/src/renderer/settings-window/ModelCalibrationPanel.vue`。
> 5. P0 错（最重要）：三代 happy 全被在役代码静态引用——`useStageModelLifecycle.ts:52-54` 导入并在
>    `:377-393` 三次安装注册 motionGroups；9 个 `dafish-body-led-*` 与 `dafish-well-actually` 从 authored/calibrated
>    取 `authoredTrack/bakeDafishParameterMotion`，从 performance 取 `registerDafishGeneratedMotion`；
>    `loader.ts:10` 每帧依赖 performance；测试 `dafish-authored-happy`/`dafish-calibrated-happy`/
>    `dafish-happy-performance.test.cjs` 直接覆盖。JSON 那半成立：`natural-presets.ts` 仅 import generic/ds，
>    但 `natural-presets.test.cjs:28-32` 以 fs 读取，删文件须同步改测试。
> 6. 成立：`motion-priority.test.cjs:125` 遍历 timer 只调 `fn()`，全文件无 `ms` 断言，5000→8000 确实拦不住。
>
> P1/P2 具体风险：`dafish-happy-performance.ts:204` 按 `motionManager.state` 实时派生，组一切换立刻变 EMPTY
> （测试 `:64-69` 断言）；表若绑动作层释放，最长延迟到 `:147` 的 8000ms，参数被多占 8 秒。
> `803` 与 `1188/1197/1716` 语义不同（后者含 `!(id in controls/emotion)` 优先级），单一优先级表无法同时复现，
> P1 验收「表 == 各处 has()」定义不成立。换模型现靠 WeakMap 自动回收（`useStageModelLifecycle.ts:471/606/663`），
> 全局表须显式撤销，中断路径易留孤儿。`preset-controller-smoothness.test.cjs:76-78` 正好 mock 该模块 id，
> 改查表使其失效。全库无测试触及 `focusWeight`，删 `:809` 无回归保护。
>
> 建议的最小路径：P0 缩小为「删 `SettingsPanel.vue:399-798` 约 400 行孤儿 + dafish JSON 及其 fs 读取」；
> P4 提前；P3 仅在 `emotion-adapter.ts:1256-1315` 内部把 tier4 排除提到 tier1-3 之前，不引入 registry。
> P1/P2 表化按现有证据不划算。
>
> 最大风险：照 P0 删 happy 会连带 `loader.ts:803` 每帧依赖与 9 个在役 body-led 动作一起崩、3 个测试直接失败
> ——名义减法实为破坏。

## 2. 主代理回验结果

**采信（我独立 grep 复现，行号一致）**

- `getDafishHappyOwnedParameters` 7 处直读：`loader.ts:803/1188/1197/1716`、`usePresetController.ts:191/545`、
  `useCompanionDirector.ts:91`。首版方案的「5 处」作废。
- `setSequenceGazeOverride` 6 处调用 + `loader.ts:1844` 定义 → AUDIT §1「零调用方、`:809` 守卫永不成立」是错的，已更正。
- `currentLayer = null` 7 处，全部位于 `useMotionPriority.ts`。
- `motion-priority.test.cjs:125` 只调 `timer.fn()`，全文件无 `ms` 断言；`:120` 测试名仍写「five-second」而实际兜底为 8000。
- happy 三代为在役基础设施，不可删（证据链与子代理一致）。
- `natural-presets.dafish.json` 在 `src` 内无 importer，仅 `tests/natural-presets.test.cjs:30/:41` 以 fs 读取并打桩。
- 滑块第 4 档排除（`emotion-adapter.ts:1330/:1331`）确实晚于第 1–3 档的 `push + continue`（`:1276/:1295/:1314`）。

**驳回（子代理自身的错）**

- 「删 `SettingsPanel.vue:399-798` 约 400 行孤儿」：路径与内容**两点都错**。该文件实际在
  `src/renderer/components/SettingsPanel.vue`（2578 行），不在 `settings-window/` 下；
  而其 399–798 行是**在役代码**——`nativeMotionOptions` / `saveNativeMotionPreset`（原生动作库存为预设）
  与 `editingSteps` / `motionSelection` / `onMotionSelect`（预设步骤与动作绑定编辑），删掉直接砍掉设置页功能。
  我原先写的「动作导演约 400 行孤儿」同样作废——`useCompanionDirector.ts` 为 6.8KB（约 200 行），
  被 `DeskpetStage.vue:758` 使用。**本轮没有任何一处「400 行孤儿」得到证实。**

**存疑（未采信，也未反驳）**

- 「P2 会影响全部模型」：只对 `loader.ts:809` 的适用模型范围做了间接判断，未逐模型跑探针。
  由于最终决定不动视线（T1-d），该结论不再影响执行，故未继续验证。

## 3. 这一轮复核的意义

首版方案的两个核心动作（P0 减法、P1 建表）都建立在未经实测的断言上，其中 P0 会造成真实破坏；
复核代理纠正了我，但它自己给的替代减法（400 行孤儿）同样是幻觉。
**教训已写进方案 §5：任何「可删」结论必须附 importer 扫描与测试引用扫描，两者都为空才允许动手。**
