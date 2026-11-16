# Uta alpha.10 全面复审

日期：2026-10-25。审查对象：`D:/Frankenstein/Uta`，分支 `main`，源码基线 `18d18a25a3186d28bcdf16aca3c34f2821f44e94`。与上轮相比，重点追踪 `e2b768f..18d18a2` 的首次引导、安装、界面、动作栈和模型过渡，同时复查运行时、语音、工坊存储与打包。本文仅审查，不实施业务修复。

## 结论

本轮记录 **11 项可行动问题：1 项 P1、10 项 P2**。其中 9 项有生产模块/组件脚本/真实模板/回环 HTTP 的隔离探针支持，2 项为发布包和接入依赖的静态核对；缺少 Node 的问题按条件性接入缺口处理，没有假称做过干净机器安装。

产品方向比上一轮统一：首次流程、蓝色与暖纸色、动作栈、独立候选包和交接记录已经串起来。当前主要风险是**跨操作保留草稿、异步结果归属、安装进程生命周期，以及配置登记与真正可用之间的判断**。仍适合受控 Alpha 体验；不建议仅凭现有全绿测试提升为稳定版。

## 范围和验证

| 检查 | 本轮结果 |
| --- | --- |
| 应用 `npm test` | 878 项，873 通过、5 跳过、0 失败 |
| 插件 `npm run test:plugin` | 103/103 通过 |
| `npm run typecheck` | node/web 均通过 |
| `npm run build` | 通过；保留 Cubism 普通 script 无法 bundle 的既有提示 |
| 三份协议/设置/mixer 契约脚本 | 全部通过；不替代运行时范围与视觉验证 |
| 本轮独立检查脚本 | 11 项均得到所述现象；断言缺陷存在，修复时必须反转预期 |
| ZIP 校验 | alpha.10 SHA-256 与 manifest 一致：`0812fc7d613b1d2544c3bab818550a0c59f3b151cad7662f564e3e2295be21ff` |
| ZIP 源码 | `18986466457a50cb1bf8c2a26ca0bd89ebc53d49`，manifest `dirty=false`；当前 HEAD 另含文档提交 |
| 真实窗口 | 独立打包实例的主窗口和无障碍树可读；点击校验失败，未完成真实操作验收 |

证据在忽略目录 `D:/Frankenstein/Uta/.tmp/review-current-20261025/`，主要为 `probes.cjs`、`probe-results.json`、`probes.log`、`app-tests.log`。插件、类型和构建日志在该目录同级的 `review-current-20261025-*.log`。探针不是新的正式回归套件：模型/宿主、组件依赖使用受控替身；运行时探针实际启动独立回环服务，不连接日常实例。Vue 脚本级工坊探针的 `provide()` 警告来自未挂载 DOM 的测试方式，未用它证明真实画面。

## 必须处理的问题

### 1. [P1: 安装超时后解除互斥，允许尚未退出的进程并行写宿主配置]

位置：`app/src/main/host-onboarding.ts:577–581、595–599、627–657`；安装按钮 `app/src/renderer/settings-window/onboarding/HostStageCard.vue:115–122`。

触发：安装命令超时，`stillRunning:true` 表示旧进程没有确认退出。函数返回错误后，外层 `finally` 仍立即把 `installInProgress` 清成 false；前端也解除 busy，用户可以重新点击安装。

探针：第一次和第二次 `install('codex')` 都执行了市场写入命令，两次均返回“进程没有确认退出”。即已有防止自动回滚的保护，但仍会产生两个未确认停止的写入者。后一次安装还可能备份中间状态，或在失败回滚时覆盖另一写入者的结果。

建议：把“本次调用结束”与“写配置的进程退出”分开。未确认退出时保持安装隔离/阻断重试，提供明确恢复入口；确认停止后才能重新备份、安装或恢复。新增“超时未退出后连续重试”的回归。

### 2. [P2: 重开首次引导会销毁尚未保存的密钥和工坊草稿]

位置：`app/src/renderer/settings-window/SettingsWindowApp.vue:14–27、356–359`；密钥注销 `app/src/renderer/components/TtsSettingsSection.vue:529–541`、`SttSettingsSection.vue:375–388`；工坊注销 `SettingsPanel.vue:1537–1541`。

触发：在语音页输入未保存密钥，或在工坊修改未保存动作；切到关于页，再点“重新打开首次引导”。平时通过 hidden 保留的两个分区，都处在 onboarding 的 `v-else` 中。切换引导会卸载它们并注销未保存记录；窗口关闭提醒没有机会介入。

