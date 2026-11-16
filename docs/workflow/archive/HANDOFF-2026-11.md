# 交接归档 2026-11（25 轮）

> 归档说明：本文件是从 docs/workflow/HANDOFF.md 拆出的历史交接条目，只作历史参考，
> 不代表当前现场。当前现场见 ../../HANDOFF.md 与 ../CURRENT.md。
> 文中出现的 D:/Frankenstein/Uta-Workspace/ 路径属于 2026-10-24 已弃用的证据区，均为历史记录，不可当作现在的写入目标。

# Uta 修复动作打断抽搐、精准解耦动作轨道与分镜表情及闭环生命周期释放交接（2026-11-03）

## 1. 事项与完成清单
- **[BUG-ANIMATION-ORCHESTRATION: 修复动作打断瞬态硬归零抽搐、精准解耦动作轨道与分镜表情、闭环动作层释放与渲染时长动态匹配]**：
  - **背景与原因**：
    1. 上一轮提交为了防止动作位姿叠加，粗暴传参 { parameters: {} }，导致所有带动作预设的分镜表情参数（眼睛、嘴型、眉毛微调、道具滑块）全部丢失，工坊分镜编辑参数在实机播放时也完全不生效；
    2. 上一轮提交删除了打断时的 stopMotion，导致连续右键或切换动作时底层动作未停止，多套动作曲线重叠打架；而中午提交加入的 stopMotion 带有硬归零导致抽搐；
    3. 动作层兜底拉长至 8 秒且缺乏主动释放机制，预设在 5.6 秒演完后待机动作（Idle motion）被阻断拒绝，桌宠原地僵直定格数秒；
    4. 右键随机预设中全帧率渲染唤醒时间硬编码为 3000ms，大肥鱼动作长达 5.6 秒，导致鼠标离开后后半段进入按需降帧。
  - **修复实现**：
    1. **分镜参数精准解耦**（usePresetController.ts）：
       - 废弃粗暴抹除 { parameters: {} }；
       - 通过 getDafishHappyOwnedParameters(store.live2dModel) 精准获取动作轨道占用的位姿参数集合，仅过滤掉已被 60FPS 曲线接管的参数；
       - 其余分镜步骤的面部微表情、嘴型、道具等参数 100% 完整保留并正常下发；
       - 工坊单步审查（preset.preview）保持 100% 原始参数呈现。
    2. **动作打断与平滑淡入接管**（useMotionPriority.ts & usePresetController.ts）：
       - 控制器打断动作时显式调用 deps.stopMotion?.({ resetTransientParams: false })，停止底层 MotionManager 播放时钟，但绝不执行瞬态参数硬归零；
       - 由 Live2D 原生的 adeInTime 自然平滑过渡接管到新动作，彻底消除打断抽搐；
       - stopMotion 保持无参调用时默认 	rue 兼容性。
    3. **动作层优先级生命周期闭环**（useMotionPriority.ts & DeskpetStage.vue）：
       - 增加 
eleaseMotionLayer 接口；
       - 在预设步骤全部执行完毕回退待机（
evertToActiveHoldPreset）及用户打断序列时，显式释放 currentLayer；
       - 待机呼吸和微动作立即无缝自然恢复，彻底消除动作播完后的僵死定格。
    4. **滑块复原平滑化与渲染时长动态匹配**（usePresetController.ts & DeskpetStage.vue）：
       - 序列取消时的滑块复位改用 REVERT_TRANSITION_MS（320ms）平滑过渡，杜绝 0ms 瞬间跳跃；
       - 右键随机预设根据所选预设的实际时长动态透传 
oteRenderActivity(duration + 500)，保障动作全程 60FPS 不掉帧。
    5. **自动化测试与质量守卫**：
       - pp/tests/preset-controller-smoothness.test.cjs 补充 4 项回归测试全部通过；
       - 全量 1290 项单元测试（1284 pass, 0 fail, 6 skip）全部通过；
       - 插件 125 项测试全部通过；
       - TypeScript（Node + Web）类型检查 0 错误。

## 2. 现场状态
- **Git HEAD**: 准备提交
- **分支状态**: main
- **测试状态**: 1290 tests, 1284 passed, 0 failed, 6 skipped
- **未提交工作区**: DeskpetStage.vue, useMotionPriority.ts, usePresetController.ts, preset-controller-smoothness.test.cjs, HANDOFF.md
- **下一步建议**: 实机体验右键随机动作、连续右键快速切动作与动作播完后待机恢复，确认动作表情自然、无抽搐无僵滞。

---
---

# Uta 修复预设动画双轨冲突、动作打断瞬移与动作层混播卡顿交接（2026-11-03）

## 1. 事项与完成清单
- **[BUG-ANIMATION-RESET-HITCH: 移除启动预设时的瞬间硬复位]**：
  - **背景与原因**：在历史提交 `0bcd088` 中，为防动画打架在 `applyPresetByEntry` 头部增加了 `deps.stopMotion?.()`，导致底层 `resetTransientParametersToHome(model)` 在第 0 帧强行将参数硬归零，使得点击或触发任何预设的一瞬间模型都会发生瞬时抽搐跳动。
  - **修复实现**：移除 `applyPresetByEntry` 开头多余的 `deps.stopMotion?.()` 调用，由 `playMotionWithPriority(..., FORCE)` 自然从当前姿态插值淡入新动作；在 `useMotionPriority.ts` 的 `stopMotion` 中增加可选 `resetTransientParams` 参数，避免非必要的硬复位破坏平滑性。
- **[BUG-ANIMATION-PARAM-MUTEX: 动作轨道与分镜参数解耦，消除双轨叠加与步骤卡顿]**：
  - **背景与原因**：大肥鱼成套预设拥有 5.6 秒高精度 60FPS Hermite 动作曲线，但分镜 `steps` 中又重复写了 `AngleZ`、`PositionZ`、`LeanInput` 等参数；两套系统同时写入同一参数，导致叠加参数角度翻倍扭曲（如 20° 变 41°）、步骤边界跳跃卡顿、非叠加参数被强行覆盖。
  - **修复实现**：在 `usePresetController.ts` 的 `runStep` 中明确权属，当预设具备 `explicitMotion` 并在运行时播放时，由 60FPS 动作轨道全权负责物理与位姿驱动，步骤仅推进控件显隐状态（如眼镜、大牙等）与时序，不重复写入位姿参数到控件栈，彻底消除了双重驱动与边界抽搐。工坊单步定格审查（`previewPresetStepOnModel`）保持完整参数呈现不变。
- **[BUG-MOTION-PRIORITY-LIFECYCLE: 动作优先级生命周期精准对齐动作时长]**：
  - **背景与原因**：`useMotionPriority.ts` 硬编码了 5000ms 超时释放，而大肥鱼成套灵动表演均为 5.6 秒（5600ms），导致在 5.0 秒时层级被提前释放，日常待机动画插队混入，产生尾段动作重叠。
  - **修复实现**：在 `playMotionWithPriority` 中支持传入 `durationMs`，控制器根据步骤实际总时长（5600ms + 500ms 缓冲）动态透传，兜底超时由 5000ms 提升至 8000ms，杜绝待机动作在演完前回流混播。
- **[BUG-SLIDER-RESIDUAL-POLLUTION: 修复预设收尾与待机回退时的滑块彻底复原]**：
  - **背景与原因**：回退日常待机或切换无参数步骤时，因判定条件导致滑块复原被跳过，上一轮预设修改过的滑块（如前倾探身 `LeanInput`、位移 `PositionZ`）永久残留在 `store.modelSliders` 中，导致回到待机依然保持前倾并污染后续预设。
  - **修复实现**：在 `usePresetController.ts` 中维护 `presetModifiedSliderIds` 集合；在步骤流转、打断（`cancelPresetSequence`）和回退待机（`revertToActiveHoldPreset`）时，对修改过的滑块执行彻底复位回默认值，并在打断时立即同步模型层（`applyModelControlAndSliderLayer(0)`）。
- **新增回归测试**：编写 `app/tests/preset-controller-smoothness.test.cjs` 验证启动防抽搐与滑块彻底复原，全量 1288 项测试（1282 pass, 0 fail, 6 skip）全部通过。

## 2. 现场状态
- **测试状态**: 全量 1288 项单元测试通过（1282 pass, 0 fail, 6 skip），TypeScript 类型检查 0 错误。
- **工作区状态**: 变更已完成并通过验证。
- **未提交工作区**: 包含 `DeskpetStage.vue`、`usePresetController.ts`、`useMotionPriority.ts`、`package.json`、新增测试与交接文档。
- **下一步建议**: 实机体验右键随机动作、预设工坊点击预览与各预设连续切换，确认动作平滑无缝且无动作混叠。

---
---

# Uta 修复预设临时部件残留与动画并发冲突交接（2026-11-03）

## 1. 事项与完成清单
- **[BUG-CONTROL-CLEANUP: 修复预设临时部件生命周期跟踪与黑框眼镜复原]**：
  - **背景与原因**：用户反馈右键随机播放 `well actually......` 预设完毕后，“黑框眼镜”部件没有消失，永久留在桌宠脸上。
    - 根因分析：在 `dafish.json` 与 `vts-import.ts` 中，`黑框眼镜` 与 `单片眼镜` 被归类为 `"outfit"`（服装）。预设控制器在 `applyStepStateToModel` 中会检测激活的 `outfit` 并视其为用户的常驻换装（`persistentActiveIds`）。因此在步骤 3（得意收手 `controls: []`）及播完恢复待机（`revertToActiveHoldPreset`）时，临时开启的黑框眼镜被误判为不可清理的常驻服装，导致其永远留在脸上。
  - **修复实现**：
    1. **分类修正 (`dafish.json`, `deskpet-adapter.json`, `vts-import.ts`)**：将 `黑框眼镜` 和 `单片眼镜` 从 `"outfit"` 正式修正为道具类 `"pose_prop"`。
    2. **临时部件动态生命周期追踪 (`usePresetController.ts`)**：
       - 增加 `presetActivatedControlIds: Set<string>` 与 `userBaselineControlIds: Set<string>`；
       - 在预设步骤执行中，动态对比上一步激活但当前步骤未包含的控件，即时调用 `applyControlActionToList(..., 'off')` 关闭并从集合剔除；
       - `persistentActiveIds` 计算时严格排除 `presetActivatedControlIds`，杜绝预设临时激活的任何部件被晋升为常驻部件；
       - 预设正常播完执行 `revertToActiveHoldPreset` 或中途取消 `cancelPresetSequence(true)` 时，强制全量关闭 `presetActivatedControlIds`，待机状态下绝不残留。
- **[BUG-ANIMATION-MUTEX: 修复预设播放互斥、悬停定时器抑制与动作打断原子性]**：
  - **背景与原因**：用户反馈右键点击桌宠有概率触发两个动画同时播放打架（如 `well actually` 与 `好奇` 同台抢占）。
    - 根因分析：
      1. `DeskpetStage.vue` 中鼠标移入 8 秒自动触发“好奇”预设的定时器 `hoverReactionTimer` 在用户点击或操作时未被清理。当右键播放 5.6 秒的 `well actually` 时，若鼠标悬停满 8 秒，定时器会强行插入播放“好奇”；
      2. 交互节流判定未将“预设正在执行中”纳入忙碌保护，导致动作中途被并发放行；
      3. 新预设接管时未原子停止上一段 Live2D 动作，导致底层 MotionManager 继续叠加运算。
  - **修复实现**：
    1. **悬停定时器抑制与即时清理 (`DeskpetStage.vue`)**：
       - 新增 `clearHoverReaction()`，在 `onStageRightClick`、`onStageClick`、`onDoubleClick`、`onModelMouseDown` 中即刻清空定时器；
       - 在 `watch(isModelHovered)` 与 `reactToInteraction('hover')` 中，若当前正在播放预设（`store.activeRunningPresetId !== 'neutral'`），直接抑制悬停触发；
    2. **右键防抖与互斥保护 (`DeskpetStage.vue`)**：
       - `triggerRandomPreset` 增加 350ms 快速点击防抖，防止鼠标抖动产生多重调用；
    3. **动作打断原子性升级 (`usePresetController.ts`)**：
       - 在 `applyPresetByEntry` 开头显式执行 `cancelPresetSequence(true)` 清理上一轮临时部件，并紧接着调用 `deps.stopMotion?.()` 强行终结底层动作管理器中的残留动作，保证新预设在 100% 干净的模型状态下启动。

