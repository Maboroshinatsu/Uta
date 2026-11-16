# 跨平台任务派发通道研究

日期：2026-10-22。研究时状态：已完成文档与本机入口核查，未实际投递。后续接入已安装 Qoder CN CLI 1.1.76，并完成只读探针和指定会话续接，见 [Qoder 派单连接验证](results/qoder-dispatch-connection.md)。下文未安装/未运行描述保留为研究阶段记录；当前事实以该验证记录与 CURRENT 为准。

Antigravity 后续也已安装官方 agy CLI 1.4.5，完成指定 worktree 只读探针与按 conversation_id 续接；桌面 Sidecar 未接通，专用项目绑定和旧插件隔离仍待处理，见 [Antigravity 派单连接验证](results/antigravity-dispatch-connection.md)。

角色：Codex 统筹；Qoder、Antigravity 开发；DSH 仅验收 Uta 在 DSH 上的兼容性。

## 1. 结论与建议

可以建立派单通道，但当前的任务 worktree 分配脚本还不是调度器。建议 Codex 读取已登记的任务，生成包含确切目录与 base 的提示，通过各平台支持的入口新建任务会话，保存真实会话标识与执行记录，最后收取文件/提交交付。

建议接入顺序：

1. Qoder CN 官方 CLI：先补齐 CLI，验证只读任务，再接开发任务。需要持续交互或细粒度权限回调时，再选择官方 ACP/SDK。
2. Antigravity 桌面 Sidecar + agentapi：优先研究复用现有桌面应用的通道。必须先验证项目与 worktree 绑定；缺少可靠结果/取消机制时，保留局限或切换官方 agy CLI。
3. DSH 已有 headless CLI：只在兼容性测试需要时启动，使用独立测试配置，不作为常驻开发 Worker。

统一任务台账，不强制三个平台使用相同传输协议。Uta 角色 MCP 和开发派单保持独立；不把派单功能塞进日常桌宠来要求它常驻工作。

## 2. 已验证的本机事实

| 平台 | 已见入口与只读检查 | 当前判断 |
| --- | --- | --- |
| Qoder CN | 桌面应用 0.4.8，位于 D:/Qoder CN；用户目录 entry/qodercn.cmd 是分发包装器，执行 --version 明确提示 CLI 未安装 | 桌面应用存在不等于可直接调用 qodercn；需安装独立官方 CLI |
| Antigravity | 桌面应用 2.25.0；resources/bin/language_server.exe 的 agentapi --help 返回 new-conversation、send-message、get-conversation-metadata；用户目录也有 agentapi.bat 包装器 | 已存在桌面程序入口，尚未验证创建/发消息；不能把 --help 成功当作派单成功 |
| Antigravity 独立 CLI | PATH 与已检查的常用安装位置未找到 agy | 仅确认这些位置未发现，未运行安装或登录；不是断言整个机器绝无副本 |
| DSH | D:/DeepSeek-Harness/resources/runtime/cli/bin/dsh.cmd；根帮助及 --profile headless --help 可正常返回 | 能指定 headless、stdin 任务、JSON 事件，恢复需要已存在的 session-id；尚未实际执行模型任务 |

Qoder 桌面包内虽有自身 SDK 及 worker-runtime 清单，不把其内置私有包、内部 IPC 或鉴权实现当成对外稳定 API。未修改任何桌面应用、平台配置、账号或插件安装。

旧 `app/src/main/host-bridge.ts` 中 Qoder/Antigravity 返回 unsupported，说明**现有 Uta 反向桥尚未实现该适配**；旧注释不能再被引用为“平台不存在官方程序化入口”的依据。开发派单适配与产品内的反向输入功能是不同范围。

## 3. 各平台通道

### Qoder CN：官方 CLI，后续可用 ACP

