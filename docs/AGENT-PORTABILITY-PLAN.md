# 前端可移植与 Agent 插件化方案

- 日期：2026-10-10（Asia/Shanghai）
- 状态：**架构规划与落地路线（2026-10-10 用户已授权开始实施升级；本次选择的首批范围为 DP001/002/004/watchdog，跨宿主可移植规划分批推进，不声称整套已完成）**
- 基线：现有 Vue 3 + Pinia + PixiJS/Live2D + Electron 前端。
- 目标宿主：Codex；DeepSeek Harness（用户已确认为 DeepSeek Harness）；未来其他有公开扩展接口的 Agent。
- 最新决策基线（2026-10-10）：
  1. 目标宿主确认为 **DeepSeek Harness**；
  2. 所有宿主（Codex、DeepSeek Harness 等）均统一以**桌面应用**进行验收；
  3. **审批提醒**与**完成提醒**为伴随插件必须功能，审批动作本身严格留在原宿主；
  4. 分发采用**轻量宿主插件 + 配公共 Runtime（桌宠独立运行时）**；
  5. TTS 默认关闭，按会话显式开启，云端 TTS 另行授权。
- 边界：不替代宿主 Agent，不绕过审批，不承诺读取所有会话，不默认支持双向输入。

相关文档：[规划索引](D:/Frankenstein/maibot-deskpet-plugin/docs/UPGRADE-ROADMAP.md)、[问题台账](D:/Frankenstein/maibot-deskpet-plugin/docs/ISSUES-2026-10-10.md)、[插件本体升级](D:/Frankenstein/maibot-deskpet-plugin/docs/PLUGIN-UPGRADE-PLAN.md)。

## 1. 产品定位：Agent 的桌面伴随插件

用户应能在现有 Agent 中继续工作，而桌宠按授权提供：

- 工作中、调用工具、等待用户处理、已结束、失败、中断等状态表现。
- 当前选中会话的结果气泡与可选语音播报。
- Agent 显式调用的表情、动作和通知工具。
- 在宿主支持的前提下，把用户主动输入的文字/语音送到明确选中的会话。

桌宠不负责：模型选择、推理循环、执行代码、修改工作区、代替用户审批、绕过宿主工具政策。

**“显示 Agent 在工作”不等于获取内部思维内容。**只使用宿主公开状态和可展示消息，不索取、不保存、不播报隐藏推理。

## 2. 选择运行形态

### 决策 ADR-01：独立桌宠运行时 + 宿主侧薄插件

```text
Codex：本地插件 / MCP 工具 / 受信任生命周期回调 ─┐
DeepSeek Harness：原生宿主插件 ────────────────┼─ 宿主适配层
MaiBot：现有 SDK 插件 + WS ──────────────────┘       │
                                                  ▼
                                     标准事件、会话范围、权限检查
                                                  │
                                                  ▼
                                      桌宠核心控制器与 UI 状态
                                                  │
                                  ┌───────────────┴───────────────┐
                                  ▼                               ▼
                              Live2D 渲染器                    静态立绘渲染器
                                  └───────────────┬───────────────┘
                                                  ▼
                                     Electron 平台能力 / 可选网页面板
```

为何优先选它：

1. 保留现有透明、置顶、拖动、穿透的桌宠形态。
2. 不要求宿主给出可任意注入 Vue 或创建原生窗口的接口。
3. 同一运行时服务多个宿主，宿主插件只承担事件翻译和授权连接。
4. Agent 安装插件，不等于宿主会自动分发/安装 Electron 可执行文件；初期明确为“两件套”。

备选形态：宿主支持网页面板时，复用角色渲染和聊天组件做嵌入式视图；这是附加入口，不能宣称等同桌面窗口。移动端不是首期目标。

## 3. 接入分级，避免把插件能力混为一谈

| 等级 | 能力 | 要求 | 首期 |
|---|---|---|---|
| L0 角色工具 | 显式显示气泡、设置表情、执行受支持动作 | 宿主能调用扩展工具，用户已配对桌宠 | 必须 |
| L1 状态观察 | 工作、等待、失败、结束通知 | 宿主提供可用的生命周期/事件入口 | 必须，缺事件时降级 |
| L2 内容展示 | 当前会话公开回复、可选 TTS | 宿主公开消息通道 + 用户按会话授权 | 可选，不抓日志补洞 |
| L3 双向输入 | 把输入送入选中宿主会话、显式取消 | 宿主公开输入 API + 明确会话关联 + 授权 | 单独阶段 |
| L4 内嵌视图 | 宿主内展示角色组件 | 宿主公开 UI 扩展点、资源/媒体权限 | 后续 |