## 2. 现场状态
- **测试状态**: 全量 1280 项单元测试通过（1274 pass, 0 fail, 6 skip），TypeScript 类型检查 0 错误。
- **工作区状态**: 变更已完成并通过验证。
- **下一步建议**: 实机右键点击桌宠体验 `well actually......` 播放完毕后眼镜与大牙自动收回，并验证连续右键随机预设切换平滑无打架。

## 3. 技术储备与未来规划 (Backlog)
- **[F-IK-ARM: 未来方向 - 基于运行时2D IK的无参数手臂解算与鼠标跟随交互]**：
  - **技术背景与目标**：
    - 针对缺乏原生手臂旋转参数（如未提供 `ParamArm`、`ParamElbow` 等）的 Live2D 模型或第三方导入模型，探索在底层渲染节点（ArtMesh / Deformer Transform）层面直接接管大臂、小臂与手腕的图层层级；
    - 基于 2D IK 算法（如三角几何解析法、CCD 或 FABRIK 求解器），根据指定空间目标点（如全局鼠标指针坐标、桌面窗口交互边缘）反向推算肩部与肘部关节旋转角，驱动手臂在无参数时动态举起与实时跟随。
  - **核心挑战与评估**：
    1. **作画崩坏防护**：2D 贴图在极端角度下易产生关节断层或拉伸变形，需设计旋转角限位（Angle Clamp）与拉伸保护；
    2. **图层遮挡（Draw Order）适配**：需防范手臂抬高时穿插到身体或胸口衣物后方的图层穿模问题；
    3. **与高质量手写预设的平滑融合**：模型自身具备原画精细动作（如大肥鱼 `well actually......`、`抚胸`）时优先走手写曲线，IK 仅作为特定动态指点、追光与通用白板模型的自适应增强能力。

---
---

# Uta 待办系统统一、桌宠交互精简、预设命名去噪与TTS自动风格交接（2026-11-03）

## 1. 事项与完成清单
- **[REFACTOR-TODO-UNIFICATION: 待办系统统一与设置页职责重构]**：
  - **背景与原因**：用户反馈待办系统原先区分了“日常”和“宿主”分栏，且包含了未实现的发送到宿主代码，小窗口底部还有多余的“在完整设置里管理”按钮；设置页面堆砌了长串待办项与只读项目，缺少真正的待办相关全局偏好设置。
  - **重构实现**：
    1. **桌宠小浮窗 (`TodoBoard.vue`)**：彻底移除日常/宿主分栏和多套数据源逻辑，统一为单一纯净待办看板；彻底删除底部“在完整设置里管理”按钮；支持 ESC 快速关闭小浮窗（输入框焦点优先失焦）。
    2. **待办列表组件 (`DailyTodoList.vue`)**：彻底清理未实现的“发送到宿主”相关代码、预览抽屉（`sendOpen`, `sendPreviewRef`, `sendIds`, `previewItems` 等）与 CSS；文案统一为“添加一项待办…”与“还没有待办事项。添加一项待办吧。”。
    3. **设置页待办面板 (`TodoDomain.vue`)**：彻底重构为专门的【待办与提醒设置】面板，涵盖：
       - 到点播放提示音开关（`todoSettings.soundEnabled`，联动主进程与本地存储）；
       - 提示音风格选择（经典风铃、清脆水滴、木质敲击、清脆单音）与一键【试听】按钮；
       - 桌宠提醒表现预设选择（到点时桌宠表演预设：好奇、开心、日常待机、惊讶等）；
       - 提醒气泡停留时长设置（5秒、10秒、15秒、30秒）；
       - 待办数据维护：已打勾完成项一键清理与二次确认防护。
    4. **桌宠到期提醒联动 (`DeskpetStage.vue` & `todo-settings.ts`)**：待办到期时，读取用户配置的提示音风格播放，驱动所选的桌宠预设，并按设定的停留秒数呈现气泡。
- **[INTERACTION-CLICK-UNIFY: 桌宠单击/双击/右键交互逻辑精简]**：
  - **背景与原因**：原先左键单击桌宠会延迟 220ms 播放好奇预设并弹气泡，双击打开输入框有延迟卡顿；且右键原本是轮换旧版表情。
  - **重构实现**：
    1. **左键单击**：彻底移除表情预设播放与延时触发逻辑，仅负责在已有面板（设置、输入框、待办、消息面板）打开时将其收起；完全消除 220ms 延迟。
    2. **左键双击**：零延时直接唤出桌面输入框。
    3. **右键单击**：随机抽取并播放一个预设（播完自动平滑恢复），并弹出互动气泡（“我在呢。”）。
- **[PRESET-NAME-CLEANUP: 默认预设名称极简去噪]**：
  - **背景与原因**：用户要求预设名称极简，除 `well actually......` 保持原样外，其余“开心·身体主导”等冗余后缀全部去除。
  - **重构实现**：
    - 各大预设定义文件修改为：`开心`、`好奇`、`生气`、`委屈`、`害羞`、`思考`、`惊讶`、`日常待机`；`well actually......` 原样保留。
    - `DAFISH_PURGE_LEGACY_FLAG` 升至 `v9`，确保客户端启动时强制刷新 localStorage 中的预设名称。
- **[FEAT-TTS-AUTO-STYLE: TTS 可选风格增加让宿主自动选择合适风格开关]**：
  - **背景与原因**：用户希望 TTS 可选风格支持让宿主自动选择，宿主在回合中返回语气标记，或通过本地词义情感分析自动推断发音风格。
  - **重构实现**：
    1. `TtsSettingsSection.vue`：在风格输入框下方增加【让宿主自动选择合适风格】开关，绑定 `store.ttsAutoStyleFromHost`。
    2. `reply-speech.ts`：实现 `inferSpeechStyleFromText` 本地词义情感推断（疑问/好奇 -> `curious`、喜悦/鼓舞 -> `cheerful`、思考/分析 -> `thinking`、专注/严肃 -> `focused`、致歉/安慰 -> `sad`）与 `resolveSpeechStyle` 决策解析。
    3. `DeskpetStage.vue`：发音统一经过 `speakWithStyleResolution`，当开关开启时优先采纳宿主语气标记，缺失时通过词义推断；关闭时严格锁定用户指定风格。
- **[UI-TITLEBAR-ENV-CLEANUP: 移除设置窗口左上角“开发实例”提示]**：
  - `SettingsWindowApp.vue`：移除 `<WindowTitleBar>` 的 `:environment="profileName"` 传参，窗口标题保持为纯净的“Uta 设置”或“Uta · 初次见面”。
- **[UI-WORKSHOP-LAYOUT-PRUNE: 预设工坊泛用性清理]**：
  - `SettingsStudioTab.vue`：移除常用动作片段中大肥鱼特化的 3 组手势循环按钮（抚胸致意、竖起食指、拿起狗尾草），保留全模型通用的标准微动作（眨眼、点头、歪头、惊讶）。

## 2. 现场状态
- **Git Commit**: `fdfe763` `refactor: [REFACTOR-TODO-INTERACTION-TTS: 统一待办系统与设置页职责、精简桌宠点击交互、默认预设名称去噪与TTS自动风格开关]`
- **测试状态**: 全量 1279 项单元测试通过（1273 pass, 0 fail, 6 skip），TypeScript 类型检查 0 错误。
- **工作区状态**: clean

---
---

# Uta 修复工坊分镜点击部件状态未同步与桌宠阶段定格呈现交接（2026-11-02）

## 1. 事项与完成清单
- **[BUG-WORKSHOP-STEP-INSPECTION: 修复分镜点击未同步参数滑块、部件状态与桌宠阶段呈现]**：
  - **背景与原因**：用户反馈在预设工坊点击对应分镜时，依然无法看到具体的参数和部件启用状态，且桌宠本身也不显示该阶段的状态。排查发现四个根因：
    1. UI 部件状态未同步：`SettingsPanel.vue` 的 `selectEditingStep` 仅更新了滑块值，未同步更新 `store.modelControls` 的 `active` 与多段 `currentStageIndex`；
    2. 参数折叠不可见且缺乏摘要：姿态参数与部件开关在手风琴卡片中默认收起，用户点击分镜看不到任何变化，且“当前帧参数”卡片和分镜卡片缺乏本帧已调参数与激活部件的直观摘要；
    3. 桌宠 Live2D 单步定格缺失：`previewPresetStepOnModel` 预览单步时未调用 `deps.stopMotion?.()`，导致后台持续播放的动画每帧刷新覆盖骨骼参数；未清理表情层残留参数（`applyParameters`）；且非滑块标准参数未穿透合并至 Live2D 控制层；
    4. 本地缓存预设未刷新：`DAFISH_PURGE_LEGACY_FLAG` 停留在 `v7`，本地 `localStorage` 缓存的旧预设未被刷新补种为带参数的完整分镜。
  - **修复实现**：
    1. **分镜点击深度状态同步 (`SettingsPanel.vue` & `settings-workshop.ts`)**：
       - `selectEditingStep(idx)` 中同步更新 `store.modelControls` 的 `active` 与 `currentStageIndex`，并修正 `loadPresetIntoEditor` 中的部件同步；
       - 智能自动展开有改动的面板：若当前分镜修改了姿态自动展开“头部与身体姿态”，若启用了部件自动展开“可选部件快捷开关”，若修改了五官自动展开“五官与眼神”；
       - `controlGroups` 激活计数逻辑修复，精确支持带阶段的多态部件；
       - 新增计算属性 `currentStepActiveControls` 和 `currentStepModifiedSliders` 并暴露给工坊。
    2. **当前帧参数卡片与分镜列表可视化增强 (`SettingsStudioTab.vue` & `WorkshopKeyframeStack.vue`)**：
       - 在卡片 2“STEP PARAMETERS · 当前帧参数”中新增【本帧已调参数与部件】可视化摘要区域：实时列出激活部件胶囊（如 `[抚胸]`、`[黑框眼镜]`）与偏离默认值的微调参数（如 `身体前后 (Z): +12`、`头部歪斜 (Z): +20.5°`、`嘴巴开合: 0.7`）；
       - 在左侧分镜卡片（`WorkshopKeyframeStack.vue`）中增加 `X部件`、`X参数`、`动作` 轻量徽标，各阶段数据差异一目了然。
    3. **桌宠 Live2D 模型精准阶段定格与穿透渲染 (`usePresetController.ts`)**：
       - `previewPresetStepOnModel` 预览分镜时，先调用 `deps.stopMotion?.()` 打断正在循环的动作动画；
       - 清除残余表情并复位情绪层参数（`clearExpression` 与 `applyParameters(model, {})`）；
       - `applyStepStateToModel` 修复：在预览单步时精准关闭未激活的临时部件并开启指定部件；
       - `applyModelControlAndSliderLayer` 增加 `directParameters` 穿透：将 `step.parameters` 直通合并至 `mergedParams`，保证所有声明参数无损生效。
    4. **预设补种版本刷新 (`stores/deskpet.ts`)**：
       - 升级 `DAFISH_PURGE_LEGACY_FLAG` 为 `v8`，强制本地 `localStorage` 重新补种 9 大身体主导灵动预设及其分镜数据。
  - **验证结果**：
    - 全量单测 1284 项测试全部通过（1278 pass, 0 fail, 6 skip）；
    - TypeScript 0 错误（`npm run typecheck` 完美通过）；
    - 生产构建 `npm run build` 成功通过。

