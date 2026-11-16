# 1.0.0 方案：代码事实、审阅范围与待验证问题

日期：2026-10-24；代码调查开始于2026-10-23。对应 [1.0.0主方案](../ROADMAP-TO-1.0.0.md)。检查起点为main提交 `b9dd3067a7d8814939939c2f0a9fa94c64ea158f`；工作区 `D:/Frankenstein/Uta-Workspace/tasks/codex-roadmap-1-0`，分支 `task/codex/roadmap-1-0`。本次是代码调查与方案编写，没有修改应用行为、启动验证实例、重新投递任务或发布程序。

## 1. 覆盖范围与限度

用户要求全面读项目再制定方案。本次对Git受控文件逐一读取、计算hash、统计行数，并对全部可识别文本做全文静态扫描；再对最新设置改动、数据保存、主进程权限、表现控制、语音、宿主与打包链路做重点代码审阅。**全文扫描不等于人工逐行语义审查，也不等于证明每行正确。本次没有完成全部95,839行的人工逐行语义审查。** 不把机器读文件、正则扫描或看测试标题写成已经人工理解每个分支。

逐文件清单：[roadmap-1.0.0-files.csv](roadmap-1.0.0-files.csv)。每行包含路径、类别、行数、字节数、内容SHA256、工作区修改标记、扫描层级和需要关注的副作用类别。清单对应调查开始时的426个受控文件，不含本次新增的方案文件。

| 文件类别 | 文件数 | 覆盖方式与用途 |
| --- | ---: | --- |
| 应用源码/界面 | 117 | 全文静态扫描；重点审读设置、主进程、store、renderer启动、模型控制、口型与新mixer |
| 宿主插件/文档/清单 | 51 | 全文扫描协议、端点、hook/MCP、平台安装/构建职责；重点审读共享客户端、环境、协议、能力与主机调用 |
| 测试与fixture/support | 72 | 全文扫描测试入口与用例声明；重点检查新设置测试是否执行实际组件、DS真实样本跳过条件、mixer用例边界 |
| 配置/根文档/脚本 | 26 | 全文扫描；重点审读构建、开发profile、ZIP、许可证、协作和启动规则 |
| 工程文档 | 94 | 全文扫描与主题/状态索引；重点比较CURRENT、近期交接、产品/Live2D方案、任务与交付记录的矛盾 |
| Soullink实验 | 19 | 全文扫描；审阅ADR与主控修正结论，作为选型证据，不当作产品已接入 |
| 锁文件 | 1 | 内容/hash/结构登记；不把依赖锁的每行当自有实现审查 |
| 第三方Cubism运行时 | 1 | 版本/版权/文件身份登记；未反编译或逐行审计压缩第三方库 |
| 模型资源 | 30 | 内容与结构/资源身份登记；二进制与纹理无法当代码逐行审查 |
| 其余图像/图标二进制 | 15 | hash/大小/用途登记，不作画面或许可完整性背书 |

总文本行数95,839包含锁文件和模型JSON。应用源码约36,166行，插件类约8,235行，测试约16,918行，工程文档约8,269行。行数以LF切分统计，末尾换行可能产生空行，不用于生产率评估。静态提取的751条test/it声明也不是运行中的测试数量，循环生成与suite嵌套会导致差异。

排除：`.git`对象、node_modules、out/dist/release/build、仓库外个人配置和日志、凭据、正式模型内容、参考项目完整仓库的再次审读。DS依据已有受控快照与本机研究记录；AIRI/Soullink依据当前仓库的登记研究与实验，没有宣称本次重新逐行审阅其完整上游。四份原有未提交文档只作输入，不纳入本次提交。

## 2. 目前可确认的起点