MCP 工具接入只解决 Agent 调用桌宠的一个方向。不能据此推断桌宠自动获得宿主完整消息流、会话列表、输入权或审批权。

若宿主仅支持 L0，就诚实显示“工具模式”，不要用持续询问 Agent 的方式模拟可靠的生命周期。

## 4. 公共运行时的边界

### 4.1 Deskpet Core

职责：会话事件归约、状态机、表情与动作调度、消息关联、通知策略、取消和清理。

约束：

- 不 import Electron、MaiBot SDK、宿主 SDK、Vue/Pinia 或 Node 文件系统。
- 不读取 localStorage，不打开网络，不启动子进程，不访问麦克风。
- 时间、随机、资源加载、日志和媒体能力由构造参数注入，可用 fake clock 测试。
- Store 是核心状态的 UI 投影，不是网络和音频副作用的入口。

### 4.2 HostAdapter（宿主适配器）

职责：建立受信任连接、声明能力、将宿主事件映射为内部事件、处理允许的反向命令。

拟议操作：connect、disconnect、getCapabilities、subscribe、sendInput（可选）、cancelTurn（可选）、dispose。

不负责：角色表情的具体参数、窗口行为、播放音频、任意文件访问。适配器不得直接依赖 Pinia 或调用 window.electronAPI。

将当前 useWebSocket 拆为 Transport + MaiBotAdapter；Chimera 现有名字可暂时保留兼容导出，但不作为通用架构概念。

### 4.3 Renderer（角色渲染器）

拟议操作：prepare、commit、dispose、getCapabilities、setEmotion、playAnimation、stopAnimation、setSpeaking、setTransform、setPointer。

- prepare 不把旧模型删掉，commit 才更新当前可见实例。
- capabilities 包括可用情绪、动作、循环支持、嘴型驱动方式。
- 每个操作有 applied / unsupported / cancelled / failed 结果；不要收到指令就报告执行成功。
- Live2D 与 ImageSet 共用控制接口，不要求两者表现能力相同。
- modelRefW/H、参数恢复、动画句柄、监听器均属于实例。
- 保留现有 adapter/imageset JSON 格式，未来扩展新增 schemaVersion，不静默改语义。

### 4.4 PlatformBridge（平台能力）

拟议能力组：window、pointer、hotkey、screenCapture、modelCatalog、assetResolver、preferences、credentials。

- Electron 实现位于 main/preload；渲染进程经白名单 IPC 调用。
- Browser 实现支持用户选文件/受控资源服务，不假装能扫描任意本机目录。
- 禁用能力的返回应是明确 unsupported，而不是可选链后什么都没发生。
- OS 特有调用只在对应实现中出现；“UI 可运行”和“全部桌面功能可用”分开验收。
- 通用 Agent 模式启动不要求 Python、SenseVoice、GPT-SoVITS、MaiBot。

### 4.5 媒体提供器

- VoiceInputController 负责录音状态，不知道最终宿主是谁。
- STTProvider 可为本地桥、宿主公开能力或其他用户配置实现；无 provider 时禁用语音转写。
- SpeechController 管理文本到语音任务、排队、取消、去重和嘴型状态。
- TTSProvider 不绑定具体云模型；本地/云端均可选，默认不开启云端传输。
- 截图是单独的高敏感平台能力，不属于“发送普通文本”的隐含步骤。
- MaiBot 本地服务管理是一个产品扩展，不装进 Core，不强制每个 Agent 用户安装全部语音资源。

## 5. 拟议事件契约 v1

**以下是本项目拟议协议，不是 Codex、Harness 或 MCP 的现有 API。正式实现前需要 JSON Schema、限制值和契约测试。**

### 5.1 标识与消息信封

