# Soullink 与 AIRI：基于本地代码的 Live2D 研究

日期：2026-10-23。本报告讨论用户提供的本地快照；没有执行git pull、安装依赖、启动两个参考项目或评定实际画面质量。研究由Codex主控、Qoder/Soullink专项、Antigravity/AIRI专项共同完成，主控核实并裁决。两仓库版本不能用来推断未来上游状态。

## 1. 来源、版本与可验证范围

| 项目 | 本地HEAD | 状态与许可文件 |
| --- | --- | --- |
| Uta | `509e15b2e337be8dbaa6349b92346e611dc88223`（本轮研究基线） | 主目录三份既有脏文档未纳入；app声明GPL-3.0 |
| Soullink | `02cd75ac0a085a87d84d1a885f1b33eca8742d53`；包0.2.0-beta.1 | 原有`package-lock.json`脏改保留；根LICENSE为Apache-2.0 |
| AIRI | `c7c9c91791d92315736e5e8ebeaf6a66601655c1`；v0.12.0-beta.6 | 调查时工作树干净；根LICENSE为MIT |

外部Worker读取主控提供的23份/项目文本快照及Uta六份主要对照文件，来源/哈希在各独立任务区忽略的review-inputs/manifest.txt；不把整份外部源码复制入Git。Codex另查公开导出、实际renderer、AIRI版本catalog/补丁、表达式释放与应用接线，弥补快照限制。

证据等级：源码可见；业务接入可见；测试文件存在/已读；实际测试通过；GUI/音频验证。此次主要达到前三类，**没有运行参考项目的测试/GUI/音频**。不能把测试文件存在写成已经通过。

## 2. Soullink到底做了什么

### 连续情绪与语义通道

`packages/engine/src/runtime/SoullinkRuntime.ts:update`串起情绪、Idle、反应、语音、语音表现与手动层，经过MotionMixer、ActionUnitSolver、ModelProfileAdapter、私有参数overlay和参数平滑。`EmotionStateController`管理current/target/baseline与hold/衰减；VAD是Valence/Arousal/Dominance（效价、唤醒、支配度），不是语音活动检测。

Uta可吸收“持续情绪”和语义通道，让一次情绪有渐变/持续/衰退，而不是只靠6秒定时器。不能同时保留两条主情绪时钟，否则画面与语义状态可能分离。

### 混合与原生资源协调

`MotionMixer.ts`按通道与层设定add/max/set等规则；`LayeredParameterMixer.ts`主要负责参数指数平滑，**并非一个完整的资源租约/控制权管理器**。`NativeAnimationResolver.ts`将情绪映射为原生表情/动作，生成token和`suppressParamIds`。

主控补查`packages/live2d-pixi/src/Live2DRenderer.ts:applyNativeAnimation`：确有token去重、原生expression/motion调用、suppressed参数集合；beforeModelUpdate应用参数并记录渲染姿态。故不能因为Worker只拿到renderer README就断言“项目没有真正应用指令”。反之，这仍只是接入源码证据，没有本机画面验证。

适合吸收原生资源占用参数声明与只在状态切换时触发的思想。Uta的控制策略还需覆盖用户工坊/会话/模型生命周期，不直接照抄Soullink层顺序。

### 模型适配与覆盖率

`ModelProfile.ts`包括parameterMap、非线性变换/范围、neutral、自定义参数、私有情绪效果、native资源和映射。`AdaptationCoverage.ts`给覆盖/置信度诊断；`profile-generator/Live2DProfileAutoGenerator.ts`有启发式与可选远端生成、校准、源签名。

重要局限：`CapabilityDetector.ts`根据映射项存在推导能力，不能证明Core真有该参数；自动生成结果和缺能力时的fallback均需Uta真实参数白名单二次验证。生成器的默认模型目录写入方式不适合Uta多profile，需改为应用数据覆盖。涉及模型信息远端推断应独立显式开启，基础功能不依赖它。

### 语音与待机

`LipSyncController.ts`同时有无电平的程序路径和真实RMS/peak路径，带噪声门、attack/release与重音；`SpeechPerformancePlanner.ts`有语义手势/表情accent、曲线、运动预算与降动效策略。`IdleActionScheduler.ts`按能力/情绪选择种子化动作、避免连续重复。

Uta已有真实振幅口型，因此不重复整条链路。先研究节奏/预算/释放与句级配合。Soullink Runtime的`applyLipSyncMouthGate`在没有voicePlaybackActive时将mouthOpen归零；这会限制无语音惊讶开口等表现，不能作为Uta所有模型的无条件规则。

### 依赖与复用边界

Soullink renderer使用PIXI7.4.3 + pixi-live2d-display0.5.0-beta；Uta使用PIXI6.5.10声明 + display0.4.0声明。不是同一渲染接缝，不在本阶段直接替换。

engine声明ESM、sideEffects:false、无运行时dependencies。`src/index.ts`只导出public；`public.ts`提供SoullinkRuntime、SpeechPerformancePlanner、resolveNativeAnimation等，**并非所有内部类都有稳定包根导出**。例如ModelProfileAdapter等若走`/internal`就承担不稳定API风险。试验必须核对真正的exports和构建产物，不按文件名想当然import。

选型建议：先隔离纯引擎试验，对比引用稳定API、裁剪/移植纯逻辑、自有实现三条路径，再出ADR。引用/复制前记录版本、版权/许可/NOTICE与修改；模型和Cubism Core授权另行核对。本轮未复制代码、资产或新增依赖。

## 3. AIRI目前做到什么程度

### 渲染控制已经是明确的插件管线

`packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:useLive2DMotionManagerUpdate`提供pre/post/final阶段；`Model.vue`实际注册BeatSync/IdleDisable、IdleFocus、Expression、AutoEyeBlink、LightSquint、ManualControl、LipSync、BreathControl。

final不受handled跳过，顺序明确：例如先表情再眨眼乘性调制，再手动姿态和口型。`Model.vue`也会调整SDK breath/eyeBlink/expressionManager及部分idle视线曲线以避免竞争。可借鉴阶段与通道协调，不能把这些内部hook当跨版本稳定API。

### 模型/角色控制边界与释放

`contexts/live2d.ts:createLive2D`为每个Root创建独立expressions/motions，beginModelLoad/dispose清理；`controls/policy.ts`过滤角色允许的原生动作/表情，manifest可免WebGL静态检查资源。

`contexts/expressions.ts`有generation保护、定时恢复、预览和`activeLastFrame`释放：不再激活的参数会恢复modelDefault。它不是“没有释放、必然永久污染”。这也不代表Uta应一律恢复静态默认；Uta还有日常预设与实时基准，释放应回当前合法基准。

`stores/motion-control.ts`包含owner与exclusive控制，`motion-control-spring.ts`有半隐式欧拉、最大dt0.05与1/120小步、settled阈值。值得吸收中断/释放/收敛策略，保留Uta模型epoch边界。

### MAGIC已实际接入，但不是情绪语义理解

`packages/motion-driver-magic/src/fit.ts`选择VAR或AR-HMM训练/拟合固定采样运动序列；`model-driver-magic-live2d`负责归一化pose、固定频率生成、过滤与target释放。

业务接线在`packages/stage-ui/src/features/motions/live2d/use-live2d-motion-magic.ts`和`components/scenes/Stage.vue`：当Live2D选择magic且未暂停/未独占时初始化并start，切换/暂停/独占时stop。`skipMouthOpen`、`forceViewTarget`从设置传入，是可配置默认。

结论：AIRI已经超出仅播放固定motion的程度，具备基于运动序列的统计生成与可选舞台驱动；该模块本身不证明理解文本情绪，也不证明任意模型默认观感更好。Uta可后续用统一pose接口试验，首版先做好控制基础与确定性自然动作。

### 音频口型：有特征提取，Live2D主路径仍是单轴消费

`packages/model-driver-lipsync/src/live2d/index.ts:createLive2DLipSync`通过wLipSync提取并重映射AEIOU权重，`getMouthOpen`取权重最大值生成开合；`Stage.vue`的speechAnalysis链路实际接入该分析，轮询写mouthOpenSize；`motion-manager.ts:useMotionUpdatePluginLipSync`最终写ParamMouthOpenY。

该插件区分nowSpeaking与零音量停顿，结束有200ms释放尾和500ms闭合保护。适合借鉴“语音内部静音不等于释放”与结束交接；具体时长需按Uta模型A/B，不照搬为保证。

`apps/stage-tamagotchi/.../system-audio-lipsync.ts`另有系统音频驱动。存在元音权重API或系统音频类，不等于每个Live2D都有五个可驱动元音嘴形，也不等于当前桌面场景均已验证。VRM路径不作为Live2D能力证据。

### 版本事实

`pnpm-workspace.yaml` catalog中@pixi/core为`^6.5.10`、display为`^0.4.0`，Vue为`^3.5.41`、Pinia为`^4.0.3`；还有display本地patch。主控看到的patch片段涉及模型选择/资源路径，未宣称所有patch内容影响motion hook；仅强调需逐项核对，不能因版本号相同就保证内部行为一致。以上是声明范围，不是本机node_modules实际resolved版本。

## 4. 对Uta的取舍表

| 能力 | 决策 | 理由/前置 |
| --- | --- | --- |
| 连续情绪、语义通道、模型Profile | 优先 | 直接解决扩展性；需真实参数校验/用户覆盖 |
| 逐通道控制权、阶段写入、释放 | 优先 | 是动作/口型/表情共存的前提 |
| 种子化待机、动作预算与冷却 | 优先 | 可复现、不依赖网络，便于A/B |
| 原生motion/exp3协调 | 优先 | 充分利用模型已有美术资源与能力 |
| 句级语音手势与播放时钟 | 基础后实施 | Uta已有幅度口型，重点是协调与节奏 |
| 自动映射/覆盖率与手动校准 | 分两步 | 自动建议不等于映射真值，不能自动写模型目录 |
| MAGIC统计动作 | 后续实验 | 需要合适数据/表现对照，不替代语义导演 |
| 五元音、摄像头/系统音频、环境光 | 后续按需 | 取决于rig/设备/性能，不作首轮默认 |
| 整套替换renderer/工具链 | 不纳入本阶段 | 与Uta历史hook/模型/版本耦合过大 |

## 5. 主控对两份专项报告的裁决

Qoder报告的结构/所有权冲突提醒有价值；但“快照中未包含”必须限定为该Worker读取范围，不能说完整仓库没有测试/renderer；“增加performance层排在emotion下”“仅语音时允许mouthOpen”“固定60Hz”都是建议而非已批准设计。最终采用逐通道/逐阶段规则，以实际benchmark决定采样频率。

Antigravity初稿对版本、表情释放、弹簧稳定性有错误，且对潜在崩溃/观感使用过强语言。主控补资料并在同一确切会话要求修订；修订已撤回这些结论。最终不纳入与本次表现需求无关的网格处理讨论，也不宣称Uta现有hook完全不改SDK。

两个报告的原始stdout只在仓库外审计记录保留；本文件与本轮结果记录是可供后续Agent采用的审查版。架构决定以 [Live2D方案](live2d-performance-plan.md) 为准。
