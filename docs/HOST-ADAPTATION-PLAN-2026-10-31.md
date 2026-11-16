# Uta 其他宿主适配方案

日期：2026-10-31。读者：后续实施与验收人员。范围：Codex、Claude Code、Qoder、Antigravity、OpenCode、ZCode，以及 MaiBot/AstrBot 适配器；DSH 作为本轮已修复的参考，不重复开发。本文是方案，不表示已实现或已完成真实宿主验收。

## 结论与当前基线

保留“独立 Uta 运行时 + 宿主薄插件”的结构，把重点放在准确的会话目标、可解释的投递结果、真实能力探测和各宿主版本验收。优先完善已经接入的平台；需要自有 Agent 客户端的深度接口作为单独可选模式。

- Uta：`D:/Frankenstein/Uta`，`main / f98bbef`，另有尚未提交的 DSH 0.5.5 修复及相关文档/测试。本文包含对这些工作区改动的观察，不把 HEAD 当成完整现场。
- 一只桌宠绑定一个宿主平台，平台下可选择一个会话；人格、记忆、任务决策和模型选择属于宿主。
- “宿主插件可调用角色工具”“观察到状态”“能发送到某会话”“能回答原生提问”“能取消任务”是分别验证的能力。
- 未打包不计为源码功能缺陷；日后候选包的验收单独记录。
- 已有入口：[主进程发送桥](../app/src/main/host-bridge.ts)、[会话注册表](../app/src/main/runtime-sessions.ts)、[运行时协议](../app/src/main/runtime-commands.ts)、[适配器契约](../app/src/renderer/services/host/contracts.ts)、[插件入口](../plugin/README.md)。

## 已核对的能力与缺口

“已有”表示代码存在；帮助/文档核实和真实端到端验收分别列出，不互相替代。

| 宿主 | Uta 当前实现 | 本轮外部/本机核对 | 主要适配方向 |
| --- | --- | --- | --- |
| Codex | MCP 角色工具、hooks、审批、计划镜像、`queue --thread --message` | 本机 CLI `0.166.0-alpha.5.1`；帮助确认 queue 及入队后尝试恢复的语义 | 区分入队与执行；绑定完整目标；核对桌面/CLI 版本差异 |
| Claude Code | MCP、hooks、StopFailure、成功 TaskCreate/TaskUpdate 增量、`-p --resume` | 本机 `2.1.138`；帮助确认精确 resume、结构化输出和 permission mode | 工作目录与并发续跑、结果解析、任务镜像完整性 |
| Qoder | MCP、hooks、审批、短摘要、待办提取；主进程尚无 qoder 发送分支 | 本机 CN CLI `1.1.76` 有 `--resume <id>`、`--print`、`--cwd`；官方文档也提供 CLI 续会话路线 | 新增经验证的 CLI 续跑模式；桌面活会话是否共享另行核验 |
| Antigravity | MCP、六类 hook、部分审批、PostInvocation/Stop 摘要 | 官方 hooks 文档核对到当前事件和字段 | 明确 App/IDE/CLI 三种表面，改进状态/失败/归属；无已验证输入通道时继续复制或回宿主 |
| OpenCode | 现有插件已为 2.0.32 注册式上下文；旧发送桥曾使用独立 CLI | 磁盘 CLI 是 1.14.31，不能据此推断桌面插件版本 | 用 2.x 插件原生 session.prompt 入队，禁止静默改走旧 CLI |
| ZCode | MCP、hooks、审批、`--prompt --resume --cwd` | 本机 CLI `0.16.9`；帮助显示 prompt 的默认 mode 为 yolo | 先确认并保留权限模式，再完善结构化结果与版本探测 |
| MaiBot/AstrBot | 声明式 HTTP 插件；MaiBot 有真实 SDK 适配器、私聊与其他聊天隔离 | 本轮只读当前源码与说明，未启动账号 | 连接和消息回执统一，固定会话/平台归属；各自补真实链路 |