官方 CLI 提供工作目录、非交互执行、JSON/流式输出、指定恢复会话等参数。可以通过 stdin 传任务，避免 Windows 命令行长度和引号问题。参见 [CLI 参数](https://docs.qoder.cn/cli/cli-reference)。

命令形态（仅设计示例，当前未安装，未执行）：

```text
qodercn --cwd <登记的worktree> --print --output-format stream-json
```

由启动器以参数数组创建子进程，并向 stdin 写入完整任务契约；若该版本要求其他参数，以安装后的 --help 为准。保留真实会话 ID，不能用 --continue 误选最近会话；--session-id 属恢复入口，不拿随机新 ID 冒充已存在会话。

不使用 Qoder 自带的 --worktree 来再建第二层目录或触发自己的合并流程。使用 Codex 已分配的 worktree。官方 [ACP](https://docs.qoder.cn/cli/acp) 提供 stdio 协议入口，适合后续长期控制，但第一轮无需先实现整套 ACP 客户端。

认证按官方 [登录说明](https://docs.qoder.cn/cli/authentication) 处理。桌面登录可否被新 CLI 直接沿用尚未实测；不得读取/复制私有登录令牌来补洞，也不要求用户把 token 发到聊天中。安装来源参见 [官方安装说明](https://docs.qoder.cn/cli/installation)。安装与默认自动更新的影响须留痕，执行任务时记录实际版本。

### Antigravity：桌面 Sidecar，独立 CLI 作为备选

官方 [Sidecars](https://www.antigravity.google/docs/sidecars) 支持托管后台进程，并向它提供 agentapi 的创建会话与发消息入口。创建会话依赖配置中的 projectId；不能仅在 sidecar 进程上设置 cwd 就声称新 Agent 进入了该 worktree。

本机帮助也显示了 new-conversation/send-message/get-conversation-metadata。其未在上述页面解释的参数（例如本机帮助中的 --profile）不猜测含义，不把它当作 cwd 使用。

先把专用测试项目绑定到 Antigravity 任务 worktree，按官方方式配置并启用专用 Sidecar。Sidecar 接收 Codex 的本地任务文件后调用 agentapi，把返回的会话标识写回；后续只向这个已登记会话发送消息。当前没有启用 Sidecar，也没有新建会话。

正式采用前须验证：目录绑定、项目权限、真实会话 ID、状态查询、交付文件、取消行为，以及 Sidecar 重启时不会重复派单。现有公开入口未证明取消能力和完整结果订阅；停止 Sidecar 也不等于停止已经创建的 Agent 任务。

如果桌面通道不满足这些条件，可采用 [agy headless](https://www.antigravity.google/docs/cli/headless/) 作为备选，用子进程 cwd 指定任务目录、流式事件收集结果。官方 [认证说明](https://www.antigravity.google/docs/install?tab=cli) 描述了跨本地产品的凭据体系，但本机 CLI 安装、认证与具体版本仍须实测；不能提前承诺登录、模型选择或可用额度。

### DSH：已有 CLI，仅发测试任务

本机帮助确认的命令形态：

```text
dsh --profile headless --json -
```

任务通过 stdin 输入，启动时 cwd 指向 DSH 测试 worktree，并注入对应 Uta profile/端点。新任务不传未知 --session-id；记录实际返回 ID 后才能恢复。上述 --help 检查未运行推理。

headless 是宿主运行模式，不自动等同于完整桌面兼容性验收。测试必须检查它是否加载目标 Uta 插件、相应状态和审批路径是否实际存在；要求桌面现象的项目还须在桌面测试会话中验证。报告区分通过、失败、未执行，不把缺失能力算通过。

## 4. 最小调度器设计

拟新增独立的开发工具（当前尚未实现），读取 operations/assignments，不允许任意传入其他目录绕过任务登记：

```text
任务契约 → 预检 → 适配器启动/投递 → 真实会话登记 → 事件/结果文件 → Codex 审查
```

每次运行记录 task、attempt、平台及 CLI 版本、worktree、branch、base、profile、提示摘要校验、会话 ID、进程身份（适用时）、日志和起止时间。token、账号私密信息不写入任务台账。

预检必须确认：目录属于登记的 worktree、Git 分支与 base 匹配、没有其他执行者占用、任务状态允许启动、配置目标与运行目录一致。平台模型沿用已明确的设置，记录实际使用结果；不默默替换模型。

状态需区分：待启动、派发中、运行中、需要处理、已提交、验收通过、取消中、已取消、失败和派发结果不明。派发成功不代表任务完成；退出码 0 也不代表完成条件达成。

传输不明确时不要自动重复发送：例如创建会话成功后尚未来得及写会话 ID 就崩溃，进入“派发结果不明”，由 Codex 核对，不能因为没有收到本地回执而再次创建模型任务。Sidecar 自动重启尤其需要此保护。

运行结束由 Codex 独立检查实际 diff、范围、head SHA、结果文件和测试证据。平台消息与自报完成不是验收依据，合并权始终留在 Codex。

## 5. 权限、进度与取消

官方无界面模式会受平台权限策略限制。初期保留默认审核，不自动启用跳过全部权限的模式；读写和测试命令按具体任务配置。需要用户或主控处理的操作进入明确状态，不通过自动点击批准继续。

Antigravity 官方 headless 文档明确存在“工具被软拒绝，但程序仍退出 0”的情形，所以必须解析事件、诊断和实际产物，不能只看退出码。[来源](https://www.antigravity.google/docs/cli/headless/)

CLI 模式记录自己启动的进程身份，先发送平台支持的取消，再核对是否停止；不得按平台名称杀掉用户所有进程，也不能假设关闭客户端就会取消服务端任务。若平台没有已验证的取消接口，能力表必须标为未验证/不支持，保留人工处理，不伪造“已取消”。

## 6. 第一轮实际验证建议

1. 补齐 Qoder CN 官方 CLI，仅先验证版本与登录。再在专用 worktree 发一张只读探针任务：读取 AGENTS、任务单，报告 pwd、Git 分支/base 与可见 profile，不改文件、不执行开发任务。
2. 验证能收到真实会话 ID、结果和日志，以及重复启动会被阻止。再验证取消/超时和权限不足的状态；全部通过后才派一个小范围实现任务。
3. 为 Antigravity 配置只绑定专用任务项目的 Sidecar；同样先做只读探针。若不能可靠指定项目或收取结果，改用 agy CLI，不通过桌面内部服务拼接不公开的调用。
4. DSH 只做测试入口握手，随后按 DSH 兼容性任务单验收，不发开发任务。

本轮完成的是“入口发现与方案”；实际投递、登录、任务执行、取消和四平台端到端隔离仍未验证。无需改动或重新打包当前日常 Uta.exe。