- main已含Qoder/Antigravity两项合入，以及后续设置入口/六领域工作区接线和桌宠仅托盘行为。调查时main为b9dd306，不能继续使用040194a时代的“任务正在运行/窗口未实现”作为当前事实。
- `app/package.json`仍为0.1.1；正式登记程序仍来自dcf1b3f。源码有新功能不等于用户的日常exe已经更新。
- `CURRENT.md`最近记录应用571项、566通过、5跳过；此前插件104项通过。**本次没有重跑上述测试或构建。** 五项跳过来自真实DS样本输入条件，不是五项通过。
- 读取Qoder保留的设置截图：语音页为Bento，角色页嵌入旧SettingsPanel，内部仍有“状态预设/预设工坊/面板设置”导航。这解释了设置功能已集中但分类仍重复的现状。
- 截图与既有真实Electron记录使用Hiyori；不能据此证明新mixer已经改善DS表现。项目内搜索没有找到生产控制路径调用 `createPerformanceMixer`；inspection仅调用profile，尚未与实际stage接线。

## 3. 优先处理的代码问题

下表把“源码直接可见的缺口”与“需要运行验证的风险”分开。它们是后续任务的输入，本次没有偷偷修代码。

| 完整事项 | 代码位置（调查版本） | 事实与影响 | 主方案安排 |
| --- | --- | --- | --- |
| 正式模式的新设置窗口不可用 | `main/index.ts:1405`、`settings-ipc/lifecycle.ts:28`、`SettingsWindowApp.vue`启动分支 | stable不创建新store，客户端为legacy且无公开document，设置页不能进入正常编辑。CURRENT也明确登记为发布阻断 | SET-04迁移和正式模式开放 |
| 设置远端冲突判断顺序错误 | `settings-window/SettingsWindowApp.vue:521`附近`syncFromDocument` | 先把currentRevision赋为doc.revision，随后比较两者是否不同，条件无法成立；dirty又比较客户端最新快照，未保留打开时基准。普通远端更新可能被误当本地草稿，新冲突却不提示 | SET-01实际组件/状态逻辑修复 |
| 保存回执可能覆盖后续编辑 | 同文件`saveChanges`成功分支约615行 | 请求结束后整体重置draft为返回document，没有字段编辑代次。保存中的新输入可能丢失；最终是否可复现须实际组件慢响应测试 | SET-01逐字段保存与慢响应验收 |
| 新旧表单与保存方式重复 | `SettingsWindowApp.vue`语音域、`TtsSettingsSection.vue`、`SettingsPanel.vue` | 新页草稿显式保存，内嵌旧页Pinia即时写；同页有多套provider/音量/开关，顶部保存按钮无法代表全部配置 | SET-02去重和保存说明 |
| 设置窗口试听权限链路不完整 | `main/index.ts:1875`、`services/tts.ts:332`、`TtsSettingsSection.vue:403` | 设置页直接调用previewTts，最终tts-synthesize仍只接受宠物sender；previewTts对HTTP/云端异常只记console并resolve。可见界面缺少可靠错误信号。需真实有声重测 | SET-03受限试听接口，VOICE-01错误回执 |
| 设置指令先报成功 | `settings-window/pet-bridge.ts:43–79` | 多个handler发起`void send`后立即true；模型快照主要在初始化和设置内换模时获取。宠物离线、超时或外部换模时容易显示过时/虚假结果 | SET-03等待回执、模型身份与快照同步 |
| 编辑锁清理依赖页面事件 | `pet-bridge.ts:82–102`、`DeskpetStage.vue`set-edit-lock分支 | pagehide发送解锁是best effort，未看到主进程按编辑owner/窗口销毁主动回收的完整机制；崩溃后是否残留须复现 | SET-03窗口归属与强制回收 |
| 新mixer没有进入生产渲染 | `services/performance/mixer/index.ts:458`与生产import搜索；`useStageRenderLoop.ts`旧口型路径 | 纯函数有测试，但仍由loader三层参数栈/旧控制器实际写Core。不能把内核交付算成画面提升 | LIVE-01/02实际模型接线 |
| mixer输出不能整包写Core | mixer`composePhase`约384行、pre/post约711行；loader参数栈 | 无活跃贡献也会输出可用通道base/neutral；post从pre结果继续计算，没有采样SDK实际更新后的状态。直接每帧写全部值会有覆盖原生/物理的风险 | LIVE-02只写已接管通道，确定实际更新阶段 |
| mixer接线前需补长期生命周期约束 | mixer`step`约508行、stateNowMs、deadLeases/latestGenerationByOwner | tick身份变化即接受重置（未判断身份是否倒退）；TTL随截断模拟时钟推进；owner历史缺少长期容量策略。纯模块有确定语义，但生产外层必须明确权威身份和休眠策略 | LIVE-02短项澄清、上限与真实旧事件测试 |
| 部分UI测试验证了另一份算法 | `tests/settings-window-integration.test.cjs:282,340` | 测试自己重写dirty与onRemoteChanged，而不是运行实际SettingsWindowApp；其中远端处理顺序也与页面不一致。这些用例通过不能排除页面上述问题 | SET-01替换/补充实际组件行为测试 |
| 发送者注释与实际边界不一致 | `main/index.ts:1529`、`isTrustedUiSender:1332`、部分无event校验的handle | `isRuntimeSender`仅比webContents，未检查注释所说主frame；公开设置已有更严格检查。不是已证明有远程利用，而是权限策略不统一 | QUALITY-03逐IPC矩阵与真实iframe/导航拒绝测试 |
| 设置命令深层输入较宽 | `shared/settings-command-contracts.ts`；Stage的sliders/controls赋值 | command顶层白名单已有，但step、preset、controls等仍为unknown/Record/数组再强转；缺少完整深度/条数/枚举限制，跨版本/坏数据可能到达模型层 | SET-03最必要校验，QUALITY-03系统检查 |
| 运行环境名固定、轻量加载表述过强 | `SettingsWindowApp.vue:442`；`renderer/main.ts:3–6` | profileName固定“开发环境”；main仍静态导入App/PIXI。没有创建第二模型不等于只加载44KB设置chunk。历史交付文档的零加载说法不能原样用于发布 | SET-02真实环境信息，QUALITY-02按实际测量优化 |
| 宿主调用依赖开发机路径 | `main/host-bridge.ts:56–63` | DSH/OpenCode/ZCode/Node等有固定D盘/系统路径；本机可用不等于用户电脑可用 | HOST-03普通电脑命令发现与安装验证 |
| 模型分发和旧文档口径不一致 | README、THIRD_PARTY_LICENSES、`docs/models/ds-control-baseline.md`、builder配置 | 用户已确认DS基础分发方向，旧根文档仍写不分发；受控快照不在默认构建输入，不能声称包已有DS。模型包含源编辑文件等资源也应按用途整理 | SHIP-01资源包/清单，SHIP-02文档统一 |