Qoder 应修正为“Uta 目前没有实现这条发送路线”，不能继续把它概括为“宿主没有官方非交互续会话能力”。CLI 能恢复历史会话，不证明可以向正在运行的桌面 Agent 原地注入消息。[Qoder CLI 官方参数](https://docs.qoder.com/cli/cli-reference)

## 先统一公共行为

### 目标在发送前固定，执行期间不重新选择

发送动作取一次明确的目标快照，至少包含宿主、宿主配置来源、会话原始 ID、工作区与当前连接代次。主进程完成检查后把同一目标传给宿主适配器；重试、等待与回执处理不能再查询“最新活动会话”。

宿主 `threadId`、共享的 `sessionId`、子 Agent ID 和 `turnId` 分别保存；不能为了统一字段而丢失宿主原始标识。工作区根目录和工具执行时的当前目录分开记录，避免 `cd src` 后把同一项目误分成新项目。Windows 路径需规范化比较，但保留用于显示与启动的原值。

固定目标缺失、归属不一致或来源已断开时拒绝本次操作，保留输入。自动跟随只用于用户未固定会话时选择下一次操作的目标。

### 投递结果与任务结果分开

拟议为主进程发送桥增加以下结果，名称是 Uta 内部设计，不是各宿主现有 API：

| 结果 | 含义 | 用户反馈与重试 |
| --- | --- | --- |
| 不支持 | 当前版本/表面没有已验证的输入接口 | 提供复制或打开宿主；被动互动不操作剪贴板 |
| 确定未发送 | 目标不存在、发送前校验失败或已证明未连接 | 保留草稿，可由用户重试；符合条件时才自动换通道 |
| 已入队 | 宿主确认排入指定会话 | 显示“已排队”，等宿主事件更新状态 |
| 已接收 | 指定会话确认收到，尚无任务结束结果 | 显示“已发送”，不显示“任务完成” |
| 结果未知 | 请求可能已被接收，成功回执丢失 | 保留记录并提示查看宿主，不自动补发 |

任务成功、失败、中断由另一个带会话/轮次的状态事件表示。CLI 退出码、HTTP 200 或角色窗口接收成功不能代替它。只在宿主确实支持时关联原生消息 ID；自行生成 `messageId` 并得到回显只解决关联，不构成幂等保证。

当前 DSH 已采用“未送达 / 明确结果 / 未知”的处理；其他发送分支渐进接入，不以一次大重构替换所有宿主。聊天记录已有 `pending/sent/failed/unknown`，可以通过兼容映射演进，不直接改坏旧数据。

### 能力按版本和连接状态计算

为每项能力分别记录：接口是否支持、是否配置、是否已连接、是否在目标表面验证，以及不可用原因。由主进程产生当前事实，renderer、MCP 返回与文档使用同一投影。

现有 [HookHostAdapter](../app/src/renderer/services/adapters/hook-host.ts) 主要声明角色能力，而主进程另行实现输入；因此不能只读取旧 adapter 的 boolean 决定整个平台“能/不能发送”。运行时 `receipts` 也不能直接解释为宿主输入投递回执。

连接检查至少区分插件文件存在、宿主已加载插件、Uta 握手通过、会话已登记、角色窗口已执行。CLI 通过 `--version/--help` 探测必要选项；SDK/HTTP 路线检查实际方法或 schema，不只比版本号。

### 状态、待办、审批分别保持归属

- 状态事件使用宿主/会话/轮次/事件 ID；同会话有顺序保证或明确的去重规则。子 Agent 结束不能直接结束主会话。
- 忙闲来自宿主事件或实际请求，不仅根据“文件最近 2.5 秒更新过”。支持 queue 的平台允许按其原生语义排队；resume-only 平台则检查并发持有者。
- 待办以成功结果、可验证的增量或宿主提供的快照为准；不能把工具调用前的意图当成已保存任务。缺事件时标记“不完整/可能过期”，不伪造恢复。
- 审批保留原始请求 ID、会话和期限；桌宠关闭、过期或切宿主后交还宿主决定。“交还宿主”不等于自动批准。
- 普通问答和权限审批使用不同协议。无法回写原生提问的宿主只显示“回宿主回答”，不把普通聊天注入冒充原生问题答案。

## 各宿主实施方案

### Codex：保留伴随插件，先完善入队与归属

1. 继续使用现有 MCP + hooks；复核插件安装、hooks 信任、会话开始、失败/中断和计划更新，不要求用户另起一套 Codex。
2. queue 目标使用确切线程 ID；把退出码 0 显示为“已排队”。本机帮助明确 `--resume` 的恢复失败可只给警告、命令仍成功，因此恢复/启动状态也要单独呈现，不能靠退出码判断。
3. 发送桥记录该会话使用的 CODEX_HOME、配置 profile、工作区与必要连接信息的受控引用，避免启动子进程时继承另一套默认配置。不同线程与共享会话树根 ID 分开保存。
4. 对同一次发送，明确 hook 回流和命令行回执各自用途，使用可关联的原生 ID 去重；没有 ID 时不猜“下一条助手消息一定是该输入的回答”。
5. 需要流式输入、精确 steer 或取消时，另立“Uta 管理的 Codex 会话”模式，评估 App Server；仅操作由该连接管理、用户明确选择的线程，不假定可接管官方桌面应用的任意会话。

OpenAI Docs 的 App Server 支持创建/恢复线程、启动/steer/中断轮次并接收事件；这些接口的存在与连接是否拥有当前桌面会话是两件事。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)、[hooks 文档](https://learn.chatgpt.com/docs/hooks)

涉及文件：`host-bridge.ts`、`host-paths.ts`、`host-session-preference.ts`、共享 `uta-host-hook.mjs`、Codex 插件打包与相应测试。验收：两个 CODEX_HOME + 两个线程；活跃/空闲/关闭目标；入队成功但没有执行、恢复警告、重复 hook、未信任 hooks、过期审批。

### Claude Code：把精确续会话与结果解析做好

1. 保留已有 StopFailure 和成功 TaskCreate/TaskUpdate 增量处理，不重新实现一套任务镜像。
2. 按会话记录的工作区启动 `-p --resume <id>`，核对项目作用域、插件目录及用户配置来源；禁止 `--continue` 或没有 ID 的 resume。
3. 先用隔离会话证明“交互式客户端持有目标时另起 print 进程”的并发语义；未证明安全前，不能把 resume 当作向活动窗口发送消息。支持范围明确标为可续跑的已登记会话。
4. 在目标版本支持时采用 JSON/stream-json，分别解析结果、错误、会话 ID 和可展示助手文本；停止把整个 stdout 当成可朗读回复。保留宿主的权限模式。
5. 最新官方文档出现 TaskCreated、CwdChanged 等事件；按版本探测后用于补充信号。TaskCreated 有决策/回滚语义，不能取代成功 PostToolUse 作为任务已落盘的依据。新的事件不在旧版本插件中无条件注册。

官方 CLI 提供精确 resume 和结构化输出；hooks 文档说明任务/目录事件及其字段。它们没有替 Uta 证明多个客户端同时续跑同一会话的安全性。[Claude CLI](https://code.claude.com/docs/en/cli-reference)、[Claude hooks](https://code.claude.com/docs/en/hooks)

涉及文件：共享 hook、`uta-todo.mjs`、Claude `hooks.json`、`host-bridge.ts`。验收：同用户两个项目、无效 ID、目标被占用、真实失败/取消、目录变化、Task 事件重复/乱序、Uta 中途上线、无任务工具模型。旧版 2.1.138 与新增事件目标版分别记录，不以一个版本通过代替全部兼容。

### Qoder：新增有边界的 CLI 输入路线

1. 将产品能力拆成 Qoder CLI / Qoder CN CLI / 桌面应用；保留现有 MCP、hooks 和审批。当前“无反向输入”是 Uta 实现限制，应在方案实施后按表面更新能力矩阵。
2. 先在独立配置里建立 CLI 测试会话，用明确 `--resume <id>`、`--cwd <workspace>`、`--print` 续跑，并解析已探测到的结构化输出。必须记录 CN/国际版可执行文件与配置根，不能混用 `.qoder` 和 `.qoder-cn`。
3. 在固定版本证明 ID、工作区、并发占用和权限不变后，才给这类 CLI 会话开放输入；桌面会话 ID 是否可被同一 CLI 恢复单独验收。未通过时，桌面入口仍提供复制/回宿主。
4. 官方参数页还列出 ACP，可作为后续由 Uta 管理的会话模式。本机 CN 帮助未展示 `--acp`，本轮未启动 ACP，不能把国际版文档直接当成本机 CN 已支持。
5. 目标版本若支持 StopFailure、CwdChanged 等事件，补失败与目录归属；从真实 payload 建 fixture，保持旧事件兼容。开发派单的固定模型策略不硬编码为产品用户会话的模型配置。

依据：[Qoder CLI 参数](https://docs.qoder.com/cli/cli-reference)、[Qoder hooks](https://docs.qoder.com/cli/hooks)、[桌面 hooks](https://docs.qoder.com/qoder/hooks)，以及本机 `qoderclicn.exe 1.1.76 --help`。

涉及文件：Qoder hook、`host-paths.ts`、`host-bridge.ts`、能力来源与连接页。验收：CN/国际配置隔离、A 缺失不投 B、活跃目标并发、恢复后工作区、取消/失败、输入含前导连字符和中文、无效目标不自动新建会话。

### Antigravity：先把伴随能力做准

1. 对 App、IDE、CLI 分别记录已测版本、插件安装位置与 hook 加载方式；当前工作区插件安装成功不能代表三种表面均已加载。
2. 继续使用 SessionStart、Pre/PostToolUse、Pre/PostInvocation、Stop；按官方 payload 的 `conversationId`、`workspacePaths` 建归属，不从其他宿主字段名推测。多工作区不擅自选第一项作为项目根。
3. Stop 只说明循环结束，最终成功/失败/取消需要相应证据；PostInvocation 的模型输出与最后短摘要分别去重，避免每次调用都播报。
4. 保留当前可工作的工具审批；逐工具核对宿主是否采用批准/拒绝结果。网络/浏览器权限由宿主处理的边界继续保留，不能用统一 allow 返回掩盖差异。
5. 在找到并验证当前表面可定向输入/回答的公开接口前，仍采用用户主动复制和“回宿主回答”。本轮未证明有或没有此类接口，不下永久“不支持”的结论。

官方当前 hooks 文档列出事件及 `conversationId/workspacePaths` 等通用字段；不据此推导外部输入或取消能力。[Antigravity hooks](https://antigravity.google/docs/hooks)

涉及文件：Antigravity hook、`hooks.json`、安装脚本、能力矩阵。验收：两个 conversation、多个 workspace、窗口关闭、Stop 错误/中断、PostInvocation 重复、审批真实采用与交还宿主。

### OpenCode：2.x 插件的原生会话输入

实施时校正：原插件已于此前迁移到 OpenCode 2.0.32 的注册式上下文。`D:/OpenCode/opencode-cli.exe` 为 1.14.31，是独立旧程序；不能将它用于恢复桌面 2.x 会话。

1. 插件通过自身 `ctx.session.get({sessionID})` 确认会话及目录，经仅限 loopback、Bearer 鉴权的桥使用 `ctx.session.prompt({sessionID,text,delivery:'queue'})` 投递。
2. 官方 v2 契约的 prompt Promise 表示持久输入箱接收；Uta 显示“已排队”，不声称回复已经生成。请求已提交但回执丢失视为未知，不能补发。
3. 所有状态、回复、审批和 Todo 都带精确会话归属；工具计划仅在成功事件确认后镜像，失败只清理该会话。
4. 桥未就绪时提示更新/重新加载插件；禁止扫描端口或改用独立旧 CLI。1.x 另行适配，不在这条路线中假装兼容。
5. 插件构建为自包含单文件；显式 profile/端点缺失时不回退日常实例，退出只清理自己写的桥信息。

契约依据：[v2 插件上下文](https://opencode.ai/v2/docs/build/plugins/server)、[v2 原生 API](https://opencode.ai/v2/docs/api)、[v2 CLI 与共享服务](https://opencode.ai/v2/docs/cli)。

已完成隔离 SDK/HTTP 回归；真实 2.x 桌面插件加载、模型回复和画面验收仍待用户环境验证。

### ZCode：先核实续跑的权限模式

1. 保留现有 MCP/hooks 与 `--prompt --resume --cwd`，按实际 CLI 特性生成参数，不从 Claude Code 的相似命令推断行为。
2. **优先验证权限继承**：本机 0.16.9 帮助写明 `--prompt` 默认 mode 为 yolo，当前 Uta 构造参数未显式传 mode。要先查明恢复会话的已保存 mode 是否覆盖默认；本轮仅核对帮助，尚未证明真实会话会放宽权限。
3. 若需要显式 mode，使用宿主记录并允许的策略，不能凭 Uta 默认值放宽；没有足够信息时限制发送，提示在宿主完成配置。
4. 读取目标版本可用的结构化输出/服务接口；若没有，则仅提取有明确边界的最终回复，保留错误类别。目录、会话 ID 和取消采用 ZCode 自身契约。

依据：本机 `node D:/Zcode/resources/glm/zcode.cjs --version/--help`，版本 0.16.9；未查得并验证完整公开远程控制契约，后续须以安装版本的源码/schema/隔离探针补齐。

涉及文件：ZCode 插件、共享 hook、`buildZcodeArgs()` 与对应测试。验收：不同权限模式的保存/恢复、审批真实阻断、无效 ID、不支持选项、busy、目录含空格、非 ASCII 文本、非零退出码。

### MaiBot/AstrBot：按适配器自身消息通道验收

继续使用声明式 HTTP 清单，给每个适配器公开版本、配置状态、健康与实际投递结果。MaiBot 固定 Uta 专用私聊身份，按原生消息 ID 关联回流；不把其他 QQ/群聊文本送到桌宠。AstrBot 依目标插件的公开协议独立验证，不能借用 MaiBot 的通过记录。

涉及文件：`maibot-adapter/`、`services/adapters/plugin-http.ts` 与清单。验收：其他聊天隔离、重复消息、宿主重启、端口冲突、Uta 绑定变化、超时后结果未知。截图和电脑控制保持单独能力，不因“可发文本”自动开启。

## 跨宿主验收脚本与交付顺序

每个宿主至少保留一份有版本、表面、插件版本、profile 和结果的验收记录：

1. 干净隔离配置加载插件 → 发现角色工具 → 握手 → 一条可见动作。
2. 建立 A/B 两个不同项目会话 → 固定 A → B 有活动 → 输入与待办只到 A。
3. A 关闭/过期 → 明确失败，不投 B，不自动创建新会话。
4. 发送前失败、入队后失败、收到请求后断线分别测试；未知结果不重复发送。
5. 工具失败、权限拒绝、用户中断分别映射；审批采用结果以宿主真正执行/拒绝为准。
6. 重复/乱序事件、宿主重启、Uta 离线后上线；镜像不完整时明确提示。
7. 用真实桌面目标表面完成一次收发与画面验证，不能只用 HTTP 接收或假 CLI 通过结项。

建议按以下批次实施，每批独立评审、验证和交付：

| 批次 | 内容 | 完成条件 |
| --- | --- | --- |
| 第一批：目标与投递公共规则 | 保留 DSH 修复，统一结果、目标快照和能力来源；核实 ZCode 权限默认 | 两项目不串线；未知不重发；没有权限静默放宽 |
| 第二批：Codex 与 Claude 稳定接入 | queue 语义、工作区/配置归属、结构化结果、任务镜像 | 两平台各完成目标表面的真实收发/失败/审批 |
| 第三批：Qoder 与 OpenCode 输入增强 | Qoder CLI 续跑试验；OpenCode 所属 server 输入与事件校正 | 可用模式和不支持表面能清楚区分，busy/断线不抢会话 |
| 第四批：Antigravity、ZCode 和其他适配器收口 | 每表面兼容、权限、真实消息归属 | 逐平台验收记录齐全，文档与 UI 同步 |
| 后续可选：托管会话 | Codex App Server / Qoder ACP / Cortico World | 用户明确选择该模式，并验证其会话所有权、取消和资源清理 |

每批都从隔离配置开始；本方案不包含自动安装真实插件、重启宿主、启动付费任务或修改用户默认权限。

## 与 Coopanion 能力借鉴的衔接

具体源码对比见 [Coopanion 对比与借鉴建议](COOPANION-COMPARISON-2026-10-31.md)。最先补齐公共发送规则，才能安全实现“摸头事件送给宿主”和“桌宠问题回答回宿主”。对没有可靠事件/回答通道的平台保留本地反馈，不用普通文本注入冒充其原生交互结果。

本轮只读源码、官方文档和本机 `--help/--version`，没有运行真实宿主任务、连接真实账号、安装插件或更改业务代码。既有代码与尚未验证的提案已分别标出。
