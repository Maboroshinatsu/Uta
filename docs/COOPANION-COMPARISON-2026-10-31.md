# Uta 与 Coopanion：能力对比与借鉴建议

日期：2026-10-31。读者：Uta 产品与开发人员。对比对象为本机源码 `D:/Frankenstein/Coopanion`，提交 `04ce022a8c1e96e6053d9cbbe8f6dc555aa93f33`，主应用 0.2.5。Uta 为 `f98bbef` 加当前未提交 DSH 0.5.5 修复。比较源码行为与已存在的测试，不把文档宣称当作本轮实机验证。

## 结论

值得优先借鉴的是：**把互动交回宿主、减少高频状态打扰、让模型导入更容易、让角色实际能力及时被宿主知道**。这几项可以接在 Uta 现有结构上，对用户有直接价值。

Coopanion 把模型服务、Persona、Memory 和桌面 World 组装成完整 Agent。Uta 继续由外部宿主负责人格、记忆和任务决策；因此不把“自带 LLM/记忆/电脑操作”列成 Uta 必须补齐的功能。若希望使用这些能力，后续可把 Cortico 作为一种宿主接入。

Coopanion 工作区干净，但本地没有 `node_modules`，Cortico 子模块也未检出。本轮没有安装依赖、运行它的测试或启动它的应用，以下评价不涉及实际动画观感、识别准确率、延迟与长时稳定性。

## 功能对照

| 能力 | Coopanion 源码情况 | Uta 当前情况 | 建议 |
| --- | --- | --- | --- |
| 人格、记忆、模型推理 | Cortico/Persona/Memory 与模型 provider 组成 Agent | 交给绑定宿主 | 维持 Uta 的边界；可研究 Cortico 宿主适配 |
| 触摸、拖放等互动 | 合并事件，按回应模式唤醒或随下次活动附带给 Agent | 已有本地轻动作和固定短反馈 | 高优先借鉴事件回传与节流 |
| 桌宠提出问题并收回答 | `pet_ask` 立即返回，回答带 askId 异步回传 | 有审批卡、choice_hint 提示，尚无等价通用回答闭环 | 值得做，但要先有可靠宿主返回通道 |
| 工作状态展示 | 追踪工具调用，合并同类状态，正文优先，有最小停留时间 | 已有状态胶囊、意图解说和气泡策略 | 借鉴节奏和层级，先做体验对照 |
| 角色导入 | ZIP/文件夹暂存、找包、读清单、预检，再选中安装 | 模型发现、检查、切换、校准与工坊已有；普通用户导入闭环较弱 | 高优先补导入体验 |
| 角色动作语义 | 当前形象的 vocab、持续动作、移动目标与变化通知 | 已有模型能力、情绪/预设工具和能力查询 | 补能力版本与变更告知，保留当前控制系统 |
| 临时安静 | 定时覆盖音效/走动，到期解除，不改永久偏好 | 已有 30 分钟专注，按偏好恢复 | 扩展时长/作用范围即可，不再新建一套模式 |
| 本地语音识别 | sherpa-onnx，SenseVoice/Whisper，模型与运行时下载状态 | 本地服务/云端 STT、录音与密钥配置 | 可选的后续产品化投入 |
| 说话音效 | 根据音节播放声音银行，与气泡打字进度协调 | 已有 TTS、文本/音频口型 | 可做可选拟声模式，优先级低于真实语音闭环 |
| 提醒 | Agent 闹钟 set/list/cancel、持久化和错过标记 | 已有日常/项目待办、每日重复、推迟、完成和恢复 | 借鉴“查询/取消/错过说明”，复用现有待办 |
| 多屏与移动 | 底边走动、跨屏拖动、拔屏迁回、形象自定义移动 | 拖动/缩放和模型表现；真实混合 DPI 仍待验 | 先借鉴验收场景，自主走动另作选择 |
| OBS 透明输出 | 可选 overlay 页面和画面流 | 当前未见等价独立输出 | 有直播/录制需求时再做 |
| 自改外观与习惯 | 按设置项区分直接修改/先询问 | 角色动作控制较丰富，永久设置主要由用户修改 | 暂不扩成任意宿主设置写入工具 |
| 自动更新与多语言 | electron-updater、11 种语言及平台打包 | 当前首版目标 Windows，依靠候选/ZIP 流程 | 发行后独立评估，避免挤占可靠性收口 |