探针执行真实父组件模板和真实 `reopenOnboarding()` 函数，受控密钥/工坊子组件在重开后均卸载，未保存登记从 true 变成 false。源组件自身也确实在卸载时注销对应草稿。返回设置不能恢复组件本地输入。

建议：进入引导前复用保存/放弃/取消保护，或保持分区和草稿挂载；同时覆盖“重开引导 → 返回设置 → 关闭窗口”路径。

### 3. [P2: 切换模型会清掉未保存的工坊内容及撤销历史]

位置：`app/src/renderer/components/SettingsPanel.vue:779–807、1570–1578`；模型选择入口 `app/src/renderer/settings-window/domains/CharacterDomain.vue:237–252`。

触发：工坊编辑未保存时，通过角色选择器或快捷面板换模型。`modelUrl` watcher 无条件载入新模型 neutral；`loadPresetIntoEditor()` 调用 `markWorkshopClean()`，连撤销历史一起清掉。现有关闭保护覆盖不了这个入口。

真实组件脚本探针：原草稿包含名称和 `ParamAngleX:12`，换模型后变成“日常待机”，`workshopDirty=false`、`canUndo=false`。

建议：换模型前检查工坊草稿，保存/放弃/取消；或按模型保留独立草稿和历史。主设置与快捷面板的入口都要处理。

### 4. [P2: 会话列表的迟到结果会串到另一个宿主]

位置：`app/src/renderer/settings-window/domains/ConnectionsDomain.vue:412–438、474–499`。

触发：Codex 的会话读取尚未返回，用户切到 Harness；Harness 列表先返回，旧 Codex 请求后返回。`refreshHostState()` 已有序号保护，但 `refreshSessions()`、`selectSession()` 没有同类的宿主/请求归属校验。

真实组件脚本探针结果：当前宿主 `harness`，列表却为 `codex-old`，固定会话 ID 也被改成 `codex-old`。点击可能得到失效会话错误；本轮没有证据证明消息真正发往错误宿主，不能把显示串线扩大为已发生消息泄漏。

建议：捕获 hostId 和请求代数，返回时核对；切宿主时清理列表、固定 ID 与 loading；选择会话和路径查询也采用同样保护。

### 5. [P2: 静态立绘尚在挂载时就被判成切换失败]

位置：`app/src/renderer/settings-window/pet-executor.ts:102–105`；`app/src/renderer/composables/useStageModelLifecycle.ts:474–497`；`app/src/renderer/components/StaticStage.vue:221–235`。

Live2D→立绘切换先验证清单，再设置 `modelLoaded=false`、更换 URL。真正的 `modelLoaded=true` 由后续 StaticStage 异步挂载完成后设置；executor 在 `await switchModel()` 后立即要求该值为 true。

探针：有效立绘 URL 已切入，返回仍为 `{ok:false,error:'model-load-failed'}`。因此可能出现画面实际已切换，首次引导/角色页却报失败；成功分支的立即快照同步也被跳过。这是就绪回执边界问题，不是立绘文件损坏。

建议：让切换 Promise 等待新立绘的加载完成/失败信号，并关联加载代数；不要用旧 Live2D 的就绪检查提前评价新组件。

### 6. [P2: 工坊撤销和重做会把循环预设改成播完恢复]

位置：`app/src/renderer/components/SettingsPanel.vue:421–435`；循环选项 `app/src/renderer/components/SettingsStudioTab.vue:111–119`。

`applyWorkshopSnapshot()` 只恢复 hold 和 revert，任何 loop 快照都被强制改成 revert。真实组件脚本探针：保存 loop 基线，改名称后撤销，名称正确恢复，结束模式却变成 revert。之后保存会改变实际动作行为。

建议：按完整的 `PresetFinishMode` 枚举恢复三种合法值；补“loop → 编辑其他字段 → undo/redo → 保存 → 运行”的组件级回归，不能只测 opaque history 字符串。

### 7. [P2: 重复事件在首次投递完成前就被确认成功]

位置：`app/src/main/runtime-bridge.ts:398–410`；预留去重 `app/src/main/runtime-sessions.ts:51–94`。

当前 registry 把已成功提交和正在投递的事件都表现为 duplicate；HTTP 层一律返回 200、`accepted:true`。如果第一个请求仍在等待 sink，第二个同 eventId/seq 的请求会先收到成功；随后第一个投递失败，第二个也不会再执行。

