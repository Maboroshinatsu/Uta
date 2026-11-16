# 工坊编辑锁的外部预设入口修复

Codex 2026-10-23 验收更新：13 项专项全部通过，已纳入 288 项应用回归，类型检查/构建和真实 Electron 桥的锁定预设拒绝检查通过。下文“本轮未运行”描述 Worker 当时的工具限制，当前结果见 [首批源码集成验收](first-wave-integration.md)。提交为 `c94a3b4a67c6c381d692ecd3dc1c309822bac15d`。

日期：2026-10-22。Owner：Qoder；主控 Codex 审查、测试、提交与合并。本任务只改任务单允许的三个文件。

## 工作区与边界

- 工作目录：`D:/Frankenstein/Uta-Workspace/tasks/qoder-preset-edit-lock`。
- 分支 / base / profile：以派单与 Codex 检查为准（`task/qoder/preset-edit-lock`，base `476f1cf6530fbf5449fae5ab840f82518c341057`，`UTA_PROFILE=qoder-preset-edit-lock`）。本轮无 Shell，未能自行核验 Git 元数据、未提交状态与实际 profile 环境变量。
- 修改文件：`app/src/renderer/composables/usePresetController.ts`、`app/tests/preset-edit-lock.test.cjs`、`docs/workflow/results/preset-edit-lock.md`。
- 未改 `app/package.json`、DeskpetStage、CompanionDirector、chat/store、SettingsPanel、main/preload 或存储迁移；未安装依赖、未启动 Uta、未调用 MCP/子 Agent、未读取个人设置/端点/密钥。

## 实现

采用两处集中锁判定，并调整控件入口的副作用顺序，避免在每个外部入口重复分支，同时保留工坊显式预览通道：

1. `applyPresetByEntry` 顶部：`store.presetEditingLocked` 为 true 时立即返回 false。
   - 覆盖所有预设落地路径：`handlePresetTrigger`、`triggerPresetOrGroup` 的精确/分组分支、`handleControlAction` 的 `preset`、精确 `set` 与未命中控件后的预设 fallback，以及未来直接调用者。
   - 守卫位于 `store.endPresetPreview()`、`cancelPresetSequence()`、活动预设赋值、slider/control 修改和计时器创建之前，锁中不产生任何舞台副作用。
2. `triggerPresetOrGroup` 顶部：清洗查询词后、Live2D 与预设查找之前，`presetEditingLocked` 为 true 时返回 false。
   - 额外覆盖不经过 `applyPresetByEntry` 的情绪 fallback（`currentEmotion` / `emotionPulse`），并避免锁定期间推进分组随机防连重记忆。

3. `handleControlAction` 调整执行顺序：先调用 `applyControlActionToList` 判定是否真正命中控件；只有命中控件或属于 `reset` / `reset_transient` / 批量 `set` 时，才执行 `cancelPresetSequence` 与锁定视线副作用。未命中的普通 `toggle` / `on` / `off` 动作若回退到预设，直接交给 `applyPresetByEntry`，锁定时由集中守卫在任何副作用之前拒绝。
   - `cancelPresetSequence` 会清空 `sequenceGazeLocked`，因此仍保持“先取消序列，再按锁状态归中视线；未锁 reset 最后恢复视线”的原顺序。

保留行为：

- `handlePresetTrigger` 原有锁拒绝逻辑未改。
- `previewPresetStepOnModel` 与 `syncSlidersFromWorkshop` 不经过 `applyPresetByEntry`，工坊步预览、整段主动预览（SettingsPanel 先显式解锁并携带 `preview: true`）以及手动滑杆/控件编辑保持可用。
- 手动 `toggle` / `set` 控件、`reset` / `reset_transient` 与滑杆同步未加全局锁，不把用户手动编辑一刀切禁掉；未锁时未命中控件的预设 fallback 仍然有效。

## 行为回归测试

新增 `app/tests/preset-edit-lock.test.cjs`：用 `typescript.transpileModule` + `vm.runInNewContext` 真实加载 `usePresetController.ts` 与真实 `emotion-adapter.ts` / `preset-sequence.ts`，仅对 store、Live2D 落地函数与 `MotionLayer` 打桩，并用假计时器断言 timer 数量。测试直接调用控制器，不使用源码正则断言。

覆盖用例：

1. 锁定时 `triggerPresetOrGroup` 的精确预设、分组名、情绪 fallback 全部返回 false；活动预设、情绪、脉冲、控件、slider、timer、focus/layer/report 调用与工坊预览标记均不变。
2. 锁定时 `handleControlAction` 的 `preset`、精确 `set`、`handlePresetTrigger` 及直接 `applyPresetByEntry` 全部拒绝且无副作用。
3. 锁定前已在途的预设计时器不会被外部预设入口取消或重启。
4. 锁定时普通 `toggle` / `on` 未命中任何控件、仅命中预设 fallback：返回 false，在途 timer、视线、活动预设、控件/slider 与工坊预览标记全部不变。
5. 锁定期间拒绝后解除锁，同一 `triggerPresetOrGroup` 入口恢复正常并落地预设与计时器。
6. 无锁时精确预设正常落地活动预设、slider、控件、计时器、控件层与宿主上报。
7. 无锁时未命中控件的普通动作仍可回退到预设。
8. 无锁时分组随机命中组内变体；情绪 fallback 正常更新 `currentEmotion` 与 `emotionPulse`。
9. 无锁时 `handleControlAction` 的 `preset` 与精确 `set` 正常应用。
10. 锁定时手动控件 toggle 与 `syncSlidersFromWorkshop` 仍能修改控件/slider，且不清掉用户手动开启的控件。
11. 锁定时手动 `set` 控件仍然可用。
12. 手动 `reset` 在锁内外保持原视线顺序：锁中归中并保持，未锁时取消序列后恢复视线。
13. 锁定时 `previewPresetStepOnModel` 仍可预览；解锁后的 `preview: true` 工坊序列预览仍能触发并保留预览标记。

测试命令（由 Codex 执行，本轮未运行）：

```bash
cd app
node --test tests/preset-edit-lock.test.cjs
```

类型检查（由 Codex 执行，本轮未运行）：

```bash
cd app
npm run typecheck:web
```

## 未验证点与风险

Codex 审查补充：首轮 9 项行为通过；扩展 reset 用例最初把 action 错当 control 参数，主控已按真实签名纠正为 handleControlAction('', 'reset')，再执行完整 13 项回归。最终结果以集成记录为准。

- 本轮无 Shell，测试与类型检查均未执行；用例是否全部通过以 Codex 集成运行结果为准。
- 未在真实 Electron/Live2D 环境中验证画面，只覆盖控制器行为。
- 未把新测试注册进 `app/package.json`（任务单要求由 Codex 集成）。
- 未核验分支、base SHA、工作区 cleanliness 与 profile；以派单方与 Codex 的 Git 检查为准。