## 2. 现场状态
- **Git Commit**: `d95a79f` `fix(workshop): [BUG-WORKSHOP-STEP-INSPECTION: 修复分镜点击未同步参数滑块、部件状态与桌宠阶段呈现]`
- **工作区状态**: clean
- **下一步建议**: 启动桌宠与设置中心实机体验工坊分镜点击联动与桌宠即时定格呈现。

---
---

# Uta 彻底移除工坊顶部冗余卡片与分镜原生动作选择器生效交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-WORKSHOP-STEP-MOTION: 彻底移除工坊顶部两大卡片与动作导演并让分镜原生动作选择器生效]**：
  - **背景与原因**：用户反馈预设工坊一切换过去，顶部就是大串的“原生动作库（20项）”和“成对手势闭环（3组）”，占用大量高度阻挡了核心工作台；并且在右侧分镜步骤属性（STEP PARAMETERS · 当前帧参数）中本来就已经有了“原生动作”下拉选择框，但此前未能真正对当前步骤生效。
  - **重构与生效实现**：
    1. **工坊顶部大卡片彻底清空**：
       - 从 SettingsStudioTab.vue 顶部彻底删除了 原生动作库 卡片、成对手势闭环状态机 卡片以及 AI 动作导演 面板及其关联的 260 余行多余 CSS；
       - 一切换到预设工坊，首屏 100% 直达核心工作台（左侧分镜时间线 + 右侧当前帧参数与滑块），没有任何列表阻挡。
    2. **分镜步骤内的“原生动作”下拉框全面生效**：
       - 将 SettingsPanel.vue 中的 motionSelection 和 onMotionSelect 从预设全局回退动作重构为直接绑定当前正在编辑的分镜步骤（currentEditingStep.value.motion）；
       - 选项展示“无原生动作”及当前模型全部原生动画名，用户切换分镜时下拉框自动同步选中该步骤绑定的动作；更改时立即写入当前步骤并提交历史记录；
       - 在 usePresetController.ts 的 previewPresetStepOnModel 中补充对 step.motion 的执行触发（deps.playMotionWithPriority），用户无论是切换步骤、在下拉框选择动作，还是全量试播分镜序列，选定的原生动作均会在桌宠模型上实时同步播放。
    3. **成对手势无缝并入快捷片段**：
       - 将 3 组闭环手势（抚胸致意、竖起食指、拿起狗尾草）作为轻量胶囊按钮无缝并入分镜时间线“一键追加常用动作片段”中；点击即可在时间线上就近追加三段分镜（起/驻/收），随用随取。
  - **自动化与生产构建验证**：
    - 全量单测 1284 个测试用例全部通过（1278 pass, 0 fail, 6 skip）；
    - TypeScript 0 错误（Node 与 Web 均通过），npm run build 打包成功。

## 2. 现场状态
- **Git HEAD**: 即将提交
- **分支状态**: main

---
---

# Uta 预设工坊分镜联动修复、待办排版优化与 VTS 参数导入增强交接（2026-11-02）

## 1. 事项与完成清单
- **[BUG-01: 修复工坊下滑至动作分镜时窗口拖动失效]**：
  - **背景与原因**：用户反馈在进入预设工坊并向下滑动到“动作分镜”一栏时，窗口无法继续拖动。排查发现滚动容器内部嵌套的复杂子区域以及部分组件残留的 -webkit-app-region: no-drag 在 Chromium 滚动重排时污染或偏移了非客户区（Non-client draggable region）。
  - **修复实现**：
    1. 在 SettingsWindowApp.vue 中为 .window-action-bar 显式声明 -webkit-app-region: drag，并严密排除按钮与输入框（button, input, select, textarea, .nav-item { -webkit-app-region: no-drag; }）；
    2. 对滚动工作区强制重置：.window-body, .window-body * { -webkit-app-region: initial !important; }，杜绝任何内层 no-drag 在滚动坐标偏移时污染标题栏与动作栏；
    3. 在 SettingsPanel.vue 中通过 useWindowDrag() 绑定桌面浮动伴侣窗口的 .bio-header 拖拽支持，并提供无侵入的安全回退判断。
- **[BUG-02: 修复工坊分镜点击未映射到参数滑块]**：
  - **背景与原因**：工坊分镜列表中点击单个步骤时，右侧参数滑块未同步更新为该分镜的参数数值；根本原因一是 selectEditingStep(idx) 仅触发了动作预览而未遍历同步 store.modelSliders；二是所有内置预设的 steps 仅占位了生命周期，未携带各步骤具体参数。
  - **修复实现**：
    1. 在 SettingsPanel.vue 的 selectEditingStep(idx) 中遍历 store.modelSliders，将对应分镜步骤的参数值（target.parameters?.[slider.id] ?? slider.defaultValue）精确回填至滑块状态中；
    2. 在全部大肥鱼预设（well-actually、angry、curious、happy、sad、shy、surprised、thinking、neutral）的 steps 中完整补充各分镜的动力学关键帧参数；
    3. 将所有预设的 finishMode 规范化为 'revert'，消除残余循环模式，与步骤结束自动回正的视线恢复保持一致。
- **[UI-06: 设置待办面板排版视觉优化]**：
  - **背景与原因**：用户反馈待办一栏排版混乱。原实现中左列堆叠了“项目选择”、“宿主计划”和“项目待办”三个卡片，导致“项目选择”与“项目待办”被宿主计划硬生生割裂开，且两者标题与进度徽章完全重复显示；
  - **优化实现**：
    1. 合并左列结构：将项目下拉切换器（aria-label="项目选择"）作为紧凑优雅的工具栏无缝内置于“项目待办”卡片顶部，消除了冗余的独立卡片与重复标题/徽章；
    2. 重新梳理信息层次：项目待办位于左侧上方，下方紧跟宿主只读镜像计划，右列独立排布日常待办，使双列高度与视觉节奏达到完美均衡；
    3. 全面升级样式细节：优化待办行悬浮反馈、复选框过渡动效、空状态居中微文案及移动端自适应布局；
    4. 保留全部测试契约（aria-label="项目选择"、aria-label="项目待办"、aria-label="宿主计划"、aria-label="日常待办"、todo-project-select、todoSendToHost 等），12 项待办单测全绿。
- **[FEAT-01: 整合 jingyu-live2d-agent 的 VTS 参数导入]**：
  - **背景与原因**：参考 jingyu-live2d-agent 中对 VTube Studio 模型的参数导入与离线校准实现，补齐 Uta 在外部 VTS 模型导入时的映射能力。
  - **功能增强**：
    1. 扩充 buildFocus 的正则识别逻辑：不仅支持简写（AngleX, PositionX），同时完整支持 Cubism 标准命名体系（ParamAngleX, ParamAngleY, ParamAngleZ, ParamEyeBallX, ParamEyeBallY, ParamBodyAngleX, ParamBodyAngleY, ParamBodyAngleZ）；
    2. 补充提取 bodyZParam 身体 Z 轴映射，使视线跟随与身体动力学更饱满；
    3. 新增 vtsMappings 列表提取并注入 VtsSidecarPlan（包含输入来源 Input、输出Live2D参数 OutputLive2D、范围下限/上限与平滑度 Smoothing）；
    4. 在 tests/vts-import.test.cjs 补充 5 组全量断言并全部通过。

## 2. 现场状态
- **Git 分支**: main
- **自动化测试**: 1284 个测试用例全部通过（1278 pass, 0 fail, 6 skip）
- **类型检查与构建**: npm run typecheck 0 错误，npm run build 生产构建成功。

---
---

# Uta 大肥鱼生气动作彻底移除兔牙搞怪部件交接（2026-11-02）

## 1. 事项与完成清单
- **[FIX-PRESET-ANGRY-REMOVE-TEETH: 彻底移除生气动作中的兔牙搞怪部件并重塑自然嗔怒口型]**：
  - **背景与原因**：
    - 用户评审指出：“为什么还有兔牙？这个兔牙只在搞怪用的动作里出现就好了”；
    - 兔牙（`key9`）属于模型特有的滑稽搞怪部件，此前在 Nerd 梗动作（`well_actually`）中发挥良好，但在常规严肃/嗔怒的生气动作中出现会破坏角色真实的情绪传达，显得搞笑荒谬；
    - 遵循原则：**兔牙仅且必须只在恶搞/搞怪类动作（如 `well actually......`）中登场，常规情绪一律严禁露出兔牙**。
  - **修改与重塑细节**：
    1. **兔牙彻底归零**：
       - `dafish-body-led-angry.ts` 中完全移除了对 `key9` 的激活，并显式配置 `add('key9', [[0, 0], [duration, 0]])`，杜绝任何历史动作残留；
    2. **重塑自然紧绷抿嘴口型**：
       - 采用闭口紧绷下撇怒意嘴（`ParamMouthForm: -0.65`），嘴部开合完全闭合锁定（`ParamMouthOpenY: 0`）；
       - 配合满面通红（`key7: 0.90`）、倒八字严厉蹙眉（`LAngle/RAngle: -0.55`）与大幅度身体前倾（`LeanInput: -25`，`PositionZ: 15`），形成纯粹、凌厉且自然正经的直视怒视状态；
    3. **迁移与单测验证**：
       - `deskpet.ts` 迁移版本升至 `v5`；
       - `dafish-body-led-angry.test.cjs` 增加对 `key9 === 0` 的强断言，测试全过；
       - TypeScript 0 错误，生产构建完成。

## 2. 现场状态
- **Git HEAD**: `af9b535` (`fix(presets): [FIX-PRESET-ANGRY-REMOVE-TEETH: 彻底移除生气动作中的兔牙搞怪部件并重塑自然嗔怒口型]`)
- **分支状态**: `main` 分支整洁。

---
---

# Uta 大肥鱼生气动作为正对身体前倾重构交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-PRESET-ANGRY-FORWARD-LEAN: 重构大肥鱼生气动作为正对不偏头的大幅度身体前倾逼近与气愤喘息]**：
  - **背景与原因**：
    - 用户评审指出：“这个生气可以重做一下，不用偏头，身体前倾就好”；
    - 针对原“傲娇转身”版本中身体向外大侧身避开屏幕（`AngleX: 14`, `PositionZ: -16`, `PositionX: 12`）的表现，彻底去除偏头与侧身转向，改为正面逼近用户的大开大合前倾姿态。
  - **新动作时序与动力学编排（5.6 秒循环）**：
    1. **0.0s ~ 0.8s【身体前倾逼近·正面直视】**：
       - 去除所有侧向旋转与歪头偏角：`AngleX: 0`, `AngleZ: 0`, `PositionX: 0`，正正面对屏幕与用户；
       - 躯干猛烈向前倾倒逼近（`LeanInput: -22.0 ~ -25.0`, `PositionZ: 13.0 ~ 15.0`）；
       - 下巴微收下压（`AngleY: -3.0 ~ -3.5`），视线上翻死死锁定并正视用户（`ParamEyeBallX: 0`, `ParamEyeBallY: 0.12`）；
    2. **0.8s ~ 3.6s【怒意爆发·气红脸咬牙喘息】**：
       - 满面气红（`key7: 0.90`），咬紧大门牙（`key9: 0.85`）；
       - 严厉倒八字倒竖眉（`ParamBrowLAngle/RAngle: -0.55`），紧绷怒目圆睁；
       - 胸腔伴随急促剧烈起伏气愤喘息（`PositionY: -2.0 <-> +0.8` 多周期剧烈呼吸，嘴部配合喘息开合 `ParamMouthOpenY: 0.04 ~ 0.12`）；
       - 怒意上头全程不眨眼；
    3. **3.6s ~ 4.6s【气消缓和·平稳后撤】**：
       - 怒意平息，门牙与脸红淡出，身体缓缓直起回正，并在 4.0s 处完成一次平静闭目眨眼（140ms）；
    4. **4.6s ~ 5.6s【平滑归零与无缝 C1 循环】**。
  - **系统集成与验证**：
    - 预设命名更新为 `生气·身体前倾`；
    - `deskpet.ts` 迁移版本升至 `v4`，确保用户刷新界面时自动加载重构后的生气预设；
    - 单测 `tests/dafish-body-led-angry.test.cjs` 断言前倾与正面直视全部通过；
    - 19 项 Live2D 动作单测全过，`npm run typecheck` 0 错误，`npm run build` 耗时 2.83s 构建成功。

