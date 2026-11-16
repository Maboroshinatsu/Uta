# Uta 功能性不足评估

日期：2026-10-27。评估基线：`main / 4fd1fc92c31ac38e09daf9fb5a3fb7555b03704c`，源码版本 `0.2.0-alpha.18`。本轮只评估、补充诊断证据与交接，不修改业务代码。

后续修复进展以 [CURRENT](workflow/CURRENT.md) 和 [HANDOFF](workflow/HANDOFF.md) 为准；以下内容保留评估当时的结论。

## 结论

Uta 已具备角色展示、工作状态联动、审批、消息气泡、语音输入/播报、模型切换和预设工坊。当前最有价值的工作是保证消息送对、送完整、能回看，再补齐任务控制和新模型适配。继续增加外观选项的收益低于这些功能。

这次确认两项发送缺陷，另有四项产品能力不足。语音、真实宿主及长时使用的部分证据仍不完整，单独列为待验，不据此认定功能不存在。

## 已确认的发送缺陷

### [P1: 手动选定的会话未重新登记时，消息退回最新会话]

- 场景：用户选定回信会话 A，Uta 重启后 A 尚未重新登记，但同平台另一个会话 B 已经活动；也可能在会话列表清理过期 A 后出现。
- 原因：`index.ts` 的 `selectedHostSession()` 在“没有手动选择”和“已选择但当前注册表找不到”两种情况下都返回 `null`。`host-bridge.ts` 用 `sessionOverride ?? readHostSession(...)`，于是两者都会读取该平台最新的 hook 会话记录。
- 后果：用户仍有明确的目标 A，消息却可能送到 B。平台内所有会话都可驱动桌宠是已决定的行为，但不等于可以忽略手动选择的反发目标。
- 受控复现：执行从生产 `index.ts` 提取的原始选择函数及生产 `sendHostMessage()`，仅替换文件读取、注册表和子进程；偏好为 `pinned-A`、A 不在注册表、最新记录为 `latest-B`。结果 CLI 参数为 `--thread latest-B`，返回 `ok=true / accepted=true`。
- 建议：区分自动跟随、手动目标可用、手动目标缺失三个状态。后者应保留草稿并要求重新确认，不能退回最新会话。
- 源码：[目标解析](../app/src/main/index.ts#L1806)、[发送回退](../app/src/main/host-bridge.ts#L463)、[注册表过期清理](../app/src/main/runtime-sessions.ts)。

### [P2: 长文本被静默截到 1000 字符，仍提示发送成功]

- 场景：在桌宠输入框粘贴较长需求、日志，或较长语音转写结果经直连桥发送。
- 原因：输入框没有长度提示或上限，主进程 `sendHostMessage()` 直接 `clip(rawText, MAX_TEXT_CHARS)`，其中上限为 1000；超过部分不报错。`sendText()` 已先把完整用户文本写入本地消息记录。
- 后果：记录显示的是完整输入，宿主实际收到的是前段，末尾的条件或限制可能消失。此问题针对主进程直连宿主桥，不能扩大到所有 HTTP 适配器。
- 受控复现：输入 1018 字符，末尾包含确认条件。实际 `--message` 长度为 1000，末尾条件不在参数中，仍返回发送成功。
- 建议：超限时明确阻止并保留原文，或在确认宿主支持的长度内完整发送；输入入口显示实际限制。不要自动拆成多条会改变任务含义的消息。
- 源码：[长度限制与发送](../app/src/main/host-bridge.ts#L65)、[输入框](../app/src/renderer/components/QuickInput.vue)、[发送前写入记录](../app/src/renderer/components/DeskpetStage.vue#L920)。

## 产品能力不足

| 事项 | 当前能力与实际影响 | 建议 |
| --- | --- | --- |
| 消息记录不能长期回看，也不显示来源会话 | `chat.ts` 只维护内存数组，最多 200 条，状态气泡也占名额；没有 host/session 字段。重新创建渲染器即为空，同平台多会话的内容无法从记录结构判断归属。消息面板没有搜索或导出入口。宿主自己的历史不受此结论影响。 | 先支持本机可控的历史保存、清除及会话来源，再考虑搜索/导出。记录应与平台、会话及本次发送回执关联。 |
| 交互入口没有提前说明宿主能力，任务控制不完整 | Qoder/Antigravity 在当前 Uta 接入中不支持反向文本注入，但输入框仍可提交，提交后才回填草稿并解释。`cancelTurn` 有能力字段，真实适配器未提供完整的取消宿主任务方法，桌面也没有相应停止入口；录音取消和试听停止已存在，不能混为一谈。 | 发送前显示当前目标和有效能力；不支持发送时提供明确的返回宿主路径。有官方取消能力的平台再实现停止任务。能力须合并适配器与主进程发送桥判断，不能只看 hook 适配器的 `sendInput=false`，否则会错误禁用已有桥的宿主。 |
| 非标准模型缺少面向用户的校准与持久化流程 | 已有模型发现、原始参数编辑、预设和适配器文件；新表现 runtime 初始化时固定传 `overrides: []`，映射消费仅接受已确认的 `standard-id`。因此模型能加载，不代表能获得与基准模型一致的微表现。当前普通设置/工坊没有语义通道校准流程。 | 提供按模型内容签名保存的少量通道校准：部位、方向、幅度、可取消预览与恢复默认。继续保留现有工坊，不重做整套引擎。 |
| 换电脑或重建实例缺少统一迁移入口 | 已有当前模型自定义预设导入/导出、旧偏好导入、设置损坏恢复；这些用途不同，尚未形成将角色选择、公共偏好、模型映射及连接参数一并预检/迁移的流程。 | 提供可选择内容的备份/迁移，预检缺失模型与路径；密钥重新授权，不能把本机加密文件直接当可移植凭据。优先级低于发送和历史。 |

相关源码：

- [消息存储](../app/src/renderer/stores/chat.ts)、[消息面板](../app/src/renderer/components/ChatBubble.vue)。
- [发送流程](../app/src/renderer/components/DeskpetStage.vue#L920)、[宿主桥支持范围](../app/src/main/host-bridge.ts)、[宿主契约](../app/src/renderer/services/host/contracts.ts)。
- [模型表现初始化与映射](../app/src/renderer/services/performance/model-runtime.ts#L80)、[角色与工坊页面](../app/src/renderer/settings-window/domains/CharacterDomain.vue)。
- [关于与旧偏好导入入口](../app/src/renderer/settings-window/domains/AboutDomain.vue)、[预设导入导出](../app/src/renderer/settings-window/domains/CharacterDomain.vue)。

## 已有能力与待验边界

- MaiBot 绑定、随包适配器和 DS-control 分发已进入 alpha.17/18，不能沿用旧报告称它们缺失。
- DSH 一键安装、程序路径与数据目录选择已进入 alpha.18。但现有验收采用隔离假 DSH profile；真实 DSH 安装、重启后工具/审批/RP 注入仍待实机验证。见 [alpha.18 验收](validation/share-package-0.2.0-alpha.18.md)。
- 本地/云端 TTS、STT、录音取消、失败重试、默认转写进草稿已经有实现。真实有声链路、设备切换/权限失败、模型与宿主切换交接仍应验证，不能写成“没有语音功能”。当前麦克风使用系统默认设备，没有应用内设备选择，属于次级增强。
- 真实 MaiBot + QQ 收发、宿主切换重连、8 小时/7 天、多屏 DPI 等仍有验收缺口。历史记录并非本轮新执行的实机验收。
- 一宠绑定一平台、该平台所有会话都能驱动桌宠，是用户已决定的产品边界；不作为功能缺陷。独立待机也不等于承诺了独立聊天模型或长期角色记忆。

## 验证和现场

- 开始与收尾核对 Git；评估前工作区干净。本轮不启动或停止 Uta、不修改用户设置、不连接真实宿主发送消息、不安装插件。
- 进程清点未发现 `Uta.exe` 或 `electron.exe`，运行 profile 未确认。当前聊天的桌宠能力查询返回运行时未启动或配对不可用，不把这一结果当作插件源码缺陷。
- 受控探针：[functional-assessment-2026-10-27.cjs](validation/functional-assessment-2026-10-27.cjs)。从仓库根目录运行 `node docs/validation/functional-assessment-2026-10-27.cjs`。它执行生产选择函数和发送桥，发送使用模拟文件/模拟子进程，无真实 CLI、网络或用户数据写入；修复后已改为断言拒绝误发和超长输入。
- 评估当时，另一个探针确认两个消息在新的 Pinia 容器中变成零条；连续写入 201 条后剩余 200 条，消息字段没有宿主/会话归属。后续持久化覆盖见 `app/tests/chat-history.test.cjs` 和当前交接。
- 现有定向测试：在 `app` 中执行 `node --test tests/host-bridge.test.cjs tests/host-session-preference.test.cjs tests/runtime-sessions.test.cjs tests/connections-domain-race.test.cjs tests/model-performance.test.cjs tests/model-capability-core.test.cjs tests/stt.test.cjs tests/tts-renderer.test.cjs`；**119 通过、0 失败、0 跳过**。已有测试通过不覆盖上述两项新复现缺陷。
- 本轮没有业务代码变更，未运行构建、全量测试或 GUI 验收。

## 推荐顺序

1. 修复 [P1: 手动选定的会话未重新登记时，消息退回最新会话] 与 [P2: 长文本被静默截到 1000 字符，仍提示发送成功]，补对应正式回归。
2. 消息来源、历史保存与发送结果；输入口提前显示目标与有效能力。
3. 有官方支持的平台取消任务、新模型用户校准。
4. 统一迁移，以及真实语音/宿主/长时与多屏验收。

以上为建议，用户尚未授权实施这些功能或修复。