真实回环探针：相同事件并发请求，第二个返回 200/accepted，首个随后返回 503，sink 调用 1 次、成功投递 0 次。它不否定之前“失败后可再次重试”的修复，但说明在途重复和已提交重复不能共用成功语义。

建议：在途同事件等待原请求结果，或返回明确的 pending/可重试状态；只有已提交事件才立即确认 duplicate 成功。增加原投递失败/超时的并发 HTTP 回归。

### 8. [P2: 停用的 MCP 配置仍会显示工具阶段已验证]

位置：`app/src/main/host-onboarding.ts:239–255、270–295`。

`mcpListed` 只对命令输出做 `/uta[-_]?deskpet/` 匹配，不解析条目身份、enabled 状态，更没有证明握手/工具加载。探针让插件和 MCP 都处于停用状态，插件阶段显示“需手动”，工具阶段却显示“已验证”。任意包含该名称的无关输出也可能命中。

建议：解析结构化输出并核对精确条目、启用状态；把“配置已登记”“握手成功”“当前会话工具已加载”分开。没有后一阶段证据时保持等待/未知，不显示绿色已验证。

### 9. [P2: 发布包里的其他宿主手动接入没有可执行材料]

位置：`app/src/main/host-onboarding.ts:367–400`；`app/electron-builder.yml:57–63`。

Qoder、Antigravity、Claude Code、ZCode、OpenCode 的手动步骤统一为“按 plugin/README.md 对应宿主的安装章节操作”。实查 alpha.10 解压包没有这个文件，随包插件目录也只有 `codex-marketplace` 和 `deepseek-harness`。新用户在卡片里找不到真实说明和所需产物，无法仅凭发布包完成操作。源码开发机的目录存在不等于发布包可用。

建议：随包提供对应材料和可打开的说明，或给用户可访问的安装页面/下载入口，标清支持范围。另把 Qoder/Antigravity 的“未检测到”改成“暂不支持自动检测”，因为其 exe 当前写死为空，并未真正扫描这两个宿主。

证据级别：发布目录与实际检测输出核对；没有在这些宿主上执行真实安装。

### 10. [P2: 自动接入没有检查 MCP 必需的 Node 运行环境]

位置：`plugin/plugins/codex/.mcp.json:4`；`app/src/main/host-onboarding.ts:260–288、508–624`。

随包 MCP 使用裸命令 `node`，自动接入只确认 Codex 和插件资源存在，没有校验宿主运行环境能否找到 Node，也没有随 Uta 提供可供该命令使用的独立 node.exe。安装了原生 Codex、但宿主 PATH 找不到 Node 的机器上，插件配置可以写入成功，MCP 启动仍会失败。

探针使用不含 Node 的受控 PATH，Codex 检测与自动安装入口仍被提供；发布包配置确认 MCP 命令为 node。**这是条件性依赖缺口，未在没有 Node 的干净机器上完整安装验证，也不声称本机当前缺少 Node。**

建议：检测实际用于启动 MCP 的运行环境；缺依赖时说明并阻断虚假成功，或随包提供稳定运行时并写入正确路径。安装验收至少包含一次进程启动/握手，不能只检查 plugin list。

### 11. [P2: 快捷面板和旧工坊的强调色文字仍可能难以辨认]

位置：`app/src/renderer/stores/deskpet.ts:190–191`；使用处如 `app/src/renderer/components/styles/settings-panel.css:327、575、637`。

设置中心的 `--uta-accent-text` 已按对比度选色，但旧体系 `--dp-accent-text` 仍用加权亮度阈值 0.64 选黑白。生产 store 探针选择内置“琥珀暖棕” `#c87137` 后仍得到白字，计算对比度约 **3.58:1**，低于项目设计规范给普通文字定的 4.5:1。自定义中等亮度主题也存在同类问题。

建议：两套变量使用同一套对比度算法，并检查正常/hover/选中/禁用状态；不能只修 `--uta-*`、遗漏 `--dp-*`。

## 界面、动效与工程评价

以下是继续打磨的建议，区别于上面有明确触发路径的缺陷。视觉评价参考本轮实际读取的主窗口，以及仓库已有的 alpha.10 设置/工坊截图；历史截图不算本轮重新操作通过。