### 重要的“已有能力”，避免重做

- settings-store已具备原子写、备份、revision、来源导入与队列，不应另造第三套通用存储。
- settings-client与Pinia已有跨连接隔离、逐字段编辑代次等保护；设置窗口草稿控制应复用其可靠部分，不回退成全量覆盖。
- loader/原生表情释放包含针对savedParameters和累加漂移的处理；换控制路径前要理解并保留这些修复。
- 模型生命周期已有加载序号、丢弃旧候选和失败保留旧角色的路径；新的Profile/预览与快照身份要接在这里，不另起加载器。
- 真实音频包络与播放时钟、TTS队列取消、回复去重和流结束保护已存在。先完成窗口/播放/新控制交接，避免重写音频系统。
- Runtime v2、端点显式目标不回退、会话过滤与五个MCP工具已存在；当前重点是可解释的连接流程和真实平台验证。
- ZIP打包已检查源码干净、记录来源和hash；缺的是新版本数据与完整候选验收，不是再造一个发布工具。

## 4. 文件族与后续责任

清单中所有426个文件都有身份登记，以下按职责分组，避免把计划只建立在少数入口文件上。

| 文件族 | 现有职责 | 1.0.0处理方向 |
| --- | --- | --- |
| main/index、preload、settings-ipc | 环境/窗口/IPC/系统权限/跨窗口转发 | 设置与试听可靠性优先；按职责分离启动、窗口、权限、服务注册 |
| main/settings-store、shared settings | 文档校验/原子写/迁移/版本与通信类型 | 复用内核，补来源收集、正式迁移、草稿冲突与用户恢复 |
| main/runtime-*、plugin/shared | 本机协议/会话/端点/角色指令 | 多实例身份、目标隔离、版本兼容、回执与错误说明 |
| plugin/plugins各宿主、plugin/scripts | 平台hook/MCP/原生接入及自包含打包 | 四平台逐项验证，安装引导；额外宿主保持已有功能与真实限制 |
| main/host-bridge、renderer adapters | 反向输入、平台选择/注册/探测 | 删开发机假设，区分选择/在线/绑定/支持能力，不自动换目标 |
| main tts/stt、renderer tts/mouth/reply | 服务请求、密钥、播音、去重和口型 | 试听回执、有声失败/取消、普通配置统一、实际播放驱动 |
| services/live2d、stage lifecycle | 加载/发现/适配/参数/资源/命中 | Profile接线、模型身份、真实范围与逐通道旧写入退出 |
| performance profile/inspection/mixer | 纯能力与贡献计算 | 可见观察面板、实际渲染适配、生产时间和资源生命周期 |
| stage render、motion/expression/preset composables | 每帧写入、优先级、预设与释放 | 保留现有修复，小通道试接，再原生资源和旧预设兼容 |
| companion、narration、agent controller | 状态解说、待机与任务行为 | 单一工作状态、连续情绪、克制动作、去重/冷却/安静模式 |
| settings-window、SettingsPanel/Tab/Studio/States | 新窗口与旧完整编辑工具 | 去重、领域边界、等待回执、预览owner、撤销/保存 |
| settings-v2组件、tokens、旧CSS | Bento展示和旧样式 | 保留已确认方向，逐页统一；不再引入另一套UI库 |
| App/Stage/ChatBubble/Approval/QuickInput/StaticStage | 用户可见角色与消息/审批/输入 | 尊重窗口隐藏、焦点、长文本/IME，静态立绘回退和无后端使用 |
| stores、model-config、render-fps、plugin settings | 运行视图与历史偏好 | 列字段归属、拆持久与瞬态、减少双窗口复制状态 |
| services/media、settings-preview、VoiceSettingsPage | 早期预留接口和独立mock | 标明用途，避免接出第三套语音主链路；确认无引用后清理过时入口 |
| experiments/soullink-engine | 只读参考与选型证据 | 保留可复现实验，按需做公共engine对比，不直接进入默认路径 |
| tests/fixtures/support与脚本测试 | 单元/行为/集成与模拟输入 | 区分真实模块/替身/实际Electron/有声/最终ZIP，补真实组件而非复制实现 |
| public模型/图标/Cubism、许可证 | 资源与授权 | DS子包、署名与来源，排除编辑工程/个人数据；不改上游许可 |
| builder/vite/开发与任务脚本 | 构建、环境隔离与本机交接 | 明确单一体验入口/候选ZIP；通用无人值守runner移出1.0主关键路径 |
| docs与根README | 使用说明、历史研究和协作 | 一个主计划，一个当前进度；历史留日期；面向用户的说明不用内部术语 |

## 5. 证据边界与下一步

本次代码调查没有运行新的应用测试、模型、音频或Windows窗口实验。此前失败的Codex临时Electron harness不是本次的成功证据，也不应继续作为主计划前置阻塞；Qoder后续已有真实窗口记录可用于确定起点，但不能覆盖尚未验证的保存竞争/DS/有声/ZIP场景。

新任务的第一步应核对当时main、正在使用的体验实例与用户已确认的成果，再执行主方案第9节的第一轮。规划不批准立即改写正式用户数据，不预填未来任务hash，也不把待审问题写成已经修复。