- protocolVersion：内部协议主/次版本。
- connectionId：一次已认证连接；重连重新分配。
- hostInstanceId：宿主实例，防止两个同类型 Agent 混淆。
- sessionId：宿主原始会话 ID，经适配器规范化但不丢映射。
- streamId：事件流及其 epoch，重启不能复用旧序号空间。
- eventId：去重用稳定 ID。
- seq：同一 stream 中单调递增；跨宿主不建立虚假全局顺序。
- turnId / messageId：可选但有真实来源时必须保留；缺失时标明 unsupported，不能伪装为可关联。
- correlationId：针对用户发出的命令，用来确认 accepted/completed/failed。
- timestamp：统一 UTC ISO 8601，用于显示，不作为唯一排序依据。

完整示例：

```json
{
  "protocolVersion": "1.0",
  "connectionId": "pair-20261010-01",
  "hostInstanceId": "codex-local-01",
  "sessionId": "session-demo-01",
  "streamId": "events-epoch-01",
  "eventId": "event-42",
  "seq": 42,
  "turnId": "turn-demo-03",
  "type": "turn.state",
  "timestamp": "2026-10-10T08:00:00Z",
  "payload": {
    "state": "working",
    "source": "host-event"
  }
}
```

示例 ID 是演示值，不要求任何宿主使用该命名。缺乏真实 turn ID 的 hook 只能产生 session-scoped 状态，不应凭本地计数声称可控制原始 turn。

### 5.2 标准事件

| 事件 | 用途 | 限制 |
|---|---|---|
| host.connected / host.disconnected | 宿主状态 | 与任务成功/失败分开 |
| session.bound / session.unbound | 用户选择与取消绑定 | 不是自动订阅所有会话 |
| turn.state | working / waiting_user / settled / failed / cancelled / unknown | settled 不默认等于成功 |
| message.delta / message.completed | 公开、可显示的 assistant 文本 | 不含隐藏推理；只有 L2 宿主可产生 |
| tool.activity | 工具阶段和脱敏显示名 | 默认不带参数、输出、路径、代码 |
| permission.attention | 提示回宿主处理 | 不提供自动批准行为 |
| character.emotion / character.animation | 明确角色指令 | 必须检查 renderer 能力 |
| notification | 用户可见提醒 | 限频、大小限制、去重 |
| media.ready / media.failed | 关联回复的媒体结果 | 禁止任意 URL 或文件路径自动读取 |
| state.snapshot | 重连后的状态同步 | 有明确游标，不重复播报历史内容 |

事件中的文本一律作为数据；不得解释为本地命令、脚本、HTML 或额外系统指令。

### 5.3 能力协商

hello/ack 交换：协议版本、宿主适配器版本、消息上限、心跳、事件类型、输入/取消能力和权限范围。

能力示意：statusEvents、assistantText、sendInput、cancelTurn、characterTools、sessionSelection。宿主声称支持不等于用户授权；只有能力和授权同时满足才启用 UI。

Media、桌面能力与宿主能力分别协商。宿主能发文本不意味着它能让桌宠截图。

### 5.4 顺序、重连和背压

- eventId 去重，seq 检测缺口；存在缺口时标为状态不完整，优先请求快照。
- 不声称 exactly-once。采用可重复投递 + 幂等处理，播放和通知另做消费去重。
- 无 replay 的 hook 模式重连后只恢复当前可知状态；不补造历史 token 或未观察到的完成事件。
- 高频进度可以合并；完成、失败、取消和权限提醒不可被普通进度淹没。
- 控制事件与音频数据分通道/队列，音频下载不能阻塞状态更新。
- 假定一个宿主运行多个会话、一个会话有子任务；以 host/session/turn 层级归属，子任务不擅自改写另一个会话的整体结果。
- MVP 同时可连接多个宿主，但一次只播报用户选中的一个会话；其他会话默认只显示计数，不展示正文。

## 6. MCP 工具与生命周期回调各司其职

### 6.1 拟议工具（本项目定义，不是宿主内置工具）

| 工具 | 用途 | 安全约束 |
|---|---|---|
| deskpet_get_capabilities | 查询当前配对角色可用能力 | 只返回当前授权范围 |
| deskpet_notify | 显示短通知 | 文本长度/频率限制，纯文本 |
| deskpet_set_emotion | 设置支持的情绪及有界持续时间 | 未知值报错，不随意写模型参数 |
| deskpet_play_animation | 执行支持的动作 | 循环必须可取消且有上限 |
| deskpet_clear_notification | 清除本调用方创建的通知 | 不能清除其他宿主的消息 |

