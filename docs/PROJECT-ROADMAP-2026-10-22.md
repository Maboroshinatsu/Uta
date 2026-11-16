# 全项目复查与执行计划

更新：2026-10-23。主控 Codex，执行 Qoder/Antigravity，DSH 仅测试本宿主。用户已授权主控规划并按需派发；阶段验收不等于批准 Worker 自行合并或发布。

最新增量规划见 [产品化与表现总方案](PRODUCT-PLAN-2026-10-23.md)：蓝色大色块、Live2D 表现基础优先、主控不在线时的有限队列。下文保留历史复查；未来优先级与新任务范围以总方案及其任务包为准，本轮未实施产品功能。

第一阶段已完成源码集成验收：应用 288/288、插件 104/104、类型检查和构建通过，另通过独立 profile 的真实 Electron 页面六项检查。详见 [首批集成验收](workflow/results/first-wave-integration.md)。日常 ZIP 仍为 dcf1b3f，没有随源码合并更新。第二阶段只完成设计审查，尚未实施设置迁移。

新增设置 UI/UX 改造需求已完成 Antigravity 首版/修订、Codex 源码与实际页面审查、主控方案和可点击线框，见 [设置与工坊改造方案](design/settings-ux-proposal.md)。独立窗口结构方向已获用户认可，视觉与细节迭代中，未改产品。目标为快捷区 + 独立设置中心（工坊在中心内）；先完成第二阶段的统一存储/窗口/能力接口，再分领域实施 UI，不能绕过数据边界直接开多窗口。

后续用户已认可独立窗口结构并提出桌宠最小化至任务栏、设置独立生命周期；已由 Codex/Antigravity 实际阅读指定飞书正文和所选 SPT 交互参考，吸收代表页先行、状态反馈、可逆编辑与输入法规则，见 [参考吸收与窗口补充](design/settings-ux-reference-review.md)。以上为方案与原型增量，非产品实现或发布。

## 当前判断与复查范围

复查 main/f814106 的入口与构建配置、renderer 启动、宿主选择、协议/桥/会话边界、聊天/语音缓冲、Agent 表现控制器、预设/陪伴/模型生命周期、持久设置、设置界面、测试和本机任务/发布记录；并分别派 Qoder 进行设置专项调查、Antigravity 进行诊断专项调查。专项结论仍须主控核对，真实 GUI/音频与四宿主端到端未因静态检查通过而视为验收。

本轮初始基线实跑：应用 252/252、插件 104/104、类型检查通过。日志在仓库外 operations/project-review-20261022/。初始单测未覆盖真实控制器组合，下面前三项缺陷在首批中修复并补充组合回归，其余项按阶段推进。

拆分后依然有大模块：emotion-adapter、main/index、Live2D loader、SettingsPanel、DeskpetStage、deskpet store；行数只是维护成本信号。本轮先修状态归属与测试缺口，不为缩小文件继续拆分。第三方模型为忽略资源，不进入发布/源码任务交付。

## 已确认的优先问题

| 问题与触发条件 | 证据/影响 | 处理 |
| --- | --- | --- |
| 切换可见会话后复用 requestId | resetSessionTurnState 未结束聊天流/清语音缓冲，未取消 TTS；新旧正文可拼接，isSpeaking 残留 | Codex 首批修复，保持历史消息，统一宿主切换入口 |
| 编辑工坊时宿主触发预设/控件预设 | triggerPresetOrGroup、handleControlAction 可绕过 handlePresetTrigger 的锁 | Qoder 首批修复，主动预览保留明确入口 |
| notify 脉冲先于 streaming 回复开始 | 脉冲计时器只看 agentWorkingState，rp_reply 会将其复位 idle，旧计时器可能关新口型 | Codex 首批修复，明确脉冲取消/归属 |
| Agent 表现控制器卸载 | 旁白/看门狗缺统一 dispose，可能在卸载后写状态 | 与 Codex 状态收尾一起修复并测假时钟 |
| 不清楚当前是哪份 Uta | 既有 getEnvironmentInfo 未在界面清晰展示；历史设置 origin 分离造成误判 | Antigravity 首批增加设置内诊断 |
| 设置依赖 localStorage origin | host/model/presets 多写入者、启动阶段读取，跨页面不统一 | Qoder 先交字段/冲突/接口设计，下一阶段实施 |
| 预设同时写 localStorage 与模型旁车文件 | 写盘 false 被忽略、非原子写，加载时磁盘优先；共享模型路径也会绕过 profile 数据隔离 | 下一阶段优先迁 canonical 设置，模型旁车改为旧来源/默认值，不自动镜像写回 |
| Antigravity 已安装插件 0.1.5 | hook 写日常目录，显式端点缺失可回退 stable；探针只能临时关插件 | 正式并发连接 Uta 前由 Codex 统一升级并验不回退 |
| 派单成功状态不可信 | Qoder permission_denials 可能为空但工具已拒；Antigravity SUCCESS 可无正文且有 TOOL_ERROR | 主控逐工具和产物验收，调度器后续固化 |

