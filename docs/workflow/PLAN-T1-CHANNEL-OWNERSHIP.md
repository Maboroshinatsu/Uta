# T1 通道所有权收敛方案（复核修正版，2026-11-04）

基线 `main` @ `3e13fea`。首版方案（2026-11-03）经独立复核 + 本人逐条回验后**大部分不成立**，
本文只保留经得起证据的部分，并记录被推翻的内容，防止后续会话再按原始设想施工。
复核原始结论与我的回验差异见 `PLAN-T1-REVIEW-20261104.md`。

## 1. 首版方案中被推翻的部分（带证据）

- **「P0 删掉被否定的 happy 实验变体（authored / calibrated / performance 三代）」——错误，撤回。**
  这三个文件不是在役编排，而是**公共基础设施**：`authoredTrack` / `bakeDafishParameterMotion` /
  `compileMotionTrack` / `registerDafishGeneratedMotion` 被 9 个 `dafish-body-led-*.ts` 与
  `dafish-well-actually.ts` 逐个 import；`useStageModelLifecycle.ts:52-54` 同时导入三代安装器并注册动作组；
  `loader.ts:10` 每帧依赖 `dafish-happy-performance`；另有三个测试文件直接覆盖。
  删下去会连带在役动作与每帧管线一起崩、三个测试立刻红——**名义减法，实为破坏**。
- **「P0 删动作导演约 400 行孤儿」——错误，撤回。** `useCompanionDirector.ts` 实际 6.8KB（约 200 行），
  被 `DeskpetStage.vue:758` 使用。复核代理改指的 `SettingsPanel.vue:399-798` 也不成立：文件在
  `src/renderer/components/`，且该范围是原生动作库存为预设 + 预设步骤动作绑定编辑的**在役代码**。
  **本轮没有任何一处「400 行孤儿」得到证实。**
- **「P1 建表后各处 `has()` 结果等价、零行为变化」——不成立。** 7 处直读的语义**本来就不同**：
  `loader.ts:803` 无条件展开；`:1188/:1197/:1716` 额外要求 `!(id in stack.controls) && !(id in stack.emotion)`
  （控件/情绪层优先于动作）；`usePresetController.ts:191` 是 `has()` 即跳过；`useCompanionDirector.ts:91`
  判 `size === 0`。单一优先级的归属表无法同时复现这四种语义，「等价」这个验收标准本身定义不清。
  且归属集由 `dafish-happy-performance.ts:204` 按 `motionManager.state` **实时派生**，切换动作组立即清空；
  若改为随动作层释放才撤销，参数最长会被多占 8 秒（`useMotionPriority.ts:147` 的兜底定时器）。
  另有 `preset-controller-smoothness.test.cjs:76-78` 直接 mock 该模块 id，改查表会让它失效。
- **AUDIT §1 的视线行——事实错误，已就地更正。** `setSequenceGazeOverride` 并非零调用方，
  在 `usePresetController.ts` 有 6 处（`:103/:350/:520/:536/:597/:611`），`loader.ts:1844` 是定义；
  因此 `loader.ts:809` 的守卫**是活的**，不是死代码。

## 2. 修正后的实测现状

| 轴 | 实测 | 真实问题 |
|---|---|---|
| 视线让位 | `sequenceGazeLocked` 11 处、`setSequenceGazeOverride` 6 处、`focusWeight` 过渡、`loader.ts:809` 的 `< 0.5` 启发式，另有 `usePresetController.ts:192` 的眼球居中 | 四套并存但**都活着且互相配合**；全库无一条测试触及 `focusWeight`，删除即无回归网 |
| 动作归属 | `getDafishHappyOwnedParameters` 7 处直读（loader 4 / 控制器 2 / 导演 1） | 通用每帧管线按名字依赖单个角色；但各处语义不同，不可并表 |
| 动作层 | `currentLayer = null` 7 处，**全部在 `useMotionPriority.ts` 内**（79/114/123/145/155/167/177）；5000/8000 在 `:147`，`SCENE_CLEANUP_MS=20000` 在 `:5/:126` | 不是「散落各处」，是单文件内 7 条出口；真正的洞是**定时器延时无人断言** |
| 滑块暴露 | `emotion-adapter.ts` 第 4 档排除（`:1330/:1331`）写在第 1–3 档（`:1276/:1295/:1314`）之后，前三档各自 `push + continue` | 控件已接管或动作已独占的参数，只要命中 focus / VTS 已知元数据 / 标准元数据，**仍会生成滑块** |