默认不提供 run_command、read_file、capture_screen、approve_tool 等通用高权限工具。

会话 ID 不能由模型传入后就被当作授权凭据。优先从可信调用上下文取得绑定；宿主无法提供会话身份时，由每会话代理/用户显式配对令牌隔离。无法实现隔离则降级为单会话工具模式。

### 6.2 生命周期回调

- 自动状态应来自宿主事件，而不是每一步都要求模型额外调用表情工具。
- 工具调用用于用户明确要求的表现、通知，Skill 只是使用说明和安装引导，不承担可靠事件总线职责。
- 回调处理只提取白名单字段，快速入队、脱敏，超时或桌宠不可达时不影响 Agent 工作。
- MVP hook 不修改 prompt，不拦截工具，不输出阻止宿主继续的控制指令。
- 本地通知桥的故障应 fail-open 对宿主任务、fail-closed 对未授权数据发送；两者不能混淆。

## 7. Codex 路线

### 7.1 已核实的公开接入边界

读取了官方插件、MCP、Hooks 和 App Server 文档，来源见附录 S1–S4。

- S1 描述插件可组合 skills、MCP 以及 OpenAI 扩展元数据；新包使用根 plugin.json，兼容格式另有规定。该页明确：带生命周期 hooks 的本地手动安装插件与公开目录分发有不同限制。
- S2 描述本地 STDIO 和 Streamable HTTP MCP 配置。配置和可用范围受客户端与部署形态影响。
- S3 列出生命周期回调及信任审查规则，支持命令/MCP 处理器；本地与云端适用范围不能混为一谈。
- S4 将 App Server 定位为构建自有 Codex 客户端的深度接口；文档指出相关命令/WebSocket 传输具有实验性。

以上不证明桌宠可直接挂接正在运行的官方应用任意会话，也不证明所有安装渠道都能分发本地进程和 hooks。目标客户端必须实际验证。

### 7.2 路线 C1：伴随插件，首选

组成：

1. 用户安装并显式启动桌宠 Runtime，或授权按需启动；不把开机自启作为默认行为。
2. 安装 Codex 本地插件，包含配对/使用 Skill、最小 MCP 代理和目标环境支持的生命周期回调。
3. 代理只连接已配对的本机 Runtime；回调归一化为内部状态事件。
4. Runtime 负责角色、气泡和可选播报，Codex 继续处理任务、输入和审批。

第一轮验证的候选回调：SessionStart、UserPromptSubmit、PreToolUse/PostToolUse、PermissionRequest、Stop、Interrupt、SessionEnd。名称来自 S3，但启用范围、payload 与会话标识仍须对目标版本验收。

注意：Stop 回调不直接等同“任务成功”。只有宿主结果字段和语义明确时才标 completed；否则映射为 settled/unknown。没有正文就只显示状态，不读取内部 transcript 文件来补齐。

首期保留两个分发变体：本地团队手动安装版（含经审查的 hooks）与工具-only 兼容版。公开发布的审核、远程 MCP 要求不在本地 PoC 中假定已解决。

### 7.3 路线 C2：App Server 托管会话，可选

当明确要求“直接从桌宠发起 Codex 任务并持续接收事件”时，再评估 App Server。

- 桌宠成为自有客户端，显式创建或按公开规则恢复它有权操作的会话。
- 用户必须知道该会话由谁创建，工作区、权限和审批如何呈现。
- 不默认接管官方桌面应用已打开的会话；可否恢复/共享需独立验证。
- 它增加了客户端职责，不是 C1 插件的无成本开关。
- 协议固定到已测版本，并处理 breaking changes。

C2 不是第一阶段的必要依赖。若 C1 已满足“桌宠跟随 Agent 工作”，不要为双向输入提前重建完整 Agent UI。

### 7.4 Codex PoC 验收

- 安装/卸载插件不修改既有用户技能、MCP 或 hooks 配置；撤销连接后不再送数据。
- 显式角色工具可用；生命周期来源可靠且不会阻塞正常任务。
- 一次工作、一次工具失败、一次等待用户处理、一次中断均有正确状态；不得代替用户批准。
- 两个会话切换不串线；无法获取可信会话范围时明示工具-only 限制。
- Runtime 不在线时宿主任务照常完成；重新上线不重复朗读旧回复。
- 无需 MaiBot 和 Python 即可完成 L0/L1 验收。

