# Live2D 连续表演资料与实现参考

更新：2026-10-24

面向 Uta 的日常连续表演：输入聆听、Agent 工作状态、空闲动作。目标不是再写一套节拍系统，而是把现有 `ModelStatePreset` 编排成连贯的参数动画。

## 1. 先看运行时到底怎么算

Live2D 模型不是“播一张动画”，而是每帧给一组参数赋值，物理/变形器再计算网格。对 Uta 来说，实际顺序是（`pixi-live2d-display` 0.4.0，仓库内 `app/node_modules/pixi-live2d-display/dist/cubism4.es.js`）：

```text
motion -> saveParameters -> expression -> 条件 blink -> focus -> natural(Uta 参数栈)
-> physics -> pose -> beforeModelUpdate(Uta 直接覆盖/部件/口型) -> Core.update -> loadParameters
```

这条顺序决定了三件事：

1. **头部/身体角度要在物理之前写**。Uta 的参数栈在 `natural` 阶段写入，随后物理会带着头发、耳朵、尾巴跟着动。不要在物理之后硬写这些参数，否则头发不会跟。
2. **物理输出参数不能手写**。DS 的耳朵骨、尾巴、头发等物理输出参数（如 `Param102–109`、`j*`、`maoshou*`）由物理计算；手写会和物理打架，表现为抖动或部件拉扯。
3. **部件不透明度在 `beforeModelUpdate` 最后写**。现有 `hiddenParts` / `shownParts` 层就是在这里生效；原生动作里的 PartOpacity 曲线也受 pose 功能约束。