## 2. 现场状态
- **Git HEAD**: `1b0611c` (`feat(presets): [FEAT-PRESET-ANGRY-FORWARD-LEAN: 重构大肥鱼生气动作为正对不偏头的大幅度身体前倾逼近与气愤喘息]`)
- **分支状态**: `main` 分支整洁。

---
---

# Uta 大肥鱼彻底清理老旧预设与全量升级灵动表演交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-PRESETS-CLEANUP-LEGACY: 彻底清理大肥鱼老旧静态预设并全量升级为9大身体主导灵动预设]**：
  - **背景与原因**：
    - 用户排查指出在桌宠界面中“有些似乎还是老动作”；
    - 经深入排查发现：设置面板中的情绪分组小胶囊在点击时（`onGroupCapsuleClick`）默认只播放该分组的第一项（`grp.items[0]`），而历史遗留的 20 余个微调静态预设（如「好奇·歪头打量」、「思考·托腮找线索」、「指引·竖指说教」、「惊讶·战术后仰」等）排在最前，新做动作排在末尾；且伴侣/指令情绪分发池中旧动作占比高达 50%~75%；
    - 根据用户明确指令：“直接把老预设删了吧”，彻底对大肥鱼所有老旧预设及过时的对照样板进行物理清理与全量升级。
  - **清理与重构范围**：
    1. **彻底淘汰老旧预设池**：
       - 清理 `natural-presets.dafish.json` 中的 23 个老旧静态参数项（`happy`, `happy_tilt`, `sad`, `sad_glance`, `angry`, `angry_glare`, `annoyed`, `weary`, `embarrassed`, `shy`, `shy_peek`, `thinking`, `focus`, `curious`, `surprised`, `waiting`, `testing`, `morph_small`, `morph_large`, `cheer`, `nod`, `wave`）；
       - 清理早期的开心实验对照样板（`dafish_happy_sample_v1`, `dafish_authored_happy_v2`, `dafish_calibrated_happy_v3`）；
    2. **大肥鱼预设唯一真实源升级**：
       - `buildDafishNaturalPresets` 重写为纯粹且仅包含 9 个高表现力、60 FPS 连续动力学编排版本：
         - **日常 (`neutral`)**：日常待机·静谧陪伴（6.0s 呼吸起伏 + 双周期生理眨眼）
         - **开心 (`dafish_body_led_happy_v4`)**：开心·身体主导（6.4s 抚胸轻笑 + 骨盆腿部连带）
         - **好奇 (`dafish_body_led_curious`)**：好奇·大歪头探身（5.6s 探身前倾 + 22°大歪头 + 垫脚弹跳）
         - **惊奇 (`dafish_body_led_surprised`)**：惊奇·战术后仰（5.4s 战术后仰 + 瞳孔急缩 + 大开嘴喘息）
         - **委屈压抑 (`dafish_body_led_sad`)**：委屈·抚胸含泪（6.0s 全身失落坍塌 + 抚胸 + 泪汪汪 + 抽噎起伏）
         - **生气 (`dafish_body_led_angry`)**：生气·傲娇转身（5.6s 决绝侧身背对 + 咬牙切齿脸红 + 斜睨偷瞄）
         - **害羞 (`dafish_body_led_shy`)**：害羞·羞赧偷看（5.6s 怯生生护胸 + 绯红脸颊 + 低头偷瞥微笑）
         - **思考 (`dafish_body_led_thinking`)**：思考·单片眼镜沉思（5.6s 金色单片镜 + 仰头盘算 + 灵光一闪）
         - **趣味 (`well_actually`)**：趣味·Well actually（5.6s Nerd 名场面黑框眼镜 + 大板牙 + 竖食指打拍子）
    3. **自动持久化存储迁移**：
       - 在 `deskpet.ts` 中实现 `purgeDafishLegacyPresets(key)`，一旦检测到大肥鱼模型加载或页面刷新，自动将现有 `localStorage` 桶内残留的老旧预设清除，替换并持久化为纯净的 9 大灵动预设；
       - 重置默认预设（`restoreDefaultPresets`）与默认状态预设（`statePresets`）同步更新，不再有任何老旧项残留；
    4. **胶囊与分发 100% 命中**：
       - 每个分组有且仅有 1 个代表预设，点击小胶囊直接 100% 播放该高表现力版本，抽中老动作概率彻底归零。
  - **验证**：
    - `tests/natural-presets.test.cjs` 8 项测试全过；
    - 7 大身体主导动作 + Nerd 梗测试 19 项全过；
    - `npm run typecheck`（Node 与 Web）0 错误；
    - `npm run build` 耗时 2.81s 打包成功。

## 2. 现场状态
- **Git HEAD**: `6f2fd8f` (`feat(presets): [FEAT-PRESETS-CLEANUP-LEGACY: 彻底清理大肥鱼老旧静态预设并全量升级为9大身体主导灵动预设]`)
- **分支状态**: `main` 分支整洁。

---
---

# Uta 大肥鱼全套预设组身体主导灵动表演交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-PRESETS-BODY-LED-ALL: 为全套预设组构建高表现力身体主导灵动表演与预设]**：
  - **背景与目标**：
    - 在 Nerd 说教预设（`well actually......`）获得用户高度认可（“很不错，可以照着这个节奏往下做，接下来给所有预设组做一份”）后，按照 `live2d-calibration/SKILL.md` 的调校规范（物理骨骼输入驱动、大开大合可见幅度、关节过渡平滑、高潮时点表情咬合、Hermite 连续插值、60 FPS 导数连续归零），为大肥鱼模型全套核心情绪预设组打造高表现力的身体主导连续动作；
    - 彻底告别以往“微幅漂移、只有头动、看不出情绪变化”的缺陷。
  - **新构建的 7 大情绪动作生成器清单**：
    1. **好奇·大歪头探身 (`dafish-body-led-curious.ts`)**：
       - **时序时长**：5.6 秒循环；
       - **动力学特征**：大幅前倾探身（`LeanInput: -24`, `PositionZ: 12`, `PositionX: -9`），头部大角度歪斜 22°（`AngleZ: 22°`），嘴部好奇 O 型微张，脚下轻快弹跳起伏（两次波峰波谷），尾声露出好奇欣喜浅笑与 140ms 生理眨眼。
    2. **惊奇·战术后仰 (`dafish-body-led-surprised.ts`)**：
       - **时序时长**：5.4 秒循环；
       - **动力学特征**：战术后仰拉开距离（`LeanInput: +25`, `PositionZ: 16`, `PositionY: 4.8`），瞳孔瞬间受惊缩放（`ParamEyeScale: -0.85`），大张嘴倒吸凉气（`ParamMouthOpenY: 0.70`, `ParamMouthForm: -0.55`），身体两次急促喘息起伏后逐渐平复回位。
    3. **委屈·抚胸含泪 (`dafish-body-led-sad.ts`)**：
       - **时序时长**：6.0 秒循环；
       - **动力学特征**：全身失落坍缩下沉（`PositionY: -5.5`, `PositionX: -6.5`, `PositionZ: -8`），抚胸安慰手势（`Movement2: 1`），双眼泪汪汪（`key2: 1`），下垂难过嘴角（`ParamMouthForm: -0.75`），胸腔两次抽噎起伏后平稳收回。
    4. **生气·傲娇转身 (`dafish-body-led-angry.ts`)**：
       - **时序时长**：5.6 秒循环；
       - **动力学特征**：气恼别过身子背对（`PositionZ: -16`, `PositionX: 12`, `AngleX: 14`），咬牙露齿与脸颊气鼓鼓气红（`key9: 0.85`, `key7: 0.85`），紧绷短促呼吸，眼神从眼角余光恶狠狠偷瞄盯人（`ParamEyeBallX: -0.55`）。
    5. **害羞·羞赧偷看 (`dafish-body-led-shy.ts`)**：
       - **时序时长**：5.6 秒循环；
       - **动力学特征**：怯生生单手护胸（`Movement2: 1`），脸颊绯红（`key7: 0.92`），垂首微侧头，视线低垂后羞怯地偷偷抬眼看向用户，嘴角泛起羞赧甜笑（`ParamMouthForm: 0.65`），伴随慌乱小眨眼。
    6. **思考·单片眼镜沉思 (`dafish-body-led-thinking.ts`)**：
       - **时序时长**：5.6 秒循环；
       - **动力学特征**：戴上金色单片眼镜（`key12: 1`），仰头托腮姿态（`AngleY: 5.5`, `AngleZ: -7`），视线向上游移盘算，两次胸腔深思起伏，最终灵光一闪（眼神回正聚焦、自信笃定微笑、利落眨眼）。
    7. **日常待机·静谧陪伴 (`dafish-body-led-neutral.ts`)**：
       - **时序时长**：6.0 秒循环；
       - **动力学特征**：自然安详的呼吸起伏（`PositionY: 1.4 <-> -1.2`），重心微移与柔和躯干摆动，双周期 140ms 生理眨眼（1.8s 与 4.5s），神情恬淡自然。
  - **系统集成与验证**：
    - **生命周期注册**：在 `useStageModelLifecycle.ts` 中注册全部 7 个动作组名称、时长及一键安装函数；
    - **预设挂载**：在 `deskpet.ts` 中统一挂载 7 个动作的对应预设（`curious`, `surprised`, `sad`, `angry`, `shy`, `thinking`, `neutral`），带有独立存储版本标记避免缓存污染；
    - **自动化测试**：新增 7 个独立单元测试文件并接入 `npm test`，全套 1283 项测试全部通过（1277 pass, 6 skipped, 0 fail）；
    - **类型与构建**：`npm run typecheck` 0 错误，`npm run build` 耗时 2.71s 成功生成发行包产物。

## 2. 现场状态
- **Git HEAD**: `f3076c3` (`feat(presets): [FEAT-PRESETS-BODY-LED-ALL: 为全套预设组构建高表现力身体主导灵动表演与预设]`)
- **分支状态**: `main` 分支保持整洁。
- **自动化测试状态**: 1283 项测试全部通过（1277 pass, 0 fail）。
- **可用预设集**: `happy`, `well_actually`, `curious`, `surprised`, `sad`, `angry`, `shy`, `thinking`, `neutral` 均已具备高表现力连续动力学版本。

---
---

# Uta 大肥鱼开心脸部与抚胸同步（2026-11-02）

- **用户范围**：认可当前身体幅度，要求张嘴笑与抚胸同时开始、手归位后结束。基线`4760fc8`，实现`b9b7415`；沿用V4 ID/动作组/6.4秒，不新增版本或改变身体。
- **实现**：V4复用V3脸部的时间压缩导致嘴部高点约2.3秒，落后于抬手。现将ParamMouthOpenY、ParamMouthForm、EyeSmile绑到手势生命周期：handStart=.24，.56达到原峰值，保持至handHome=3.12，再渐出至3.55；其余28条编译曲线与已接受基线逐字节相同。
- **验证**：全量1267（1261通过、6跳过、0失败），Node/Web类型/构建通过。新增同步回归，边界采用60Hz烘焙误差容限。正常SDK近景/两轮录屏/中途停止已验；实际mouth约.27保持到手回，3.56秒约.025，停止无残留。仅只读观察监听，无live2dLab强写。
- **现场**：同一隔离PID20240新时序循环；原dev20152未重启。原身体已接受录屏未覆盖。新预览和近景在`D:/Frankenstein/Uta-Workspace/runtime/previews/dafish-face-sync-20261102/`；原帧在上一轮final/face-sync-clean与face-sync-stop。初次与全量测试并行录制有采集间隔漂移，已重新干净录制；最终两轮256帧约12.806秒，按时间戳导出6.4秒WebP。
- **边界**：只改三条脸部轨道，未扩展其他状态、改日常数据/宿主/原模型或打包。未跟踪宿主验证记录未动。用户尚未评价这次脸部时序，不将此前身体认可扩大为新脸部已验收。完整[交付](results/dafish-face-sync-20261102.md)。