## 建议优先借鉴的四项

### 互动成为宿主可理解的事件

Coopanion 的 [world.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/world.ts) 中，`onTouch()/flushTouch()` 将同类互动在 2.5 秒内合并；回应模式决定该事件唤醒 Agent，还是等下一次活动一同送入。一次互动已唤醒后，后续互动不会持续触发新回合。相关用例位于 [world.test.ts](../../Coopanion/packages/cortico-world-desktop-pet/tests/world.test.ts)。

Uta 的 [reactToInteraction()](../app/src/renderer/components/DeskpetStage.vue) 当前主要执行本地预设和固定短句，已有忙碌让路与三秒节流。可增加一种可选、版本化的互动事件：类型、次数、发生时间、目标快照；由宿主决定回应内容，Uta 只立即给轻反馈。

实施建议：

- 默认先只保留本地回应；用户可给支持的宿主开启“互动也告诉宿主”。
- 先接明确点击/摸头和拖放完成；悬停不默认唤醒 Agent。短时间合并，宿主忙碌时只保留有上限的摘要，断线后不重放过时互动。
- 事件到来时锁定宿主/会话，切换后不送给新目标；无可投递会话就保留本地动作，不新增聊天任务，不改剪贴板。
- 不支持带外事件的宿主若只能发普通用户文本，必须单独标明会触发新回合，由用户选择；不能把它当作免费、无唤醒的背景上下文。

可见验收：连点三次只形成一份摘要；工作期间不打断；切会话/断线后没有补发给其他会话；宿主回复遵循原本的人设。依赖 [宿主适配方案](HOST-ADAPTATION-PLAN-2026-10-31.md) 的目标和投递规则。

### 角色导入有预检、预览和确认

Coopanion 的 [PackImporter](../../Coopanion/packages/cortico-world-desktop-pet/src/pack-import.ts) 会暂存 ZIP/文件夹、寻找清单、报告损坏项与同 ID 的已安装版本，再按暂存 token 安装用户选择项；[pack-import.test.ts](../../Coopanion/packages/cortico-world-desktop-pet/tests/pack-import.test.ts) 覆盖这条流程。

Uta 适合先支持数据型资源：Live2D model3 与 ImageSet。流程为“选择文件夹/ZIP → 检查主文件/贴图/动作引用 → 显示角色、体积、能力和问题 → 隔离预览 → 确认导入/启用”。取消和失败保留当前角色，不需要用户理解模型目录结构。

保留 Uta 当前路径检查、模型签名和用户数据隔离；导入写入当前 profile 的受控模型目录，不改原始模型。先完整复制并校验到临时目录，再以可回滚方式替换。Coopanion 的 `install()` 当前先删旧目录再复制，不把这个写入顺序当作 Uta 的可靠性模板。

Coopanion 形象包还允许运行代码，使用 [packs.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/packs.ts)、[server.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/server.ts)、[body-host.js](../../Coopanion/packages/cortico-world-desktop-pet/web/body-host.js) 中的沙箱 frame 与 CSP。Uta 此阶段不需要加载任意第三方 JS；将来增加代码型角色包时，单独设计 renderer 隔离和受限桥，不能直接在现有 preload 环境执行。

可见验收：普通 ZIP 和嵌套一层的 ZIP 都能识别；缺可选资源降级说明；坏主文件不能启用；同名覆盖有提示；复制失败/取消/重启后旧角色仍能用。

### 宿主知道当前角色真正会什么

Coopanion 的形象清单用 `vocab` 描述动作及持续属性，运行中的身体会报告实际识别的词；换形象后通过 figure 事件或工具回执告诉 Agent 能力增删。入口见 [packs.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/packs.ts)、[world.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/world.ts)、[script.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/script.ts)。

