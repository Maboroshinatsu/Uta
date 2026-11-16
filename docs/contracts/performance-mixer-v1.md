# Uta 表现逐通道仲裁契约 `uta-performance-mixer-v1`

状态：2026-10-23，供下一批 Qoder 纯内核任务使用。类型唯一来源为 `app/src/shared/performance-mixer-contracts.ts`，合成类型样例为 `app/tests/fixtures/performance-mixer-v1.ts`。本契约只增加仲裁输入和诊断，不更改 `first-wave-contracts.ts` 内冻结的 `SemanticChannel`、`ModelCapabilityProfile`、`PerformanceIntent`、`PerformanceSnapshot`。

## 边界与单位

- `SemanticChannel`、`ModelCapabilityProfile`、`PerformanceIntent`、`PerformanceSnapshot` 继续来自 `first-wave-contracts.ts`。不能复制、重命名或扩展成 Soullink 专属公共API。
- mixer 只读 Profile 能力并处理语义值，不读取模型文件、不调用 Cubism Core、不依赖 PIXI、不执行原生 motion/expression，也不接入 Stage/loader。
- 所有 mixer `values`、base、current、target 都是无量纲语义值，绝不是 Cubism 参数单位。映射到参数的范围、方向、非对称默认值由后续 Profile adapter 负责。例如 mouthForm 的语义 neutral=0 应映射到该模型 Profile 声明的默认值；不能把 neutral=0 当成原始参数0。
- 各通道范围和 neutral 锚点以共享常量为准：头/身/视线/眉/嘴形为 `[-1,1]` 且 neutral 0；眼睑开合为 `[0,1]` 且 neutral 1；mouthOpen 与 breath 为 `[0,1]` 且 neutral 0。每次组合完成后按该通道 clamp。
- `values` 中存在的键就是 mask；缺失键不参与，不隐式控制其它通道。对不在 Profile `available` 的通道不得生成有效输出。物理输出、未确认映射和缺失参数不能写入；此纯模块阶段只报告降级原因。

## 组合规则

- `replace`：value 必须在该通道 anchor 的 `[min,max]` 内；对当前值作有界线性插值，`current + (value-current) * effectiveWeight`。
- `add`：value 表示语义增量，所有通道统一限制 `[-2,2]`，然后把 `value * effectiveWeight` 加到当前值。
- `multiply`：value 表示乘数，所有通道统一限制 `[0,2]`，按 `current * (1 + (value-1) * effectiveWeight)` 计算。乘数的 neutral 是1。
- `effectiveWeight` 是 contribution strength 与淡入/释放包络的乘积，最终限制在 `[0,1]`。淡入淡出使用 smoothstep；时间以单调毫秒计。
- 每个 channel 独立排序和仲裁，不能用一个全局 owner 或优先级抢占所有部位。该 channel 的贡献先按 `priorityByChannel[channel]` 升序，再按本机 accepted monotonic time 升序、`ownerId` 字典序、generation 升序、`contributionId` 字典序稳定排序；后应用者在组合链中生效。省略的 priority 是0。
- 同一 owner 可以只拥有某些通道。通道不存在贡献时使用 tick.base 对应值；若 base 未提供，则用 `SEMANTIC_CHANNEL_ANCHORS[channel].neutral`。tick 的贡献先计算 pre-physics，再计算 post-physics；post-physics 的 base 是 pre-physics 结果，因此不会丢失前阶段贡献。
- mouthOpen 与 mouthForm 是独立通道。state/emotion 本身不得隐式把 mouthOpen 归零；只有有效贡献能改变 mouthOpen。语音暂停/静音仍由上游持有 mouthOpen owner 并提交闭合值；真正结束/取消时才释放并走 fade-out。
- 眼睑开合和眨眼必须通过同通道声明的 replace/add/multiply 顺序组合，不能各自直接覆盖最后值。具体眨眼导演不属于本任务。

## owner、时间与失效

- `ownerId + generation + modelEpoch + bindingGeneration` 是控制租约身份。新的 generation 取代旧 owner 状态；旧 generation 的 update、cancel、release 一律无效，不能解除新 generation。
- contribution 被本机接受时，runtime 记录注入的单调时钟值。外部 `PerformanceIntent.issuedAtUnixMs` 不得作为租约开始时间，也不与 `Date.now` 混用。一个 tick 所有通道共享同一个 `sampledAtMonotonicMs`。
- `ttlMs` 只能是 null 或整数 `1..60000`。到期开始 fade-out，尾部清理后删除。`fadeInMs`/`fadeOutMs` 是整数 `0..5000`。重复/倒退的时钟样本不推进状态；elapsed dt 限制为 `0..50ms`，超过时累计 `frame-gap-clamped` 诊断，后台恢复不能单步跳到极值。
- cancel/release 必须匹配完整 owner generation、modelEpoch 和 bindingGeneration。release 可指定 fade-out；不指定时使用 contribution 的 fadeOutMs。旧 epoch/generation 不得清理新模型/会话租约。
- modelEpoch 或 bindingGeneration 改变时，清理旧租约与时间状态；拒绝迟到贡献。所有输入/中间结果必须 finite，非法贡献进入 `rejectedContributionIds` 并说明原因，不允许 NaN/Infinity 污染其它通道。

## 诊断与测试停点

- `PerformanceMixerResult` 同时返回 pre-physics 与 post-physics 语义输出；`PerformanceMixerSnapshot` 是 renderer 本地低频诊断。要能逐通道看到 base/current/target、phase、owner、贡献、clamp 与降级；不能为诊断逐帧 IPC。若生成已有 `PerformanceSnapshot` 投影，保留其现有语义且不更改冻结接口。
- 相同 Profile、tick 顺序、单调时钟和贡献输入必须产生相同输出。无随机源；如后续导演需要 seed，由其上游提供具体贡献。
- 任务测试必须覆盖三种组合、channel mask、逐通道优先级、stable tie break、缺失/未确认/physics 能力、非对称/反向映射仅按语义输出约束、mouthOpen/mouthForm独立、眨眼与眼睑组合、owner generation/旧 release、expiry/fade、epoch/binding reset、NaN/越界、dt=0/正常/100ms恢复、相同输入回放。测试不加载模型资产，不写 Core。
- 该接口不代表真实画面改善；不在此任务接 Core、Stage、loader、旧 mouth-motion、预设或新的 director。性能只记录本机可重复的算法采样方法，不写成产品性能保证。