官方也强调参数计算顺序会直接改变结果：覆盖、加算、正片叠底不是可交换的，最后执行覆盖会忽略之前的结果。参见 [参数操作](https://docs.live2d.com/4.2/zh-CHS/cubism-sdk-manual/parameters/)、[模型计算顺序](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/model-param-updater/)。

## 2. motion3.json 的曲线格式

`motion3.json` 的权威解析在本地 SDK 的 `CubismMotionJson` / `CubismMotion.parse()` 中。结构如下：

```json
{
  "Version": 3,
  "Meta": {
    "Duration": 4.0,
    "Fps": 30,
    "Loop": true,
    "AreBeziersRestricted": true,
    "CurveCount": 89,
    "TotalSegmentCount": 590,
    "TotalPointCount": 1803,
    "FadeInTime": 0.8,
    "FadeOutTime": 0.8
  },
  "Curves": [
    {
      "Target": "Parameter",
      "Id": "ParamAngleZ",
      "FadeInTime": -1,
      "FadeOutTime": -1,
      "Segments": [0, 0, 1, 0.4, 6, 0.8, 0]
    }
  ]
}
```

`Target` 只有三种：`Model`、`Parameter`、`PartOpacity`。

`Segments` 是扁平数组，第一段固定是 `[time, value]`，后面每段以类型开头：

| 类型 | 含义 | 数据 |
| --- | --- | --- |
| `0` | 线性 | `time, value` |
| `1` | 贝塞尔 | `c1.time, c1.value, c2.time, c2.value, end.time, end.value` |
| `2` | 阶梯 | `time, value`（保持前值） |
| `3` | 反阶梯 | `time, value`（提前取后值） |

Uta 不做原始 motion3 编辑；这份格式主要用于理解“原生动作为什么是连贯的”，以及后续若要导出 motion3 时对齐字段。真实 DS `idle.motion3.json` 就是 89 条参数曲线、4 秒循环，曲线大量使用贝塞尔段。

### 淡变与循环

- 动作级 `Meta.FadeInTime` / `Meta.FadeOutTime` 默认 1 秒；单条曲线也可覆盖 `FadeInTime` / `FadeOutTime`。
- 播放时参数值是 `source + (curveValue - source) * fadeWeight`；淡入淡出是对“当前值”插值，不是简单叠加。
- `Meta.Loop` / SDK `setIsLoop(true)` 控制循环；Unity 的 Mecanim 路线会忽略文件里的 Loop，OW/Web 的 `CubismMotionManager` 会读。
- 官方：`ACubismMotion` 用 `setFadeInTime` / `setFadeOutTime` / `setIsLoop`；循环动作不保证与 Editor 完全一致。参见 [关于动态](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/motion/)、[淡变值设置](https://docs.live2d.com/zh-CHS/cubism-editor-manual/fade-setting/)。

### 表情和部件

- `.exp3.json` 只有参数，混合方式为 `Add`、`Multiply`、`Overwrite`；计算顺序会改变眨眼/动作叠加结果。表情适合做短时叠加（脸红、星星眼），不适合承担连续的身体动作。参见 [关于表情动态](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/expression/)。
- 部件不透明度通过 `setPartOpacityById` 设置，范围 0–1；但如果模型有 pose 功能，部件不透明度由 pose 管理，motion 里的 PartOpacity 可能被忽略。参见 [不同工作流程的动态创建差异](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/sdk-type-for-motiopn/)、[参数操作](https://docs.live2d.com/4.2/zh-CHS/cubism-sdk-manual/parameters/)。
- DS 鼠控版没有 `pose3.json`，所以当前 Uta 的部件显隐可以生效；但它有物理，物理输出参数仍然不要手写。

## 3. Uta 现有预设格式的能力边界

`ModelStatePreset` 的步骤是：

```ts
{
  durationMs: number,   // 参数从当前值过渡到目标值的时长
  holdMs: number,       // 过渡完成后保持多久再进入下一步
  controls: string[],
  parameters: Record<string, number>
}
```

关键事实：

- 每一步只做“当前值 -> 目标值”的 **easeInOutCubic** 过渡，然后等待 `durationMs + holdMs` 进入下一步（`usePresetController` + `loader.syncModelStack`）。
- 不支持每条参数不同时序，也不支持在一步内做贝塞尔曲线；但可以通过**多步、短保持、首尾同姿态**排出连续感。
- `finishMode: 'loop'` 只在多步预设下有效；单步循环会退回 settle（`preset-sequence.ts`）。
- 参数写入 `stack.controls`（预设滑块层）；`resetTransientParameters` 会跳过 base/controls/emotion，所以场景动作留下的参数不会被普通预设自动清掉。
- 预设可以绑定 `motion: { group, index }` 播原生动作；但 DS 的 `selfie` / `ketchup` / `bubble` 是**有状态场景动作**，播完会留手机/蛋包饭/泡泡糖，现有 `resetMotionPriority` 也不会停止正在播放的动作。日常连续表演先不要绑定这些场景动作。
- 循环无缝的关键：最后一步的参数要回到第一步附近；否则每次 loop 重开会有一小段“回位”。

## 4. DS 鼠控版可安全使用的参数

从用户现有 19 个预设统计出的实际范围（2026-10-24）：

| 参数 | 实际使用范围 | 用途 |
| --- | --- | --- |
| `ParamAngleX` | -11 – 3.6 | 头部左右 |
| `ParamAngleY` | -13 – 16 | 抬头/低头 |
| `ParamAngleZ` | -4.8 – 6 | 歪头 |
| `ParamBodyAngleX` | 约 -3 – 3 | 身体左右 |
| `ParamBodyAngleZ` | 约 -2 – 2 | 身体侧倾 |
| `ParamEyeBallX` | -0.55 – 0.28 | 视线左右 |
| `ParamEyeBallY` | -0.85 – 0.65 | 视线上下 |
| `ParamEyeLOpen` / `ROpen` | 0.22 – 1 | 睁眼程度（仍受眨眼组影响） |
| `ParamEyeLSmile` / `RSmile` | 0 – 0.85 | 弯眼笑 |
| `ParamBrowLY` / `RY` | -0.5 – 0.45 | 眉高 |
| `ParamBrowLAngle` / `RAngle` | -0.5 – 0.35 | 眉角 |
| `ParamBrowLForm` / `RForm` | -0.45 – 0.45 | 眉形 |
| `ParamMouthForm` | -1.62 – 0.77 | 嘴角（DS 默认约 -0.5） |
| `ParamMouthOpenY` | 0.2 – 0.55 | 张嘴（说话时让给口型） |
| `ParamCheek` | 0 – 0.8 | 脸红 |
| `pointX` / `pointY` | -30 – 5 / -5 – 5 | 点菜手位置（用户聆听预设） |
| `ParamBreath` | 不手写 | 呼吸/物理 |

避免手写：`Param102–109` 等耳骨物理输出、`j*` / `maoshou*` 等 idle 动作通道、`phone*` / `danbao*` / `paopao*` 等场景道具通道，以及 `ParamEyeBallX/Y` 之外的视线内部参数。`ParamAngle*` / `ParamBodyAngle*` 属于叠加型参数，Uta 不会写回 `_savedParameters`，但预设层可以正常占用。

这些范围来自用户预设的实际值，不是 moc3 的绝对上下限；正式编排前最好在设置工坊里核对滑块范围。官方文件类型说明见 [文件类型和扩展名](https://docs.live2d.com/cubism-editor-manual/file-type-and-extension/?locale=zh_cn)。

## 5. 连续编排的做法

### 输入聆听

1. 输入框打开时触发 `聆听` 组的 loop 预设；DS 优先用用户已有的 `聆听记录`（13 步、约 6.35 秒），其他模型回退到 `专注`。
2. 输入框关闭或发送时取消序列，回到当前常驻预设；如果 Agent 已经接管视觉，就不要抢回。
3. 循环段的结构：进入姿态（400–600ms）→ 点头/视线扫描 2–3 轮 → 回到第一步。每一步 250–400ms 过渡，hold 0–150ms，避免每一步都停顿。

### Agent 工作

现有 `agent_state` 已经能把 `thinking` / `tool_running` / `completed` / `error` 送到表现控制器；缺的是“工作状态时用连续 loop”，而不是一次性 hold。做法是新增一个 `工作` 组的连续预设（或给现有 `思考/专注/好奇` 组补多步变体），在工作状态用 `loop` 触发，状态切换时由预设控制器取消。

一条合格的“工作连续”序列可以只动这些部分：

- 头：`ParamAngleX/Y/Z` 缓慢左右看、偶尔点头；
- 视线：`ParamEyeBallX/Y` 在屏幕/纸面之间扫视；
- 眉：`ParamBrowLY/RY`、`ParamBrowLAngle/RAngle` 交替压眉/放松；
- 嘴：`ParamMouthForm` 小幅变化，`ParamMouthOpenY` 只做呼吸级微张；
- 身体：`ParamBodyAngleX/Z` 做延迟于头部的轻微跟随；
- 手：DS 可少量用 `pointX/pointY`，但不要和聆听预设抢同一条手部通道。

### 空闲

现有 idle scheduler 已经会随机说一句、切 `好奇/害羞/开心` 或播原生 `idle` 动作。可以再补一条 6–8 秒的 `待机·张望` loop，作为偶尔触发的 `revert` 预设；不要让它常驻，否则会和环境头部微表现叠加。

### 节奏原则

- 不要每个参数同时起停。头先动，视线晚 80–150ms，眉毛再晚一点，身体最晚；现有步骤格式不能逐参数延迟，但可以用“前一步只改头、后一步补视线/眉”近似。
- 每 2–3 步安排一次反向小动作（点头后回正、视线左后右），避免单向漂移。
- 循环首尾一致；最后一步不要留下一个和第一步差很远的姿态。
- 幅度宁小勿大。DS 的 `ParamAngle` 实际使用大多在 ±16 内，`ParamBodyAngle` 在 ±3 内；超过这个范围很容易看起来像被拽。
- 不要用手写参数替代物理。耳朵、尾巴、头发交给物理；手写只会让部件互相打架。

## 6. 第一版实现（2026-10-24）

已落地到源码，全部走现有预设/控制器：

1. **内置连续预设包**：`app/src/renderer/services/live2d/continuous-presets.json`
   - `工作·连续`：12 步、约 7 秒、`loop`，动头、视线、眉、嘴、脸颊、身体；
   - `空闲·窗边张望`：7 步、约 5 秒、`revert`，安静地张望、微笑、回正；
   - 两条序列都不写 `ParamEyeLOpen/ROpen`，把眨眼交回 SDK；实测能看到原生眨眼。
2. **按模型裁剪**：`continuous-presets.ts` 只给嘴角支持负值、AngleY 有足够幅度的标准 VTB 模型添加；逐参数按滑块范围裁切，缺可选参数时自动跳过。DS 兼容，Hiyori 这类嘴形范围不兼容的模型不会收到。
3. **默认与旧桶接入**：
   - `buildModelStatePresets()` 为新模型追加连续包；
   - `deskpet.ts` 对已经存在的用户预设桶做一次补齐；只补缺失的 `工作` / `空闲` 分组，不覆盖、不删除用户已有预设，用户删掉后不会反复塞回。
4. **输入聆听**：`DeskpetStage` 监听 `showInput`，`useCompanionDirector.startInputListening()` 优先用 `聆听记录`，再回退 `聆听` / `专注`。输入框是用户发起的交互，**优先于 Agent 工作/回复视觉**；只在工坊锁定、预览、无模型时拒绝。关闭时取消聆听：Agent 正在思考/执行/出错就恢复对应工作视觉，否则回到常驻预设；如果聆听已被其他预设接管，则不抢回。
5. **工作连续**：`AgentPresentationController` 在 `thinking` / `tool_running` 时优先触发 `工作` 分组 `loop`；同一轮工作状态之间不重启循环，状态切换时由现有预设控制器取消。缺失 `工作` 时仍回退原来的 `思考` / `专注` / `好奇`。输入框打开时控制器只更新工作状态和胶囊，不抢预设；关闭后再恢复工作循环。
6. **空闲**：`runIdleAction` 的随机预设池加入 `空闲`，仍然只由现有 idle scheduler 触发；不新增调度器。
7. **没有做的部分**：第一版不绑定 `selfie/ketchup/bubble` 等场景动作；这些动作仍然是有状态的，若要纳入日常，需要先给现有 motion priority reset 补“停止当前动作”。

### 本轮实测

- 隔离 Electron profile（本地临时目录），真实 DS 模型副本。
- 输入框打开触发 `聆听记录`（13 步、loop），关闭后回到日常；截图确认部件完整。
- `agent_state thinking` 触发 `工作·连续`（12 步、loop）；`tool_running` 不重启循环；`completed` 正常进入 `开心·欢呼`。
- 空闲序列实测 `空闲·窗边张望`（7 步、revert）后正常回正；工作循环中捕获到原生眨眼。
- **输入优先实测**：在 `thinking` / `tool_running` 期间打开输入框，视觉切到聆听，状态胶囊继续显示“执行中”；输入框开放期间再上报工具不会抢回；关闭后恢复 `工作·连续`。
- 应用测试 **773 项（768 通过、5 跳过、0 失败）**，插件 103/103，node/web 类型检查、构建通过。
- 证据：隔离 profile 下 `60-input-listen-2s.png`、`70-work-thinking-1.5s.png`、`80-idle-1.5s.png`、`work-loop-loop.gif`；正式 profile 预览证据在 `operations/continuous-performance-2026-10-24/`（`stable-priority-input-open-tool.png`、`stable-priority-restored.png` 等）。
- 已产出独立预览包 `app/release/preview-continuous-20261024/win-unpacked`，用正式 stable profile 启动并验证；旧候选 ZIP、日常 0.1.1 和 stable 包未替换。源码当前未提交。

## 7. 预设原生动作（2026-10-24 第一版）

`ModelStatePreset.motion` 和 `resolvePresetMotion()` 早就存在，保存/预览链路也已经会读它；本次只是在预设工坊补了“原生动作”选择器。

- **可选范围**：`preset-motion-options.ts` 从 `modelCapabilities.motionGroups` 生成动作组和序号。名称命中 `selfie/ketchup/bubble/splash/openLid/phone/danbao/paopao/scene/prop/item/weapon` 的组默认隐藏，避免再次留下手机、蛋包饭、泡泡糖等场景道具。
- **旧绑定不丢**：如果某个旧预设已经绑定了被过滤的场景动作，选择器仍会把它作为“当前绑定（场景动作）”显示，保存时不会静默清空。
- **播放语义**：原生动作在预设开始时播放一次；预设步骤写入的参数层优先级更高，所以动作里的头/眼曲线会被预设参数覆盖，动作特有的道具/次级通道仍可看到。想完整看动作，请把预设参数留空，只保留动作绑定。
- **眨眼**：不放进动作列表。眨眼是 SDK 的常驻行为，预设不写 `ParamEyeLOpen/ROpen` 时自动生效；手动把眼睛开合写进预设反而会压掉眨眼。
- **实测**：真实设置窗口里打开“预设工坊”，原生动作选择器只列出 `idle` / `aidale`；选择 `aidale` 预览能看到锤子动作；另存为新预设后，存储里的 `motion` 为 `{ group: 'aidale', index: 0 }`。
- 实现位置：`preset-motion-options.ts`、`SettingsPanel.vue`（状态与保存）、`SettingsStudioTab.vue`（选择器 UI）、`settings-workshop.ts`（工作区接口）、`settings-panel.css`。

## 8. 工坊部件回待机清理（2026-10-24 修复）

- **现象**：预设工坊里开启“爱心眼”等部件后，切回“日常待机”，爱心眼、爪印、汽水等效果仍留在模型上。
- **根因**：待机预设的控件步骤为空，而“空控件步骤不清理用户控件”是刻意保留的规则；同时这些特效参数可能已经不在控件层里，普通 `reset_transient` 和清空控件层都不足以把它们恢复。之前旧节拍也遇到过同一类残留。
- **修复**：
  - 回到 `日常待机` / `revertToActiveHoldPreset` 时，先把非持久控件恢复到 `defaultActive`（常驻服装、发型保留），再清表情和未被 base/controls/emotion 接管的残留场景参数；
  - 关闭工坊/设置且没有常驻预设、Agent 空闲时，也执行同一套清理；
  - `loader.ts` 记录模型加载时的参数快照 `homeParameters`，清理时恢复到“第一次看到的初始姿态”，而不是 Core 默认值，避免手臂等初始姿态被重置成另一个姿势。
- **保留**：空控件步骤仍然不会在普通预设切换时清掉用户手动开启的控件；只有明确的“回日常待机/关工坊”入口执行清理。
- **验证**：真实设置窗口里开启“爱心眼”后切回日常待机，爱心眼、爪印、汽水全部消失，`ParamCheek17`/`Paramhh2` 回到 0；姿态回到模型加载时的初始快照，常驻服装/发型保留。

### 点菜手与蛋包饭手

- **点菜手不是部件**：`point`（点菜板）、`pointX/Y/Z`（点菜手位置/按下）是参数，驱动的是同一组手/board 部件（Part125/126、Part5、Part120 等）。它们没有独立的 PartOpacity 开关，所以不能像“隐藏一个部件”那样理解。
- **蛋包饭手**：`蛋包饭.exp3.json` 把 `point` 设为 -1、`danbaofan` 设为 1；关闭时控件层被移除，但 `point` 会回到 Core 默认 0，而 DS 默认手的初始快照是 `point=1`，于是手消失。
- **修复**：工坊内关闭控件时，如果桌宠处于编辑锁状态，`sync-sliders` 会检测到控件被关掉，并把未被 base/controls/emotion 接管的参数恢复为模型加载时的 `homeParameters`；同时设置窗口会同步预设最终步骤的滑块值，并在取消控件时恢复开启前的控件/滑块快照。
- **分类**：“蛋包饭”里的“包”曾被服装正则误判成常驻 outfit；现在 `蛋包饭/点菜/便当/餐桌/饭桌` 优先归为 `pose_prop`，回待机时按临时道具处理，不会当成常驻服装留下。
- **实测**：聆听姿态（双手在板前）→ 开蛋包饭 → 关蛋包饭，手恢复；`point=1`、`pointX=-30`、`pointY=5`。应用测试 **784 项（779 通过、5 跳过、0 失败）**，类型检查通过。

## 9. DS 鼠控版专用适配表（2026-10-24）

真实模型：`c_0120`，247 参数、100 部件、28 参数组、44 表情、8 原生动作、42 个可用控件（含 7 个强特效）、32 个滑块。专用适配文件：`docs/models/ds-adapter.json`。

- **显式控件**：42 个全部写成 adapter controls（35 个基础 + 开心兴奋/星星眼/脸红/哭/闭眼口水/问号/感叹号），不再依赖自动正则猜分类；所有控件都有可解析的 expression 或 parameters，标签去掉参数噪音。
- **分类**：12 个 `face_effect`、11 个 `pose_prop`、1 个 `hair`、11 个 `outfit`。眼镜/头箍/贴纸/马尾/鲸鱼/桌布按常驻外观处理；蛋包饭/电话手/画笔/比耶/猫手/魔爪/巴菲等按临时道具处理。
- **idle**：显式声明 `idleMotions: ["idle"]`，不再依赖组名回退。
- **滑块**：32 个；17 个脸部、5 个头身/点菜手、10 个高级发型/道具/特效内部通道。高级参数保留在“高级参数”折叠组，不混进日常面捕。
- **设置分组修复**：工坊分组从旧的 `costume/hand/emotion/prop` 对齐到 `outfit/hair/pose_prop/face_effect/toggle`，不再出现“除发型外全塞进其他部件”。
- **真实审计**：在临时 profile 中把 35 个基础控件逐个开/关，全部满足关闭后 `point=1`、`danbaofan/phone/bi/love=0`、活动控件清空；蛋包饭、手机手、爱心动画的开关和手部恢复均实拍确认。
- **内容回归**：`app/tests/ds-adapter.test.cjs` 校验 42 个控件、分类集合、唯一标签、expression/parameters、idle 组。
- 应用测试 **784 项（779 通过、5 跳过、0 失败）**，node/web 类型检查通过。

## 7. 资料来源

- [关于动态（Cubism SDK 手册）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/motion/)
- [关于表情动态（Cubism SDK 手册）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/expression/)
- [参数操作（Cubism SDK 手册）](https://docs.live2d.com/4.2/zh-CHS/cubism-sdk-manual/parameters/)
- [模型计算顺序（Cubism SDK 手册）](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/model-param-updater/)
- [不同工作流程的动态创建差异](https://docs.live2d.com/zh-CHS/cubism-sdk-manual/sdk-type-for-motiopn/)
- [淡变值设置（Cubism Editor 手册）](https://docs.live2d.com/zh-CHS/cubism-editor-manual/fade-setting/)
- [文件类型和扩展名](https://docs.live2d.com/cubism-editor-manual/file-type-and-extension/?locale=zh_cn)
- 本地解析器：`app/node_modules/pixi-live2d-display/dist/cubism4.es.js`（`CubismMotionJson`、`CubismMotion.parse`，0.4.0）
- 本地运行时顺序：`docs/workflow/HANDOFF.md`（2026-10-24 的 Live2D 更新顺序记录）
- 真实 DS 动作样本：`C:/Users/Administrator/AppData/Roaming/uta/models/DS鼠控版/motions/idle.motion3.json`（89 条曲线，4 秒循环）
- 真实 DS 预设样本：`C:/Users/Administrator/AppData/Roaming/uta/models/DS鼠控版/deskpet-presets.json`（19 个预设，`聆听记录` 13 步）

## 10. 两套自然编排（2026-10-24）

- **通用包** `app/src/renderer/services/live2d/natural-presets.json`：18 个状态预设，只用标准参数（头、视线、眉、嘴、身体），`controls: []`，不依赖任何模型自定义表情 ID；兼容嘴角支持负值的标准 VTB 模型。
- **DS 专用包** `app/src/renderer/services/live2d/natural-presets.ds.json`：同样的 18 个动作骨架，叠加 DS 强特效控件：开心兴奋、星星眼、悲伤、哭、生气、流汗、闭眼口水、脸红、爱心眼、问号、感叹号、心跳。仅当模型同时具备点菜手参数和 DS 控件时选择，避免把 DS 的强表情塞给其他模型。
- 选择逻辑：`buildNaturalPresetsForModel()` 用 `pointX` + DS 控件集合判断；否则使用通用包。两套都保留原生眨眼，不在预设里写眼睛开合。
- 旧状态预设迁移：`deskpet/natural-presets-v2:<model>` 一次性把已有桶里的同 ID 状态预设替换为自然版；用户自己的「聆听记录」和自定义预设不覆盖，连续工作/空闲保留。
- 强特效按情绪使用：开心=开心兴奋/星星眼，委屈=悲伤/哭，生气=生气（只给压眉紧盯变体），厌烦/尴尬=流汗，倦怠=闭眼口水，害羞=脸红/爱心眼，好奇=问号，惊讶=感叹号，等待=心跳；思考和专注保持纯微动作。
- 验证：真实 DS 迁移后 18 个自然预设 + 聆听记录 + 工作/空闲；0.9/2.0/3.5 秒截图检查入场、保持和强特效；5 秒后开心/生气的强特效都能回到待机。应用测试 **788 项（783 通过、5 跳过、0 失败）**，类型/构建通过。