其他待验证项：切模型期间的陪伴快照/触摸计时器、异步加载失败回滚与卸载后的旧返回、窗口闪烁、语音/麦克风资源释放。尚未复现者不写成已修复或已确定根因。

设置专项与主控约束见 [设置迁移设计审查](workflow/results/settings-migration-design-review.md)，其中自动写模型旁车的方案已否决；未来实现必须保护共享资源和 profile 隔离。

## 分阶段路线与验收门槛

| 阶段 | Owner 与范围 | 依赖及完成条件 |
| --- | --- | --- |
| 第一阶段：运行正确性和环境诊断 | Codex 会话/说话状态；Qoder 工坊锁；Antigravity 独立诊断组件 | 各自独立分支，范围审查；组合回归、类型检查、应用/插件测试、构建通过；主控合并后验证实际页面 |
| 第二阶段：持久设置统一 | Qoder 实施，Codex 审核共享 IPC 与迁移策略；Antigravity 仅协助 UI 适配 | 首先锁定字段白名单、schemaVersion、原子写、旧 origin 冲突/回退和启动顺序；dev/file 同 profile 一致、不同 profile 不串写，写失败不丢旧值，不直接解析真实 LevelDB |
| 第三阶段：插件和派单可重复运行 | Codex 负责调度工具与真实安装；Qoder/Antigravity 提交各自适配 | 登记 worktree/base/profile/模型/真实会话；互斥、防重派、超时、取消、异常/权限不足和崩溃结果不明状态实测；升级旧插件后缺失端点不得回退 stable；不使用最近会话代替指定会话 |
| 第四阶段：宿主兼容性闭环 | Codex 验证 Codex/Qoder/Antigravity；DSH 只验 DSH | 分别证明发现工具、MCP、桥、会话归属及真实气泡/预设；headless 不代替桌面场景；产品内 Qoder/Antigravity 反向文本输入单独设计，不能拿开发派单通道冒充已适配 |
| 第五阶段：生命周期、语音和模型稳健性 | Codex 拆单，由两执行平台按文件归属实施 | 模型切换/卸载/重载无旧状态回灌；HTTP/云 TTS 取消及失败不改用户选择；STT 占用/取消/设备丢失可恢复；性能与闪烁先可复现再优化 |
| 第六阶段：持续验证和 ZIP 发布 | Codex 集成与发布；执行平台交测试/文档 | 固化有行为价值的组合测试和构建检查；有 remote 后再配置 CI；干净提交打 ZIP、独立目录解压 Uta.exe、integration profile GUI 验证、数据备份/回退/哈希记录后才提升日常入口 |

## 第一批任务与共享文件约束

- Codex：tasks/runtime-state-hardening.md。拥有 DeskpetStage、runtime-command-controller、agent-presentation-controller、reply-speech/chat、CompanionDirector 相关收尾与测试。
- Qoder：tasks/preset-edit-lock.md。仅预设控制器与专项测试，不改上述运行状态文件或设置 store。
- Antigravity：tasks/runtime-diagnostics.md。仅独立诊断组件/纯展示辅助、SettingsTab 挂载与组件 scoped 样式/测试，不改 SettingsPanel、main/preload、deskpet store、DeskpetStage。
- Qoder 的 settings-store-migration 本轮只收设计，不在其工作区并行做源码迁移。后续依赖第一批集成后的统一基线。
- 新增测试先通过显式 node --test 执行；app/package.json 的总测试注册由 Codex 集成时统一修改，避免多人竞争。
- Worker 不修改总台账、不合并、不全局安装插件、不启动日常实例。Cli 的工具权限与 worktree 协作边界不能被描述为系统安全沙箱。

## 发布与审查规则

本轮开发通过不自动替换已验收的 dcf1b3f 日常 ZIP。源码合并、候选包验收、日常提升分别记录；需要真实模型时只在独立 profile 中读取现有资源，不拷贝密钥、用户存储或模型进 Git。

仅修文档/业务用词过期处，不顺手纳入三份历史脏规划文件。后续 Agent 以 CURRENT、各任务单、operations 分配/运行记录和实际 Git 为准；历史完成状态不是实时进程证据。