## 3. 保留的执行项（按性价比排序，每项一个提交）

**T1-a 滑块暴露顺序修正**
把 `emotion-adapter.ts:1330-1331` 的两条排除提到第 1 档之前判定，`vtsOutputSet` 例外保留不动。
收敛的是**判定源**，不是加标志位——控件接管与滑块两个入口不再互相覆盖。
验收：新增不变量测试「同一参数不得同时出现在滑块清单与控件接管集」，与具体编排内容无关，不会因改编排而脆。
代价：少数滑块会从清单里消失，需用户在 `npm run dev` 过一眼确认没误伤常用控件。

**T1-b 动作层出口收口 + 定时器断言**
`useMotionPriority.ts` 内 7 处 `currentLayer = null` 收敛为一个 `releaseLayer(reason)`；
给 `motion-priority.test.cjs:125` 的 `timer.fn()` 循环补上延时断言。
当前该文件无一处校验 `ms`，而 `:120` 的测试名还写着「five-second release timer」、实际兜底已是 8000——
**这正是 5000→8000 那次静默放宽没被拦住的原因**，也是本项的核心价值。

**T1-c 真减法**
删除 `natural-presets.dafish.json`：`src` 内无任何 importer，仅 `tests/natural-presets.test.cjs:30/:41`
以 fs 读取并打桩。删文件必须同步改这两处，否则测试变绿但读的是空气。

**T1-d 视线：本轮不动，只记录**
在 `loader.ts:809` 附近补一条注释，写清四套机制各自何时让位、为什么需要 `< 0.5`。不改行为。
将来若要动，前置条件是先补出 `focusWeight` 的回归测试网。

**T1-e（可选，仅在 T1-b 之后顺手）**
把通用管线里对 `getDafishHappyOwnedParameters` 的调用换成模型无关的入口名，仅转发、不新增状态；
收益是每帧管线不再按名字依赖单个角色。**若这一步需要引入任何新标志位，立即放弃。**

## 4. 明确不做

- 不引入 `channel-claims` 归属表 / 仲裁者。理由见 §1 P1 一条：各处语义不同，表化会制造假的统一并引入孤儿声明
  （换模型现在靠 WeakMap 自动回收，全局表需显式撤销，中断路径极易漏）。
- 不删除 happy 三代文件、不删动作导演、不删 `SettingsPanel.vue` 任何区间。
- 不在收敛期间调整任何预设编排数值。
- 不新增全局标志位来「临时」绕过。

## 5. 止损与新增规则

- 每项独立提交、当天合入，不留分支。
- 任一项做完若**净增行数 > 净删行数且没有新增能力**，判定走偏，停下重议。
- 观感由用户在 `npm run dev` 里确认；不通过就回滚该单项提交，不追加补偿性修改。
- **任何「这段可以删」的结论必须同时给出：全库 importer 扫描为空 + 测试引用扫描为空 + 该区间内容摘录。**
  本轮两处「孤儿」判定都栽在只凭印象报范围上（我自己一处，复核代理一处）。

## 6. 执行状态（2026-11-04 收官）

| 项 | 状态 | 提交 / 结论 |
|---|---|---|
| T1-a 滑块暴露顺序 | 已完成 | `5d47636`。只提「控件接管」，动作独占留在原档——一次提两条会让「标准姿态参数仍留滑块」的既有测试变红。本机 16 个模型重叠数为 0，**属潜在问题，现有观感零变化**；不变量测试已反向验证 |
| T1-b 动作层出口 + 定时器断言 | 已完成 | `113fb73`。普通动作此前完全不订阅 finish，层级白占 8 秒；现演完即释放，兜底只作保险，延时已断言。反向验证 4 条红 |
| T1-c 真减法 | 已完成 | `b923aa8`。删 2289 行死 JSON 及测试里的 fs 读取/桩 |
| T1-d 视线注释 | 已完成 | 同批文档提交。只在 `loader.ts` 的 `< 0.5` 处写明两个让位来源与阈值语义，不改行为 |
| T1-e 模型无关入口名 | 未做（可选） | 仅在需要时可做，禁止引入新状态 |

视线仍保持四套机制并存：本轮没有为「收敛」而制造新的抽象，原因见 §1。
下一轮若要动视线，先补 `focusWeight` 的回归测试网，再谈合并。