## 8. DeepSeek Harness 路线

### 8.1 已核实范围

官方仓库 S5 确认 DeepSeek Harness 是独立的 Agent Harness，并标注 developer preview 和兼容性变更风险。架构文档 S6 描述 Cordis 插件的 services、typed events 和可卸载 effects，以及进程内流式事件与持久会话事件的区别。

这是“接入 Harness 插件体系”，不是调用 DeepSeek Chat Completions API。正式实现必须固定具体 tag/commit，当前读取的 master 不能当作长期稳定契约。

### 8.2 路线 H1：原生薄插件

拟议插件职责：

- 按 Harness 的公开插件机制注册；仅在用户启用的 profile/范围内生效。
- 订阅适合 UI 展示的状态/会话事件，归一化后发送给本地配对 Runtime。
- 必要时注册与 MCP 模式同语义的角色工具，工具名/注册方式按所固定版本确定。
- 若需要消息正文，分别处理瞬时 stream 和持久提交，避免重复显示或把重试中的未提交文本当成最终结果。
- 停用插件时清理所有监听、连接和定时器，不改变 Agent 的会话存储。

S6 中出现 agent/assistant-stream 等进程内事件；不能假设外部桌宠直接订阅，也不能把所有事件当普通 EventEmitter。其 waterfall 扩展点有委托规则，接入前须验证；优先选择只读通知面，不介入 prompt、工具权限或推理流程。

### 8.3 路线 H2：通用工具桥降级

若所固定版本的原生插件入口成本过高，可评估宿主已提供的工具/MCP 接入；只有实际验证后才启用。降级为 L0，不能把缺失生命周期用模型“记得调用工具”伪装补全。

### 8.4 Harness PoC 验收

- 原生插件启用、禁用、重载后没有重复订阅。
- 同一轮流式与完成事件只形成一条最终消息；取消、重试不会残留错误完成气泡。
- 宿主侧插件失败不破坏原任务和工具执行。
- 至少两个会话隔离，子任务归属明确；单个关闭不清空其他会话。
- 同一个桌宠 Runtime 不改 Core，即可接收 CodexAdapter 或 HarnessAdapter。
- 双向输入仍须独立证实公开入口和授权，不从已读架构文档推断具体可调用方法。

## 9. 配对、权限与数据最小化

### 9.1 本地通信

- Runtime 只绑定 loopback；本地地址本身不是鉴权。
- 优先每适配器 STDIO 代理连接本地 Runtime；stdout 只承载协议，日志走 stderr。
- 本地 HTTP/WS 提供实例级随机凭据、限定宿主/会话 scope；使用一次性配对流程，凭据不放 URL 查询串，不打印日志。
- 浏览器客户端校验 Origin，拒绝任意网页调用；非浏览器客户端同样必须鉴权。
- MCP 工具认证与 Runtime 配对是两层，不能把一个工具参数当作另一层授权。
- 配对凭据主进程持有，renderer 只获必要状态；可撤销、可轮换。
- 不提供接受 arbitrary command、Python 路径或任意文件路径的事件。

### 9.2 权限分级

| 权限 | 默认 | 说明 |
|---|---|---|
| 角色工具 | 配对后按用户选择 | 仅视觉效果，不触达文件或审批 |
| 任务状态 | 指定会话开启 | 默认只传类别，不传完整参数 |
| 回复正文 | 关闭或首次确认 | 只限公开最终回复/允许的增量 |
| 本地 TTS | 关闭 | 用户开启后仍可随时停止 |
| 云 TTS | 关闭且单独确认 | 文本会离开本机，必须清楚说明 |
| 麦克风 | 关闭 | UI 持续显示采集状态；禁用立即释放 |
| 截图 | 关闭 | 单次确认或明确持续授权；发送前绑定目标 |
| 向 Agent 发送输入 | 关闭 | 显示目标 host/session 和待发送文本 |
| 工具审批 | 不提供 | 始终回宿主处理 |

### 9.3 故障与滥用防护