---
---

# Uta 大肥鱼V3被否定后的身体主导修正（2026-11-02）

- **最新用户确认**：此前聊天预览与Uta窗口效果相同；当前V4“挺合适”。以当前6.4秒版本的幅度和节奏作为大肥鱼开心基线，保留现有效果。认可不扩大到其他状态，不自行收回到V3的小幅慢速。

- **用户反馈优先**：V3效果特别差、幅度不可察觉、过慢、身体像只有头在动。此前的400次标定和测试通过不能作为观感合格证明。保留旧样板/录屏作为失败对照，不再称V3已完成自然效果。
- **基线与提交**：基线`770ad33`；`12ebb75`修复关闭跟随后瞄准全身画布中心而非中立位置，新增resetLive2DModelFocus，真实渲染循环回归覆盖一次归零且不重复写。`413966e`新增6.4秒V4「开心·身体主导样板」，ID `dafish_body_led_happy_v4`，组「开心·大肥鱼身体主导」。复用我们自己的V3脸部轨道，全部身体/手势时序重编，无原生动作资产输入。
- **幅度与节奏**：PositionX/Z峰12/16，Y峰6.5，LeanInput峰5.5；抬手.24→.98秒，收手2.12→3.12秒。头部小幅配合；另有headStill诊断变体。首次空生命周期步骤duration200/hold1400，步骤总长仍1600ms，避免视线让路耗掉主要身体动作。V1/V2/V3均未改。
- **验证**：最终1266项（1260pass、6skip、0fail），类型与构建通过；专项33通过。新的fresh profile正常SDK录制头固定7.2秒、正常两轮12.8秒、停止3.5秒。头固定渲染前AngleX/Y/Z全0，躯干Z约-12.68..3.16、骨盆Z约-2.30..9.73、腿Z约-4.18..16.33；正常播放与停止画面已查。早期head-still和head-still-clean受旧视线/步骤干扰，不能引用为成功证据。
- **现场**：最终预览`Uta [live2d-lab]` PID20240，临时根`uta-live2d-lab-t7HujU`，保留V4循环。实验29688已退出；原开发20152未重启。有效证据/媒体在`D:/Frankenstein/Uta-Workspace/runtime/previews/dafish-body-led-20261102/final/`，happy-v4.webp为新片，head-fixed.webp为头固定，v3-v4-realtime.webp同速对比。无实验强写钩子，运行时gaze/idle关闭，renderer错误0。
- **沉淀**：修正skill的“先小幅”错误倾向：先确认常用尺寸下肩以下清楚可动，再收敛幅度；读取运行时设置，不能只写旧localStorage键。仓库skill和本机默认skills副本同步。标定记录追加用户否定与实验污染说明。
- **边界**：未改日常数据/原模型/宿主配置，未安装插件、真实发送或打包；未跟踪宿主验证文件未动。下一步以用户对新片的具体观感继续迭代，不自动扩展状态或把已通参数当成审美验收。完整[交付记录](results/dafish-body-led-happy-20261102.md)。

---
---

# Uta 大肥鱼视觉标定与开心试片交接（2026-11-02）

- **授权/基线/提交**：用户确认通过视觉反馈摸清有效参数后再编排。基线 `main@cd7f7dc`；工具与首轮实测 `60ed179`，新试片 `1ea1716`。不接 VTS，不复用原生动作曲线，不扩展其他状态。
- **实测**：509 个参数中 292 个物理输出、25 个分隔、5 个服装和2个标记分开处理；185 个候选输入初筛，400 次原图/物理前与渲染前读数，包括左右关节、条件性眼形和4种路径。不是185个都已经完成所有上下文验证。部分初筛截图有气泡污染，记录已注明，清洁复测有0差异重复/回归基线。细小嘴角不能用全身像素阈值判断。事实与范围见 [标定记录](../live2d/dafish-calibration-20261102.md)。
- **试片**：新 `dafish-calibrated-happy.ts`，12.8 秒，`dafish_calibrated_happy_v3` /「开心·标定编排样板」/「开心·大肥鱼标定编排」。A 正肘路径仍外展，B 负向折肘经腰前抬到胸口，先回垂手再切手型。V1/V2 保留；V2 全部编译曲线与基线 JSON 哈希相同。只抽出烘焙编译器复用，未改V2轨道。
- **检查**：全量1263（1257通过、6跳过、0失败），Node/Web类型与生产构建通过，专项18通过。SDK无试验钩子录制15秒A/B（各225帧），检查密集抬手/循环帧；中途停止录制4秒，末帧双手垂落，错误0。主观自然度仍待用户反馈，不称为最终动作系统。
- **现场**：实验PID31008已退出；当前预览PID31004，标题 `Uta [live2d-lab]`，使用独立临时根 `uta-live2d-lab-SQqLZL`，保留B循环；原开发实例未重启。私有runtime信息仅在本机结果目录，不记录凭据。预览原图、A/B motion3、自制WebP及timings在 `D:/Frankenstein/Uta-Workspace/runtime/previews/dafish-calibrated-happy-20261102/`；标定原图在相邻 `dafish-calibration-20261102/`。
- **复用**：实验工具 `app/scripts/live2d-lab/README.md`；skill 源码 `.agents/skills/live2d-calibration/`，本机 `C:/Users/Administrator/.codex/skills/live2d-calibration/` 同步。skill已用js-yaml校验frontmatter、metadata、引用和占位符；自带Python检查器因环境缺PyYAML不可运行。未额外安装依赖。
- **边界/下一步**：用户先比较新版手臂路径和开心读感，再针对具体问题继续逐项迭代。未修改日常数据、模型源、宿主配置、安装插件、真实账号发送或打包。既有未跟踪宿主验证文档保持原样。

---
---

