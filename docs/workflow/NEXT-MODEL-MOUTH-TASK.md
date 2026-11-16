# 下一轮：模型切换时隔离口型尾状态

状态：已完成；见 [`results/model-switch-mouth-2026-10-24.md`](results/model-switch-mouth-2026-10-24.md)。由 Codex 在 main 单会话实施，没有启动其他模型、会话或平台任务。

功能基线：main `c00f49d`。开工先核对实际 HEAD、AGENTS.md、CURRENT.md 顶部和 HANDOFF.md 末尾。仍由 Codex 单会话串行开发，切换模型不等于恢复外部平台分工。

## 这一轮只完成什么

模型替换、短暂没有模型、同模型嘴部参数绑定变化时，新角色不继承旧角色的收口尾值，已销毁的旧模型不再被写入；仍在播放的同一段音频或流式文字继续当前进度，不重播、不从头计算。

不要进入完整新表现引擎、持续 owner、打包 exe 启动诊断或其他后续事项。完成本项验证、提交和交接后停下。

## 目前已确认的代码结构

- `app/src/renderer/composables/useStageRenderLoop.ts` 的 `startAnimationPoll()` 在整个轮询生命周期里持有 `lastMouthVal`、`mouthWasActive`、`lastMouthTickAt`、`streamingMouthActive` 和 `streamingMouthClock`。
- 每帧取当下 `store.live2dModel` 和 adapter 的 mouthOpenParam/gain；上述状态尚未按模型或参数绑定区分。
- 这是需要验证的状态泄漏风险，尚未提供模型切换的最终复现结果。先写能够失败的真实逻辑回归，再根据结果最小修复；不要把风险直接描述成所有切换都必定故障。
- `setModelLipSync` 是现有唯一口型写入/释放入口。它负责静音 active=true、收口尾段与恢复旧参数栈；继续使用，避免再造第二个说话标记。
- 最近已修好 TtsMouthTracker 的音频时钟、暂停/等待/seek/结束、重复 playing 与迟到回调，本轮不要重新实现或回退。

## 冻结行为

1. 区分两类状态：模型/参数的平滑与释放状态，以及当前音频/文本的时间进度。仅因模型更换，不得清掉音频队列、重启播放器、重置同一条流式文本时钟或重新合成。
2. 没有正在说话、只有旧模型收口尾段时切到新模型，新模型不能收到旧尾值。优先清理局部状态，不要为了归零而把新模型自己的表情/默认嘴部值写成 0。
3. 正在播放或流式说话时切模型，新模型应从当前输入电平与当前绑定开始计算；采用新模型的 mouthOpenParam/gain，不能沿用旧参数 ID 或旧增益。不要从头播放文字口型。
4. 经过 model=null 的间隔再装入新模型，也满足前两项。旧模型销毁后不得继续读写旧 Core；仍活着的旧绑定通过既有释放入口安全交还，不靠陈旧参数快照覆盖。
5. 同一模型的 mouthOpenParam 改变也视为绑定变化；若允许 gain 改变影响平滑，需要解释选择并验证不会突然继承旧模型的 raw 值。当前 lastMouthVal 是归一化电平，不能把它误当模型原始参数单位。
6. 不改变真实语音优先、句中静音仍占用、尾段正常收口，以及最近新增嘴形预览让出说话开合的规则。

## 范围

优先只修改 `useStageRenderLoop.ts` 和相应测试，可增加一个小型 renderer 内部状态 helper。允许更新 CURRENT/HANDOFF/本任务结果。不修改公开偏好、外部 SDK、mixer 契约、main/preload、模型资产或正式数据；若实际复现证明现有接口不足，先在交接记录说明，不扩大重构。

不得暂存以下既有改动：

- `docs/AGENT-PORTABILITY-PLAN.md`
- `docs/IMPLEMENTATION-P2-L0.md`
- `docs/ITERATION-ROADMAP-2026-10-13.md`
- `docs/design/blue-block-design-spec.md`

## 必须验证的场景

| 场景 | 预期 |
| --- | --- |
| A 只有收口尾值，切到 B | B 不继承尾值，不强写 B 的嘴为 0 |
| 音频正在播放，A 切到不同参数/增益的 B | B 使用当前音频输入和新绑定，播放器没有重启 |
| 流式文字尚在增长，A 切到 B | 延续同一文本进度，不从首字重播 |
| A → null → B；A 已销毁 | 清掉模型尾状态，不访问已销毁 A 的 Core |
| 同模型 mouthOpenParam 变更 | 旧参数不再被写，新参数按当前输入接管 |
| 正常结束/静音/停止 | 现有释放和嘴形/语音优先回归不变 |

尽量驱动实际 composable 的 RAF 与现有 setModelLipSync，而不是只测试新 helper 的同义代码。必要的运输/画布替身可以使用，但应能观察实际调用的模型、参数、数值与释放顺序。

在 app 目录运行受影响测试、`npm run typecheck`、`npm test`、`npm run build`。实际 Electron 验收使用独立 profile，检查换模后的 Core/原播放器时间，记录身份并正常退出。未跑的检查必须明确列出，纯计算测试不能替代真实换模验收。受限环境的回环 EACCES/构建 EPERM 使用正常工具审批流程，不改全局规则、不把权限失败当测试通过。

## 交付

原子提交到当前 main，更新 CURRENT/HANDOFF：复现是什么、改了什么、实际检查结果、日志位置、临时进程/端口清理情况。日常 `start-uta.bat`、正式 AppData/DS 模型、stable 登记与已验收 ZIP 不动。完成这一轮后停止，不自动扩展后续任务。