- 输入使用 schema 校验和帧大小限制；未知事件忽略并限频记录，不执行其内容。
- 不自动打开消息 URL，不渲染不可信 HTML，不把媒体路径变成任意文件读取。
- 模型资源经可信目录/导入服务提供，检查路径边界、外部引用和包体积。
- 角色动作、气泡和音频有速率/队列限制；用户可一键静音/暂停所有宿主。
- Agent 的输出不能作为新的用户输入，语音回放不触发录音回灌。
- 不保存源码/工具完整输出作为默认日志；诊断导出脱敏并由用户主动触发。
- 远程场景另做 TLS、身份和网络可达性设计；云宿主不能直接访问用户机器的 localhost。

## 10. 用户流程

### 首次连接

1. 安装桌宠 Runtime，仅包含基本角色与必要运行资源。
2. 在宿主安装对应插件；引导用户选择 Runtime，而不是悄悄修改全部宿主配置。
3. 双方确认实例和权限，桌宠显示“已连接的宿主”和可用能力。
4. 选择一个会话；未绑定时不显示其他会话正文。
5. 状态变化触发表现；缺少正文权限时只显示状态标签。

### 正常工作

- 工具执行等高频事件聚合为低频视觉变化，避免连续抖动和弹窗。
- 需要用户行动时使用中性提示，打开/切回宿主的能力仅在官方支持时启用；否则显示手动返回提示。
- 结果通知默认简短，长回答留在宿主；可选展示原文但不让小窗口承担完整 IDE 职责。
- 多个宿主同时工作时，桌宠明确显示当前来源，不用“最新事件覆盖”决定来源。

### 双向输入（后续）

- 文本/语音先成为草稿，确认选中会话和权限再发。
- 语音转写结果在发送前可检查；自动发送需要额外可撤销设置。
- 不支持 sendInput 的宿主显示“此连接只读”，不模拟键盘输入。
- 断线时不静默排队后自动发送敏感草稿；重连由用户重新确认。
- 取消只作用于发出命令时绑定的 turn，不因用户切换会话而取消别的任务。

## 11. 代码组织迁移提案

以下为未来逻辑边界，不是本轮创建的目录或包名：

```text
应用层：现有 Electron 桌宠 / 可选浏览器预览
公共层：core、contracts、controllers、UI projections
渲染层：renderer-live2d、renderer-imageset
平台层：platform-electron、platform-browser
宿主层：adapter-maibot、adapter-codex、adapter-harness、adapter-fake
媒体层：voice-input、speech-controller、可选 STT/TTS providers
插件层：Codex 安装包、Harness 原生插件、通用 MCP 代理
```

初期仍在当前仓库逐步形成边界。只有公共层已通过无宿主测试，再考虑提取成 packages 或独立仓库。不为未来扩展预建大量空包。

### 可保留资产

- Vue 界面与现有视觉风格，先不重做。
- 模型适配文档、adapter/imageset 格式及校验思想。
- Live2D/静态立绘加载器，修复生命周期后复用。
- 聊天气泡、输入框、缩放拖拽与表情表现。

### 必须替换的边界

- useWebSocket 内的 UI/媒体/平台副作用。
- DeskpetStage 中对宿主协议和录音细节的直接管理。
- 全局共享的模型尺寸和分散计时器。
- “所有后端都有 sys:env/Python”与“所有平台都有 electronAPI”的假设。
- 只有 connected 布尔值、没有会话范围和能力协商的连接模型。

## 12. 分阶段可验证交付

### P0：证实宿主接入面

- 固定目标 Codex 客户端版本、Harness commit。
- 捕获最小脱敏事件样本，核实 session/turn 字段、事件顺序、卸载行为和 hook 失败语义。
- 产出兼容矩阵：supports/unsupported/unverified，不用猜测字段补全。
- 若目标入口不可用，降级为工具模式，停止承诺自动状态和双向聊天。

### P1：公共边界 + FakeHost

- 先完成升级计划中的高风险修复，再抽 Core/Platform/Renderer。
- 无网络、无 MaiBot、无 Python 的演示可模拟完整状态周期。
- 录音、图片慢加载、消息乱序、取消和重连测试通过。

### P2：Codex L0/L1 本地插件

- 最小角色工具 + 受支持的状态回调 + 配对 + 卸载。
- 无需任何屏幕读取；Runtime 退出不影响 Codex。
- 不支持的正文/输入功能明确禁用。

### P3：Harness L0/L1/L2 原生插件