| Before | After | Why |
| --- | --- | --- |
| 默认设置窗口首屏被角色信息和多排操作占据；动作编辑需要向下找 | 压缩角色摘要，把当前选中动作和主要编辑操作放到更容易看到的位置 | 动作栈是差异点，应减少到达它的步骤和滚动距离 |
| 两栏只在窗口宽度大于 1200px 时出现；默认窗口为 880px | 按编辑区实际宽度设计紧凑布局，评估可折叠侧栏、紧凑动作栈和持续可见的选中摘要 | 不应只在 2048 CSS px 的展示截图里验证主要编辑体验 |
| 动作栈用数组 index 作 TransitionGroup key（WorkshopKeyframeStack.vue:18） | 用稳定的编辑帧 ID，并验证删除中间帧/撤销后的焦点与移动 | 现在删除中间项时 DOM 身份跟随位置，退出动效可能落在末项；属于动效身份问题，未列为数据错乱 |
| `.pressable` 松开反馈为 520ms，另有 55ms delay（settings-panel.css:135–140） | 按交互频率缩短回弹，给键盘输入即时反馈；用实际录屏检查中断 | 连续点选工坊控件时，长回弹容易削弱直接感；本轮未通过真实点击确认手感 |
| 宿主内部路径、英文模型目录名、六阶段矩阵直接铺给新用户 | 先呈现“能否使用/下一步”，路径与矩阵放进诊断详情，优先显示友好模型名 | 能减少首次配置的阅读负担，保留需要时的排错能力 |
| 两套 `--uta-*`/`--dp-*` 配色和两套前台/宿主状态判断仍并存 | 共用色彩计算、依赖检测和状态契约，在旧组件迁移时分批收口 | 本轮的对比度和状态虚报都发生在重复逻辑之间 |

动效代码具备短过渡、减少动态、模型交叉淡化和旧模型释放的基础；本轮未发现足够证据证明 alpha.9/10 的特定过渡修复失败。但**动效部分不能给出完整通过结论**：真实连续操作与逐帧验证未完成，且上表的帧身份/长回弹仍需复核。先完成可靠的操作和草稿生命周期，再继续增加动效。

工程方面，现有大量测试、生产组件脚本测试、独立 profile、ZIP manifest 和阶段性交接值得保留；缺口是测试组合偏单点。opaque history 测试覆盖不了 loop 在组件恢复时被改写，安装单次超时测试覆盖不了后续重试，关闭提醒测试覆盖不了引导重开/换模型导致的卸载。应优先补这种跨操作测试，而不是以测试总数继续增长作为完成标准。

## 尚未验证与现场清理

- 启动本轮唯一自建打包实例：profile `review-current-20261025`，用户数据/运行时/端点均在本轮 `.tmp` 子目录，另设隔离 `CODEX_HOME` / `DSH_HOME`；没有覆盖 APPDATA，没有执行真实宿主安装，没有访问日常实例的 MCP 工具。
- 实际读取到了该实例主窗口和无障碍树。元素点击报告 `element 11 is not available in cached app state for Uta.exe`；坐标点击报告 `point (...) is over Uta.exe "Chrome Legacy Window", not target window Uta.exe "Uta [review-current-20261025]"`。激活并重新观察后重试仍被拦截，因此停止输入。没有使用 CDP 或其他自动化方式绕过校验；未把这一工具问题认定为 Uta 功能 bug。
- 未完成本轮真实首次引导、真实安装、键盘焦点、动效中断、声音与麦克风验收；未做干净机器、多屏/DPI、8 小时/7 天验证。既有截图/记录不是这些检查的替代品。
- 本轮自建主进程 PID `35248`，启动 UTC `2026-10-25T05:35:24.8205328Z`。首次清理因 JSON 日期转字符串导致精度丢失，被身份检查拒绝，没有停止进程；改为 DateTime UTC ticks 后核对路径与完整启动时间一致，再清理其进程树（子进程 `33020 / 38716 / 28148`）。本轮主进程和自建 endpoint 均已确认不存在；运行时探针服务在 finally 中关闭。
- 原有 `docs/AGENT-PORTABILITY-PLAN.md` 改动保留，不暂存、不纳入本轮提交。业务源码未修改；构建刷新忽略目录 `app/out`；没有替换用户的运行包或停止用户实例。

建议修复顺序：安装进程互斥 → 引导/换模型草稿保护 → 静态切换回执和会话迟到保护 → undo/redo 与在途事件确认 → 宿主接入材料/依赖/状态 → 色彩和实际动效验收。每一批用本轮触发路径验证修复，再把正确预期纳入正式测试。