# Uta 大肥鱼经典 Nerd 说教“well actually......”灵动表演交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-PRESET-WELL-ACTUALLY: 实现大肥鱼经典Nerd说教well actually......灵动表演与预设]**：
  - **背景与原因**：
    - 针对用户提出的核心创意：“思考不应该竖食指，我认为你可以做一版nerd梗的动作，正好模型作者也为了玩这个梗做了相应的部件，也就是兔牙/食指/黑框眼镜，预设名字可以直接叫‘well actually......’，你应该知道这个梗吧”；
    - 结合 GPT 编写的 `live2d-calibration` 调校规范（身体主导大开大合、关节路径平滑过渡、表情高潮卡点咬合），彻底激活模型作者预留的经典 Nerd 彩蛋：黑框眼镜（`key11`）、大牙（`key9`）与竖食指控制链（`Movement3` + `Param40/36/39/41/42/43`）。
  - **表演时序与动力学编排（5.6 秒循环）**：
    - **1. 0.0s ~ 0.8s【起手与摆架子】**：身体大幅度侧向支棱转体（`PositionZ: 14~16`, `PositionX: -9~-10.5`），身体拔高挺胸（`PositionY: 4.2`），右臂顺着内侧腰身自然抬至脸侧，在 0.2s 切换 `Movement3=1`，食指直立立于脸侧；
    - **2. 0.8s ~ 3.5s【🤓☝️ 经典 Nerd 名场面爆发】**：
      - 在食指到位的瞬间（0.8s），黑框眼镜（`key11: 1`）与大牙（`key9: 1`）整齐亮相；
      - 挑起严肃的八字眉（`ParamBrowLY/RY: 0.35`, `ParamBrowLAngle/RAngle: 0.22`），眼神直勾勾盯视用户；
      - 身体探身前倾（`LeanInput: -18 ~ -22`），手指在空中随说教节奏卡点轻点两次打节拍（`Param41: 0.70 -> 0.78 -> 0.67 -> 0.70`, `Param42` 打颤），嘴巴露出大板牙配合两次说教开合（`ParamMouthOpenY: 0.06 -> 0.32 -> 0.08`）；
    - **3. 3.5s ~ 4.6s【说教完毕·得意收手】**：
      - 食指缓缓放下，右臂顺自然弧线滑落身侧，`Movement3` 切回 0；
      - 黑框眼镜与大门牙淡出，嘴角露出一抹纠错得逞的浅笑（`ParamMouthForm: 0.52`），并在 4.0s 处完成一次干脆利落的 140ms 生理眨眼；
    - **4. 4.6s ~ 5.6s【平滑归零】**：一阶导数连续收敛归零，无缝衔接下一轮待机。
  - **系统集成与验证**：
    - 编写动作生成器 [`dafish-well-actually.ts`](file:///D:/Frankenstein/Uta/app/src/renderer/services/live2d/dafish-well-actually.ts) 与单测 [`dafish-well-actually.test.cjs`](file:///D:/Frankenstein/Uta/app/tests/dafish-well-actually.test.cjs)；
    - 在 `useStageModelLifecycle.ts` 中注册 `DAFISH_WELL_ACTUALLY_MOTION`，在 `deskpet.ts` 中挂载 `well_actually` 预设；
    - TypeScript 检查 0 错误，生产打包构建成功；
    - 启动前台测试实例（Task ID `task-5767`），大肥鱼已加载并正在桌面上循环播放该动作，并成功截取高潮快照 `well-actually-preview.png`。

## 2. 现场状态
- **Git HEAD**: `8f01d50` (`feat(presets): [FEAT-PRESET-WELL-ACTUALLY: 实现大肥鱼经典Nerd说教well actually......灵动表演与预设]`)
- **后台预览实例**: Task `task-5767`（正在屏幕上循环播放 `well actually......` 表演）
- **自动化测试状态**: 23 项 Live2D 相关测试全部通过（23 pass, 0 fail, 0 skipped）。
- **未提交工作区**: 干净。

---
---

# Uta 大肥鱼开心独立编排交接（2026-11-02）

- **授权与基线**：用户明确要求保存上一版，再做不套用自带动作的样板。基线 `main@d535ca7`；代码提交 `e629907`。旧版标签 `prototype/dafish-happy-native-v1` 和旧视频已保留，两个样板并存。
- **实现**：新增 `dafish-authored-happy.ts`；仅输入真实参数范围和物理输出列表，以分关节 Hermite 曲线编译 17.6 秒循环。无原生 motion JSON 输入，身体、肩肘腕、脸部独立时间轴；共用 V1 注册/参数所有权基础设施。新预设 `dafish_authored_happy_v2`，标签「开心·独立编排样板」，动作组「开心·大肥鱼独立编排」。模型迁移只补一次样板，不覆盖现有预设。
- **验证**：全量 1261 项（1255 pass、6 skipped、0 fail），类型与构建通过。独立真实 Electron 播放、录屏、切换新旧版、停止后手臂回落均验证；运行时错误 0。新视频见 `D:/Frankenstein/Uta-Workspace/runtime/previews/dafish-authored-happy-20261102/happy-v2-preview.webp`。
- **现场**：预览 `Uta [dafish-happy-preview]` 主进程 PID 10392 正在循环新版；旧预览 PID 1700 已自行退出。临时 profile 仍为 `%TEMP%/uta-dafish-happy-20261102/profile`；新启动/录屏脚本在 `app/node_modules/.cache/dafish-authored-happy-20261102/`。未重启原 dev 实例、未修改日常模型/宿主配置、未打包。既有未跟踪 `host-connection-verification-20261101.md` 保持原样。
- **下一步**：先看用户对新片段的反馈；不要自动扩展其他状态。保留旧样板以便对照，原版曲线构建函数未改动。独立曲线仍受模型可用关节和部件切换方式约束；此轮没有实现通用轨道编辑器。完整记录见 [独立编排交付](results/dafish-authored-happy-20261102.md)。

---
---

# Uta 大肥鱼开心连续表演样板交接（2026-11-02）

- **授权与范围**：用户要求先做一版，只做开心、只做大肥鱼。基线 `6c0ac4b`，实现提交 `21fe81a`。新增独立的「开心·自然表演样板」，不替换旧开心或其他状态。
- **实现**：模型加载时将原生「脱捕」身体轨道、狗尾草原生起收手以及分时脸部/视线轨道编译成 18.6 秒运行时动作；复用 Cubism 播放和物理。补齐参数所有权、视线让路和随机待机让路，避免静态部件参数钉住动作。
- **验证**：全量 1258 项（1252 pass、6 skipped、0 fail），类型与构建通过。真实大肥鱼上观察、录制完整一轮并检查停止清理；当前是效果样板，不是整个状态系统或工坊连续轨道编辑已完成。
- **用户可看**：独立预览 `Uta [dafish-happy-preview]`，PID 1700 保留循环；录屏位于 `Uta-Workspace/runtime/previews/dafish-happy-20261102/`。原开发实例未重启；未安装插件、未真实账号发送、未改原模型、未打包。
- **继续入口**：本机脚本 `app/node_modules/.cache/dafish-happy-20261102/`，默认 `play.mjs` 重播样板，传入 `日常待机` 停止。全部使用临时 profile 和私有端点。完整技术记录及边界见 [样板交付](results/dafish-happy-performance-20261102.md)。下一步先听用户对画面的反馈，再决定动作幅度、节奏与部件频率；不要自动扩展其他状态。

---
---

# Uta 默认预设自然复合表演重构交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-DEFAULT-PRESETS-REFACTOR: 重构全套默认预设为表情+肢体姿态+部件联动的自然复合表演]**：
  - **背景与原因**：
    - 此前预设关键帧仅调节眉、眼、嘴等 8-10 个五官参数，身体参数（`ParamBodyAngleX/Z`）被置 0，头部倾角仅有 1-2 度的微颤，躯干处于绝对僵直状态；
    - 构建器 `natural-presets.ts` 内部丢失了对 `motion` 字段的透传，导致模型原生动作（如大肥鱼的脱捕、竖手指、抚胸手）无法与预设协同；
    - 部件与道具（`controls`）在很多预设中未被有效调度，无法形成一体化演出；
    - 用户明确指示：“重构一下默认预设，每一个动作预设应该是利用面部表情的同时调用其他的肢体动作和部件，拿大肥鱼举例，应该是像那个脱捕动作一样”。
  - **实现与整改**：
    - **预设协议与构建器打通原生动作支持 (`natural-presets.ts`)**：
      - 在 `RawStep`、`RawPreset` 和 `buildPack` 中补齐并透传 `motion?: { group: string; index?: number } | 'none'`；
      - 预设不仅能驱动多步缓动关键帧参数与部件，还能直接触发模型原生 `.motion3.json`，实现原生骨骼动作与面部表情、部件控制的有机叠加。
    - **大肥鱼专属预设全面重构 (`natural-presets.dafish.json`)**：
      - 新增 `cheer` (欢呼·脱捕欢腾)：绑定原生 `脱捕` 动作 + `爱心眼` 部件 + 身体大幅跳动起伏（`ParamBodyAngleX: -5 -> 3 -> 0`，`ParamBodyAngleZ: 4 -> -4 -> 0`）；
      - 新增 `nod` (赞同·抚胸致意)：绑定原生 `抚胸手打开` 动作 + `抚胸` 姿态部件 + 欠身前倾致礼（`ParamBodyAngleX: 6 -> 2 -> 0`）；
      - 新增 `wave` (指引·竖指说教)：绑定原生 `竖手指打开` 动作 + `竖食指`、`屑屑眼` 部件 + 挺胸抬指讲解（`ParamBodyAngleX: -4 -> -2 -> 0`）；
      - 强化全套现有动作：
        - `happy`: 联动 `狗尾草` 与 `爱心眼`，加入头身左右波浪摇摆节奏（`ParamBodyAngleZ: 4 -> -4 -> 0`，`ParamAngleZ: -5 -> 5 -> 0`）；
        - `sad`: 联动 `黑脸` 与 `落泪`，身体蜷缩下沉含胸（`ParamBodyAngleX: 6 -> 4 -> 5`，`ParamAngleY: -9 -> -6 -> -8`）；
        - `angry`: 联动 `大牙` 与 `流冷汗`，身体紧绷挺立（`ParamBodyAngleX: -4 -> -2`）；
        - `curious`: 联动 `圈圈眼`，大幅侧倾头身（`ParamAngleZ: -10, ParamBodyAngleZ: 6`）；
        - `surprised`: 联动 `大钢盆` 与 `><眼`，触发战术后仰（`ParamBodyAngleX: -8, ParamMouthOpenY: 0.6`）；
        - `shy`: 联动 `脸红` 与 `抚胸`，侧首含羞低眉；
        - `thinking`: 联动 `屑屑眼` 与 `单片眼镜`，身体轴心微偏。
    - **通用 Live2D 预设注入身体动力学 (`natural-presets.json`)**：
      - 引入人体平衡反向倾斜律（Counter-movement）：在所有通用表情中计算并注入 `ParamBodyAngleX` 与 `ParamBodyAngleZ`，终结“仅五官动身体不动”的僵硬木偶感。
    - **单测与全量回归**：
      - `natural-presets.test.cjs` 补充大肥鱼脱捕、抚胸手、竖食指等动作与姿态绑定的断言；
      - 全工程 1253 项测试全部通过（1247 pass, 0 fail, 6 skipped），TypeScript 类型检查全部通过。

## 2. 现场状态
- **Git HEAD**: `165a46e`
- **自动化测试状态**: 核心单测 1253 项全部通过（1247 pass, 0 fail, 6 skipped），TypeScript 类型检查全部通过。
- **打包约束**: 遵照指示未执行任何 zip 打包。

---
---

# Uta 用户体验审查问题全量修复交接（2026-11-02）

## 1. 事项与完成清单
- **[FIX-WORKSHOP-LEGACY-HINT: 预设工坊删除多余的点菜手文案残留]**：
  - **背景与原因**：预设工坊头部与身体姿态折叠面板中残留了调试测试期文案“点菜手 X/Y 只有在点菜手姿态出现时才有明显效果。”；
  - **实现与整改**：在 `app/src/renderer/components/SettingsStudioTab.vue` 的 `bio-fold-body` 中精确定位并彻底删除了该提示。

- **[FIX-CLAUDE-INSTALL-STATUS: 修复 Claude 一键安装在命令失败或超时后仍误报成功]**：
  - **背景与原因**：`installClaude` 未校验 CLI 命令退出码和超时，失败时仍然盲目执行第二步并虚报成功；
  - **实现与整改**：
    - `app/src/main/host-onboarding.ts`：对 `marketplace add` 与 `plugin install` 进行双重判空、非零退出码与超时拦截（`code !== 0 || stillRunning`）；若第一步失败，立刻中断并返回 `ok: false` 与 `stage: unavailable`；
    - 超时时明确返回 15 秒超时说明；
    - 复现脚本验证退出码 1 和超时 -1 均已被正确捕获并报告失败；
    - `app/tests/host-onboarding.test.cjs` 新增测试用例全数通过。

- **[FIX-UNBOUND-HOST-INPUT-HINT: 修复未绑定宿主时双击输入框持续提示退出重启]**：
  - **背景与原因**：未绑定宿主（独立模式）时，双击桌宠输入框误报“正在确认发送通道；若一直不可用，请完全退出后重新启动 Uta”；
  - **实现与整改**：
    - `app/src/main/host-bridge.ts`：`getHostInputStatus` 在宿主为空或 `none` 时返回 `当前未绑定宿主，请在快捷设置中选择宿主。`；
    - `app/src/renderer/components/DeskpetStage.vue`：输入提示直接引导用户在快捷设置中选定宿主；
    - `app/tests/host-bridge.test.cjs` 单测断言已通过。

- **[OPT-ONBOARDING-HOSTS-AND-MODELS: 优化新手引导中的宿主文案与角色友好名称展示]**：
  - **背景与原因**：角色选择直接显示物理路径文件夹名；引导文案漏提已支持的多宿主自动部署；桌面域找回窗口包含开发黑话；
  - **实现与整改**：
    - `app/src/renderer/settings-window/onboarding/OnboardingFlow.vue`：角色映射优先使用 `model.displayName`（显示“Hiyori Pro”、“示例立绘·团子”等友好名称）；为 Hiyori 增加 `推荐` 徽标；引言更新为全面支持 Antigravity、Qoder、Claude Code、Codex 与 DeepSeek Harness 插件一键安装；
    - `app/src/renderer/settings-window/domains/DesktopDomain.vue`：找回窗口说明改为通俗指引（“如果桌宠被拖到屏幕外或找不到，请在右下角系统托盘图标上右键，选择“重置窗口位置”即可居中召回”）。

## 2. 现场状态
- **Git HEAD**: `2b7a55e`
- **自动化测试状态**: 核心单测 1252 项全部通过（1246 pass, 0 fail, 6 skipped），TypeScript 类型检查全部通过。
- **打包约束**: 遵照指示未执行任何 zip 打包。

---
---

# Uta 用户体验测试与评估交接（2026-11-02）

- **任务范围**：用户要求测试最近的体验优化并从用户视角评估；基线 `main@94f9d78`。仅测试和写评估，未改业务代码。
- **已完成**：原生窗口走通首次引导、七个设置领域、日常待办、明暗主题、Live2D/立绘切换、动作导演六步生成、草稿关闭保护与重启保留；隔离 appData 下热切 Codex/Qoder，窗口文档加载次数保持 1；本地模拟事件验证状态胶囊、气泡、宿主计划和消息记录。
- **确认问题**：[P1: Claude 一键安装在命令失败/超时后仍报告成功]，用真实安装业务模块和隔离执行器复现；[P2: 未绑定宿主时输入框持续建议退出重启]，用生产入口窗口复现。还记录角色展示、工坊布局与接入说明问题。细节及定位见 [体验评估](results/user-experience-review-20261102.md)。
- **检查**：应用测试 1243 pass/6 skipped/0 fail；插件 124/124；Node/Web 类型与构建通过。真实宿主自动安装、账号收发、音频和长期运行未验收；没有打包或替换日常 exe。
- **现场**：独立 profile `ux-review-20261102`；PID 30936 已停止，PID 29376 已正常退出，私有运行时和配对端点均已移除。脚本/复现 JSON 位于 `app/node_modules/.cache/ux-review-20261102/`，测试数据与日志保留在本机临时目录；未改日常 profile 或真实宿主配置。开工前已有未跟踪文件 `results/host-connection-verification-20261101.md` 未改、未暂存。
- **下一步**：按用户确认范围先修安装结果与未绑定提示，再收敛角色选择和工坊操作布局。不能把本轮模拟事件通过称为真实宿主端到端验收。

---
---

# Uta 大肥鱼内置标准模板与各宿主输入能力矩阵交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-MODEL-TEMPLATE-DAFISH: 将大肥鱼适配方案沉淀为内置标准模板]**：
  - **背景与原因**：
    - 此前用户导入包含 500+ 参数的复杂 VTS 模型（如大肥鱼）时，因缺乏预设模板，生成的 `deskpet-adapter.json` 是空草稿（`emotions: {}`、`animations: {}`、`controls: {}`），8 个核心动作语义未映射，情绪库未关联，导致初学者面对庞大参数墙和“面瘫木头人”体验；
    - 用户明确指示：“P4可以把我之前测试大肥鱼的时候那一套作为其模板”。
  - **实现与整改**：
    - **标准内置适配器与宽容别名发现 (`builtin-adapters/index.ts`, `dafish.json`)**：
      - 补充标准动作语义映射：`wave -> 竖手指打开`、`nod -> 抚胸手打开`、`cheer -> 脱捕`；
      - 拓展 `findBuiltinAdapter`：增加别名库匹配（`大肥鱼`、`dafish`、`da-fish`、`deepseek`、`deepseek娘`、`c_0120`），当模型重新导出导致签名微调或路径不含精确中文名时，依然能准确定位大肥鱼内置模板。
    - **导入期自动装配与 VTS 控件提取 (`vts-import.ts`, `model-import.ts`)**：
      - 在 `vts-import.ts` 中新增 `DAFISH_VTS_TEMPLATE` 常量与 `isDafishModelSidecars` 识别器；
      - 导入大肥鱼及其变体时，自动写入包含 21 个控件（含大小变、长短裙、尾巴多阶段与狗尾草、抚胸、竖食指关节参数）、9 个标准情绪、3 个标准动作与水印重置参数的完整适配文件；
      - 对于通用非大肥鱼 VTS 模型，自动根据 `.vtube.json` 的 `Hotkeys` 将表情开关提取为带语义分类（`face_effect`、`outfit`、`pose_prop`、`toggle`）的模型控件，彻底终结“导入后生成空白 adapter”问题；
      - `model-import.ts` 将装配计划中的 `controls`、`emotions`、`animations`、`baseParameters` 同步持久化至 `deskpet-adapter.json`。
    - **自然预设包与大肥鱼专属编排 (`natural-presets.ts`, `natural-presets.dafish.json`)**：
      - 新增 `natural-presets.dafish.json`，注入大肥鱼标志性表情与道具（爱心眼、狗尾草、脸红、抚胸、竖食指、落泪、黑脸、大小变）；
      - 新增 `isDafishModel` 识别器与 `buildDafishNaturalPresets` 构建函数；在 `buildNaturalPresetsForModel` 中优先匹配大肥鱼自然预设，使大肥鱼载入后即自带完整表演谱；
      - 完善 `buildPack` 阶段语法校验：支持冒号阶段语法（如 `大小变:小`、`大小变:大`）的基础控件存在性解析。
    - **单测覆盖与验证**：
      - `app/tests/builtin-adapters.test.cjs`: 验证别名匹配与动作语义；
      - `app/tests/vts-import.test.cjs`: 验证大肥鱼模板自动应用与通用热键控件推导；
      - `app/tests/model-import.test.cjs`: 验证大肥鱼导入后自动生成完整适配表；
      - `app/tests/natural-presets.test.cjs`: 验证大肥鱼识别与自然动作编排；
      - 全量测试 1249 项全部通过（1243 pass, 0 fail, 6 skipped），类型检查 0 错误。

- **[DOC-HOST-INPUT-CAPABILITIES: README 与新手引导标注各宿主输入能力矩阵]**：
  - **背景与原因**：
    - 针对评测子代理提出的“各宿主双向沟通能力不对等，部分宿主降级为只读”痛点，用户指示在 README 中明确注明各宿主能力矩阵；
    - 避免用户因 Qoder/Antigravity 无法双击注入文本对话而产生困惑。
  - **实现与整改**：
    - 在 `README.md` 第 5 节新增《各宿主交互与双向输入能力矩阵》对比表格，详述 DSH、Claude Code、Codex、OpenCode、ZCode、Qoder、Antigravity 的状态感知、审批卡片、MCP 角色工具与双向对话注入支持情况；
    - 明确解释 Qoder 与 Antigravity 专注于伴侣级工作状态解说、情绪动作映射、审批提醒和 MCP 工具控制，双向文本对话请直接在宿主窗口内进行；
    - 同步更新 `host-onboarding.ts` 中的宿主卡片描述备注（`note`），突出全宿主一键安装与各自特长。

## 2. 现场状态
- **Git HEAD**: `fa7cd0b`（`main` 分支原子化提交）
- **原子提交记录**:
  - `fa7cd0b docs: [DOC-HOST-INPUT-CAPABILITIES: README 与新手引导标注各宿主输入能力矩阵]`
  - `c2e2fc2 feat(model): [FEAT-MODEL-TEMPLATE-DAFISH: 将大肥鱼适配方案沉淀为内置标准模板]`
  - `6783313 docs(workflow): [FEAT-HOST-AUTO-INSTALL-ALL: 补全全宿主（Antigravity, Qoder, Claude, OpenCode）一键自动安装] 更新交接文档`
  - `c9e2f86 feat(onboarding): [FEAT-HOST-AUTO-INSTALL-ALL: 补全全宿主（Antigravity, Qoder, Claude, OpenCode）一键自动安装]`
  - `37a04f6 docs(workflow): [FEAT-HOST-HOT-REBIND: 宿主切换支持无缝热重绑，无需重启桌宠] 更新交接文档`
  - `6eac67c feat(runtime): [FEAT-HOST-HOT-REBIND: 宿主切换支持无缝热重绑，无需重启桌宠]`
- **运行环境**: Node.js v24.14.0, Electron 34.5.8, Windows 11
- **主工程仓库**: `D:/Frankenstein/Uta`
- **自动化测试状态**:
  - 核心应用单测: 1249 项全部通过（1243 pass, 0 fail, 6 skipped）
  - 插件单测: 124 项全部通过（124 pass, 0 fail）
  - 静态类型检查: `npm run typecheck`（Node & Web 双通过，0 错误）
- **打包约束**: 遵照用户指示无需运行 `npm run dist:zip`。

---
---

# Uta 全宿主一键自动安装补全交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-HOST-AUTO-INSTALL-ALL: 补全全宿主（Antigravity, Qoder, Claude, OpenCode）一键自动安装]**：
  - **背景与原因**：
    - 此前 Uta 的新人引导与连接设置仅为 Codex 与 DeepSeek-Harness 提供了自动化一键安装与状态校验能力，而 Antigravity、Qoder、OpenCode、Claude Code 均硬编码为 `autoInstall: false` 和 `plugin: manual`，用户只能对照说明手工拷贝文件夹或执行命令行，体验断层；
    - 用户确认需求：“P3的确是个问题，之前只对这两个做了自动安装，其他的需要补上”。
  - **实现与整改**：
    - **主进程宿主 Onboarding 安装能力补全 (`app/src/main/host-onboarding.ts`)**：
      - 新增 `installAntigravity()`：自动读取随包分发的 `uta-antigravity-plugin`，部署至用户全局插件目录 `~/.gemini/antigravity/plugins/uta-deskpet` 与工作区 `.agents/plugins/uta-deskpet`，即时生成并校验 MCP 工具与角色配置阶段；
      - 新增 `installQoder()`：自动读取随包分发的 `uta-qoder-plugin`，写入本地扩展缓存 `~/.qoder-cn/plugins/cache/local/uta-deskpet/0.1.0` 及 `~/.qoder` 全局目录，并配置生命周期 hooks；
      - 新增 `installOpencode()`：自动将随包 `uta-opencode-plugin/uta-opencode.ts` 部署至 `~/.config/opencode/plugins/uta-opencode.ts`，使 OpenCode 事件流与 MCP 立即就绪；
      - 新增 `installClaude()`：调用检测到的 Claude CLI 可执行程序（`claudeExe || claudeJs`），通过 `claude plugin marketplace add` 添加本地随包 `claude-marketplace`，并执行 `claude plugin install uta-deskpet@uta` 完成自动安装；
      - 完善 `detectOtherHosts()`：根据目标目录和插件配置检测 `pluginInstalled` 状态，为具备一键安装条件的宿主（Antigravity, Qoder, OpenCode, Claude Code）开放 `autoInstall: true`，并将插件阶段标记为“支持一键自动安装”或“插件已就绪”；
      - 强化沙箱与环境感知：将所有用户路径绑定到当前进程环境可感知的 `userHome = env.USERPROFILE || env.HOME || os.homedir()`，并在 `HostOnboardingDeps` 中开放 `claudeExe` 可选注入，确保单元测试沙箱隔离与环境无关性；
      - 更新 `unblockInstall()`：为全部支持自动安装的宿主解除安装锁限制。
    - **主进程 IPC 开放 (`app/src/main/index.ts`)**：
      - 移除 `onboarding-install-host` 与 `onboarding-unblock-install` 中硬编码的 `codex / deepseek-harness` 白名单限制，向设置窗口开放全宿主自动安装 IPC 调用。
    - **单测与全量回归验证**：
      - `app/tests/host-onboarding.test.cjs`: 新增 5 项专用自动化测试（Antigravity 拷贝部署、Qoder 扩展缓存写入、OpenCode 插件脚本复制、Claude Code 市场添加与安装指令执行、全宿主 unblock 校验）；
      - 核心应用单测: 1243 项全部通过（1237 pass, 0 fail, 6 skipped）；
      - 插件单测: 124 项全部通过（124 pass, 0 fail）；
      - 静态类型检查: `npm run typecheck`（Node & Web 双通过，0 错误）。

## 2. 现场状态
- **Git HEAD**: `c9e2f86`（`main` 分支原子化提交）
- **原子提交记录**:
  - `c9e2f86 feat(onboarding): [FEAT-HOST-AUTO-INSTALL-ALL: 补全全宿主（Antigravity, Qoder, Claude, OpenCode）一键自动安装]`
  - `6eac67c feat(runtime): [FEAT-HOST-HOT-REBIND: 宿主切换支持无缝热重绑，无需重启桌宠]`
- **运行环境**: Node.js v24.14.0, Electron 34.5.8, Windows 11
- **主工程仓库**: `D:/Frankenstein/Uta`
- **自动化测试状态**:
  - 核心应用单测: 1243 项全部通过（1237 pass, 0 fail, 6 skipped）
  - 插件单测: 124 项全部通过（124 pass, 0 fail）
  - 静态类型检查: `npm run typecheck`（Node & Web 双通过，0 错误）
- **打包约束**: 遵照用户指示无需运行 `npm run dist:zip`。

---
---

# Uta 宿主无缝热重绑与取消挂起审批交接（2026-11-02）

## 1. 事项与完成清单
- **[FEAT-HOST-HOT-REBIND: 宿主切换支持无缝热重绑，无需重启桌宠]**：
  - **背景与原因**：
    - 此前用户在快速设置或设置面板切换宿主（如从 Codex 切换到 Qoder/Antigravity）时，渲染层硬编码了 `window.location.reload()` 与 `api.reloadWindow()`，导致整个 Electron 窗口强制刷新、Live2D 模型重载与短暂黑屏；
    - 根本原因在于 `preload/index.ts` 中的 `window.utaAPI.petBinding` 仅在启动时同步读取一次，未随绑定变化实时更新；且 `active.ts` 未监听 `onPetBindingChanged` 事件，导致无法动态热切换宿主适配器。
  - **实现与整改**：
    - **预加载层动态绑定映射 (`app/src/preload/index.ts`)**：
      - `petBinding` 改为受控状态对象，内部通过 `ipcRenderer.on('pet-binding-changed')` 监听主进程广播，实时同步最新的 `binding` 状态。
    - **活动适配器热重绑 (`app/src/renderer/services/adapters/active.ts`)**：
      - 增加 `dynamicBoundHost` 与 `setBoundHostPreference` 接口；
      - 自动监听 `onPetBindingChanged` 事件，当宿主 ID 变更时自动调用 `switchActiveHost` 无缝替换活动适配器，释放旧适配器连接并启动新宿主；
      - 导出 `toHostId` 供组件热切使用。
    - **主进程审批安全熔断 (`app/src/main/runtime-bridge.ts`, `app/src/main/index.ts`)**：
      - 在 `RuntimeBridge` 中新增 `cancelPendingApprovals(hostId?: string)` 接口；
      - 在宿主切换或解除绑定时，自动取消旧宿主仍挂起的在途 `/approval/ask` 审批请求（返回 `cancelled`），避免旧宿主长时间挂起超时；
      - 在 `/approval/ask` 内部引入 `Promise.race` 与 `ctrl.signal` 监听，保证请求在客户端断开或取消时能够即时响应；
      - `validateApprovalRequest` 同步兼容 `host` 与 `hostId` 传参。
    - **渲染层解除强制刷新与状态同步 (`DeskpetStage.vue`, `QuickSettingsPanel.vue`, `ConnectionsDomain.vue`, `deskpet.ts`)**：
      - `DeskpetStage.vue`: 彻底移除 `switchPreference` 内的 `window.location.reload()`，改为调用 `switchActiveHost` 热切；
      - 并在 `onHostChanged` 回调中清除残留审批卡片（`store.clearApprovalRequests`），向新宿主推送当前模型控件与表情；
      - `QuickSettingsPanel.vue`: 移除 `reloadWindow` 倒计时与“重新加载”提示，改为“切换宿主”与即时热重绑反馈；
      - `ConnectionsDomain.vue`: 去除“桌宠正在重新加载”文案。
    - **单测与全量回归验证**：
      - `app/tests/runtime-bridge.test.cjs`: 新增 `cancelPendingApprovals` 在途审批取消与即时 `cancelled` 返回测试；
      - `app/tests/quick-settings-panel.test.cjs`: 更新测试契约断言，验证无重载热切；
      - `app/tests/ui-style-alignment.test.cjs`: 匹配 `switchActiveHost` 热重绑调用；
      - 全量测试 1238 项全部通过（1232 pass, 0 fail, 6 skipped），插件测试 124 项全部通过，类型检查 0 错误。

## 2. 现场状态
- **Git HEAD**: `6eac67c`（`main` 分支原子化提交）
- **原子提交记录**:
  - `6eac67c feat(runtime): [FEAT-HOST-HOT-REBIND: 宿主切换支持无缝热重绑，无需重启桌宠]`
- **运行环境**: Node.js v24.14.0, Electron 34.5.8, Windows 11
- **主工程仓库**: `D:/Frankenstein/Uta`
- **自动化测试状态**:
  - 核心应用单测: 1238 项全部通过（1232 pass, 0 fail, 6 skipped）
  - 插件单测: 124 项全部通过（124 pass, 0 fail）
  - 静态类型检查: `npm run typecheck`（Node & Web 双通过，0 错误）
- **打包约束**: 遵照用户指示无需运行 `npm run dist:zip`。

---
---

# Uta deskpet_play_animation 中文动作名与模型能力清单对齐交接（2026-11-02）

## 1. 事项与完成清单
- **[FIX-ANIMATION-NAME-VALIDATION: 放宽 deskpet_play_animation 中文动作名校验与能力清单对齐]**：
  - **背景与原因**：
    - 主进程 `runtime-commands.ts` 对 `play_animation` 的 `name` 采用 `sanitizeToken`（严格限制 `/^[A-Za-z0-9_-]{1,32}$/`），直接以 HTTP 400 拦截任何含有中文字符的动作名；
    - 然而桌宠端 `useStageModelLifecycle.ts` 暴露给宿主的能力清单中，向宿主推荐的动作名包括大肥鱼、DS 等模型的中文原生动作（如「脱捕」、「狗尾巴草打开」、「狗尾巴草关闭」、「抚胸」、「竖食指」等）；
    - 造成宿主通过 `set_preset` 可以播放对应动作，但走官方 MCP 工具 `deskpet_play_animation` 却恒被主进程校验拒绝报 400；
    - 即使绕过主进程校验，渲染进程 `useStageRenderLoop.ts` 原先只检查 `store.emotionAdapter.animations`，未传入 `store.modelCapabilities`，导致未能命中原生模型动作组（`caps.motionGroups`），直接丢弃动作。
  - **实现与整改**：
    - **主进程指令清洗放宽 (`app/src/main/runtime-commands.ts`)**：
      - 新增 `ANIMATION_NAME_PATTERN = /^[\u4e00-\u9fa5\u3040-\u30ffA-Za-z0-9_·\-@#\s.]{1,48}$/` 与 `MAX_ANIMATION_NAME_CHARS = 48`；
      - 新增 `sanitizeAnimationName` 函数，替代原有的严格 ASCII `sanitizeToken`；
      - 允许中日文字符、常见连字符、下划线、@符号（如 `Tap@Body`）、#序号（如 `脱捕#0`）与点号。
    - **运行时桥接能力校验 (`app/src/main/runtime-bridge.ts`)**：
      - 优化 `command.command === 'play_animation'` 的能力匹配逻辑；
      - 支持精确名称匹配、支持 `#索引` 前缀动作组匹配、支持不区分大小写回退匹配，杜绝 422 误报。
    - **渲染层动作解析增强 (`app/src/renderer/services/live2d/emotion-adapter.ts`)**：
      - 将 `getAnimationTarget(adapter, animation, caps)` 拓展为支持传入 `caps: ModelCapabilities`；
      - 当 `adapter.animations` 中未显式映射时，自动回退到 `caps.motionGroups`，直连原生动作组（如 `脱捕 -> { motion: { group: '脱捕', index: 0 } }`）；
      - 完整支持 `动作组#索引` 语法（包括大小写容错），支持通过索引直达多变体动作；
      - 覆盖不区分大小写的备用匹配。
    - **渲染主循环与调试入口接入 (`useStageRenderLoop.ts`, `useStageModelLifecycle.ts`)**：
      - 在 `useStageRenderLoop.ts` 消费 `pendingAnimation` 时，将 `store.modelCapabilities` 传入 `getAnimationTarget`；
      - 在 `useStageModelLifecycle.ts` 的 `deskpetTestAnimation` 调试函数中同步传入 `store.modelCapabilities`。
    - **宿主 MCP 工具契约更新 (`plugin/plugins/deskpet-mcp/server.mjs`)**：
      - 更新 `deskpet_play_animation` 的 Tool 描述与 Schema 说明，明确指引宿主 LLM 可以直接传入来自 `deskpet_get_capabilities` 的中文动作名（如 `脱捕`、`狗尾巴草打开`）；
      - 执行 `npm run plugin:build` 重新打包所有分发插件包。
    - **单测与全量回归验证**：
      - `app/tests/runtime-commands.test.cjs`: 补充中文原生动作（`脱捕`、`狗尾巴草打开`、`狗尾巴草关闭`、`抚胸`、`竖食指`、`Tap@Body`、`脱捕#0`）的白名单与边界校验测试；
      - `app/tests/control-activation.test.cjs`: 补充 `getAnimationTarget` 原生中文动作组解析、#索引语法解析、不区分大小写匹配的单元测试；
      - `app/tests/runtime-bridge.test.cjs`: 补充运行时桥接端点对中文动作命令的合法投递、422 拒绝与归一化测试；
      - `plugin/tests/mcp-server.test.cjs`: 补充 MCP 工具对中文动作名的直调测试；
      - 全套单测 1237 项全部通过（1231 pass, 0 fail, 6 skipped），插件测试 124 项全部通过，类型检查 0 错误。

## 2. 现场状态
- **Git HEAD**: `c8ded67`（`main` 分支原子化提交）
- **原子提交记录**:
  - `c8ded67 fix(runtime): [FIX-ANIMATION-NAME-VALIDATION: 放宽 deskpet_play_animation 中文动作名校验与能力清单对齐]`
- **运行环境**: Node.js v24.14.0, Electron 34.5.8, Windows 11
- **主工程仓库**: `D:/Frankenstein/Uta`
- **自动化测试状态**:
  - 核心应用单测: 1237 项全部通过（1231 pass, 0 fail, 6 skipped）
  - 插件单测: 124 项全部通过（124 pass, 0 fail）
  - 静态类型检查: `npm run typecheck`（Node & Web 双通过，0 错误）
- **打包约束**: 遵照用户指示无需运行 `npm run dist:zip`。

---
---

# Uta 动作工坊导出标准 Live2D motion3.json 动作文件交接（2026-11-01）

## 1. 事项与完成清单
- **[FEAT-WORKSHOP-MOTION3-EXPORT: 动作工坊分镜序列导出标准 Live2D motion3.json 动作文件]**：
  - **背景与原因**：
    - 用户希望学习 Jingyu 项目的核心能力，将 Uta 动作工坊中编排好的分镜动作一键导出为标准的 Live2D `motion3.json` 动作文件，使导出的动作可直接放入 VTube Studio、Cubism Viewer 或各类 Live2D 宿主中作为原生动作使用；
    - 针对此前的要求，日常开发验证专注于功能与测试（跳过耗时的 `npm run dist:zip` 打包步骤）。
  - **实现与整改**：
    - **标准动作导出服务 (`app/src/renderer/services/live2d/motion-exporter.ts`)**：
      - 严格依照 Cubism 3/4/5 Motion 规范构建 `Version: 3`、`Meta`、`Curves` 与 `Segments`；
      - 采用确定性采样插值（默认 30Hz，可选 15..60Hz），缓动曲线严格使用与 Uta 舞台运行时 100% 一致的 `easeInOutCubic` 公式；
      - 针对每个分镜步骤的 `durationMs`（过渡）与 `holdMs`（保持），自动烘焙平滑曲线；
      - 完整支持多阶段控件（如 `大小变:中`、`大小变:小`）的参数解析与平滑过渡；
      - 完整支持部件显隐过渡（自动生成 `Target: "PartOpacity"` 曲线）；
      - 自动过滤物理输出通道（`physicsOutputIds` 与 `isPhysicsOutput`），杜绝动作导入 VTube Studio 后与物理演算打架；
      - 自动过滤全程无位移/未修改的静态默认参数，保持生成的 `*.motion3.json` 动作文件极致轻量干净；
      - 支持三种收尾模式（`hold` 终态保持、`revert` 终态保持后平滑淡回待机、`loop` 循环动作标记）。
    - **主进程与预加载文件保存通道 (`app/src/main/index.ts`, `app/src/preload/index.ts`, `app/src/renderer/env.d.ts`)**：
      - 注册 `settings-motion-export-file` IPC 通道，提供带有 `*.motion3.json` 专用文件过滤器的系统原生保存对话框；
      - 自动清洗非法字符，规范化文件名命名（`dafish-bow.motion3.json`）；
      - 在 Web/测试环境中内置 Blob 自动下载兜底。
    - **工坊界面与用户交互 (`SettingsStudioTab.vue`, `SettingsPanel.vue`, `settings-workshop.ts`)**：
      - 在动作工坊操作栏（`studio-action-row`）中追加「⤓ 导出 motion3.json」按钮，采用 Blue Biophilic 设计系统样式；
      - 导出成功后自动在工坊顶部展示轻量反馈提示（`已成功导出标准 Live2D 动作文件：xxx.motion3.json`）。
    - **单测与全量测试覆盖 (`app/tests/motion-exporter.test.cjs`, `app/package.json`)**：
      - 编写 6 个核心测试用例：文件名规范化、easeInOutCubic 边界钳制、单步 revert 完整时序、物理与静态参数过滤、大小变多段烘焙、部件显隐 PartOpacity 与循环标记；
      - 接入 `app/package.json` 的 `npm test` 脚本，测试全部通过。

## 2. 现场状态
- **Git HEAD**: `dfae12e`（`main` 分支原子化提交）
- **原子提交记录**:
  - `dfae12e feat(workshop): [FEAT-WORKSHOP-MOTION3-EXPORT: 动作工坊分镜序列导出标准 Live2D motion3.json 动作文件]`
- **运行环境**: Node.js v24.14.0, Electron 34.5.8, Windows 11
- **主工程仓库**: `D:/Frankenstein/Uta`
- **自动化测试状态**:
  - 核心应用单测: 1235 项全部通过（1229 pass, 0 fail, 6 skipped）
  - 插件单测: 124 项全部通过（124 pass, 0 fail）
  - 静态类型检查: `npm run typecheck`（Node & Web 双通过，0 错误）
  - 生产构建: `npm run build` 成功（2.57s）

---