Uta 已经有能力查询、预设分组、真实 Core 检查和校准，这一项应增量完善：

- 每次模型加载/切换产生模型签名与能力版本；暴露当前实际可用的情绪、预设、动作、持续方式和停止方法。
- 宿主工具执行时同时检查当前版本；使用过期预设时返回“角色已更换，请刷新能力”，而不是声称播放成功。
- 宿主能接事件时推送能力变化摘要；只有 MCP 查询能力时，在后续工具回执提示刷新，不靠扫描宿主聊天文件注入说明。
- UI 的可读名称和模型参数 ID 分层，继续沿用现有模型安全门槛与口型优先策略。

可见验收：Live2D→静态立绘→另一模型后，宿主不会继续调用原模型专属动作；不支持的动作有明确结果；停止/换模不残留控制。

### 工作状态清楚，但不和对话争抢

Coopanion 的 [StatusTracker](../../Coopanion/packages/cortico-world-desktop-pet/src/status.ts) 按调用 ID 追踪状态并合并连续同类工作；[pet-app.js](../../Coopanion/packages/cortico-world-desktop-pet/web/pet-app.js) 让对话/聆听优先，思考延迟 0.6 秒出现、状态最少停留 1.2 秒、结束淡出。具体工具到可展示字段的映射在 [pet-status.ts](../../Coopanion/core/pet-status.ts)。

Uta 已有状态解说和优先级控制，可增加一轮相同事件脚本的体验比较：快速 read→read→read 合并为一次读文件状态，短思考不闪烁，等待用户与失败不会被普通进度覆盖，输入/语音/审批出现时让路，结束后只恢复仍有效的状态。

先沿用 Uta 已有白名单意图与工具名，不为了显示细节就把所有工具参数带到 renderer。若新增文件名展示，由宿主插件仅提取 basename 等有限字段并让用户可关闭；未知工具仍显示“处理中”。Coopanion 展示工具参数的做法不能直接扩展 Uta 当前信息边界。

可见验收：同脚本比较总气泡数、短闪次数与关键提示遗漏；文字输入/麦克风不被状态挡住；结束/切会话立即清理。数值先作为对照起点，根据 Uta 实际窗口和角色比例调整。

## 第二阶段适合考虑的能力

### 可以回答的提问气泡

Coopanion 的 `askUser()/onAnswer()` 使用 askId 关联答案、关闭与替换；工具立即返回，答案作为事件到达。旧问题的迟到回答会被忽略，见 [world.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/world.ts) 和对应测试。

Uta 可新增自己的异步问题卡：问题 ID、宿主/会话/轮次、选项、自由回答、期限与取消。角色工具得到“问题已展示”，用户作答才投递答案事件；工具不能一直阻塞等人。审批卡保持独立。

只给有正确返回接口的宿主开放；无法回答宿主原生表单时仍引导回宿主。不能将“往聊天发一段 A”标成“原生 AskUserQuestion 已完成”。优先用 Uta 自己的角色问题做闭环，再逐宿主接原生问题。

### 本地 STT 的安装与状态管理

Coopanion 的 [sherpa.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/asr/sherpa.ts) 定义本地识别器与状态，[runtime/store.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/runtime/store.ts) 管理运行时/模型下载、大小与哈希校验。它提供了普通用户能理解的缺失、准备中、可用、失败状态；本轮没有测识别准确率或耗时。

Uta 可选新增一个本地语音包，用独立子进程运行并复用现有 STT 接口，解决“本地服务地址从哪里来”。展示下载大小/进度/取消、缺磁盘空间和重试，按需加载/释放；不强制所有用户下载，不挤占桌宠 renderer。先 Windows 中文闭环，再评估其他语言和模型。

### 在现有专注和提醒上补齐细节

Coopanion 的 `pet_quiet` 使用临时覆盖，`alarm_list/cancel` 提供可管理列表，`takeDue()` 标明错过的提醒。参考 [world.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/world.ts)、[alarms.ts](../../Coopanion/core/alarms.ts)。