- 复用同一 Runtime 和 contracts，只增加 adapter/安装物。
- 处理瞬时与持久事件、重试和取消语义。
- 插件热卸载不残留副作用。

### P4：L3 双向输入与增强媒体

- 单独完成会话绑定、输入授权、取消和审批展示方案。
- Codex App Server 自有会话模式与伴随插件模式明确区分。
- STT/TTS 作为可选插件安装，不回到“默认绑全套 Python 服务”。

### P5：发布与跨平台

- Windows 先验收，macOS/Linux 的平台能力逐项测试。
- 本地手动安装/团队分发先于公开插件目录；公开渠道需要独立审核策略。
- Runtime、内部协议、宿主插件独立版本化，并有兼容范围表。
- 自动更新验证来源与完整性，配置迁移可回退；卸载插件不删除用户模型。

## 13. 最小成功定义

完成第一版“可移植 Agent 桌宠”必须同时满足：

1. 同一个 Core 和桌宠应用，在不安装 MaiBot/Python 的情况下，连接两个不同 Agent 宿主。
2. 每个适配器声明准确能力；至少完成 L0 和可验证的 L1，不把仅有工具调用宣传成完整自动集成。
3. 原 MaiBot 路径仍然可用；模型和现有用户配置可迁移。
4. 任何宿主断线、插件报错、桌宠退出，都不会破坏 Agent 原任务。
5. 会话隔离、配对、撤销、敏感能力权限测试通过。
6. 不依赖抓屏、内部数据库、私有 API 或模拟输入。
7. 有明确安装、配对、失败诊断、升级和卸载说明。

如果只完成“把 Vue 页面嵌进去”或“能调用一个 set_emotion 工具”，应标为局部 PoC，而不是完整插件化完成。

## 附录 A：官方依据与不确定性

核实时间：2026-10-10。检索工具未返回可用正文，因此通过直接 HTTP GET 读取下列官方页面，记录状态 200 与最终跳转地址；不把检索空结果当作事实依据。来源是设计约束，不是本机目标版本测试结果。正文仅概括必要接入事实，所有项目接口与阶段划分为本方案自行设计。

### S1 / OpenAI：Build plugins

原始/最终地址：

```text
https://developers.openai.com/plugins/build/plugins
```

依据：插件封装格式、skills/MCP/扩展元数据、本地手动 hooks 与公开目录限制。计划不预先生成可安装 manifest，实际开发时按目标版本再次核对。

### S2 / OpenAI：MCP

```text
https://developers.openai.com/codex/mcp
https://learn.chatgpt.com/docs/extend/mcp?surface=cli
```

第一行为入口，第二行为读取时最终地址。依据：STDIO/Streamable HTTP、配置方式与不同运行环境的范围差异。不能据此推断完整会话观察能力。

### S3 / OpenAI：Hooks

```text
https://learn.chatgpt.com/docs/hooks
```

依据：事件名称、信任审查、处理器和本地/云端适用范围。提案中回调字段映射仍需目标版本 PoC。

### S4 / OpenAI：App Server

```text
https://developers.openai.com/codex/app-server
https://learn.chatgpt.com/docs/app-server
```

依据：自有客户端的深度集成、流式事件及实验性提醒。不是“官方应用任意会话接管 API”的证据。

### S5 / DeepSeek 官方仓库

```text
https://github.com/deepseek-ai/deepseek-harness
```

依据：项目身份、插件化定位、developer preview 与兼容性变更提醒。正式实施前固定 tag/commit；不引用 star 数等无关动态信息。

### S6 / DeepSeek 官方架构文档

```text
https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/architecture.md
```

依据：Cordis 插件/typed events/effects、生命周期与会话事件、进程内流与持久记录的边界。master 会变动，不据此编造插件导出函数、注册签名或包版本。

### 待验证项

- 用户真实使用的 Codex/Harness 版本、配置与插件渠道。
- hooks 在该客户端是否启用、是否有可信 session/turn 标识和正文。
- Harness 的实际安装清单、兼容范围、只读订阅与输入 API。
- 宿主内嵌 UI 能力、后台音频政策、跨 OS 原生窗口行为。
- 当前项目使用的角色模型、Cubism 资源和第三方依赖是否适合新的分发形态；需另行核对授权，不在本方案作法律结论。