Uta 已有专注到期时间、每日重复、推迟和未处理提醒，适合补可选时长/当前剩余时间、启动后错过提醒说明，以及明确的提醒管理入口。将来宿主设置提醒时复用当前 daily-todo-store 的校验、原子保存与数据恢复，不复制一个平行 alarm 文件。

不照搬它以固定 24 小时推进每日闹钟的实现；Uta 的“本地每天几点”、跨日、时区/夏令时应有单独语义与测试。

## 可选项与暂不纳入的能力

- **拟声说话**：[speech.js](../../Coopanion/packages/cortico-world-desktop-pet/web/speech.js) 将音节短音与文字时钟协调。可作为无需 TTS 的角色音效，默认关闭，与真实 TTS 互斥并可随时打断；不能把它宣传成准确朗读。Uta 先完成真实语音闭环。
- **底边走动/拖拽物理**：更适合体积小、可走动的专门形象。Uta 的 Live2D 半身角色不能默认套用；若做，应由模型能力声明，工作/审批/输入时停止，先验证混合 DPI 和拔屏恢复。
- **OBS 输出**：[server.ts](../../Coopanion/packages/cortico-world-desktop-pet/src/server.ts) 的 overlay 和 host 画面流可作后续参考；Uta 只输出角色与授权气泡，不把它扩成桌面捕捉。先确认用户有直播/录屏需求。
- **自有 LLM、人格、记忆、完整 CUA**：继续由宿主提供，避免 Uta 同时成为另一套 Agent。Coopanion 的模型 provider 或 Persona 系统不作为 Uta 本轮改造对象。
- **自动更新、跨平台和 11 语言**：属于发行与平台专项，不能由“对方已提供”直接变成当前发布门槛。

Coopanion 仓库声明 AGPL-3.0-or-later，并含额外许可文字，见其 [LICENSE](../../Coopanion/LICENSE)。本文只记录能力和接口设计参考，没有复制其代码、音频、角色素材或模型；若后续移植代码/资产，按具体来源另行核对许可。

## 可选：把 Cortico 接为宿主

若用户希望“Coopanion 的人格与记忆 + Uta 的 Live2D 表现”，可以做独立的 Cortico World 适配，而不是把人格/记忆搬到 Uta：

1. World 向 Cortico 暴露 Uta 角色工具，调用本机 Uta 运行时；Uta 绑定专用宿主 ID。
2. 用户文本、互动与答案由 World 以 Cortico 原生事件送入已绑定会话；人格与记忆仍由 Cortico 管理。
3. 原桌面 pet World 可关闭，避免同时显示两只角色；其他 World 与原设置继续由宿主管理。
4. Core 的状态/输出只经公开 World 契约映到 Uta，不接控制台私有页面、不共用数据库。

这是后续可行性方向，不是已验证适配。当前 Cortico 子模块缺失，实际事件投递、工具注册、会话范围与生命周期需要先在对应版本的完整源码中核实，再做隔离 PoC。

## 推荐落地顺序

| 顺序 | 完整任务 | 理由与依赖 |
| --- | --- | --- |
| 先做 | 宿主目标/投递公共规则 + 真实收发 | 为互动回传和回答提供正确通道，见宿主适配方案 |
| 随后 | 模型导入闭环 + 能力变更告知 | 不依赖所有宿主同步升级，用户收益直接 |
| 随后 | 可选互动回传 + 状态节奏对照 | 增强陪伴感，保留忙碌让路，不增加 Uta 自有人格 |
| 条件具备后 | 提问回答闭环 + 专注/提醒细节 | 依赖宿主能力，复用现有 UI 和存储 |
| 独立专项 | 本地 STT 语音包 | 需要下载、子进程、资源和真实录音验收 |
| 有需求再做 | 拟声、走动、OBS、Cortico 宿主 | 不阻塞当前可靠性和发布收口 |

本轮对比不据此给两个项目打总分：Coopanion 的完整 Agent 能力更广，Uta 的多编码宿主适配、Live2D Core/工坊、待办和数据保护有不同侧重。后续选择以 Uta 用户旅程和既定产品边界为准。
