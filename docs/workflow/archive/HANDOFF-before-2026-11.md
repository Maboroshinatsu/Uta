# 交接归档 2026-11 之前（旧格式，74 个小节）

> 归档说明：本文件是从 docs/workflow/HANDOFF.md 拆出的历史交接条目，只作历史参考，
> 不代表当前现场。当前现场见 ../../HANDOFF.md 与 ../CURRENT.md。
> 文中出现的 D:/Frankenstein/Uta-Workspace/ 路径属于 2026-10-24 已弃用的证据区，均为历史记录，不可当作现在的写入目标。

# Uta 当前开发交接

更新：2026-11-01。读者：接手本项目的开发会话。用户进度入口是 [CURRENT](CURRENT.md)，产品顺序是 [1.0.0 方案](../ROADMAP-TO-1.0.0.md)。本文件随实际进展更新，不另建平行总台账。


## 2026-11-01 深度对齐 VTS 参数标准与物理/幽灵参数彻底净化

- 基线 main@08bf140，提交 fb56699。
- **[OPT-VTS-STANDARD-SLIDERS: 深度对齐 VTS 参数标准与物理输出/幽灵参数彻底净化]**：
  - 资产层解析：在 main/index.ts 收集 *.vtube.json 中的 ParameterSettings 到 vtubeParameters，并在 env.d.ts 与 loader.ts 中同步类型；
  - 抑制官方死参数：当模型有 AngleX/Y/Z 或 PositionX/Y/Z 时，自动抑制官方未连接的 ParamAngleX/Y/Z 与 ParamBodyAngleX/Y/Z，消除双重滑块与假滑块；
  - 识别 VTS 核心五官：在 emotion-adapter.ts 建立 VTS_KNOWN_META，把 EyeSmile（笑眼）、CheeckPuff（鼓脸）、TongueOut（吐舌）、JawOpen（下巴张开）、Mouthpucker（嘟嘴）、MouthFunnel（圆嘴）、NoseNeer（皱鼻梁）等 30+ 项 VTS 参数映射为第一梯队的核心滑块；
  - 物理与通道彻底过滤：双重守卫彻底剔除 292 个物理输出参数，正则剔除内部粒子花瓣、闪烁特效、汗水层及语音通道；
  - 大肥鱼工坊滑块由 426 个大幅收敛精简至 44 个真实、可调、即时生效的清晰滑块。
- **验证与产物**：
  - 应用单测 1229 项全部通过（1223 pass, 0 fail, 6 skipped），插件单测 124 项全部通过，Node/Web 类型检查 0 错误。
  - 发布压缩包刷新：app/release/Uta-0.2.0-win-x64.zip（SHA256: 2d5be2c0d14b109a24bad54543429075154f5419de3afffcf5f10620047eaf84）。
- **现场与状态**：Git HEAD fb56699，工作区干净。



## 2026-11-01 大肥鱼多阶段控件（大/中/小）、反向开关、手势姿态与VTS核心姿态滑块全面适配

- 基线 main@b4d62df，提交 06bd6ce。
- **[FEAT-MULTI-STAGE-CONTROLS: 大小变三阶段（大/中/小）与多阶段控件引擎支持]**：
  - 数据模型：ModelControlTarget 与 ResolvedModelControl 增加 stages、currentStageIndex、defaultStageIndex。
  - 控制引擎：getActiveControlParams 提取激活阶段参数；applyControlActionToList 支持循环递进切换（大 -> 中 -> 小 -> 大），支持冒号直达语法（大小变:中、大小变:小），返回默认阶段时自动标记 active = false；reset 恢复默认阶段；
  - 锁钉逻辑：toggleHeldControl 支持阶段循环并在非默认阶段维持 held = true，回到默认阶段自动 unpin；
  - 界面呈现：QuickSettingsPanel 与 SettingsStudioTab 控件胶囊增加阶段微标（[大]、[中]、[小]），使用 Blue Biophilic 配色。工坊步骤编辑支持记录并持久化包含阶段的动作项。
- **[FIX-DAFISH-TOGGLE: 修正大肥鱼反向开关与手势肢体参数补齐]**：
  - 长短裙切换：改用两阶段状态，阶段 0 为长裙（Clothes1: 1），阶段 1 为短裙（Clothes1: 0）；
  - 尾巴开关：改用两阶段状态，阶段 0 为开（Clothes5: 1），阶段 1 为关（Clothes5: 0）；
  - 肢体手势：为“抚胸”、“狗尾草”、“竖食指”补全作者原生动作中的肢体与关节参数（Param56、Param59~62、Param36/39/41~43 等），恢复真实手部姿态。
  - 同步更新三个配置源：内置适配表、文档适配表以及用户日用模型配置。
- **[OPT-SLIDERS-VTS: 适配 VTS 模型头部与身体核心姿态滑块及分隔符过滤]**：
  - resolveModelSliders 接入 focus 映射，自动将 VTS 模型的 AngleX/Y/Z 与 PositionX/Y/Z 解析为第一梯队的核心姿态滑块；
  - 新增正则过滤，彻底剔除 VTS 纯占位分隔符（Divider*、■■■）与无用内部触发键（Anikey*、SWITCH*）。
- **验证与产物**：
  - 应用单测 1228 项全部通过（1222 pass, 0 fail, 6 skipped），插件单测 124 项全部通过，Node/Web 类型检查 0 错误。
  - 生产构建与发布打包顺利完成：app/release/Uta-0.2.0-win-x64.zip（SHA256: 0626f7e51218706f81539be139eb41c3bb29c18c13129d64574674e3bba0a259）。
- **现场与状态**：Git HEAD 06bd6ce，工作区干净，日用 profile 完整。


## 2026-11-01 Codex 聊天自动恢复与日常连接体验

- 基线 main@b4d62df，用户已确认自动恢复、默认跟随主动发言的聊天、固定聊天可选的方案。
- 新增实例内 codex-conversations.json，仅保存聊天 ID、标签、工作目录、活动时间、可用状态和自动目标，最多 64 项；固定目标及当前自动目标受保留。旧 profile 内的 hook 会话记录可迁入。聊天历史正文、令牌和工具参数不进入该缓存。
- RuntimeBridge 在鉴权、宿主过滤、去重之后记录会话活动；Codex 的聊天列表、发送就绪与实际发送共用持久化目标。后台工具结果/完成/新会话握手只更新活动；UserPromptSubmit 的 userInitiated 标记才切换已有自动目标。兼容已安装旧 hook 的专用“思考中...”标签，处理结果/处理失败的 thinking 状态不能抢目标。
- Codex 的已知聊天保留到重启后，30 分钟无活动不再拒绝 queue；实际线程失效由原有 CLI 回执确认，并标记目标不可用。固定目标缺失时保持选择，发送失败保留草稿；其他宿主的过期、权限和忙碌校验维持原语义。普通 CLI/参数错误不误判为聊天被删除，未知投递结果保留 unknown 语义。
- 连接页每 2 秒后台更新聊天列表，固定聊天收进可选展开项，本机端点收进诊断。Codex 长时间无活动显示待命，移除要求登记后手动刷新的日常提示。
- 验证：应用 1225 项（1219 通过、6 跳过），插件 124/124，Node/Web 类型、应用构建和插件构建通过。真实隔离 Electron 三轮验证了后台不抢目标、主动发言切换、窗口自动更新、重启恢复一天前的固定聊天、失效固定聊天保持选中且禁止发送。发送队列使用受控 CLI 替身验证精确线程；真实账号发送仍待用户使用验收。
- 现场开发 profile dev-f7e444bba875 的 PID 18932 为更新前的主进程，完整重启 Uta 后加载新逻辑。app/out 及 plugin/dist 已更新；本轮交付为源码与开发启动构建。日常 ZIP 保持上一批候选包来源，后续打包需基于本次提交。
- 结果与 UI 截图保留在本机临时目录的 uta-conversation-ui-*；测试实例已经退出。后续先确认重启后的自动回复目标及固定聊天，然后再验收真实 Codex queue 的回执与回复归属。


## 2026-11-01 动作工坊与宿主导演审查缺陷修复及日常候选包发布

- 基线 main@c4b9b9e，原子化修复提交 5 个：81f5272、7748751、3816187、3c3de95、b64502d。
- **[P1.1: 修复预设工坊一键生成重复预设ID]**：在 deskpet.ts 引入 timestamp + random + counter 生成机制与 currentList.some 冲突检测防抖，彻底消除密集同步批量保存下的 ID 冲突；单测验证连续 24 动作 ID 严格唯一。
- **[P1.2: 修复成对手势重新编辑丢失起手收手动作]**：在 SettingsPanel.vue 中对 applyWorkshopSnapshot、loadPresetIntoEditor、previewEditingSequence 补充 s.motion 的深拷贝保留，防止重新编辑或撤销时起手/收手原生动作被丢弃。
- **[P1.3: 修复宿主导演将异步排队回执当成计划回复]**：在 SettingsPanel.vue 的 sendPromptToHostDirector 捕获 delivery === 'queued' 与 queued 回执，明确展示排队中状态，杜绝误报格式错误和重复投递。
- **[P2.1: 修复嵌套多角色模型包扫描动作跨角色串入]**：在 model-import.ts 的 collectVtsSidecars 增加目录层级边界守卫，遇到包含独立 .model3.json 的子目录时停止下钻，防止子角色动作注册进父角色。
- **[P2.2: 修复动作导演标准头部转动参数名匹配]**：在 natural-action-planner.ts 增加 resolveParamKey 动态探针，自适应匹配 ParamAngle* 与 Angle*、ParamEyeBall* 与 EyeBall*，恢复对 Hiyori 等标准 Live2D 模型的头部驱动。
- **[P2.3: 补齐渲染端 direct_actions 执行分支]**：在 env.d.ts 与 RuntimeCommandController 补齐 direct_actions 载荷与执行路由，在 DeskpetStage.vue 接入自然动作编译并以 revert 模式执行预设。
- **[P2.4: 增加动作导演计划粘贴反序列化空值容错]**：在 natural-action-planner.ts 强化正则匹配并过滤 actions 中的 null/非法对象；在 SettingsPanel.vue 增加 try-catch 兜底与可操作性格式指引。
- **验证与产物**：
  - 应用单测 1217 项（1211 通过、6 跳过、0 失败），插件单测 124/124 全部通过，Node/Web 类型检查通过。
  - electron-builder --win --dir 刷新绿色产物 app/release/win-unpacked/Uta.exe。
  - 发布压缩包 app/release/Uta-0.2.0-win-x64.zip 生成就绪（SHA256: fc713019ea922753fd67d6e3d28dd6760ca0cbb97d44634a01bfb4ecc86a7f93）。
- **现场与环境**：Git HEAD b64502d，日用 %APPDATA%/uta 完好无损。

## 2026-11-01 Codex 宿主配对与重连修复

- 基线 main@52fe990。用户授权修复开发实例切换到 Codex 后离线、重连提示不结束的问题。
- 手动切换/重连通过 pet-switch-host 为当前实例发布 host-pets/<host> 配对，绑定文件保存 sharedDiscovery；普通开发/候选实例和旧绑定默认仍用私有端点。冲突时不覆盖其他存活实例，写绑定失败则恢复此前端点；同路径配对可在原实例退出后重试。
- 在线状态同时采用本实例最近收到的宿主会话。Hook 探测 5 秒超时，旧请求不能覆盖重连或断开后的状态；快捷面板离线时结束等待并提示。设置窗口等待异步配对结果。
- 独立源码副本只含本次连接修复，避免混入并行的动作导演修复。全量应用 1212 项（1206 通过、6 跳过）、Node/Web 类型、构建通过。真实隔离 Electron 证明未手动配对前无共享端点，手动配对后客户端发现同实例并完成 Codex hello，getHookStatus 在线；第二次启动自动恢复配对。这里使用测试会话，真实 Codex 仍须在当前 Uta 重启、点击重新连接并收到下一次真实 hook 后验收。
- 现场日用中的源码开发 profile 为 dev-f7e444bba875。原主进程尚未重启加载修复。工作区另有用户的预设、导入、动作导演修复；本次只提交连接改动，DeskpetStage.vue 仅暂存 reconnect 的两行修改。未安装或重启 Codex 插件。


## 最新：[LIVE2D-CAPABILITY-FACTS: 能力事实与只读诊断]

- 基线 `8791928`，提交 `637315c`、`29f29df`、`a43ca9a`、`297df13`、`0881805`、`8eee8f0`。本轮只补事实导出、诊断、试听入口和导入保护，不改播放、优先级、预设执行、设置 UI 或默认表演谱。完整记录见 [实施结果](results/live2d-capability-diagnostics-20261101.md)、[重导验证](results/dafish-reimport-20261101.md)、[资源试听与黑块修复](results/dafish-resource-audition-20261101.md)。
- inspection 将每条 motion 的 `Meta.Duration`/`Meta.Loop` 和 `Parameter`、`Model`、`PartOpacity` 曲线分开保留；能力 profile 对旧 schema v1 向后兼容。`buildModelCapabilityFacts()` 输出模型签名、Core 参数、表达式写入、原生动作、有效 focus/口型/adapter 绑定及结构化诊断，输出与输入对象脱离。
- 收尾提交 `297df13` 补全了事实：`modelUrl`、`motionGroups`、`unregisteredExpressions`、`parts/poseGroups`、adapter 的 base/hidden/controls，以及应用内 `resolved.baseParameters/controls`（含 defaultActive、hidden/shown parts、held）。未注册 exp3 现在按旧校验器同样规则参与表情判断，不再误报缺失；新增 `missing-part`，默认口型参数缺失降为 warning。
- 控制台新增 `deskpetInspectModelFacts()`；旧 `deskpetInspectModel()` 保留为简表。adapter 校验和 `MODEL-ADAPTER-SPEC.md` 已改为推荐新入口。专项脚本为 `npm run test:live2d-capabilities`；新测试已同时加入 `npm test` 主列表。
- 真实 Hiyori：`Tap#1` = 2100 ms、loop、33 Parameter 曲线、0 Model、2 PartOpacity（`PartArmA/PartArmB`）；`emotion:happy`、`animation:wave`、`animation:cheer` 共用它，但三个语义分别产生 review，不能据结构事实声称画面成立。
- 真实大肥鱼：隔离 profile 重导已恢复 23 个表情、8 个动作、509 个参数、147 个部件，真实 Electron 加载并启动 `IDLE` 成功；详见 [重导验证](results/dafish-reimport-20261101.md)。按用户明确选择“装回日常并备份”，已把完整模型和 adapter 同步到日用 `C:/Users/Administrator/AppData/Roaming/uta/models/imported-character-072c7e1cdc`；旧目录备份在 `%APPDATA%/uta/.model-import-backups/dafish-pre-sync-20261101`。日常真实实例已加载 23 表情/8 动作、21 控件、9 情绪，截图无鼻子黑块；详见 [日常同步](results/dafish-daily-sync-20261101.md)。
- 重导后的生成 adapter 仍只绑定 `idleMotions: ["IDLE"]`、focus 和口型；仅靠它会导致鼻子蒙版黑块回归。已装回仓库已知 adapter，并在导入器加入“替换重导且源包无 adapter 时保留目标 adapter”的保护；真实替换重导验证 23 表情/8 动作、8 个 base 参数、21 控件、9 情绪和两个隐藏网格都保留，近景无黑块。
- 新增原生表情试听入口 `deskpetListExpressions()` / `deskpetPreviewExpression()` / `deskpetClearExpression()`，已完成 23 表情、8 动作、50 帧联系表。全身/服装/道具表情和手部动作可见；`脸红`近景可见；兔牙、圈圈眼、屑、流冷汗、流泪、爱心眼、黑脸、＞＜、单片眼镜的脸部机位仍不够清楚，不能据此宣称视觉验收完成。所有 8 个动作 `Meta.Loop=true`，接入计划必须声明结束策略。
- 新增内置适配目录（`b392071`）：静态 adapter 随程序发布，按模型签名精确匹配；解析顺序为本地 `deskpet-adapter.json` → 内置签名匹配 → 自动草稿。大肥鱼已验证 adapter 已按恢复后的签名内置；临时移走本地 adapter 后真实 Electron 仍以 `adapterSource: builtin-adapter` 加载 23 表情/8 动作、21 控件、9 情绪和两个隐藏网格。详见 [内置适配验证](results/dafish-builtin-adapter-20261101.md)。
- 验证：应用 1177 项（1171 通过、6 跳过）、专项 163 项（158 通过、5 个任务本地真实 DS 样本条件跳过）、Node/Web 类型、共享契约、构建通过；重导、替换保护、内置回退和日常加载均有真实 Electron 证据。日常 profile 的模型目录已按用户选择同步，宿主配置/TTS/密钥未改；`win-unpacked` 已用 `b392071` 重建，包含 DS/Hiyori、内置适配和新代码，用户快捷方式已保留。
- 下一步：先把脸部特写机位修正，重拍 9 个未看清的脸部表情；再把已看清的服装/道具表情和 8 个动作映射到 adapter/表演计划。之后再做“统一解析影子对照”，adapter/预设投影为同一计划，先记录选择、资源和参数占用，旧播放继续执行。不要直接跳到表演谱、UI 或默认谱。首个画面对照仍是 DS“轻开心”保持口型和鼠标 focus，但尚未验证该表现。

## 最新：[RELEASE: 0.2.0 稳定 ZIP]

- 版本提升到 `0.2.0`，ZIP 来源 `147920a`（`dirty:false`），产物 `app/release/Uta-0.2.0-win-x64.zip`，SHA-256 `e55fbfb588a536e65ab72ab20ed8b7194c99efaed3d858cd126047806a187dd0`；`sharePackage:true`，含 `DS-control/c_0120` 与 `hiyori_pro_zh`，DSH 插件资源为 0.5.6。
- 发布门禁：应用 **1153 项（1147 通过、6 跳过、0 失败）**，插件 **124/124**，typecheck 与构建通过；解压 ZIP 后以隔离 profile 真实启动，环境版本 0.2.0、健康检查正常、设置七页可达、0 渲染错误。
- 打包修复：新增的 `yauzl` 模型导入依赖原先被 electron-builder 排除，导致解压包启动报 `Cannot find module 'yauzl'`；已在主进程构建中内联该依赖并重新打包。另将 ZIP 构建改为使用本地 Electron，避免下载 TLS 失败。
- 未做：没有替换日常 stable 数据、没有设置 `operations/stable.json`、没有安装/重启真实宿主、没有签名；DSH 运行实例仍是旧插件。真实宿主端到端和 8 小时/7 天验收仍待完成。

## 最新：本轮核心实施已收口

- Antigravity 0.1.7：所有角色指令附 v2 conversation/event 归属，审批也带 session；workspacePaths 只有一个有效目录才绑定，多目录以显式空 cwd 清除旧单目录。UNKNOWN Stop 回 idle，不发成功或暂存摘要。默认文本仍在宿主。
- 共享 hook 和 Qoder 记录 busy/idle/unknown，节流键含活动状态；PreToolUse→Stop 即使间隔不足 2 秒也能落 idle。resume 会话 busy 时禁止启动，Qoder CLI 必须 idle；输入打开时每 2 秒刷新可用性。Codex/OpenCode queue 不再被最近 2.5 秒的事件挡住。
- OpenCode 每个插件桥写独立 UUID 文件，逐会话保存 nativeBridgeId；发送/就绪检查使用指定桥且缺失不回退 global latest。兼容旧 metadata 的 global 文件仅在未指定桥时使用。测试覆盖 A 所属桥与 B 全局桥同时存在、A 消失后不投 B。
- fixed session 的 cwd 优先使用精确保存记录，空 cwd 不借旧 runtime.cwd。协议明确空 session_bind.cwd 会清除旧根，缺省仍保留。
- 最终应用 1147 通过/6 跳过、插件 124/124；Node/Web 类型、app/plugin 构建通过。模型导入 GUI 的最终证据 `gui-import-result.json` 含前后能力与 Live2D 预览通过；私有进程已退出、端点移除，7 个隔离 profile 保留（自动审批拒绝递归删除，只返回 blocked by policy），日志/截图/脚本保留 `.tmp/host-adaptation-20261031`。主目录 main，源码提交清楚，无真实账号任务、宿主安装/重启或日常数据写入；app/out 已更新，没有本轮最终 ZIP。
- 剩余验收：真实 Codex/Claude/ZCode 精确续会话，Qoder CLI（实验）实际 JSON 与并发语义，OpenCode 2.x 真实 SDK/插件加载，Antigravity 各表面实际审批采用，最终包。可选互动回传/状态节奏/问题卡/STT/OBS/走动/Cortico 没有默认启用，不能据本轮宣称全部完成。

## 最新：角色导入与能力版本

- `model-import.ts` 只暂存数据型文件，限制 ZIP/目录数量、大小、路径、链接；Live2D 必要 Moc/贴图检查，缺可选资源降级记录，ImageSet 默认图必要。临时清单不改原文件。token 绑定 settings sender，取消/关闭清理；预览通过受控 uta://model-import 读取。
- 保存复制到 prepared 后再复核，旧目录移出 models 后用已准备目录原子替换；journal 在进程中断后恢复旧目录，恢复记录损坏只关闭导入，不阻止启动。用户当前角色在保存阶段不切换；同名替换需明确勾选。yauzl 2.10.0 从现有依赖提升为直接运行依赖。
- 独立 ModelImportPreview 复用 Core/Pixi 加载，设置窗口显式安装已有的 CSP 兼容模块；不放宽 unsafe-eval。取消销毁模型/纹理；当前桌宠不受预览影响。
- 模型上下文含 ready/kind/revision/animations。每次模型/能力/预设变化产生版本，MCP 记住查询版本并在后续动作携带；运行时拒绝旧版/加载中/不支持动作，向 renderer 附实际版本，renderer 再拦截换模后迟到动作。ImageSet 只报告自身表情，无 Live2D 动作/预设。
- 应用 1145 通过/6 跳过，插件 123/123，Node/Web 类型、app/plugin 构建通过。真实 Electron 私有 host-import-test7 证明立绘预览→保存保持 Hiyori→点击使用切静态、能力版本变化且动作/预设为空、Live2D Hiyori 独立预览、1080/760 无溢出。结果/截图保留在 `.tmp/host-adaptation-20261031`，所有测试 Electron 已退出，7 个 profile 保留（自动审批拒绝清理）。日常数据/真实宿主未写，尚无最终 ZIP。
- 下一步收口 Antigravity 事件归属和 resume 宿主忙碌检查；可选互动回传和状态节奏按原方案处理，STT/OBS/走动/Cortico 不在本轮默认范围。

## 最新：Qoder CLI 与桌面路线分离

- 新增随包 `runtime/launch-qoder-cli.mjs`（源码 scripts 同名文件）。显式绝对 CLI 程序/已有配置目录，当前进程环境登记表面；自动带本插件目录。全局配置/环境未修改。
- hook 原子保存逐会话 metadata，含 surface/executable/config/plugin/permission；只有明确 CLI 完整登记可发送，主进程不从桌面会话猜 CLI 配置。JSON 输出按目标 ID 验证，权限显式继承。
- Qoder 插件 0.1.11。修正 Codex MCP 缓存回退路径到插件 0.2.3，并以 manifest 检查 hello SDK 版本，避免两个版本不同步。
- 应用 1138 通过/6 跳过，插件 122/122，Node/Web 类型与插件构建通过；真实 Qoder CLI/桌面和 OpenCode 2.x 画面仍未验收。无本轮遗留服务或真实安装改动。下一步模型导入与能力变更告知。

## 最新：宿主适配第二批——真实能力与结构化结果

- `getHostInputStatus()` 是主进程统一状态来源，经受信 IPC 给输入框和连接页；不再由 renderer 写死 host 列表。区分 implementation/configuration/session readiness。
- Claude `--output-format json`、ZCode `--json` 按目标 session 解析；只使用宿主结果字段，日志与工具文本排除。已接收但处理失败标 completed，不恢复重发草稿。
- OpenCode 现有插件实际为 2.0.32，旧计划的 1.x 基线推断有误，已纠正文档。插件建立本机鉴权桥，以 `ctx.session.get` 校验 ID/cwd，`ctx.session.prompt(delivery:queue)` 持久输入箱回执显示 queued；桥缺失不改走磁盘 1.14.31 CLI。
- OpenCode 打包改用 bundler，所有指令附 v2 meta；会话元数据按 ID 保存，日志与桥跟随显式 runtime，Todo 只在 success 确认。工具缓存以 session+callID 隔离，退出只删本 token 桥文件。共享 hook 也禁止 PreToolUse 提前提交 Todo。
- 插件版本：Claude 0.1.10、ZCode 0.1.7、Codex 0.2.3；需配套更新，未改真实宿主安装。应用 1137 通过/6 跳过、插件 121/121、类型与构建通过；本轮无遗留测试服务/进程，无日常数据写入。
- 下一批：Qoder CLI 与桌面表面分清，再做模型导入/能力变更告知。真实宿主/画面/最终 ZIP 验收尚未开展。

## 最新：宿主适配第一批——投递结果与精确会话元数据

- DSH 修复已复核整合为 `636560d`，用户确认允许接手，基线干净。实施目标见 [任务记录](tasks/host-adaptation-20261031.md)。
- `HostBridgeResult.delivery` 区分未发送/排队/接收/已完成/未知；renderer 使用同一投影，unknown 不当作 failed 回填。历史保留 v1，新增可忽略的 `deliveryStage:queued`，旧读者仍可读取 sent。截断的 DSH HTTP 响应也会收尾为 unknown，不悬挂或补发。
- 共享 hook 原子写最新记录与 `hooks/sessions/<host>/<sha256(sessionId)>.json`，按会话保留 cwd、CODEX_HOME/CLAUDE_CONFIG_DIR 来源及 ZCode 权限模式；固定目标只补入 ID 匹配的记录，兼容只有最新文件的旧插件。发送前核对 host 并复制目标，IPC 核对当前绑定平台。
- 本机 ZCode 0.16.9 已核实：prompt 的默认 yolo 作为 modeOverride 优先于保存模式。现由可信 hook 的 permission_mode 登记，未知模式拒绝直发，已知模式显式传入。未运行真实账号验证；新插件必须配套更新后才有新登记信息。
- 新增行为回归覆盖排队持久化/重启、unknown 不恢复草稿、跨宿主目标、ZCode 未知模式不启动与显式 plan、A/B 元数据隔离、DSH 部分回执。全量应用 1132 通过/6 跳过、插件 117/117、类型与构建通过。
- 现场：本轮无 Electron 实例/profile，无新后台服务，未安装真实插件、未改日常数据。日志在 `.tmp/host-adaptation-20261031`；下一批继续统一能力来源与宿主结构化输出，后续模型导入和互动按任务记录推进。

## 最新：2026-10-31 修复 [P1: DSH 指定会话失效时消息误投其他会话] 与 [P2: DSH 原生桥回执中断后自动回退命令行可能重复投递]

- 基线 `main / f98bbef`（审查报告提交），开工工作区干净。工作目录 `D:/Frankenstein/Uta`，分支 `main`，未提交 4 个文件；本轮未安装插件、未启动 Uta、未写日常数据。
- **[P1: DSH 指定会话失效时消息误投其他会话]** 两层都错，两层都堵：
  - 插件 `src/index.mjs` 原生桥 `/message`：旧逻辑 `agents.get(requested) → 活动会话 → 最后一个 root` 三级回退。现在**有显式 `sessionId` 就只精确查一次**，查不到回 `409 session-not-found`；查到还复核 `agent.session.id`，不一致回 `409 session-mismatch`；**只有调用方完全没给 `sessionId`** 时才允许活动会话/root 兜底。
  - 主程序 `app/src/main/host-bridge.ts`：旧逻辑只认 `ok && accepted` 再把请求 ID 覆盖回去（`{ ...native, sessionId: session.sessionId }`）。现在校验回执的**实际接收会话**，为空或不等于目标就返回 `ok:false / code:'no-session'`，并明说"宿主回报的接收会话是「X」，与目标「Y」不一致"。
- **[P2: DSH 原生桥回执中断后自动回退命令行可能重复投递]** `sendNativeHarnessMessage()` 从「结果或 null」改成三态：`unavailable`（桥信息缺失/过期、HTTP 401/404、`ECONNREFUSED`/`EHOSTUNREACH`/`ENETUNREACH`/`ENOTFOUND`/`EADDRNOTAVAIL`/`EACCES`、请求未刷出即报错）才允许回退 CLI；`unknown`（5s 超时、发出后 `ECONNRESET`/`EPIPE`）**禁止回退**，直接报"消息可能已经送到宿主，为避免重复投递，这次没有自动改用命令行重发"；`result` 原样返回。请求体新增 `messageId`（`crypto.randomUUID()`）由插件回传，仅作回执关联，**不是**跨通道幂等。
- 回归（每条都验证过「在旧代码上失败」）：
  - `plugin/tests/deepseek-harness-plugin.test.cjs` +3：目标失效不得改投（先把活动会话设成 B 再请求 A）、精确命中并回传 `messageId`、无目标时仍按活动会话兜底。
  - `app/tests/host-bridge.test.cjs` +4：回执会话不一致不得报成功、目标不存在不改投且直接失败、收下后断线不得改走命令行、连接被拒仍允许回退。
  - `git stash` 单文件复验：3 条 P1/P2 断言在旧源码上失败，1 条「连接被拒仍回退」新旧都过（它守的是既有可用路径）。
  - 审查方探针 `.tmp/review-20261031/host-boundary-probes.cjs` 回放：在「B 应收到 1 条」处实得 0 条而失败 = 旧 bug 不再复现；修复后期望版本在 `.tmp/review-fix-20261031/probe-fixed.cjs`（三场景结果见同目录 `results.json`）。
- 验收：插件 **117/117**；应用全量 **1130 项（1124 通过、6 跳过、0 失败）**；`npm run typecheck` Node+Web 通过。
- 接手状态：用户已确认原会话收尾并授权接手。后续宿主适配实施前重跑应用 1124 通过/6 跳过、插件 117/117、Node/Web 类型检查通过，将本批修复独立纳入基线。真实运行中的插件是否生效仍需独立核对，不能由源码提交推定。
- 下一步建议：① 重启 DSH 后按插件 `HANDOVER.md` §14.7 / §15.4 验收；② 真实宿主里手动验一次"目标会话被关掉后再直发"的提示文案；③ 若要给 `unknown` 态补「查询投递结果」，需要宿主侧提供可去重的稳定消息 ID 与结果查询接口，目前只有回执关联标识。

## 上一轮：2026-10-31 只读审查与完成度重评

- 基线 `main / 7638349`，开工干净。只新增审查记录，不修改业务代码。完整证据和评估见 [REVIEW-2026-10-31](../REVIEW-2026-10-31.md)。
- **[P1: DSH 指定会话失效时消息误投其他会话]**：插件 `index.mjs:1272–1277` 对显式目标仍回退 active/root；主程序 `host-bridge.ts:178–183,528–529` 不检查实际接收者并回报请求目标。生产插件+生产发送桥+隔离 agents 复现 A 缺失→B 收到→报告 A 成功。
- **[P2: DSH 原生桥回执中断后可能重复投递]**：请求已经被接收，socket 断开仍返回 null 并自动 headless 回退。生产桥+本地 HTTP/假 CLI 复现一次操作两条投递路径；真实 DSH 是否再次执行取决于 adopt 状态，不能把未知结果当确定失败。
- 应用 1120/1126（6 跳过、0 失败），插件 114/114，MaiBot 17/17，node/web 类型检查、构建、三组契约通过。第一次系统 Python 缺 SDK，改用 MaiBot 自带环境后通过。日志/探针在 `.tmp/review-20261031`，不要整目录提交；修复时将缺陷存在断言反转为正式回归。
- 现场：无 Uta/Electron 进程，默认日常端点不存在；DSH 在运行。hooks 最近记录过插件 0.5.4，因此下方“仍是 0.5.3”的旧现场已不适用，但本轮没有验证真实握手/收发。没有本轮遗留服务、没有新建 Electron profile，日常数据及宿主配置未写。
- `app/out` 已按当前源码重建；alpha.18 分享 ZIP 的 manifest/hash 仍对应 `69758f3`（10 月 26 日），没有本轮新包。GUI/录音/20–30 分钟记录引用同日已提交的 POLISH 文档，本轮未重做 GUI、真实语音、长时/DPI/升级验收。
- 下一步：先确定上述两项投递修复方案，再实施回归与真实宿主链路；之后从同一修复提交交新候选并完成发行验收。旧保存错误和 CODEX_HOME 共享锁已有修复/测试，不再按旧审查列为开放问题。

## 最新：[DSH-ADAPT: 适配 DeepSeek Harness 0.2.1-rc.3 / host protocol 4]

- 基线 `e5ea5e3`，`main`，开工时工作区干净。本机 DSH `0.2.1-rc.3`（Electron 44.7.0 / Node 24.21.0 / `hostProtocolVersion: 4`）。插件 `0.5.3 → 0.5.4`，`package.json` 新增 `dsh.compat` 记录兼容基线（**故意不声明 `peerDependencies`**：`@deepseek-ai/*` 都是 asar 内置包，声明会让 pnpm 去 registry 解析而安装失败）。改动覆盖插件适配、主进程 cwd 支持、测试与文档，已作为一次 DSH 适配提交入库。
- [DSH-ADAPT-A: 会话工作目录取错] DSH 0.2.x 的 `Session` 只有 `get id()`，工作目录在 `session.header.cwd`；`tools/execute` 的 `exec` 对象只有 `token/callId/name/signal/agent/arguments/...`，**没有 `session`**。原代码三处取值（`exec.session`、`payload.session.cwd`）都是不存在的属性，静默退到 `process.cwd()`；Electron 下那就是 profile 目录 `C:\Users\Administrator\.dsh\profiles\desktop`，于是待办归属和会话登记全记错工作区。现场证据：`%APPDATA%\uta\hooks\harness-session.json` 的 `cwd` 就是这个 profile 路径。修法：新增 `sessionCwdOf(obj)` 按 `session.header.cwd → session.cwd → session.directory → agent.session.header.cwd` 取值，`reportHostSession()` 的 `cwd` 改为入参，`todo_snapshot` 与 `tools/execute` 两处都走它。
- [DSH-ADAPT-B: 桌宠直发被 headless 拒绝] rc.3 的 `dsh-headless --session-id` 是 **adopt 语义**，`assertAdoptable` 要求 `session.header.cwd === process.cwd()`，另外还拒绝带 agent preset 的会话、subagent/fork 会话、以及在本进程存活的会话。Uta 侧 `spawn()` 从来没传 `cwd`，子进程继承 Uta 自己的启动目录，所以必失败。修法：`HostInvocation` 增可选 `cwd`，harness 分支用会话登记的 `cwd` 启动子进程；错误映射补三条（`runs under agent preset` → 提示改不带预设的会话、`recorded no working directory` / `was recorded in ... not ...` → `no-session`、`is a subagent or forked session` / `is live in this process` → `busy`）。
- [DSH-ADAPT-C: 协议 v2 信封缺字段] Uta 协议 v2 要求 `meta` 带 `hostId/hostInstanceId/sessionId/turnId/eventId/seq/ts`，且 `hello.capabilities` 要覆盖 `RUNTIME_CAPABILITIES`。插件原来只给 `hostId`（偶尔 `sessionId`），`hello` 也少报 `sessionBinding`/`receipts`。修法：加载时生成 `hostInstanceId = dsh-<pid>-<12hex>`，每条指令带 `eventId: crypto.randomUUID()`、自增 `seq`、`ts`；`sdkVersion` 标 `0.5.4`，能力补到 7 项全集。
- 运行期证据（不是读源码推断）：用最小 Cordis 假上下文直驱插件（探针脚本放 `.tmp`，不入库），传 `agent.session.header.cwd = <tmp>\proj-alpha` 后 `harness-session.json` 写入 `cwd: <tmp>\proj-alpha`；`session/event` 的 `todo/write` 与 `tools/execute` 的 `todo_write` 两条路径发出的 `todo_snapshot.cwd` 都是这个工作区；v2 信封 `hostInstanceId` 一次加载内恒定、`eventId` 唯一、`seq` 单调、`ts` 可解析。子进程侧另用假宿主 CLI 验证：`sendHostMessage` 真的以会话工作区作为 `cwd` 启动，`--session-id` 取到登记值，任务以 `-` 从 stdin 读。
- [DSH-ADAPT-D: 反向结论——`patchReload: "live"` 是无效字段] 在整份 `app.asar` 里搜 `patchReload` **0 命中**（`desktop-runtime.json` 只提供 `hostProtocolVersion`，`dsh-app-boot` 只认 `dsh.bundle.patch`）。实测改完插件源码后运行中的 DSH 心跳仍是 `PluginLoaded 0.5.3`，`harness-session.json` 继续被旧代码写入。**结论：改插件源码必须重启 DSH 才生效**；插件 `HANDOVER.md` §14.5 早前那版「已支持热重载」已在本轮更正。
- [DSH-ADAPT-E: hooksDir 归属] `resolveRuntimePaths()` 里 `runtimeDir = UTA_RUNTIME_DIR || dirname(endpointFile) || userData`，所以运行时是 `%APPDATA%\uta\hooks`；测试把 endpoint 写到临时目录时 hooks 也跟着在临时目录。写测试别按 `APPDATA` 找 `harness-session.json`，本轮在这个坑里白跑了一轮排查。
- 验收：插件 **114/114**（新增 2 条 `[DSH-ADAPT: ...]` 回归），应用全量 **1016 项（1011 通过、5 个真实 DS fixture 条件跳过、0 失败）**，`npm run typecheck:node` 退出码 0。新增 app 测试用假宿主 CLI 锁住子进程 cwd；两条发送节流门（同宿主 2.5s 连发、记录需 ≥2.5s 前）在测试里显式等待，不是放宽实现。
- 现场状态：DSH 适配改动已提交；运行中的 DSH **仍是 0.5.3**（本轮没有重启它，重启会掐断正在对话的会话）。
- 待验证（重启 DSH 后看三件事）：① 心跳/`hello` 显示 `0.5.4`；② `%APPDATA%\uta\hooks\harness-session.json` 的 `cwd` 变成真实工作区；③ 桌宠直发消息能过 `assertAdoptable`。另外仍需排查 `%APPDATA%\uta\runtime-endpoint.json` 缺失（Uta 主进程疑似没在跑，端到端受阻），以及更新插件 `README.md`（仍停在 10/24 的面向用户说明）。
- 下一步建议：重启 DSH 完成上面三项验收 → 补 Uta 主进程端到端。README 与版本说明已在本次提交更新。

## 最新：2026-10-28 Claude Code 任务增量镜像

- 基线 `ce1bc32`，main 开工干净。Claude 插件版本 0.1.9，市场构建版本同步；未安装到真实 Claude，也未替换日常 Uta。
- `extractClaudeTaskDelta` 仅接 Claude `PostToolUse` 且有会话 ID 的 TaskCreate/TaskUpdate，从成功的 tool_response 获取任务 ID、标题与实际状态；删除的 `updatedFields` 是 `deleted`。失败、未确认结果、缺失 ID、跨宿主或未发生变化的事件不投递；保留旧 TodoWrite 完整快照路径。
- `claude_task_delta` 经 v2 信封、绑定宿主与非空会话校验到主进程。`todo-store` 按会话和任务编号合并并在 host-plans.v1.json 保留 ID；兼容旧记录，任务删除仅移除对应项；接到未知任务的更新不伪造标题。桌宠浮窗和设置页标注“仅显示 Uta 接收到的任务，可能不完整或有延迟”，不会因为中途启动/断线宣称完整。已记录的镜像可跨 Uta 重启，但不主动回读 Claude 的完整任务表；并发乱序或离线漏事件可能造成遗漏或暂时过期。
- 定向测试覆盖协议校验、创建/更新/删除、重复创建、会话隔离、缺失事件、重启读取、失败结果；应用全量 1014 项（1009 通过、5 条 DS fixture 跳过），插件 112/112，node/web 类型检查及构建通过。
- 任务内独立安装 Claude Code 2.1.312 到 `.tmp/claude-compat-20261028/cli-2.1.312`（未修改本机 2.1.138）；用本地模拟 Anthropic API 调用真实 TaskCreate/TaskUpdate，采集创建、完成、改名、删除实际 PostToolUse。隔离 Uta profile `claude-task-fixture`，通过真实 hook → 运行桥 → 主进程 → 存储：创建两项，完成并改名第一项，删除第二项，最终显示一项已完成及不完整提示；真实桌宠浮窗截图 `task-plan.png` 已检查。Uta 测试 PID 43292 已退出，未使用真实 Claude 会话、密钥或日常 profile。
- 未验证真实账户交互、所有版本及 Claude 任务状态的自动补全；任务工具在部分模型默认关闭，不应静默改变用户配置。插件与桌面源码变更都需要配套更新后才在日常版本生效；未打包发布、未全局安装。`.tmp/claude-compat-20261028` 含测试程序及端点数据，不要提交整个目录。

## 最新：2026-10-28 Claude Code 新版适配第一阶段

- 基线 `a265e59`，main 开工时干净。本机 Claude Code 2.1.138；官方文档当前已列出更高版本，未安装或验证那些版本。插件版本从 0.1.7 升至 0.1.8，marketplace 声明同步；要求 Claude Code >=2.1.78（StopFailure 事件引入版本）。
- `hooks/hooks.json` 注册 StopFailure；`uta-host-hook.mjs` 仅对 Claude Code 映射为 `agent_state:error` 和固定短标签，不传 API 错误正文，也不伪报完成；现有权限审批的离线回退保持不变。
- 使用独立 `.tmp/claude-compat-20261028` 中构建的插件、`CLAUDE_CONFIG_DIR`、Uta endpoint、localhost 模拟 Anthropic API 与模拟 Uta bridge，实际运行本机 Claude CLI：注册并向模型请求暴露 5 个 MCP 工具，SessionStart/UserPromptSubmit/Stop/SessionEnd 到达；模拟 HTTP 400 时产生 StopFailure，并投递 error 状态（短命 CLI 的 SessionEnd 之后会回 idle）。未调用真实模型或日常配置。CLI 校验最终插件清单通过，插件回归 111/111。
- 真实 401 模拟遇到 CLI 重试并在 45 秒超时终止，未验证该场景下 StopFailure 时序；400 模拟成功。未实测真实权限弹窗、MCP 工具调用、真实桌宠画面或新版 2.1.312，未部署或覆盖已安装插件。测试文件可能含端点数据，勿提交整目录；测试服务和子进程已退出。
- 尚未完成新版任务列表适配：现有 `uta-todo.mjs` 只识别 TodoWrite 等整份清单，TaskCreate/TaskUpdate 是增量且需要关联工具结果中的任务 ID；不能把单次创建直接作为整份 `todo_snapshot`，否则覆盖其他任务。建议按宿主会话隔离追踪并只在确认成功后更新，明确缺失事件、重启/恢复时如何避免伪造完整列表；通过真实或模拟最新版本抓取 hook 载荷，再设计并验证。新版部分模型默认不启用这些工具，禁止静默强制改变用户宿主配置。

## 最新：2026-10-28 待办默认日常与日常发送宿主

- 基线 `7ec731f`，main 开工干净。`DeskpetStage` 普通打开与 `TodoBoard` 默认 lane 均为 daily，标签顺序为日常、宿主；提醒入口继续进入日常。设置页原并列布局保持，复用的 `DailyTodoList` 两处均有发送入口。
- 发送前勾选未完成项并预览。`daily-todo-send.ts` 在主进程核对绑定宿主、当前存储与预览时的 id/文本/未完成状态，拒绝重复、变化、损坏数据和超过 1000 字符；`daily-send-to-host` 使用现有 `selectedHostSession` 和 `sendHostMessage`，不按项目 cwd 限制日常待办。unsupported 复制清单，其余错误显示；成功不更改待办。
- 应用 1012 项（1007 通过、5 跳过）、node/web 类型检查、构建通过；新增服务测试覆盖选择、内容/宿主变化、长度、无会话和复制回退。首次全量测试因 `model-migration.test.cjs` 的隔离模块清单缺新增依赖而失败，补充 stub 后重新通过。
- 独立 Electron `daily-send-20261028`：日常为默认，标签日常/宿主；两项预览可取消一项，预览后修改内容被拒，无会话提示，待办仍 pending；设置页日常栏也有发送入口。PID 35232、36728 已退出；日常 profile 未操作。合成测试证据在 `.tmp/daily-send-20261028/` 与 `.tmp/daily-send-final-20261028/`，不要上传含端点数据的目录。
- 未向真实宿主创建任务；复制分支由自动测试注入验证，未覆盖真实系统剪贴板；未打包或更新日常运行版本。

## 最新：2026-10-28 提醒跨午夜与专注待机修复

- 基线 `48f7b5f`，main 开工时干净。`isDailyReminderDue` 在首个提醒锚点之后优先处理 snooze，避免次日正常时间覆盖推迟目标；已提醒或推迟的未完成项跨日保留未处理角标。事件 `dueAt` 优先使用实际推迟目标，完成/编辑原提醒仍清除 snooze。
- `selectAmbientPerformanceState` 接入 `focusActive`，在 idle 时返回 null；审批、工作、说话等其他状态仍遵循原优先级。模型原生呼吸/眨眼与物理不由此暂停。
- 定向测试 28/28；应用全量 1010 项（1005 通过、5 个真实 DS fixture 条件跳过）；node/web 类型检查和构建通过。覆盖跨午夜、重载、最长 1440 分钟、首次提醒时间、完成、每日重置和修改提醒。跨午夜使用固定时钟，未改系统时间。
- 隔离 profile `fix-two-20261028` 的真实 Electron + Hiyori：进入专注前 ambient `idle` 且有头部附加值，进入后 state/head 均为 null；待办新增→推迟→完成的未处理数量 1→1→0。PID 33688 已退出，日常 profile 未操作。`.tmp/fix-two-20261028/` 留有合成证据及可能含令牌的端点数据，不要提交或分享整目录。
- 尚未在真实午夜等待触发、未做人工动作观感和真实宿主场景验收；未打包或更新日常版本。下方评估保留原始发现作为历史记录，本节说明修复状态。

## 最新：2026-10-28 全项目只读业务审查

- 源码基线 `9196137133d847ec21dc46ddc78b5fc8203a9169`，`main`，开工工作区干净。本轮只新增 [全项目评估](../validation/project-assessment-2026-10-28.md) 并更新交接，未修业务代码。
- 用户最新产品边界覆盖历史记录：每只桌宠选择一个宿主，角色个性/记忆/对话决策属宿主职责。不要重新建议跨宿主多 Agent 共用或桌面人格系统；现有同宿主 session 选择是另一层实现事实。
- **[P2：每日提醒跨午夜推迟失效]**：`daily-todo-store.ts:74-78` 先按今天 HH:mm 拦截，再看 snooze；23:55 + 10 分钟到次日 00:05 得到 `due=false`，`unhandledDailyReminderIds` 同时为空。固定时间模块复现已保存；需统一推迟实例和角标规则，尚未修复。
- **[P2：专注模式遗漏持续待机微动作]**：`DeskpetStage.vue:641-655` 的 ambient 输入未结合 `focusActive`；隔离 Hiyori 中 focus=true 后仍 state=idle、suspended=false，存在附加头部量。随机待机、静态待机与 TTS 已门控，不应误写成全部专注无效。
- 完整测试重跑：应用 1007（1002 通过、5 个真实 DS fixture 条件跳过）、插件 110/110、MaiBot unittest 17/17、node/web 类型检查、构建通过。单次当前测试通过未覆盖上述两个边界，不能据此否认复现。
- 隔离 profile `project-audit-20261028` 验证 v2 非绑定宿主 403、绑定宿主 200、待办增/推迟/完成 IPC、Hiyori 模型检查及设置窗口；未向真实宿主发任务，未用日常配置/密钥/语音服务。PID 26816、26416 已退出，端口 65268/65270 已关闭。测试证据留在 `.tmp/project-audit-20261028/`，整目录不要提交或分享（端点可能含令牌）。
- 其他边界：公开迁移包未包括互动/帧率等 localStorage 偏好，消息只导出不恢复；模型接入仍以目录与手工校准为主；文档的 MCP 数量、反向输入、系统语音和 RP 配置来源有过期描述。旧 `media` 占位没有生产调用，不能误判真实 STT/TTS 缺失。
- 未验收真实各宿主/音频、多模型观感、多屏/睡眠/长时资源与换机恢复；未打包。alpha.18 manifest 仍对应 `69758f3` / 2026-10-26，不能当成当前源码版本。建议先修两个复现，再整理迁移/能力文档与真实场景验收；此建议不是已获新功能实施授权。

## 最新：2026-10-28 桌宠互动、消息筛选、专注和待办恢复

- `interaction-policy.ts` 统一限制互动冷却和任务/审批/播报/预览/浮层期间的抢占；舞台单击在明确命中 head/face 时选开心，否则通用回应；静态立绘使用存在的差分，拖动放下与 8 秒悬停共用门控，穿透及专注下的被动悬停不触发。点击互动偏好暂存当前 profile 的 renderer localStorage，不属于公开设置迁移包。
- `useModelDrag` 和 `StaticStage` 分别处理拖动释放、blur 与卸载清理；静态立绘暴露实际 figure 矩形和 tap 状态。双击输入、右键循环表情保留。
- 消息记录按真实 host/session 组合筛选、筛选发送失败并显示时间；不推测缺失的项目或会话，不更改共享桌宠行为。快捷面板的 30 分钟专注暂停待机、解说和 TTS，进入时取消在播语音；提醒和审批照常。计时保存在当前 profile 的 renderer localStorage。
- `todo-recovery.ts` 限定项目/日常文件，预检来源和目标版本、按 SHA-256 检查目标未变化，确认恢复前以独立文件保留原始字节；损坏原文件可单独导出，最多 8 MiB。恢复后重载 store 并通知两个窗口；聊天记录目前仍只支持独立导出，不支持在此入口恢复。数据导出不允许选择当前 profile 内的文件。
- 验证：应用 1002 通过、5 跳过；插件 110/110；node/web 类型检查及构建通过。隔离 Electron `companion-resume`、端口 9329：Hiyori 单击、静态立绘拖动后回应及开心差分、设置窗口恢复日常待办并更新桌宠列表。上轮隔离实例还验证消息失败筛选与专注开关。PID 29044 已停止，两个隔离测试目录留在 `.tmp`，包含合成数据。用户日常 profile 未操作。
- 边界：真实鼠标长悬停、自然动作观感、完整场景脚本、真实宿主发送接收、系统文件选择对话框和真实服务语音尚未验收；未打包。设置、动作及校准已有独立迁移入口，模型文件、连接密钥和消息恢复不在新增待办恢复范围。

## 最新：2026-10-28 开发实例恢复全局快捷键

- **原因**：`registerGlobalShortcuts` 自 `a40ba10`（2026-10-22）起对非 stable 直接 `return`，所以 `npm run dev` 从不注册全局快捷键；但托盘/设置又只在注册成功时才显示，结果就是“快捷键没了”。
- **修复**：stable 照旧；非 stable 先扫描 `%APPDATA%/uta/runtime-endpoint.json` 与 `host-pets/*/runtime-endpoint.json`，若有另一个存活 PID 的实例就跳过（`main/shortcut-scope.ts` 的 `findForeignLiveEndpoint`，纯函数，配 `shortcut-scope.test.cjs`），否则正常注册。托盘与设置的“是否显示键”从 `environment.isStable && isRegistered` 改为只看 `isRegistered`；语音键候选回退与 `voiceShortcut` IPC 不变。`SttSettingsSection` 无键文案改为“可能被其他程序或另一个 Uta 占用”。
- **本机实测**：`Ctrl+Alt+V` 注册失败（被其他程序占用），按既有候选回退到 `CommandOrControl+Alt+Space`；隔离实例的设置页显示“语音输入快捷键：Ctrl+Alt+Space”。
- 验证：应用 **1015（1010 通过、5 跳过、0 失败）**、插件 **110/110**、node/web 类型检查、构建通过。测试实例与 profile 已清理；未打包。
- **边界**：系统热键是全局的——日常稳定实例已经在跑时开发实例让路；开发实例先启动时，日常实例会注册失败（与任何两个抢同一热键的程序一样）。

## 最新：2026-10-27 日常提醒闭环

- **数据**：`DailyTodoItem` 新增 `resetDaily?`（每天重复的次日重置，默认关闭）与 `snoozedUntil?`；`DailyTodoState` 新增 `unhandledIds`。`currentOccurrence()` 是"本轮提醒时间"的唯一来源（daily 取今天 HH:mm，且不早于 `remindAt`）；`isDailyReminderDue` 先看 snooze（`lastRemindedAt < snoozedUntil` 才再触发），`markReminded` 触发后清 `snoozedUntil`。`shouldResetDailyItem` 用"完成日 < 本轮发生日"判定，所以同一天提前完成不会在当天提醒时间被翻回未完成；`applyDailyRecurrence()` 在每次 tick 最前面执行（早于 runtime 就绪门禁），启动即补；`clearCompleted` 保留 resetDaily 条目。
- **IPC/preload**：新增 `daily-snooze-item`（1..1440 分钟，UI 固定 10）；`daily-add-item`/`daily-update-item` 接受 `resetDaily`；`env.d.ts` 同步。`model-migration.test.cjs` 的 store stub 补 `snoozeItem`/`applyDailyRecurrence`/`currentOccurrence` 与 `unhandledIds`。
- **调度**：`tickDailyReminders` 先跑 `applyDailyRecurrence()` 并按需广播，再走原来的 reminded 流程；`daily-reminder-due` 的 `dueAt` 改为 `currentOccurrence()`。
- **桌宠**：`DeskpetStage` 新增 `reminder-card`（标题=事项名；多条=“有 N 件…”；按钮：完成/10 分钟后/打开待办/×），30s 自动收起；`completeReminder` 只对单条生效（多条不给一键全完成），`snoozeReminder` 对卡片内每条各推迟 10 分钟；待办按钮角标用 `useDailyState().unhandledIds`；“打开待办”把 `TodoBoard.initialLane` 设为 `daily`。宠物气泡保留原句，卡片只显示事项，避免重复。
- **列表**：`DailyTodoList` 行结构改为“勾选 + 正文/状态两行 + 操作”，窄浮窗不再把文字挤成一字一行；到点项有 `daily-todo-due` 标记 + “稍后”，snooze 中显示“已推迟到 HH:mm”；提醒编辑器与新建表单在“每天这个时间”下出现“第二天重新出现”。`TodoDomain` 日常栏头部显示“N 件到点”。
- **验证**：应用 **1003（998 通过、5 跳过、0 失败）**、插件 **110/110**、node/web 类型检查、`electron-vite build` 通过。隔离 profile `ui-reminder-20261027` + CDP 9231 真实跑通：设置页新建（每天 + 第二天重新出现）→ 到点卡片（`该做「…」了` + 卡片）→ 完成（角标 2→1、状态写回）→ 稍后（`snoozedUntil` 写入、列表显示“已推迟到 22:33”）→ 打开待办落到日常栏；把该条改成昨天完成后重启，启动即回到未完成并再次提醒（`completedAt` 清空、`resetDaily` 保留）。截图 `docs/validation/screenshots-reminder-20261027/`。
- **现场**：测试实例已停止、profile 已删除；日常实例与 5173 未动；未打包。
- **边界**：“稍后”固定 10 分钟；无系统通知/贪睡循环/开机自启；“到点未处理”按“已到点且未完成”推导，推迟中仍计入。

## 最新：2026-10-27 待办审查问题修复

- `todo-store` 写入前校验完整文档；项目标签限制 120 字符，超过 200 项的关联拒绝且不动原文件。按目录或宿主添加时复用已存在项目。
- `todo-session` 只在宿主和会话 ID 一致且记录新鲜时补全目录；发送待办时固定实际目标会话并匹配项目目录，未知或不一致时阻止发送。不支持直发的平台保留复制回退。
- 日常重复提醒以首次提醒时间为下限；修改文字或完成状态不重排提醒时间。日常文件损坏或版本过高时 UI 明确提示并禁用写入，原文件不覆盖。
- 验证：应用 993 通过、5 跳过；插件 110/110；node/web 类型检查及构建通过。隔离 profile `todo-review-fix` 验证跨项目发送被 IPC 拒绝、损坏日常文件提示可见且原文件不变；测试 PID 29644 已停止。尚未验证真实宿主接收、人工声音或打包版。
- 自动审批拦截了删除 `.tmp/todo-review-fix-20261027` 的操作；目录保留本轮合成的隔离测试数据，没有日常 profile 数据。
- 已经由旧版本写出不符合规则的待办文件不会被自动修改；若遇到旧文件不可读，需先保留原文件再单独处理恢复。

## 最新：2026-10-27 待办"添加失败"修复：把不可用原因说真话

- **诊断（用户报"待办添加失败"）**：其开发实例 Electron 主进程 12:53:15 启动（进程 CreationDate；`%APPDATA%/uta-development/dev-f7e444bba875` 的 DevToolsActivePort/Preferences 时间戳一致），待办 IPC 在 14:59（`9374c0c`）/16:08（`3e6a882`）才提交；渲染层经 5173 Vite 热更新已是新 UI，preload/主进程仍是旧的，`window.utaAPI.todoAddItem` 不存在 → 可选调用返回 `undefined` → 界面打"待办添加失败。"。该 profile 没有 `todo.v1.json`/`daily-todos.v1.json`，证明请求从未到达存储。**用户侧动作：完全退出后重跑 `npm run dev`。** 本轮代码修的是"失败信息不说真话"。
- **新增 `app/src/renderer/services/todo-availability.ts`**：`hasTodoIpc()/hasDailyIpc()` 检查 preload 表面（`getTodoState+todoAddItem` / `getDailyState+dailyAddItem`）；`OUTDATED_MAIN_MESSAGE`（主程序比界面旧，请完全退出重启）与 `NO_PLATFORM_MESSAGE`（未绑定平台，项目待办用不了，去"日常"栏）。
- **`useTodoState`/`useDailyState` 新增 `available`**：接口缺失时 `error=OUTDATED_MAIN_MESSAGE`、`state=null`、不再说"待办状态不可用。"；窗口聚焦刷新会重新判定。
- **门控**：`TodoBoard.canEdit`、`DailyTodoList.canEdit`、`TodoDomain.canEditSelected` 并入 `available`；宿主栏再并入 `noPlatform`（`!!state && !state.activeHostId`），`TodoBoard.messageText` 无错误时回落到 `NO_PLATFORM_MESSAGE`，`TodoDomain` 增加 `settings-note is-warning` 说明条。修复前未绑定平台时宿主栏添加框可点、提交只得到"无法确定待办所属项目。"（真实窗口复现过）。
- **验证**：应用 **994（989 通过、5 跳过、0 失败）**、插件 **110/110**、node/web 类型检查、`electron-vite build` 通过。真实隔离 profile `ui-fix-20261027` + CDP 9231：`bindPetHost('harness')` 后桌宠浮窗宿主栏/日常栏与设置页两栏均真实添加成功并落盘 `todo.v1.json`/`daily-todos.v1.json`（跨窗口一致）；未绑定与 `unbindPetHost()` 后宿主栏输入禁用并显示 `NO_PLATFORM_MESSAGE`、日常栏仍可用，截图 `docs/validation/screenshots-todo-fix-20261027/settings-unbound-guidance.png`。`todo-ui.test.cjs` 用桩 `window` 功能验证了 `available=false` 时两个 composable 的 `error` 文案；真实窗口无法把 contextBridge 暴露的 `utaAPI` 变旧（属性不可配置、不可删、`window.utaAPI` 不可重定义），故"主程序过旧"提示未做真实窗口复现。
- **现场**：用户 12:53 的开发实例未触碰（仍需其自行重启）；5173 未停；测试实例已停止、`ui-fix-20261027` profile 已删除；stable 数据未动。未打包。

## 最新：2026-10-27 待办两栏化与日常提醒

- **数据**：新增 `app/src/shared/daily-todo-contracts.ts`、`app/src/main/daily-todo-store.ts`。日常待办独立存 `daily-todos.v1.json`（items + `reminderSound`），与 `todo.v1.json`（项目/宿主栏）完全分开；损坏 fail-closed、atomic 写入。`remindAt`/`repeat:'none'|'daily'`/`lastRemindedAt` 都在日常项上；每天重复保存时用 `normalizeDailyAnchor` 归一到下一次发生，避免设了过去的今天时间就立刻响。
- **调度**：`dueDailyReminders()` 是纯函数（一次性只响一次、每天按 HH:mm 判定、完成项跳过、`lastRemindedAt < dueAt` 去重）；主进程 `tickDailyReminders` 每 30 秒跑一次，要求 `runtimeCommandReady` 且 pet 窗口存在；触发后 `markReminded`、广播 `daily-changed`、向 pet 发 `daily-reminder-due`（items + sound），并调用既有 `summonPetWindow()`（`showInactive`，不抢焦点）。`before-quit` 清理计时器。
- **IPC/preload**：`daily-get-state`、`daily-add-item`、`daily-update-item`、`daily-delete-item`、`daily-clear-completed`、`daily-set-reminder-sound`、`onDailyChanged`、`onDailyReminder`；`env.d.ts` 已补类型。
- **渲染**：新增 `useDailyState`、`reminder-chime.ts`、`DailyTodoList.vue`。提醒事件在 `DeskpetStage` 里转成 12 秒状态气泡（“该做「X」了”/“有 N 件…”）并触发“好奇/等待”轻神态；`payload.sound` 为 true 时播放两下很轻的正弦音（AudioContext 不可用就静默跳过）。不做系统通知、不做语音播报、不循环响铃。
- **UI**：`TodoBoard.vue` 顶部加“宿主/日常”切换；`TodoDomain.vue` 改为左右两栏（>960px 两列，窄屏堆叠）：宿主栏=项目选择+宿主计划+项目待办+发送预览，日常栏=`DailyTodoList`（可编辑、datetime-local 提醒、每天重复、可选提示音）。原名“我的待办”已改为“项目待办”，设置页副标题同步为“按项目保存待办，也记日常小事；到点让桌宠轻轻提醒。”。
- 验证：应用 **992（987 通过、5 跳过、0 失败）**；node/web 类型检查、`electron-vite build` 通过。真实隔离 profile `ui-daily-20261027` + CDP 9231：到期后气泡轮询记录到“该做「…」了”、store 写回 `lastRemindedAt`、事件 `sound:true`；最小化后 `document.hidden` 从 true 回到 visible 且气泡出现，证明轻呼出生效；日常栏浮窗和设置两栏均已截图（`docs/validation/screenshots-daily-reminder-20261027/`）。提示音只验证了事件与播放调用路径，没有人工听感验收。
- 边界：提醒依赖 Uta 进程运行；无稍后提醒/贪睡/系统通知/多设备同步；日常待办不能发给宿主；`model-migration.test.cjs` 已加 `./daily-todo-store` stub。未打包，alpha.18 ZIP 仍是上一份分享包。
- 现场：5173 开发服务保持运行；9231 测试实例已停止，`ui-daily-20261027` 测试 profile 已删除，日常 stable 数据未触碰。提交前工作区包含本轮日常待办与提醒改动。

## 最新：2026-10-27 待办与宿主计划同步

- 新增 `app/src/shared/todo-contracts.ts`、`app/src/main/todo-store.ts`。用户待办存在 profile 的 `todo.v1.json`，宿主快照存在 `host-plans.v1.json`；两者分开，用户待办损坏时 fail-closed，宿主快照损坏只重置快照。项目 key 使用规范化 cwd（Windows 小写、正斜杠），未识别项目用 `unidentified:<hostId>`；`associateProject` 只搬用户明确关联的桶。
- 协议：`runtime-commands.ts` 新增 `todo_snapshot`（source/cwd/items，最多 50 项、200 字/项）；主进程在 runtime sink 中直接落库并广播 `todo-changed`，不依赖桌宠渲染层。`preload`/`env.d.ts` 增加 `getTodoState`、`todoAddItem/Update/Delete/ClearCompleted/AssociateProject/SendToHost`、`onTodoChanged`。
- 宿主抓取：`plugin/shared/uta-todo.mjs` 统一解析 `update_plan`、`TodoWrite`、`todowrite`、`todo_write`、`write_todos`；`uta-host-hook.mjs` 在 Pre/PostToolUse 发 v2 快照；Qoder/Antigravity hook 接入；OpenCode `onToolBefore` 在 `todowrite` 前发 v2 快照；DSH 监听 `session/event: todo/write` 和 `todo_write` 工具。快照按 host+session 保存，相同内容去重。
- 会话/项目归属：`activeTodoContext` 优先当前选择/最新 runtime session，缺失 cwd 时回退 `readHostSession` 的 30 分钟内 hook 会话文件；这样 Claude/ZCode 等非 Codex hook 也能把待办归到真实工作目录。测试代码 `model-migration.test.cjs` 增加 `./todo-store` stub。
- UI：`TodoDomain.vue` 为第七个设置页（`settings-domains.ts`、`SettingsIcon`、`SettingsWindowApp`）；桌宠侧边工具栏新增“待办”按钮，打开 `TodoBoard.vue` 伴随浮窗（与消息窗口同款定位/动画，和消息/快捷设置互斥），支持项目切换、宿主计划、我的待办添加/勾选/删除；快捷面板不再包含待办。设置页保留完整编辑、未识别关联、发送预览都复用现有 token。`useTodoState` 统一拉取并在 `todo-changed`、窗口聚焦时刷新；发送成功后写回状态消息，复制回退时保留预览并显示剪贴板提示。
- 发送：`todo-send-to-host` 只接受当前绑定宿主，按项目读取选中的未完成项，拼成 ≤1000 字任务消息；现有 `sendHostMessage` 支持 Codex/DSH/Claude/ZCode/OpenCode；unsupported（Qoder/Antigravity/适配器）时 `clipboard.writeText` 并返回 `mode:'copied'`，不会自动勾选或改宿主计划。
- 验证：应用 **986（981 通过、5 跳过、0 失败）**，插件 **110/110**；node/web 类型检查、`npm run plugin:build` 自包含检查、`electron-vite build` 通过。真实隔离 profile `ui-todo-20261027` / `ui-board-20261027` + CDP 9231 验证：Codex/Claude 共享 hook 实际 POST 快照、宿主计划 UI、会话 cwd 项目关联、添加/编辑/勾选、未识别关联、发送预览、无会话错误、Qoder 复制回退（剪贴板内容确认）；桌宠第四个侧边按钮打开 `TodoBoard`、与消息窗口互斥、浮窗内添加/勾选/删除正常。截图 `docs/validation/screenshots-todo-20261027/`。
- 未验：真实宿主窗口中触发 `update_plan/TodoWrite`（只用手工 hook payload 走真实 hook 脚本）；OpenCode/DSH/Qoder/Antigravity 的真实事件；成功直发会在宿主创建真实任务，未在真实会话里执行；发送支持适配器仅复制，不走 HTTP 适配器。无打包，alpha.18 ZIP 仍是上一份分享包。
- 现场：5173 开发服务保持运行；9231 测试实例已停止，`ui-todo-20261027`、`ui-board-20261027` 测试 profile 均已删除，日常 stable 数据未触碰。提交前工作区包含本轮待办功能与测试/文档改动。

## 最新：2026-10-27 平台绑定一键切换与检测过滤

- `ConnectionsDomain.vue`：平台绑定不再走“解除绑定 → 重走引导”。`switchHost()` 调 `store.requestModelAction({ type: 'switch-host', preference })`，成功后更新 `boundHostId` 并提示桌宠重载；`DeskpetStage.switchPreference` 调 `switchPetHost`，260ms 后 `reloadWindow`。About/引导/设置失败文案同步。
- `ConnectionsDomain.vue` 的“切换平台”是手风琴：`hostListOpen` 默认在未绑定时展开、已绑定时收起；展示 2 列 `.host-switch-option`，只有名称和“当前/切换/不可用/切换中”。平台说明、一次一平台提示、停止任务提示和未加载插件诊断行已移除；快捷面板的宿主说明也移除。
- **检测**：`createHostOnboarding` 新增 `detectPresence()`；主进程 `detected-hosts` IPC 返回 `{ ids, checkedAt }`，`isTrustedUiSender` 可用、15s 缓存。检测 Codex/DSH/Claude Code/ZCode/OpenCode 的可执行入口，并新增 Qoder/Antigravity 桌面程序探测（`desktopHostExe`：`LOCALAPPDATA/Programs`、Program Files、`D:/Qoder CN`、`D:/Qoder`、`D:/Antigravity`、PATH）；`deps.qoderExe`/`antigravityExe` 供测试注入。`detectOtherHosts()` 现在给 Qoder/Antigravity 真实 `installed`/`executable` 与“未检测到可执行入口”阶段。
- **渲染过滤**：`services/adapters/index.ts` 新增纯函数 `filterAvailableAgentHosts()`；设置页与快捷面板用它过滤 agent 宿主（检测集合为空/未知时保留全量），始终保留当前绑定；设置页只保留 `entry.loaded` 或当前绑定的适配器条目。引导 `visibleHostCards` 隐藏未检测的其他宿主，保留 Codex/DSH 安装占位和随包 MaiBot。
- **推荐移除**：`onboarding-flow.ts`、`host-onboarding.ts`、`host-onboarding-contracts.ts` 删除 `recommended` 字段；`OnboardingFlow.vue` 删除“推荐从 Codex 开始”“Codex 优先”和按推荐预选；`HostStageCard.vue` 删除“推荐”标签。Codex 仍可自动安装，但不再被优先标记。
- 测试：新增 `host-onboarding` 的 Qoder/Antigravity 注入检测、`onboarding-flow` 的未检测宿主隐藏/无推荐、`host-selection` 的过滤纯函数；更新 quick/settings-center/UI 回归。应用 **974 项（969 通过、5 跳过、0 失败）**，node/web 类型检查、`electron-vite build` 通过。
- 真实验收：隔离 profile `ui-detect-20261027` + CDP 9231 + 现有 5173 渲染服务。首次引导显示 7 个已安装宿主的真实结果（Qoder/Antigravity 已安装；MaiBot 为随包适配器），无“推荐”；设置页“切换平台”折叠/展开正常，9 个选项，无说明注释；独立状态点 Codex 写入 `pet-binding.json` 并触发桌宠重载；快捷面板宿主列表同样过滤。截图 `docs/validation/screenshots-host-filter-20261027/host-switch-accordion.png`、`one-click-switch.png`。
- 边界：适配器按插件加载/当前绑定显示，不探测 MaiBot/AstrBot 程序是否安装；首次引导仍保留 Codex/DSH 安装入口。Qoder/Antigravity 检测覆盖常见安装位置，非标准自定义目录未做全盘扫描；检测结果缓存 15s，窗口聚焦会刷新。
- 现场：5173 开发服务保持运行；9231 隔离实例已停止，测试 profile `ui-detect-20261027` 与上一轮 `ui-switch-20261027` 均已删除，日常 stable 数据未触碰。全量测试与类型检查在清理前通过；未打包，alpha.18 ZIP 仍是上一份分享包。

## 最新：2026-10-27 GPT 前端改动对齐（327e914）

- 审阅 GPT 的 6 个提交（`5023663` 评估、`c1083e3` 发送安全、`0130c35` 历史/输入提示、`c0dc4db` 迁移、`df3138d` 校准、`d3918f6` 历史/迁移边界）。功能与存储逻辑未改，只调整前端表现。
- `ModelCalibrationPanel.vue`：检查按钮移入 `.panel-head` 右侧；字段改为 3 列并复用 `.calibration-select`（36px/9px/`--uta-input`/`--uta-focus`）；强度改为 `.bio-scrub` + `.bio-scrub-grip` + 透明 `.bio-range-input`，与工坊滑条一致；滑条 `@input` 重置 `previewed`，必须重新预览后保存。窄屏 900px 两列、720px 单列。
- `SettingsTransferPanel.vue`：kicker 从重复的“数据与迁移”改为“数据备份”；`.transfer-select` 36px/9px、`.transfer-check` accent-color、行高/小字统一；`modelLabel` 优先显示已加载模型的名称，未知来源才显示路径；720px 以下两列。
- `ChatBubble.vue`：搜索/导出与清空确认分行，`.history-confirm` 独立提示；来源标签使用短 host label（`HOST_LABELS`），完整 host/session 仅放 `title`；用户消息才显示 delivery；失败用现有 `#e5533d`；搜索仍匹配 host/session。
- `QuickInput.vue` / `DeskpetStage.vue`：字数只在有输入时显示，超限才变色；bridge 提示精简为“发送给 …；会话可在设置中选择。”；连接页停止任务提示缩短。
- 新增 `app/tests/ui-style-alignment.test.cjs`（4 项）锁定上述样式选择；应用 **969（964 通过、5 跳过、0 失败）**，node/web 类型检查/构建通过。真实 Hiyori 隔离窗口检查了校准浅/深色、迁移预检列表、消息来源/失败状态、输入提示；测试 profile 已清理。没有停止 5173 上已有的开发实例，也没有改 GPT 的后端/迁移/校准逻辑。真实文件选择对话框、跨机器迁移、真实宿主停止任务仍未验收。截图在 `docs/validation/screenshots-ui-alignment-2026-10-27/`。

## 最新：2026-10-27 功能不足修复：历史和迁移边界复核

- `stores/chat.ts` 正文最多 1000、临时状态/图片最多 100，分别裁剪；大量解说不再挤掉保存的正文。回归测试先写 1000 条正文，再写 150 条状态，磁盘仍保留全部正文。
- `data-transfer.ts` 合并用户动作时验证现有桶，但保留现有原始对象和其他模型桶的未知字段；新增动作仍经校验/清理。迁移文件 v2 增加 `calibrations`，按完整模型资源签名选择导入；读取 v1 时为空。`model-calibration.merge` 仅新增没有本地记录的签名，拒绝无效、未来/损坏数据和 stale expected，已有条目不覆盖。备份现含导入前校准对象。
- 独立 `functional-fix-check` 真实 Electron 设置窗口调用读取/合并 IPC：已有 Hiyori 反向映射不变，模拟新签名新增 1、原签名跳过 1，旧 expected 被拒绝。测试 PID 4124 已核实并停止；未触碰日常 profile。
- 全量应用 **965 项（960 通过、5 跳过）**；其后新增 merge 异常输入保护，56 项对应定向测试、node/web 类型检查、最终构建通过。UI 的文件选择对话框、换机全流程、多模型观感尚未实测；迁移入口不含模型文件、连接地址、密钥、聊天记录，备份无一键回滚。
- 停止宿主任务尚未实现。官方 Codex App Server 的 `turn/interrupt` 需准确 threadId 与 turnId；本机只读 `codex app-server daemon version` 连接 `app-server-control.sock` 失败，Windows 错误 10050，无法证明该控制端点连接本桌面会话。连接页指引回宿主停止，不伪造取消成功或猜测目标。其他平台也需逐个核实。

## 最新：2026-10-27 功能不足修复：模型通道校准

- `ModelCalibrationPanel.vue` 在角色页提供 10 个有符号语义通道；由真实 Core 参数/物理资源列出中性值在范围内部、非物理输出、未占其他已确认语义通道的候选。显式预览一个参数的 10% 范围，自动回落；用户确认后选择方向/强度并保存，支持二次确认恢复默认。眼睛开合与说话口型不在此手动映射。
- `main/model-calibration.ts` 在当前 userData 的 `model-calibration.v1.json` 存数据，按完整模型资源签名隔离，独占临时文件与原子替换；损坏/较新 schema/链接拒绝覆盖。保存主进程重算目标模型签名、compare-and-swap 检查预览时的数据；UI 需重载桌宠生效。
- `model-runtime.ts` 重新校验 live Core，物理输出、范围不安全、占用其他语义通道的候选不会进入新映射；日常 additive 写入及头部预览考虑方向/强度，保留预设参数所有权与口型保护。未覆盖眼睛开合与口型映射，也未完成跨模型同脚本观感验收。
- 真实隔离 Hiyori 实例通过 CDP 选 `ParamAngleX` 反向，预览中采集 139 次真实 Core 写入、最小值约 -2.35；保存后重载桌宠，`inspect-performance` 返回 `source=manual / direction=reversed`。首次测试发现 Vue 代理经 IPC 无法克隆，现已展开为普通对象并补真实 SFC 克隆回归。测试 profile `functional-fix-check`、PID 23612 已停止；没有日常配置写入。全量应用 **960 项（955 通过、5 跳过）**，类型检查与构建通过。
- 迁移暂不包含新校准文件、模型资源、连接参数/密钥或一键回滚；宿主停止任务需要准确的 thread/turn 归属，尚无可靠现有接线，连接页明确提示回宿主停止。真实多模型视觉验收及文件对话框仍待做。

## 最新：2026-10-27 功能不足修复：公开偏好与自定义动作迁移

- `SettingsTransferPanel.vue` / `services/data-transfer.ts` 使用版本化 `uta-data-transfer` 文件导出 12 项公开偏好、各模型 `isUserPreset` 动作；不包含模型文件、连接地址、密钥、聊天记录。导入以复选框选偏好，按来源模型选择目标；只显示在当前实例已建立预设桶的已安装模型，避免首次导入遮蔽默认动作；同 ID/名称保持现状。人工改映射时提示检查目标模型。
- 确认前核对当前设置 revision、动作原文和草稿状态；写之前 `settings-transfer-backup` 在当前 `userData/transfer-backups` 保留原始动作 blob 和公开偏好。设置经现有 CAS patch，之后动作一次 setItem；再次检查动作原文，任何后半段失败明确报告部分完成。备份目录链接拒绝、文件独占创建。当前备份是本机恢复材料，尚无一键回滚 UI；跨存储的两步写入不是事务。
- 数据文件版本/未知字段/偏好值/预设校验拒绝异常，备份失败和预检失效不修改目标。导入/导出文件对话框由主进程固定 IPC 实现，导出通过临时文件替换。`data-transfer.test.cjs` 含真实 SFC setup 的备份、冲突和失败验证；全量 **953 项（948 通过、5 跳过）**，类型检查及构建通过。
- 独立 `functional-fix-check` profile 的真实 Electron 设置窗口显示入口、按钮可用、无横向溢出；CDP 调用真实备份 IPC 创建测试文件。PID 25064 已确认并停止，无 Uta/Electron 残留；未操作日常 profile。未实测系统文件对话框、换机完整流程与不同模型动作观感。
- 剩余：迁移未包含模型文件、连接参数/凭据、聊天记录或一键回滚；非标准模型校准和宿主停止任务尚未实现。官方 Codex App Server 支持 `turn/interrupt`，但要求准确的 threadId/turnId；Uta 现有 hook/注册表无法可靠证明与当前桌面会话的连接和轮次归属，不得猜测目标或终止其他聊天。

## 最新：2026-10-27 功能不足修复：消息历史与输入提示

- `main/chat-history.ts` 使用当前环境 `userData/chat-history.v1.json`，验证版本、大小与条目，拒绝链接/损坏/未来版本覆盖；临时文件 fsync 后原子替换。仅保存正文和可用来源/发送状态，不保存临时状态气泡或表情图片；最多 1000 条，消息内容保存在本机，未做内容加密。
- 渲染器异步读取并与到达中的新消息合并；流式写入合并、退出时请求 flush，失败提示与重试，恢复消息不重播浮动气泡。清空需二次确认，写盘失败保留内存与磁盘，清空期间新到达消息保留；支持搜索和另存 JSON。宿主提供会话时保存真实来源；发送桥成功回传 sessionId；缺信息显示未记录，不能伪造。
- 输入框显示宿主能力与直连桥 1000 字符计数，Codex/DSH/Claude/ZCode/OpenCode 按主进程桥识别；不支持反向输入的平台禁用发送并提示回宿主。未实现虚假的任务停止，待核实各宿主原生 API。
- 全量应用 **947 项（942 通过、5 跳过）**；node/web 类型检查和 build 通过。另加发送来源断言后需再跑相关定向测试。独立 `functional-fix-check` profile 的真实 Electron 载入 fixture 后，用 CDP 点击验证历史恢复/来源、搜索、二次确认清空与磁盘为空；PID 20104 已核对并停止，无其他 Uta/Electron 进程。未测系统导出对话框、原生鼠标点击、强制崩溃后的最后一条持久化。
- 当前任务还包括非标准模型校准、跨实例迁移和可支持宿主的取消任务；尚未完成，继续前重读其现有契约，不写日常数据。

## 最新：2026-10-27 功能不足修复：发送安全

- 用户已授权修复上一轮评估的全部事项；从 `main/5023663` 开始，初始工作区干净，无 Uta/Electron 进程，运行 profile 未确认。
- **[P1: 手动选定会话未重新登记时，消息退回最新会话]**：`selectedHostSession` 现在用 undefined 表示自动、null 表示手动目标缺失，发送桥只在 undefined 时跟随最新；null 返回 no-session，桌宠保留草稿。**[P2: 长文本被静默截到 1000 字符，仍提示发送成功]**：超 1000 字符直接失败，原草稿保留；不改变 HTTP 适配器。
- 24 项定向测试、node/web 类型检查和受控反向探针通过；未连接真实宿主或做 GUI 验收。诊断脚本已改成断言两处修复行为，聊天内存部分仍是旧状态观察，待后续同步。
- 待继续：消息历史保存和来源、输入能力提示及可支持宿主的取消、非标准模型校准、跨实例迁移。不要宣称上述工作已完成；继续使用隔离 profile。

## 最新：2026-10-27 功能性不足评估（基线 4fd1fc9）

- 用户仅要求评估，本轮不修业务代码。报告 [FUNCTIONAL-ASSESSMENT-2026-10-27](../FUNCTIONAL-ASSESSMENT-2026-10-27.md)；诊断脚本 `docs/validation/functional-assessment-2026-10-27.cjs`，从根目录直接用 Node 执行。它断言当前缺陷行为，修复后应改成相应正式回归；不是期望长期保持通过的产品测试。
- **[P1: 手动选定会话未重新登记时，消息退回最新会话]**：`index.ts:selectedHostSession` 把无偏好与偏好目标不在内存注册表都变成 null；`host-bridge.ts:sendHostMessage` 用 nullish fallback 读取最新 hook 会话。受控调用生产函数：选 A、注册表无 A、最新 B，最终参数是 `--thread B` 且成功。需要区分自动/已选可用/已选缺失，缺失阻止发送。不能把已决定的同平台所有会话驱动一宠误报为缺陷。
- **[P2: 长文本被静默截到 1000 字符，仍提示发送成功]**：`host-bridge.ts` clip 1000，QuickInput 无长度提示。受控模拟子进程收到 1000/1018 字符且尾部条件消失。仅涉及主进程宿主桥，不扩大到 HTTP 插件。
- 产品缺口：消息 store 纯内存、上限 200 且无 host/session 字段；输入口未提前说明能力，取消宿主任务无完整接口；表现 runtime 固定空 overrides、仅消费 standard-id，缺用户校准持久化；已有预设导出与旧偏好导入，但缺统一迁移。
- 验证：发送桥/偏好/注册表/连接竞态/模型表现与能力/STT/TTS 的 8 个既有测试文件 **119 通过、0 失败、0 跳过**；生产探针确认两项缺陷和聊天 store 的易失性。IO/子进程均模拟，无真实宿主消息。无业务变更，不跑构建或全量测试。
- 现场：初始 `main/4fd1fc9` 干净；未发现 Uta/Electron 进程，运行 profile 未确认；当前聊天 MCP 能力查询提示运行时/配对不可用。没有启动/停止桌宠、安装插件、触碰日常设置或发布产物。
- 待验：真实 DSH 安装与重启后工具/审批/RP、真实 MaiBot + QQ、有声链路与设备失败、宿主重连、长时/多屏仍按现有验证文档保留。下一步建议先修两项发送缺陷，用户尚未授权实施。

## 最新：2026-10-26 alpha.18 DSH 一键注入（69758f3）

- 朋友机器上 DSH 检测不到目录后无法继续。原实现只检查默认 `D:/DeepSeek-Harness` 与 `~/.dsh/profiles/desktop`，卡片只给 `dsh plugin ...` 命令；普通用户 PATH 里没有 `dsh`，自定义安装/首次未启动 DSH 都会卡住。
- **路径**：`host-paths.ts` 增加 `harnessHome` override（`host-paths.json`，环境 `UTA_DSH_HOME`），自动尝试 `%LOCALAPPDATA%\Programs\DeepSeek Harness`、`Program Files`、原默认目录；显式 `DSH_HOME`/用户选择的 home 优先，即使暂时不存在也不会偷偷改用别的 `.dsh`。`writeDshHomeOverride` 接受 `.dsh` 或 `profiles/desktop`，保存为 `.dsh` home。
- **检测**：`host-onboarding.ts` 每次检测/安装重新解析路径（不再缓存工厂创建时的路径）；检查 exe、CLI、profile package、插件依赖/bundle 和 `node_modules/@uta/deepseek-harness-plugin` 链接；缺程序/缺 home 时返回可操作的阶段，`pathActionLabel`/`homeActionLabel` 控制兜底按钮。
- **安装**：`installDsh` 先 `tasklist` 检查 `DeepSeek Harness.exe` 未运行，创建 `dsh-plugin-install.lock`，备份 `package.json`/`cordis.patch.yml`/`cordis.yml`/`pnpm-lock.yaml` 到 `runtimeDir/dsh-plugin-backups/<timestamp>`，然后 spawn DSH exe + `resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`，env 加 `ELECTRON_RUN_AS_NODE=1`、`DSH_HOME=<home>`，参数 `plugin --profile desktop add <resources/uta-plugins/deepseek-harness>`；完成后回读验证。失败恢复备份；超时保留锁与备份；已安装返回“无需重复安装”。
- **UI/IPC**：DSH 卡片“安装 Uta 插件”、备注“先完全退出 DSH”；`chooseHostPath('harness')` 选择和 `settings-dsh-home-choose` 选择 `.dsh`，preload `chooseDshHome`，选择后重新检测；`HostStageCard` 新增 `pathBusy`/`choose-path`/`choose-home`，安装按钮文字由 `installLabel` 驱动，解除阻断文字按宿主区分。
- 验证：应用 **939（934 通过、5 跳过、0 失败）**，MaiBot 适配器 17/17，类型检查/构建通过；真实源码 Electron 与解压后的 alpha.18 成品包都用隔离假 DSH home/CLI 完成“检测 → 安装 → 备份 → 回读 → 重启提示”，插件链接指向 `resources/uta-plugins/deepseek-harness`，真实 `~/.dsh` 的 mtime/内容未变；真实 DSH CLI 只跑了只读 `plugin list`。ZIP `Uta-0.2.0-alpha.18-win-x64.zip`，SHA-256 `8ab16619d459f811cbb977cbcf30d4505bfef8a26f0a271b035e2904070ff394`，来源 `69758f3`，`dirty=false`。
- 边界：未在真实 DSH profile 执行最终 `plugin add`，也未验证 DSH 重启后的 `uta_express`/系统提示/审批；朋友第一次点击安装才是真实验收。分享包未签名；MaiBot + QQ 端到端、8h/7d、多屏 DPI 仍待验。测试 profile 已清理，真实 DSH 与日常数据未触碰。详见 [alpha.18 验收](../validation/share-package-0.2.0-alpha.18.md)。下一步：让朋友安装后确认 DSH 工具列表和桌宠状态联动；如果 CLI 输出异常，先用 DSH 自带 `plugin list` 和备份目录定位。

## 最新：2026-10-26 alpha.17 分享包与 Uta-MaiBot 适配器（9a087a6）

- 用户明确要求给其他人试用一份包含 DS 鼠控模型、Hiyori 和 MaiBot 适配器的版本；这是对“日常迭代不打包”约定的单次例外。产物 `app/release/Uta-0.2.0-alpha.17-win-x64.zip`，SHA-256 `f970d6311a489d87ddeebf9d49ccf8e8cb027eb731c57b5c3fcd55bbf77b6df4`，来源 `9a087a6`，`dirty=false`；版本 `0.2.0-alpha.17`。适配器/引导 `a7b9a77`，打包/版本/说明 `9a087a6`。
- **适配器**：`maibot-adapter/`，入口 `plugin.py`；只用 Python 标准库 + `maibot_sdk`。8524 本机 HTTP 入口含 `/health`、`/input/text`、`/input/screenshot`、`/sync/model`，把 Uta 消息作为 `platform=uta / account=uta-desktop / scope=local` 的私聊注入。`chat.receive.before_process` OBSERVE 上报 thinking；`@MessageGateway("duplex")` 只把发给该网关的回复拆成 ≤480 字 v2 `rp_reply` 流式帧写回，再发 completed。运行时端点优先 `%APPDATA%/uta/host-pets/maibot/runtime-endpoint.json`，其次 stable 根端点，可用 `[runtime] endpoint_file` 覆盖。
- **绑定缺口**：原首次引导不包含 MaiBot，`SettingsTab` 只切偏好、不写 `pet-binding.json`，所以适配器 v2 事件会被 403。现已把 `maibot` 加入 `OnboardingHostId` / `HOST_ORDER` / `host-onboarding.ts` 检测：卡片“兼容接入”，徽标“随包适配器 / 需放入 MaiBot”，阶段“随包提供/安装插件/桥接工具/运行时/绑定/回声”；选中后完成引导会走 `switch-host` 真正绑定。
- **打包**：`UTA_SHARE_PACKAGE=1 UTA_DS_MODEL_DIR=<DS-control 目录> npm run dist:zip`。`package-zip.mjs` 在 electron-vite build 后把 DS 模型复制到 `out/renderer/models/DS-control`，校验 `c_0120.model3.json`、`MODEL-NOTICE.txt`、适配器和 Hiyori，再打包；分享模式用 7z 从 ZIP 删除 `Try-Uta.bat`，因为候选 profile 不发布 host-pets 端点。`electron-builder.yml` 的 `extraResources` 带过滤后的适配器，`extraFiles` 带 `README-FIRST.md` / `MAIBOT-ADAPTER.md` / `DS-MODEL-NOTICE.md`。
- **验证**：应用 932（927 通过、5 跳过、0 失败），适配器 17/17（真实 SDK），node/web 类型与构建通过。隔离生产实例完成 `maibot` 绑定后，v2 thinking + 两段流式 rp_reply + completed + set_emotion 全被接受，桌宠气泡显示完整句子；解压后的 `win-unpacked/Uta.exe` 在全新 profile 中列出 3 个模型并实际从 asar 渲染 DS-control；`resources/maibot-adapter` 由真实 SDK 识别为 1 个 HookHandler + 1 个 duplex 网关。证据 [share-package-0.2.0-alpha.17](../validation/share-package-0.2.0-alpha.17.md)。
- **边界**：没有真实 MaiBot + QQ 端到端；`/input/text` 注入只到组件/模拟层。包未签名，SmartScreen 预期。分享包必须跑稳定 `Uta.exe`（候选启动器被移除）。测试 profile `share-check`/`share-check2`/`share-verify` 已删除，进程已退出；日常 stable、日常实例与 MaiBot 配置未触碰。下一步：找一套愿意接受插件的 MaiBot 测试环境，验证 Uta 文本注入 → Maisaka 回复 → 气泡闭环，再决定是否补情绪/动作工具。

## 最新：当前状态与完成度重评（fa3daf0，只评估）

- 用户要求查看目前状态并重写评估。基线 `main/fa3daf0dc57ef51bfe11494ee5e1840dea053083`，工作区原本干净；详见 [最新评估](../ASSESSMENT-2026-10-26.md)。上轮 5 项对应代码和正式回归已核对通过，保留真实双 Electron/GUI等未验收边界；旧审查报告加历史标记。
- 新确认 **[P2: 即时保存单字段失败被其他字段成功掩盖，关窗丢失未落盘设置]**：`use-settings-draft.ts` 成功清除全局错误，失败字段未单独追踪，1.8s 重试因状态已 success 被跳过，`hasPending()` 返回 false；`use-settings-close.ts` 于是直接 close。生产 composable 探针为主题失败→视线字段成功→执行重试→关闭，结果 draft dark/committed light、无提示且 close 获批。尚未修复。
- 验证：应用 **924（919 通过、5 跳过、0 失败）**，插件 105/105，node/web 类型、构建和三份契约全部通过。日志与 `autosave-probe.cjs/json` 位于 `.tmp/assessment-20261026/`；真实 DS fixture 缺失。没有把旧 GUI 记录当成本轮新执行。
- 现场：统一开发 profile `dev-f7e444bba875`、主 PID 12868、Vite 父进程 PID 29512；显式私有端点 `/health` 正常。默认 MCP 查询未连接该 dev 实例，不推断为运行服务离线。设置窗口最小化，本轮未恢复、点击或改变用户窗口。未另启或停止桌宠；`npm run build` 仅刷新生成目录。
- 工作方式：继续按用户决定以 `npm run dev` 验收，不例行打 ZIP；正式发行时再做最终包验证。模型表现工程面板已按新决定移除，底层 runtime 仍在，不能据此把已实现成果清零。
- 下一步优先修新发现的保存组合失败，其次完整走通工坊真实编辑链路，再补真实语音、四宿主与长时/DPI。当前定位为功能较完整、仍在收口的 Alpha；业务修复未在本轮实施。

## 最新：2026-10-26 即时保存组合失败修复

- 评估 `ASSESSMENT-2026-10-26` 的 **[P2: 即时保存的单字段失败被其他字段成功掩盖]** 已修复，提交 `ee805ab`。
- `use-settings-draft` 增加逐字段 `failedKeys`：成功只清理本次字段；状态由全部未落盘字段推导；1800ms 重试读取失败集合而非全局 `saveStatus`；`hasPending()` 纳入失败集合与 draft/baseline 差异。
- `use-settings-close` 在任一字段失败时提示；无工坊/密钥草稿时标题为“关闭设置前重试保存？”，主按钮“重试并关闭”，重试成功后关闭。
- 验证：`settings-window-draft.test.cjs` 新增组合失败与关窗重试两条真实 SFC 测试；反转评估探针得到 `status=error / pending=true / 重试再写 themeMode / closePrompt=true / decisions=[]`。应用 **926（921 通过、5 跳过、0 失败）**，类型检查与构建通过。
- 边界：故障为受控持久化注入，未在真实用户目录制造磁盘失败；真实关窗/恢复与长时验证仍待补。

## 最新：2026-10-26 设置改为即改即存

- 用户要求去掉设置页“保存更改/放弃更改”确认。公共 12 项偏好改为即时写入：`use-settings-draft.ts` 重写为按字段串行提交，保留写入期间的新输入；离散控件立即写，强调色/语速/音量 160–220ms 防抖；revision 冲突自动刷新重试最多 3 次，失败保留本地值并每 1.8s 重试一次，状态栏可手动重试。
- `use-settings-close.ts` 只在语音密钥/预设工坊草稿未保存或偏好写入失败时提示；关窗先 `flushPending()` 等待在途写入；“保存草稿并关闭”只保存登记的草稿。
- `SettingsWindowApp.vue` 移除保存/放弃按钮、未保存标记与冲突横幅，新增“改动会自动保存到本机”和自动保存状态；`AboutDomain` 显示保存方式，`VoiceDomain` 更新保存规则文案。
- 验证：应用 **922（917 通过、5 跳过、0 失败）**，类型检查与构建通过；真实 dev 窗口验证日/夜、强调色、视线开关即时落盘并同步快捷面板，关窗不再提示；记录见 [settings-live-save-2026-10-26](../validation/settings-live-save-2026-10-26.md)。未打包，日常实例未触碰。
- 测试调整：`settings-window-draft.test.cjs` 改为即时写入、防抖、冲突重试、失败重试、草稿关窗；`unsaved-drafts.test.cjs` 的关闭守卫假 draft 改用 `hasPending/flushPending/retryNow`。
- 边界：冲突重试为组件级测试，未做两个真实 Electron 窗口同时改同一字段的 GUI 竞争；真实 TTS/麦克风、长时、DPI 未验收。

## 最新：2026-10-26 审查修复（源码，不打包）

- 基线 `main/79d8d64` 的 5 项审查问题已修复；用户要求后续直接在 `app` 下 `npm run dev` 验收，本轮没有生成新 ZIP、没有替换日常版本。
- **[P1: 同平台多实例覆盖宿主端点]**：`main/host-endpoint.ts` 只在 stable 或显式 `UTA_BOUND_HOST` 的 Pets profile 发布共享 host-pets 端点；开发/候选 profile 默认关闭共享发现。`runtime-bridge` 写入共享端点前检查存活 PID/令牌并用短时 claim 锁，已有存活实例时不覆盖；关闭时只删除 token 属于自己的文件。回归 `host-endpoint.test.cjs` + `runtime-bridge.test.cjs` 覆盖双真实回环 bridge。
- **[P2: 切预设丢失工坊草稿]**：`applyStatePreset`、`togglePinPreset`、`startNewPreset` 统一走保存/放弃/继续编辑门控；同预设重播不重载编辑器，草稿与撤销历史保留。`workshop-draft-guard.test.cjs` 用真实 SFC setup 覆盖保存、放弃、继续、新建、钉住和同预设重播；真实设置窗口 760px 验证弹窗。
- **[P2: 工坊中等宽度裁切]**：工坊以 `studio-workbench-shell` 的 `container-type: inline-size` 按底板实际宽度在 660px 以下切单列，操作按钮行允许换行。真实设置窗口 960/880/760 均单列无横向裁切。
- **[P2: 快捷动作片段未生成动作]**：新增 `services/preset-snippets.ts`，眨眼/点头/歪头/惊讶生成两帧参数关键帧并按模型能力禁用；真实窗口点击“+ 眨眼”生成 `眨眼·闭`/`眨眼·睁` 两步。
- **[P2: 强调色文字对比度回退]**：恢复按实际白/深墨对比度选择，全部内置色正常/hover 均断言 ≥4.5:1。
- 验证：应用 **927（922 通过、5 跳过、0 失败）**，插件 **105/105**，node/web 类型检查与构建通过；修复记录见 [review-fixes-2026-10-26](../validation/review-fixes-2026-10-26.md)。开发实例验证后已停止；日常 0.1.1/stable 与用户正在运行的 alpha.14 未替换、未停止。
- 未验收：两个真实 Electron 实例的共享端点 GUI 竞争、冲突的设置页徽标、真实宿主重连、真实语音、8 小时/7 天、多屏 DPI。没有重新打包，因此不存在本轮新 ZIP；alpha.16 ZIP 仍只代表 `2b54665`。

## 2026-10-26 审查与完成度评估（修复前基线）

- 审查基线 `main/79d8d6418e087007c51d69d3739aea3a14781bc3`，起始工作区干净、没有 Uta/Electron 进程。昨天 81 个提交按风险面核查，完整结论见 [审查报告](../REVIEW-2026-10-26.md)。
- 确认 **[P1: 同平台多实例覆盖宿主端点]**、**[P2: 切预设丢失工坊草稿及撤销历史]**、**[P2: 工坊中等宽度裁切]**、**[P2: 常用动作片段未生成动作]**、**[P2: 强调色文字对比度回退]**。各有生产模块/组件或真实 Electron 渲染探针；切预设问题早于昨天，不当作新界面引入的回归。
- 验证：应用 913（908 通过、5 跳过、0 失败），插件 105/105，node/web 类型、构建及三份契约通过；本轮真实 DS fixture 缺失。原生 Computer Use 两次激活失败，停止该路线；后续只做独立 Electron API/合成 DOM 布局实验，不当作原生点击验收。
- 产物差距：alpha.16 ZIP hash 与 manifest 一致，但来源为 `2b54665`，不含后续 9 个源码界面提交。`npm run build` 刷新 `app/out`，没有重新打 ZIP、替换日常启动或安装插件。
- 本机证据：`.tmp/review-20261026/` 的 `component-probes.cjs/json`、`endpoint-probe.cjs/json`、`observe-electron.cjs`、`layout-probe.json`、`settings-observation.json` 及四份测试/构建日志。复现断言当前缺陷存在，修复后要反转预期并纳入正式测试。
- 现场：profile `review-20261026`、`review-observe-20261026`、`review-settings-20261026`、`review-layout-20261026` 全部使用本轮私有 userData/runtime、CODEX_HOME/DSH_HOME，保持真实宿主未绑定。自建 PID 2740/27004/2016 按探针退出逻辑结束，22016 核对身份后停止；端点已清理，收尾没有遗留 Uta/Electron 或测试监听。没有用户日常实例被操作。
- 该轮只审查；上述 5 项随后已在源码修复，见顶部记录。仍未补真实语音、四宿主、长时/DPI、升级/回滚验收；当前为可体验 Alpha，不能标作 1.0 已完成。

## 最新：alpha.16 消息 Markdown 渲染候选（2026-10-25）

- 当前分支 `main`；功能提交 `56ee39e`（消息换行保留 + token Markdown 渲染），发布准备 `2b54665`；版本 `0.2.0-alpha.16`。
- **协作方式更新（2026-10-25）**：用户要求后续日常迭代不再打包 ZIP/候选包，验收直接在 `D:/Frankenstein/Uta/app` 下运行 `npm run dev`。只有明确要求发版或测试包时才打包；不要停止或替换用户正在运行的打包实例。
- 候选 ZIP：`app/release/Uta-0.2.0-alpha.16-win-x64.zip`，SHA-256 `666f601bafd75f7a4a5a5bb3a90e801d3f72369c37f447ac9b689893e3f1c1f7`，来源 `2b5466579c3d1793d6641093275b1a4ca21e3305`，`dirty=false`，构建 `2026-10-25T09:44:29.904Z`；`Try-Uta.bat` 使用 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.16`、profile `candidate-020-alpha16`。
- **根因**：`sanitizeText` 把所有换行压成空格；加粗/斜体是行内格式仍可解析，列表/代码块/标题没有换行就无法建块。新增 `sanitizeMessageText` 用于 `notify`/`choice_hint`/`rp_reply`，保留换行和列表缩进、清控制字符、限长；标签仍单行。
- **渲染**：`renderer/services/markdown.ts` 输出 token（bold/italic/strike/code/link、paragraph/heading/code/list/quote/rule），`MarkdownText.vue` + `MarkdownSegments.vue` 用 Vue 模板渲染，无 `v-html`。支持 `**`/`__`、`*`/`_`、`~~`、反引号、fenced code、列表、标题、引用、分隔线、http(s) 链接。浮动气泡和消息记录共用；消息记录链接可点击，气泡链接仅样式。
- 验证：应用 **913（908 通过、5 跳过、0 失败）**，插件 **105/105**，node/web 类型检查与构建通过；开发与打包实例都发送了包含加粗、斜体、列表和代码块的消息，渲染正确。打包实例使用 zcode 测试绑定，验证后已删除候选数据、`host-pets/zcode` 与开发绑定。
- 未验收：Markdown 表格排版、完整 CommonMark 嵌套、真实 Qoder 插件更新后的行为、锁定穿透、真实宿主切换重连、真实 DSH/麦克风/云端 TTS、8 小时/7 天、多屏 DPI。日常 0.1.1/stable 与用户正在运行的 alpha.14 未替换、未停止。

## 最新：alpha.15 快捷面板双击与模型卡片修复候选（2026-10-25）

- 当前分支 `main`；修复提交 `e625184`（面板双击、模型卡片、气泡停留），发布准备 `ad27385`；版本 `0.2.0-alpha.15`。
- 候选 ZIP：`app/release/Uta-0.2.0-alpha.15-win-x64.zip`，SHA-256 `805ddbc121cfb8454f5efb1725f42ae327e07dde5c50af809ca939cf7409e6e2`，来源 `ad27385cdf05c2fc9ade7093d48d21dab6ce8cc8`，`dirty=false`，构建 `2026-10-25T09:33:45.692Z`；`Try-Uta.bat` 使用 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.15`、profile `candidate-020-alpha15`。
- **双击关闭根因**：快捷面板只阻止了 `click`，没有阻止 `dblclick`；双击冒泡到舞台根 `onDoubleClick` 后关闭面板。现在 `.quick-settings`、`.quick-input`、`.companion-window` 都 `@dblclick.stop`，`onDoubleClick(event)` 再按目标面板兜底。
- **模型卡片**：`aria-label="模型"` 的 `.qs-model-block` 独立卡片，显示“模型”和当前模型名；点卡片展开原模型列表；标题栏仅“快捷设置”+关闭，下面有分隔线。
- **气泡停留**：`estimateBubbleTtl` 最短 5000ms、最长 16000ms；消息记录仍保留全部文本。
- **Qoder 输出诊断**：当前用户运行的 alpha.14 stable 已绑定 Qoder，`/context` 显示 `qoder:069c2355...`，hooks 正常写入。发送 rp_reply 会立即出现气泡；通过已安装 Qoder Stop hook 发送的最终回复进入消息记录。之前看不到主要是气泡短 + 新实例还没完成一次 Stop；不是宿主断开。未自动转发助手正文，工作期间主动发言仍依赖 `deskpet_notify`。
- 验证：应用 **907（902 通过、5 跳过、0 失败）**，插件 **105/105**，node/web 类型检查与构建通过；开发与打包实例都验证了模型卡片和面板内双击保持打开。诊断时向当前稳定实例发过 4 条测试回复，仅在内存消息记录，重启清空。
- 未验收：Qoder 助手正文自动转发、真实 Qoder 插件更新后的行为、锁定穿透真实点击、真实宿主切换重连、真实 DSH/麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏、贴靠图标同步。日常 0.1.1/stable 与用户正在运行的 alpha.14 未替换、未停止。当前安装的 Qoder 插件缓存为 0.1.9，未改写用户日常宿主配置。

## 最新：alpha.14 快捷面板宿主切换与模型区改版候选（2026-10-25）

- 当前分支 `main`；功能提交 `6da2248`（快设宿主切换、模型区移入正文、跨窗口绑定同步），发布准备 `8004397`（版本、FIRST-READ、Try-Uta profile、构建配置）；版本 `0.2.0-alpha.14`。
- 候选 ZIP：`app/release/Uta-0.2.0-alpha.14-win-x64.zip`，SHA-256 `fad4d1216dc33f638e4753e95b42784c5bf9bbe4751b8b9bf625190fe2f4939b`，来源 `80043970451883a51f151f5da3cc8d564430cfb4`，`dirty=false`，构建 `2026-10-25T09:18:11.952Z`；解压目录 `app/release/Uta-0.2.0-alpha.14-win-x64`，`Try-Uta.bat` 使用 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.14`、profile `candidate-020-alpha14`。
- **宿主切换**：`createPetBindingStore` 新增 `rebind(hostId)`，保留 `bind()` 的“已绑定拒绝第二平台”语义；主进程新增 `pet-switch-host`（trusted UI sender），更新 `boundHostId` 和 `setExtraEndpointFile`，删除旧平台端点并发布新端点；preload 暴露 `switchPetHost`。绑定变化后主进程向所有窗口广播 `pet-binding-changed`，SettingsWindowApp / ConnectionsDomain 订阅并更新。
- **快捷面板**：头部只剩“快捷设置”+关闭并加 `border-bottom` 分隔线；“角色”分组在正文第一位，右侧加粗显示当前模型，展开后是原来的展示方式/模型列表；“宿主”分组在“部件”之后，列出 7 个 agent 平台，选择后内联确认“切换并重载”，成功后调用 `reloadWindow`。解除绑定仍在 About，宿主列表不含 standalone/外部 HTTP。
- 真实窗口：开发实例从独立待机切到 ZCode → OpenCode → ZCode；`pet-binding.json` 依次更新，旧平台 `host-pets/<host>/runtime-endpoint.json` 被删除，桌宠重载后仍保持 DS 模型；设置窗口停在连接页时，OpenCode → ZCode 会即时更新。打包 alpha.14 实例也显示同一套新面板。验证后开发绑定、ZCode/OpenCode 端点均删除，开发与 smoke 实例已退出，smoke 数据已删除。
- 验证：应用 **907（902 通过、5 跳过、0 失败）**，插件 **105/105**，node/web 类型检查与构建通过。新增回归覆盖 `rebind`、切换 IPC/广播接线、面板分组与标题分隔线。
- 未验收：没有切到本机正在运行的 Qoder/Codex/Antigravity/Harness，避免真实插件接到隔离实例；真实插件重连、真实宿主会话、真实麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏、贴靠图标同步仍未验收。日常 0.1.1/stable 与正在运行的 alpha.12 未替换、未改动。

## 最新：alpha.13 工作状态、快捷面板与部件保持候选（2026-10-25）

- 当前分支 `main`；功能提交 `6989b22`（工作视觉、左右键合并、快捷面板、模式模型记忆、部件保持）、发布准备 `8382a0b`（版本、FIRST-READ、Try-Uta profile、构建配置）、`4d58f56`（发送消息后重新落地控件层，保持部件不消失）；版本 `0.2.0-alpha.13`。
- 候选 ZIP：`app/release/Uta-0.2.0-alpha.13-win-x64.zip`，SHA-256 `57d3a56b074ff875ce30e988ea977c958607c0d925398c5894374d1ae686e27f`，来源 `4d58f56eded3`，`dirty=false`，构建 `2026-10-25T08:48:55.058Z`；解压目录 `app/release/Uta-0.2.0-alpha.13-win-x64`，`Try-Uta.bat` 使用 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.13`、profile `candidate-020-alpha13`。
- 行为：宿主 hook 没有输入框焦点事件，按用户决定取消宿主输入框监听；思考/工具状态依次尝试 `聆听记录 → 聆听 → 工作 → 思考/专注/好奇`，命中循环后由 `workingVisualOwns` 独占，工作解说和工具切换不抢视觉。桌宠自己的输入框也不触发聆听。
- 点击：`onStageClick` 与 `onStageRightClick` 共用 `cycleEmotion()`；单击延迟 220ms，双击在 `onDoubleClick` 清定时器并打开输入框；旧触摸区域命中、`hitTestModel`、`performTouchReaction` 与“戳一戳”台词已删除。输入框占位只剩“输入消息…”。
- 快捷面板：角色名展开模型抽屉；主题色只在完整设置；桌面组新增 `setClickThroughLocked` 锁定穿透；部件区按 `outfit/hair/pose_prop/face_effect/toggle/other` 分组，调用 `store.toggleHeldControl`。`held` 标记在 `applyControlActionToList` 的 `reset_transient`/`set` 中保留，完整 `reset` 清除；预设步骤把保持项最后落地，互斥时用户保持优先。发送消息清场景参数后会调用 `syncControlsToModelAndHost(240)` 重新落地控件层，保持部件不会在发送后消失。
- 模式记忆：`deskpet/model-by-kind` 记录每种 kind 最后 URL；`setStoredModelPath` 与 `discoverModel` 都会写入；快捷面板、完整设置角色页、旧 SettingsPanel 的 `setDisplayMode` 都会先查记忆再回退第一项。
- 验证：应用 **903（898 通过、5 跳过、0 失败）**，插件 **105/105**，node/web 类型检查与构建通过。真实开发实例 `dev-f7e444bba875` 用隔离的合成绑定和本机 v2 事件验证了“思考中”胶囊、设置页“正在表现：工作·连续”、完成后回待机；验证了单击不开输入框、右键切表情、双击开输入框、蛋包饭部件“保持”跨多次操作不消失、DS ↔ `sample_static` 双向记忆、快捷面板折叠布局。打包 `Try-Uta.bat` 实例正常加载 Hiyori 并显示同一套新面板。证据见 [候选验收记录](../validation/candidate-0.2.0-alpha.13.md)。
- 未验收/边界：锁定穿透按钮没有在真实窗口点击（本机同时有日常 alpha.12，共享全局快捷键），只做了代码和源码测试；真实 Codex/Qoder/DSH 工作事件、真实宿主输入框焦点（宿主不提供）、真实麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏、贴靠图标同步仍未验收。
- 现场：开发实例与打包 smoke 实例均已停止；开发实例的合成 `pet-binding.json` 已删除，`win-unpacked` 内 smoke 临时输出已清理；smoke 生成的 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.13` 已删除，用户首次双击 `Try-Uta.bat` 会从干净引导开始。日常 `uta` 数据与正在运行的 alpha.12 实例未触碰；日常 0.1.1/stable 未替换。

## 最新：alpha.12 单平台绑定与多桌宠候选（2026-10-25）

- 当前分支 `main`，代码提交 `bfa5d6c`（单平台绑定、平台内会话共用、宿主端点、Pets 启动器、Codex 发言/hooks/共享锁修复）、`4818a15`（固定绑定文案）、`dc2ec01`（最终截图/打包源码）；版本 `0.2.0-alpha.12`。候选 ZIP `app/release/Uta-0.2.0-alpha.12-win-x64.zip`，SHA-256 `e395d5189bd8e74b2d327ceaed26ad80aa279f3f211e5f6513fed67d1f450c50`，来源 `dc2ec01436c3`，`dirty=false`，构建 `2026-10-25T07:56:38.094Z`。
- 行为变化：每个 Uta profile 只绑定一个平台，绑定写入 `runtimeDir/pet-binding.json`；主进程只接受该平台的 v2 事件（其他平台 403），未绑定时连 legacy 也拒绝。同一平台所有会话共用桌宠；`session_bind` 结束旧回合。连接页不再能切换平台，About 可解除绑定。
- 多桌宠：包内 `Pets/` 有 7 个启动器，各自 `%LOCALAPPDATA%\Uta-Pets\<platform>` 数据和 `UTA_BOUND_HOST`。桌宠额外写 `%APPDATA%\uta\host-pets\<host>\runtime-endpoint.json`；插件优先读取，端点带 PID，死进程文件跳过。共有宿主专属端点的实现见 `runtime-bridge.setExtraEndpointFile` 和 `plugin/shared/uta-runtime-client.mjs`。
- 迁移/解除：旧 localStorage 平台偏好首次启动迁移为绑定，并写 `uta/binding-migration-v1`；解除后标记阻止旧偏好自动绑回，桌宠重载为独立待机。真实两次确认解除已验证绑定文件和宿主端点都删除。
- Codex 报告修复：发言标记只在成功 `PostToolUse` 写入（拒绝/失败仍保留最终摘要）；hooks 信任按插件完整事件集合计数并显示部分信任；安装锁按共享 `CODEX_HOME` 跨 profile 互斥。
- 验证：应用 **906（901 通过、5 跳过、0 失败）**，插件 **105/105**，node/web 类型检查、构建、ZIP manifest 通过。真实开发双实例分别绑定 Codex/Harness，端口 56673/51411，互相投递分别 403/200；打包实例 About 显示 `v0.2.0-alpha.12 / dc2ec01436c3 / clean / Packaged`，连接页只读。证据见 [候选验收记录](../validation/candidate-0.2.0-alpha.12.md) 与 `docs/validation/alpha12-*.png`。
- 未验收：真实 Codex 安装点击/MCP 握手、两个真实宿主插件同时连接、真实 DSH/其他宿主会话、真实麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏、贴靠图标同步。平台内聊天共用是设计选择；若要单聊天隔离需另做会话级绑定。
- 现场：开发双实例与打包实例已停止；测试产生的 `%APPDATA%\uta\host-pets` 端点已删除；隔离数据保留在 `%LOCALAPPDATA%\Uta-Candidates\multi-codex`、`multi-harness`、`alpha12-final`。日常 0.1.1/stable 未触碰；`docs/AGENT-PORTABILITY-PLAN.md` 保留未提交。

## 最新：Codex 新安装与适配专项验收（2026-10-25）

- 基线 `main/74d971b`，候选 alpha.11、插件 `uta-deskpet@uta/0.2.2`、真实 CLI `0.164.0-alpha.11.1`。独立 `.tmp/codex-injection-20261025/codex-home` 初始无插件，生产安装器调用真实 CLI 安装成功，重装不改配置；实际 app-server 新聊天发现并连接 5 个 MCP 工具，均可到达生产桥。
- 信任后用本地固定 Responses 输出驱动真实 Codex 消息和工具链路，开始/思考/工具前后/完成及一次性审批允许、拒绝均有真实 hook 回执。没有调用付费模型或复制日常认证。测试信任仅写入本任务配置，未使用绕过信任开关。
- 新发现 **[P2: 无会话身份的 MCP 绕过已绑定聊天]**、**[P2: 拒绝发言工具仍抑制最终回复]**、**[P2: 部分信任误报整组已信任]**，详见 [专项报告与复现](../validation/codex-injection-2026-10-25.md)。本轮不修业务代码；已有共享 CODEX_HOME 安装锁缺口也仍未修复。
- 回归应用相关 83/83、插件 103/103。安装验证未经过真实候选窗口按钮，角色渲染/声音/审批点击未验；queue 接口参数匹配，但本机附带 CLI 无法在独立目录启动完整 daemon，反向输入仍未端到端验证，不能误记成 Uta 的已确认缺陷或验收通过。
- 本机证据在忽略目录 `.tmp/codex-injection-20261025/`。结束时自建 app-server/MCP/Node 服务无遗留，测试端点删除、独立配置恢复到安装后状态；日常 Codex config.toml 哈希未变。没有改日常 Uta、没有替换发布包；原有 `docs/AGENT-PORTABILITY-PLAN.md` 改动未暂存。
- 下一步建议：先修上述三项适配缺口及共享安装锁，再用完整 Codex 安装环境补 queue 闭环，最后在打包候选验实际安装/气泡/审批交互。详见报告中的证据边界。

## 最新：alpha.11 独立验收，仍有跨实例安装互斥缺口（2026-10-25）

- 验收基线 `main/4270fb38f1c00fcb8d7e32289b7e7040c90e1544`；详见 [alpha.11 独立验收](../ACCEPTANCE-2026-10-25-ALPHA11.md)。原 11 项中 10 项在模块/组件/包核对范围通过；**[P1: 按 Uta runtimeDir 持久化安装阻断，无法互斥同一 Codex 配置目录的多个实例]** 仍需修复。同 profile 重启保护已通过，不要回退该修复；以规范化 CODEX_HOME 为共享资源做跨进程原子互斥和活实例状态核对。
- 本轮应用 902（897 通过、5 跳过）、插件 103/103、node/web 类型、构建、三份契约通过。`.tmp/acceptance-alpha11-20261025/probes.cjs` 最终 13/13；`boundary.cjs` 独立复现同一 CODEX_HOME、两个 runtimeDir 调用两次未确认退出的市场写入，结果在 `boundary-result.json`。所有宿主写入复现均为生产模块+临时文件系统+受控进程结果，没有真实宿主安装。边界脚本刻意断言缺口存在，后续须反转为第二写入不发生。
- ZIP `68143ab8...ffe86a` 与 manifest 一致，解压 exe/asar 均与 ZIP entry hash 一致；asar 构建身份 `0.2.0-alpha.11 / 3dd17fe8749a / dirty=false`。本轮未重新打包或提升日常入口。
- UI：独立 profile `acceptance-alpha11-20261025` 主窗口/树可读，点击在重新绑定激活后仍被 `Chrome Legacy Window` 目标校验拦截，未绕过；本轮真实弹窗/焦点/宿主握手/语音仍未验。不要将交付方截图写成本轮独立操作通过。
- 现场：本轮数据/运行时/端点、CODEX_HOME/DSH_HOME 在 `.tmp/acceptance-alpha11-20261025`；主进程记录 28096、UTC `2026-10-25T06:37:21.3054023Z`，收尾时已退出，未强杀；查无该 profile 的 Uta 子进程，自己的 endpoint 已删除，回环探针 finally 关闭。业务源码未改，构建刷新 app/out；`docs/AGENT-PORTABILITY-PLAN.md` 前后 hash 一致，未暂存/提交，日常实例未操作。

## 最新：alpha.11 复审修复与候选（2026-10-25）

- 当前分支 `main`，复审修复提交 `9497bdd`（安装互斥、MCP/Node 检查）、`5a9bf61`（草稿保护与强调色对比度）、`b99c3e2`（会话迟到归属）、`ab7012c`（在途重复事件）、`7a39b5a`（静态立绘回执）、`a15594b`（alpha.11 版本与随包材料）、`69ef67f`（Qoder/Antigravity 检测措辞）、`c355245`（视觉证据）、`3dd17fe`（阻断落盘，重启仍有效）；版本 `0.2.0-alpha.11`。
- 候选 ZIP：`app/release/Uta-0.2.0-alpha.11-win-x64.zip`，SHA-256 `68143ab8c33600a16854d8136969ec2a5021bad0a791688a08066ec1d8ffe86a`，来源 `3dd17fe8749a`，`dirty=false`；解压目录 `app/release/Uta-0.2.0-alpha.11-win-x64`；`Try-Uta.bat` 使用 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.11`。详见 [候选验收记录](../validation/candidate-0.2.0-alpha.11.md) 与 [体验说明](../releases/0.2.0-alpha.11.md)。
- 已修复 alpha.10 复审 11 项：安装超时后保持写入互斥并提供解除入口（阻断落盘，重启不自动解除）；重开引导/换角色/快捷面板保护未保存草稿；迟到会话按宿主和请求代数归属；静态立绘等待真实挂载回执；工坊 undo/redo 保留循环模式；在途重复事件等待首次投递结果；MCP 精确条目与启用状态；其他宿主材料随包并修正“暂不支持自动检测”；安装前检查 node；两套强调色共用 WCAG 对比度算法。
- 自动验证：应用 **902 项（897 通过、5 跳过、0 失败）**，插件 **103/103**，node/web 类型检查与构建通过。新增正式回归：`color-contrast`、`model-load-gate`、`static-switch-gate`、`connections-domain-race`、`workshop-draft-signal`、`settings-workshop-undo`，并扩充了宿主安装、运行时重复、设置窗口草稿和引导测试。
- 真实窗口：最终实例 profile `packaged-alpha11-final2`，Uta 数据、运行时、端点、`CODEX_HOME`、`DSH_HOME` 全部在 `%LOCALAPPDATA%\Uta-Candidates\alpha11-final2-20261025`。验证了宿主卡片措辞、换角色草稿保护、快捷面板跨窗口拦截、静态立绘切换成功、重开引导保护、琥珀强调色（正常 4.95:1、悬停 5.71:1）和关于页 `v0.2.0-alpha.11 / 3dd17fe8749a / clean / Packaged`。交互截图来自同一源码树的上一构建（差异只有阻断落盘），版本/诊断截图来自最终构建。截图在 `docs/validation/alpha11-*.png`。
- 未验收/边界：真实 Codex 安装点击（最终实例使用隔离 `CODEX_HOME`，只检测）、MCP 实际握手、安装超时/解除阻断的真实 UI 触发、其他宿主真实会话、真实麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏、贴靠图标同步。复审中的界面打磨建议（默认动作栈位置、关键帧 DOM 身份、`.pressable` 回弹）未处理。
- 现场：本轮的 alpha.11 最终实例主进程 `30492`、第一次视觉实例主进程 `37856` 均已清理；桌面原有的 alpha.10 候选实例（PID `38280`）不是本轮启动，未停止；日常 0.1.1/stable 未触碰。隔离数据保留在 `%LOCALAPPDATA%\Uta-Candidates\alpha11-verify-20261025`、`alpha11-final-20261025` 和 `alpha11-final2-20261025`。打包前 `docs/AGENT-PORTABILITY-PLAN.md` 三次临时收起、打包后恢复，仍未提交。
- 下一步建议：在愿意接受备份时，用真实 Codex 配置完成一次安装、`/hooks` 信任和新会话 MCP 握手；再用真实 DS 模型确认预设回默认/取消部件过渡；之后再做 8 小时/7 天与多屏 DPI。不要用测试全绿代替真实宿主/声音验收。

## alpha.10 独立全面复审（2026-10-25，已由 alpha.11 处理）

- 基线 `main/18d18a25a3186d28bcdf16aca3c34f2821f44e94`，候选 alpha.10 源码 `1898646`。复审详见 [复审报告](../REVIEW-2026-10-25-ALPHA10.md)：11 项（1 项 P1、10 项 P2），9 项有运行探针，另 2 项核对发布包材料/条件性 Node 依赖。alpha.11 已修复并补回归；该轮自身未修业务代码。
- 该轮验证：应用 878（873 通过、5 跳过），插件 103/103，node/web 类型、构建与三份契约通过。独立脚本 `.tmp/review-current-20261025/probes.cjs` 的断言刻意证明缺陷存在；修复时已反转为正确预期并纳入正式测试。
- 真实窗口边界：该轮独立打包主窗口和树可读；点击被 `Chrome Legacy Window` / 目标窗口校验拒绝，激活重试仍失败，未绕过。未完成真实首次引导/动效/麦克风/宿主安装验收；仓库旧截图仅作视觉参考。
- 现场：该轮独立 profile `review-current-20261025`，数据/端点在本轮 `.tmp`，隔离 CODEX_HOME/DSH_HOME；自建主进程 35248 与子树已清理，端点已删除，探针服务 finally 关闭。未停止用户同路径日常实例，未触碰日常宿主配置，未替换运行包。原有 `docs/AGENT-PORTABILITY-PLAN.md` 改动保留；构建仅刷新忽略的 app/out。

## 最新：首次引导、蓝调界面与候选 alpha.10（2026-10-25）

- 当前分支 `main`，核心提交 `3507a6f`（首次引导 + 蓝色外壳）、`a085c0b`（安装安全与界面审查修复）、`8d1fa00`（安装回滚与引导退出修复）、`8eb4491`（移除失效的圆点快捷操作卡片）、`0779776`（清理旧偏好/静态视线/托盘快捷键等）、`f449796`（模型切换交叉淡化初版）、`3dc5fcb`（按帧计时、160ms 双模型淡化）、`1898646`（预设/工坊复位顺位）；版本 `0.2.0-alpha.10`。候选 ZIP 在 `app/release/Uta-0.2.0-alpha.10-win-x64.zip`，SHA-256 `0812fc7d613b1d2544c3bab818550a0c59f3b151cad7662f564e3e2295be21ff`，来源 `18986466457a50cb1bf8c2a26ca0bd89ebc53d49`，`dirty=false`；ZIP 已解压到同版本目录并用隔离 profile 启动，关于页显示 `v0.2.0-alpha.10`、提交 `18986466457a`、干净构建、打包发行版。详见 [候选验收记录](../validation/candidate-0.2.0-alpha.10.md)。
- 已完成：真实首次流（五步、跳过、完成、重开）、7 个宿主的真实检测、Codex 插件已安装状态读取、DSH 手动步骤、自绘标题栏最大化/还原、560px 两列换行步骤条、2048px 宽屏工坊双栏、深浅主题截图与对比度修复。自动验证：应用 878 项（873 通过、5 跳过、0 失败），插件 103/103，类型检查与构建通过。截图在 `docs/validation/screenshots-0.2.0-alpha.10/`。
- alpha.6 清理：桌宠已不再显示左上角圆点，设置中心“桌面与交互”里的“角色身上的小圆点 / 快捷操作”卡片已移除；旧 `orbAction` 字段保留兼容，不再暴露无效果的选择。
- alpha.7 同类清理：旧偏好导入不再列出悬浮球动作；静态立绘禁用视线跟随并说明原因；模型错误提示去重；同步“正在表现”预设；Antigravity 说明改为工作区插件 + MCP 钩子；候选/开发托盘只显示实际注册的快捷键。
- alpha.5 额外修复：安装超时且进程未退出时不自动回滚；恢复前另存安装期间外部改动；首次安装失败移走新建配置；hooks 只认可真实 Uta 段；引导完成失败可从任意步骤退出；语音跳转保留宿主/语音选择；忙碌时锁住导航；浅色强调色自动选择可读按钮文字。
- 本轮刻意没有在你的真实 Codex 配置上点击“安装并连接”：安装内核由单元测试与之前隔离 `CODEX_HOME` 的实际安装验证；本候选构建的真实安装点击仍待你在接受备份时体验。DSH 桌面 profile 由宿主独占，Uta 保持手动。其他宿主只验证检测与手动说明。
- 未验收：恢复页自绘标题栏、Windows 贴靠后的图标同步、深色快捷面板逐项无障碍、真实麦克风/云端 TTS、真实拔插显示器、8 小时/7 天、录屏。候选未替换日常 0.1.1/stable。
- 透明记录：早期 DSH 调研执行 `dsh plugin --profile tui --help` 时，DSH 在 `C:\Users\Administrator\.dsh\profiles\tui` 初始化了一个空 profile；已检查内容并只删除该次调研创建的空目录，没有安装插件或改动 DSH 设置/日常 profile。
- 测试现场：源码验收实例 `visual-review-20261025`、`visual-alpha5-20261025`、`desktop-cleanup-alpha6` 与打包验收实例 `packaged-alpha4-20261025`、`packaged-alpha5-20261025`、`packaged-alpha6-20261025`、`packaged-alpha7-20261025` 均已退出；隔离体验数据保留在 `%LOCALAPPDATA%\Uta-Candidates\` 供复查。日常 Uta 未被启动、停止或覆盖。打包前既有未提交文档 `docs/AGENT-PORTABILITY-PLAN.md` 原字节保留，未纳入本轮提交；打包时临时收起、打包后已恢复。

## 最新修复验收与评价（2026-10-25）

用户要求独立验收修复后评价项目；基线 `main/d681c4134e9b205cec7651cc5b258aaaa966be86`，功能修复 `6e06090` / `b4c0842`。详见 [验收报告与项目评价](../ACCEPTANCE-2026-10-25.md)。主要修复有效，但三项额外探针失败，不能沿用后文历史记录作“全量通过”结论：**[P2: 旧发送失败回执覆盖新草稿]**、**[P2: 批处理宿主入口发现成功但 spawn EINVAL]**、**[P2: Runtime 同 session 并发 seq-only 未互斥]**。本轮没有修业务代码。

- 本轮验证：应用 819 项（814 通过、5 跳过）、插件 103/103、node/web 类型检查、构建与三份契约通过；独立探针 15 项（12 通过、3 失败）。材料在忽略目录 `.tmp/acceptance-20261025/`。
- 包与环境：核对 `preview-all-fixes-20261025` 的 asar 哈希与交付一致，以新建 `acceptance-20261025` profile 启动；Computer Use 只列出唯一测试窗口，读取被拒绝 `Computer Use was not approved to use uta`，未执行 UI 输入、没有用 CDP 绕过。真实云语音、麦克风、宿主 CLI、跨机器/长时/DPI 仍未验。
- 收尾：核对可执行路径、PID 与精确 UTC 启动时间后清理自建 Uta 进程树和模拟服务，自己的 endpoint 已删除；日常旧包未停止/覆盖。业务源码未改，构建刷新 app/out；三份原有未提交规划文档保留。
- 下一步：先围绕三项缺陷对齐小范围修复，再用主要宿主/模型/语音路线做解压包完整流程验收。项目已有清楚方向和工程基础，发布与真实组合验证仍是主要短板。

## 最新横向审查交接（2026-10-24 至 25）

用户要求 review 当前项目，包括潜在 bug 和使用体验；本轮没有实施业务修复。审查基线 `main/049220026a838eb879f276a126831e7525524f13`，完整发现、触发条件、位置、修复建议和验证边界见 [全面审查报告](../REVIEW-2026-10-24.md)。共 18 项（4 项 P1、13 项 P2、1 项 P3）；16 个隔离探针支持其中 16 项，不能当作真实 Electron 画面/声音验收。

- 已完成：应用 795 项（790 通过、5 跳过）、插件 103/103、node/web 类型检查、构建、三份契约检查。初次 EACCES/realpath EPERM 为沙箱限制，最终权限重跑通过。临时脚本和日志在 `.tmp/review-20261024/`，脚本断言当前缺陷存在，后续修复需反转预期后纳入正式测试。
- 当前现场：业务源码未改；构建刷新忽略目录 `app/out`。未启动真实 Uta 窗口、未停止用户进程；CIM 无权枚举 PID，不引用历史 PID。自建测试端点已关闭且 endpoint 已删除。三份原有未提交规划文档保留，不纳入本轮提交。
- 待验证：真实云端音色与服务协议、麦克风、完整宿主事件/输入、CSP 的真实 Electron 抓包、ZIP/新电脑/长时运行/多屏 DPI。旧测试与构建通过不能替代这些验收。
- 下一步：先对齐 **[P1: 云端 TTS 密钥来源与重定向保护]**、**[P1: 完整设置切换宿主未同步]**、**[P1: 打包静态立绘资源被拒绝]** 的小范围修复，再依报告顺序推进。不要把审查请求自动扩大为结构性重构，也不要用旧工作区或其他平台自动续做。

## 用户最新决定

由 Codex 单独接手全部开发、测试、复核、整合与交接。暂停 Qoder / Antigravity 的默认分工，不能从旧任务单、armed、桌面启动说明或历史监听推导新的派单授权。额度不足时保存现场，下一会话继续，不自动换平台。四个平台的宿主兼容目标仍保留，DSH 不承担日常开发。

主目录 `D:/Frankenstein/Uta` 是统一开发版入口。正常在 `app` 内运行 `npm run dev`，先核对运行中的实例，避免重复启动。根目录 `start-uta.bat` 仍启动已验收的日常解压版 Uta.exe；本轮没有更新日常程序。开发与正式数据继续隔离。

## 旧工作区已核对到哪里

清点基线：main `58b12fe9322b05023226f67983aeacf6bf397a60`。共主目录 + 31 个任务 worktree；逐个核对提交祖先、所有未提交/未跟踪文件，以及源码、测试、插件、脚本、实验和文档目录中被忽略的文件。检查全部本地未合入分支、stash 和未登记的任务子目录，结果均为空。

| 内容 | 核对结论与处理 |
| --- | --- |
| 31 个旧任务目录的提交 | 全部可从 main 追溯，没有待 cherry-pick 或 merge 的独有提交 |
| 29 个 Git 干净的旧任务目录 | 无未提交功能代码；保留目录，不作为新的实施入口 |
| `antigravity-settings-runtime-integration` | 6 个已跟踪改动 + 8 个未跟踪文件，共 14 文件，SHA256 全部与 `operations/cli-wave3-monitor/antigravity-capture.json` 一致；它们是已在 `404be6d` 复核修正的原交付，不应再覆盖当前实现 |
| `codex-settings-electron-validation` | 577 个未跟踪文件全部位于 `app/.uta-review-tmp/node-compile-cache/`，是编译缓存，不是遗漏实现 |
| 主目录中被忽略的 DSH `HANDOVER.md.tmp` | 是旧交接稿，缺少后来第 9–13 节；仅收取其中两处仍有价值的章节引用/编号修正到正式 HANDOVER，保留后续历史，未整文件覆盖 |
| 4 个目录中的私有输入 | `codex-cli-wave3-review`、`codex-desktop-wave2-review`、`qoder-model-inspection-adapter`、`qoder-soullink-engine-spike` 的 `.uta-task/model-input` / `reference-inputs` 仍保留，未移动/删除，也未提交 Git |
| 主目录四份原有修改文档 | 保留原字节，不暂存/提交到本轮；名单见下方 |

完整逐目录、逐文件状态及 SHA256 在本机 `D:/Frankenstein/Uta-Workspace/operations/takeover-2026-10-24/inventory.json`。非缓存未提交文件已复制到同目录 `backup/`，仅本机保存，不是公开资产或发布输入。历史分支、任务原件、模型与验收资料均未删除；没有以清理目录代替确认代码是否整合。

受保护的原有文档：

- `docs/AGENT-PORTABILITY-PLAN.md`
- `docs/IMPLEMENTATION-P2-L0.md`
- `docs/ITERATION-ROADMAP-2026-10-13.md`
- `docs/design/blue-block-design-spec.md`

## 本轮实际验证

在统一主目录源码、上述基线执行：

- `app/npm test`：571 项，566 通过、5 跳过、0 失败；跳过为需要本机真实 DS 输入的测试，不计作通过。
- `app/npm run test:plugin`：104/104 通过。
- `app/npm run typecheck`：node/web 均通过。
- 根目录 `node scripts/check-first-wave-contracts.cjs`、`check-desktop-wave2-contracts.cjs`、`check-performance-mixer-contracts.cjs`：均通过。

应用与插件日志在本机 `operations/takeover-2026-10-24/app-tests.log`、`plugin-tests.log`。本次未重新验收真实画面、声音或 ZIP，未提升 stable，未访问写入正式模型/设置。上次真实设置窗口与任务栏验证记录仍见 CURRENT 的日期分段。

## 接管清点时的运行现场（历史）

清点时，主目录 Electron 路径下可见两个渲染进程，PID 32164 / 22600，创建时间分别为 2026-10-23 23:31:35 / 23:31:39（本机时区）；开发数据属于 `uta-development/dev-f7e444bba875`。5173 端口由 PID 18104 监听。这里只证明进程/监听存在，未据此宣称窗口交互正常。

未发现命令行中指向旧任务目录的 Qoder / Antigravity CLI 实施进程，未重新派单，未停止任何现存进程。PID 只是检查当时的现场，后续必须重新核实路径、创建时间和监听，不得按本文 PID 终止进程。

本轮接管文档复用现有 `codex-roadmap-1-0`、`task/codex/roadmap-1-0`，起点与 main 同为 `58b12fe`，原状态干净；未为此新开任务区，未在该目录启动应用或新 profile。后续正常实施直接在统一主目录进行。

## 已直接接手的第一项：设置窗口保存修复

接管规则与目录核对已在 `1821249` 合入 main。随后直接在主目录、main、该提交上实施保存修复；原四份未提交文档未纳入。没有新的实施工作区或实例。

原页面用非响应式客户端快照判断 dirty，广播中先赋 revision 再与自己比较，成功回执则整份覆盖草稿。现在由 `app/src/renderer/settings-window/use-settings-draft.ts` 管理响应式已提交快照、逐字段合并与编辑版本，`SettingsWindowApp.vue` 使用该逻辑。客户端和主进程协议不变。

已实现：

- 没有本地修改的字段随远端同步；本地改主题、外部改音量不会互相覆盖或误报冲突。
- 同字段同时改动才展示冲突名称；“冲突项使用外部版本”只处理冲突项，其他本地草稿保留；普通保存不绕过冲突。
- 保留草稿并保存只提交实际修改字段，仍受客户端 revision 检查；期间第三次外部修改会再次提示，不自动覆盖/重试。
- 慢保存期间的新输入保留，包含重新改回旧值的情况；旧回执不覆盖较新广播或清掉新冲突。保存成功但仍有新输入时明确提示仍待保存。
- 保存失败保留草稿并允许重试，错误不直接显示原始异常；重复点击不会重复写入；关闭页面退订并清理提示计时器，忽略迟到回执。

验证：新增 `app/tests/settings-window-draft.test.cjs` 的 10 项测试并登记到 `npm test`。实际编译并挂载生产 Vue 页面、控件、草稿逻辑和真实 SettingsClient；只替换 Electron 传输及无关的旧工作区组件，没有在测试里复制草稿算法。最初测试宿主缺少 Vue 原生输入指令需要的 DOM 方法/类型，补齐测试宿主后 10/10 通过，未为此改动产品行为。

完整应用 581 项（576 通过、5 跳过、0 失败），node/web 类型检查与产品构建通过。日志在本机 `operations/takeover-2026-10-24/settings-draft-full-tests.log`、`settings-draft-build.log`；构建仍有已有 Cubism 普通 script 不能 bundle 的提示，退出 0。构建仅为子进程设置仓库外临时目录，没有修改全局 TEMP 或 APPDATA。插件和三份契约在接管基线已通过；本项未改协议/插件，未重复无关检查。

体验入口：统一开发版中打开独立设置窗口 → 外观与性能 → 修改强调色 → 保存；正常保存后按钮应变为不可点，继续编辑后再次可保存。首次提交时只有实际组件测试，后续已补真实 Electron 双窗口和重启验证，见下一节。首次保存修复未启动实例；后续验证只启动临时 profile，没有停止原开发实例或发布 ZIP。

## 本轮完成：关闭草稿保护与真实双窗口验证

实施现场：主目录、main，起点 `dd051ec640a9bfaf921811c6e163cc47e57362f6`；原四份未提交文档继续保留。没有新 worktree 或其他平台任务。

### 实际行为与代码

- 原生关闭设置窗口时，先由 renderer 判断公开偏好是否有草稿。干净窗口直接关；有草稿显示“保存并关闭 / 放弃并关闭 / 继续编辑”。保存失败、同字段冲突或保存后的新输入留在窗口里，不自动选覆盖。退出整个 Uta 用同一条确认链路，选择继续编辑不会先销毁托盘、存储或 runtime bridge。
- 新共享接口 `shared/settings-window-contracts.ts`、main 的 `settings-ipc/window-lifecycle.ts` 和 preload `settingsWindow` 只提供准备就绪/接收关闭请求/回应当前请求。主进程严格限制到登记的设置窗口、准确页面和主 frame；请求编号过期、未知选择、其他窗口或子 frame 均不能批准关闭。
- `SettingsWindowManager` 在收到 `closed` 前始终保留窗口引用，避免关闭被否决后另开第二个设置窗口。退出先等待设置窗口确认，取消会清除退出意图；真正关闭后才继续原有存储落盘/应用退出流程。导航、崩溃和新窗口不能沿用旧请求或被旧进程的迟到事件解除保护。
- `use-settings-close.ts` 协调草稿保存和关闭；取消关闭后迟到的保存成功不再关窗，新关闭请求不会被上一条取消回执卡住。弹窗背景使用 inert，初始焦点为继续编辑，Tab/Shift+Tab 在选项中循环，Esc 返回编辑。
- **保护范围**：本轮只覆盖顶部“保存偏好”管理的十二个公开字段。旧 TTS/STT 服务配置和工坊自身草稿没有因此统一管理，不能宣称所有设置表单都已有关闭保护。

### 实际验证和证据

默认应用套件增加 16 项（9 项真实 Vue 页面、7 项窗口管理/IPC/preload），最终 **597 项：592 通过、5 跳过、0 失败**；node/web 类型检查、构建通过。模型迁移测试的 main 加载器新增一条新模块替身，维持原临时文件系统测试，不删除/跳过原用例。5 项 skip 仍是缺真实 DS 输入的用例，不算通过。主进程关闭接口和 preload 用真实生产模块执行；组件测试运行实际 SFC/控件/SettingsClient，不复制一份理想流程。

真实 Electron 使用 `app/out` 构建结果、主进程原生 BrowserWindow.close/app.quit、真实 preload 和两个 renderer，数据限定到 `D:/Frankenstein/Uta-Workspace/runtime/profiles/settings-close-20261024`。先核对 main 与 renderer 返回的 profile/userData，再操作：

1. 设置保存后宠物主题同步；改颜色草稿时宠物写音量，两项均保留。
2. 同字段外部修改在页面提示具体冲突；采用外部冲突项后其他本地草稿仍保留。
3. 主进程模拟原生标题栏关闭，真实页面显示三选项且焦点正确；继续编辑保留草稿。
4. 保存并关闭后重开取到新值；放弃并关闭后重开仍是已保存值。
5. app.quit 时选择继续编辑，后续真实存储 patch 成功，runtimeEndpointReady 和 rendererReady 仍为 true；再次退出并保存正常结束。
6. 新进程重新读取同一受控 profile，main 和实际设置页面均恢复最后写入值；没有草稿时退出无需确认。

本机证据目录 `D:/Frankenstein/Uta-Workspace/operations/settings-close-2026-10-24/`：`electron-results.json`（9项）、`restart-results.json`、`close-prompt.png`、`verify.mjs`、`verify-restart.mjs`、`app-tests.log`、`typecheck.log`、`build.log`。最初调试脚本错误假设 inspector 中存在 process.mainModule，改用当前 Node 的 createRequire 后继续，未为此改产品代码。脚本只操作已核对身份的临时实例。

### 当前现场与体验入口

两轮验证进程分别为 PID 12036（2026-10-24 00:42:35）、36280（00:49:13，本机时区），均已通过应用正常退出；收尾核对两进程结束、9274/9275 无监听、该 profile 的 runtime-endpoint.json 已清理。创建时间/路径保存在证据目录的 process.json / restart-process.json，后续不可按历史 PID 停进程。

临时 profile 和截图保留作证据，不是新的日常设置源；未提高 stable、未生成日常 ZIP、未改正式设置/模型。原开发实例未停止，收尾仍可见原 32164 渲染进程和 5173 监听（仅为现场，不据此推断所有窗口正常）。

本轮包含 main/preload 修改，**需要重新启动开发版才能完整体验关闭保护**。入口为 `D:/Frankenstein/Uta/app` 内 `npm run dev`；根目录 start-uta.bat 仍启动旧日常 exe。体验：设置 → 外观与性能 → 修改强调色但不保存 → 点窗口关闭，确认三种选项。保存/冲突与退出不再只有模拟证据。

## 本轮完成：模型操作真实回执与工坊会话回收

实施现场：`D:/Frankenstein/Uta`、main，起点 `aeaa225540c51241755a87ebe0830660d05c1000`。没有派单、额外 worktree 或日常版本更新；原四份文档仍按接管清单核对原字节并保留。

### 实际行为与继续修改的边界

- `SettingsPanel.vue` 的步骤、组合、滑块、控件、陪伴操作使用 store 的异步 `requestModelAction`。不再因为设置窗口的 `live2dModel` 为空而跳过；页面显示正在执行、桌宠已开始执行或具体失败。宿主侧旧同步 API 保留，未把整个 store 改成 Promise。换模失败仍保留现有模型。
- `settings-window/pet-bridge.ts` 只同步模型元数据，不创建第二个模型。发送时克隆编辑草稿、顺序等待加锁与执行回执，绑定 URL/模型引用代次/桌宠代次；模型变化后刷新快照，但不自动重放旧输入。刷新快照有次数限制；退出清计时器、watcher 和排队预览。
- 宠物执行抽到 `settings-window/pet-executor.ts`，由 `DeskpetStage.vue` 调用生产 store/controller。未加载模型、无执行器、无效参数不会报告成功。组合预览在宠物侧真正设置 preview 标记；步骤与滑块 controller 返回实际受理结果。
- main 的 `settings-ipc/pet-commands.ts` 管理具体设置文档的单调会话编号与待处理命令。登记窗口、准确页面、主 frame 与回执来源均校验。关闭、主文档导航、崩溃、超时主动取消并通知宠物释放；新会话和已释放编号形成边界，旧清理不影响新会话，旧命令不能重新加锁。宠物重载改变 petEpoch，旧快照不能继续控制新 renderer。
- `release-workshop` 立即取消桥内排队操作，不等某次未返回的预览。离开工坊标签、切换设置领域导致组件卸载，以及正常关闭时都释放锁/循环预览并清除 80ms 拖动预览计时器。取消关闭保留原工坊。主进程回收为主要保障，pagehide 仅补充。
- 改动涉及 main/preload/shared 的内部窗口通信契约，开发版需要重启；外部 SDK v2/插件协议未改。回执说明实际接受/开始，不证明完整动画或发声已完成。仍用原 Live2D 执行链；新 mixer 未接真实 Core，本轮也没有实现语音试听或工坊草稿持久化。

### 测试与真实窗口证据

新增默认登记的 `settings-pet-lifecycle.test.cjs`（8 项）和 `settings-pet-execution.test.cjs`（9 项）。执行实际生产 controller、executor、bridge、Pinia/Vue store；替换传输、Core handler 和环境，不复制产品算法。覆盖迟到回执、子 frame、模型代次、旧清理/新会话、崩溃/导航/超时、排队快照、立即退出与 watcher 释放。模型迁移 main 加载器补新模块替身，原用例仍执行。

最终应用 **614 项：609 通过、5 跳过、0 失败**；node/web 类型检查、构建，以及根目录三份 `check-*-contracts.cjs` 通过。5 项 skip 仍为需要真实 DS 输入的用例；本轮未运行插件回归（本次未改插件，接管时 104/104 通过）。构建保留既有 Cubism 普通 script 提示；未改全局 TEMP/APPDATA。

真实 Electron 使用最终 `app/out`、真实 main/preload 和宠物/设置双窗口，先核对隔离身份再操作。本机证据在 `D:/Frankenstein/Uta-Workspace/operations/settings-actions-2026-10-24/`：

- `electron-results.json`：12 项通过。实际工坊步骤/组合按钮及状态提示；宠物只有一个模型、设置没有模型；取消关闭保留锁；确认关闭、刷新、renderer 崩溃后实际宠物锁与 preview 均清除；崩溃恢复可继续预览；离开工坊标签或角色领域释放；宠物重载拒绝旧绑定，主动重试恢复；宠物不可用时实际按钮显示错误。
- 主进程只加被动观察器读取宠物清理回执，确认锁确已释放，不以重开后的快照推断此前释放。`verify.mjs`、成功/失败截图、`app-tests.log`、`typecheck.log`、`build.log` 保留；未提交个人数据或截图到 Git。
- 最终临时进程 PID 23324，创建时间 2026-10-24 01:31:13（本机时区），路径与身份记录在 `process-attempt2.json`；初次验证 PID 3992 同样已退出。只让已核对身份的测试实例正常退出，收尾确认 23324 不存在、9276/9277 无监听，临时 runtime-endpoint.json 已删除。不可按历史 PID 清理其他进程。
- profile/userData 为 `settings-actions-20261024` / `D:/Frankenstein/Uta-Workspace/runtime/profiles/settings-actions-20261024`。保留作测试证据，不作为新的日常设置源。正式 AppData/模型、stable 登记与日常 0.1.1 ZIP 未改，原开发实例未停止。

体验入口：重启主目录开发版 → 设置 → 角色与动作 → 预设工坊 → 预览步骤/组合，看到“桌宠已开始执行”；切换语音分区停止工坊控制，返回仍能预览。该结果已经过真实窗口验证，但不等于 DS 新控制、音频或 ZIP 已验收。

## 无人值守连续推进授权

用户在 2026-10-24 本轮明确要求无人值守持续推进，不逐轮停下来。按既定 1.0.0 产品顺序完成每轮实现、测试、实际验收、提交和交接后继续；不恢复外部 Agent 派单。最终提升日常 exe 仍需用户验收；账号登录、外部设备/平台手动操作、未定产品方向等真实阻塞如实记录，不能假造验收结果。

## 本轮完成：模型能力显示与 DS 头部单通道试验

起点 main `eae469e846f029dbbde9e8b8b22259e1974ff73b`，主目录直接实现。角色与动作新增 `settings-window/ModelPerformancePanel.vue`，默认折叠；读取真实能力，按头部/视线/眼睛/眉毛/嘴部/身体显示可用/部分可用/需校准/不支持。普通界面不列参数 ID，技术详情保留内容签名、映射原因及 native/applied 样本。沿用 Bento/蓝色设计 tokens，不加装动画库；系统减少动画时保留能力读取，停用转头演示。

2026-10-26：用户认为该面板多余（“直接在预设工坊里拖滑块不就知道能不能用了”），已从角色页移除并删除组件。`inspect-performance` / `preview-head|eyes|mouth|ambient` 命令与执行器仍保留，供诊断与回归测试使用。

### 技术落点与边界

- `main/model-performance-assets.ts` 被现有 inspectModelAssets 调用，只读 model3 声明的 MOC、纹理、CDI、physics、pose、expression、motion/sound，不扫描个人 presets/adapter。逐引用 realpath 限制在模型目录；JSON 8 MiB、单二进制 32 MiB、总量 128 MiB、1024 文件上限，缺失/损坏返回 null。签名算法为 `uta-live2d-assets-v1:` + 排序的 `[相对路径, SHA256]` JSON 的 SHA256，包含 model3 自身；与 DS 冻结基准签名是两个不同版本，不能直接比较。全量元数据只在加载时返回宠物，不逐帧读盘。
- `services/performance/model-runtime.ts` 对当前 `_model.parameters` 执行已合入的 inspectCoreModel/profile builder。每次加载都核对真实 Core，最多缓存 8 个完全匹配的 profile；无可信资源资料则不开放试验，不影响旧控制。按标准 ID、非物理输出、默认值两侧均有空间，保守开放 headX。签名不含个人覆盖；手动校准缓存与持久表现方案未实现。
- 模型生命周期 prepare 阶段登记 runtime；作废加载、卸载、销毁停止旧试验。loader 的自然更新包装在旧参数栈后调用 mixer，物理前只写 headX；试验期间该参数的旧 active/transitions/post 栈写入暂停，原生 motion/focus 仍是当帧基准。没有贡献的其他通道绝不因 mixer neutral 值被写入。参数按实际 default 分段还原，保留不对称范围。
- 试验是一次最多 4 秒、20% 范围以内的连续转头，使用当前帧原生头部值作为 mixer add 基准；到期/停止直接结束该短时 mixer，原 native save/load 不被改写。为避免 owner/墓碑长期累积，每次试验新建 mixer，结束不保留 leases。不是持续表现引擎，未迁移嘴形/眨眼/身体，也未引入 Soullink。
- 内部白名单新增 inspect-performance/preview-head；实际预览仍绑定既有模型/会话代次。旧对照调用真实预设 handler，必须先启动再加编辑锁；首次实测发现先加锁会被旧 controller 拒绝，已修正并加回归。旧对照使用分段关键帧，新对照使用连续曲线，不能宣传为同一脚本的性能或观感优劣测量。
- 关闭/崩溃/超时沿用上轮 main 会话回收并在 executor 释放 runtime；折叠模型表现、离开领域也停止。播放期间 `presetPreviewActive` 计入 renderActive，避免预览半途降为待机帧率。其余模型/衣物/物理仍为旧执行链。

### 验证、证据和现场

新增 `model-performance.test.cjs` 默认登记的 12 项：真实 inspection/profile/mixer、非对称范围、物理输出拒绝、仅 head 写入、超时/错误释放、生产 loader 旧写入退出/恢复、executor 会话释放/旧控制锁顺序，以及真实临时文件系统的内容 hash/旁车忽略/缺失/越界/超限。默认应用 **626 项：621 通过、5 跳过、0 失败**，插件 **104/104**、node/web 类型检查、构建与三份契约检查通过；5 个 DS 历史 skip 不算本轮真实验收通过。

仓库外 `D:/Frankenstein/Uta-Workspace/operations/model-performance-2026-10-24/` 保留 app-tests/typecheck/build/plugin 日志、`verify.mjs`、`electron-results.json`（9 项通过）、`ds-capabilities.json`、`head-samples.json`、DS 与设置截图。实际 Electron 验证 DS 247/44/8 与 body 关闭、单模型、旧预设播放/自动结束、连续 headX 真实写入/自动结束、手动停止、离开领域、减少动画、折叠与原生关窗释放。截图已查看；没有真实有声/麦克风/ZIP 验收。

只从 `assets/ds-control-baseline-v1` 的清单核对 SHA 后复制 59 个资源/署名文件到临时 profile 的 models/DS-control；没有读写正式 AppData 模型。测试 profile 为 `model-performance-20261024`，userData 为 `D:/Frankenstein/Uta-Workspace/runtime/profiles/model-performance-20261024`。最终 PID 8840（本机 2026-10-24 01:52:04），已正常退出，9282/9283 无监听、临时端点删除。首轮脚本导航精确文字定位失败后，临时 PID 22328 未完全退出；核对真实路径、创建时间和带测试端口的命令行后只清理该次自建实例。记录在 process-attempt1.json / process-attempt2.json / process.json，不按旧 PID 清理其他实例。

体验：重启主目录开发版 → 角色与动作 → 展开“模型表现” → 旧预设 / 试验控制 → 停止并恢复。正式 DS 数据、stable、日常 ZIP 和四份原有脏文档保留。没有日常版本发布。

## 本轮完成：语音入口去重与真实试听结果

起点 main `7bd662421797a12b8fb4c07882cc7e8af7665a74`，主目录直接实施，无派单、无新 worktree。

- `SettingsWindowApp.vue` 保留唯一一套公开播报字段（顶部保存）；移除新 system 选项但不改历史 system 值，显示旧来源提示。来源可在播报关闭时配置，音量/语速补真实 label/id。`SettingsTab.vue` 不再嵌 TTS/STT，改为经 SettingsPanel 事件跳转语音域；STT 仅在语音域出现一次。
- `TtsSettingsSection.vue` 只管理服务连接/密钥/试听，改用 Bento tokens。连接信息沿现有自动保存，API 密钥显式保存，上方偏好与试听使用 props 的当前草稿，不冒充顶部保存覆盖服务配置。云端保存失败可见；手动慢保存只在原字段未再次改变时采纳规范化回执，密钥也仅清除本次提交的原输入，不清掉后续键入。旧云端来源初始化仍沿原兼容规则，统一服务配置来源/每 provider 草稿与 STT 草稿是后续范围。
- main 新 `settings-ipc/voice-preview.ts`，注册 `settings-voice-preview`；preload 新 `previewSpeech`。只认已登记的设置窗口、准确页面与主 frame；最多 120 字，0.5–2 倍速度，未知字段拒绝，本地只允许无凭据的回环 HTTP(S)。云端只用主进程保存配置与密钥，不接收请求自带密钥/任意云端端点。每设置窗口同一时刻一个合成，音频响应有大小/mime 限制；错误只返固定代码。原 tts-synthesize 与宿主/审批权限保持原限制。
- renderer 新 `services/voice-preview.ts` 独立拥有一个 Audio：只有 onplaying 才显示播放，ended 才完成；自然 pause-before-ended 不算失败。停止暂停/卸载/回收 object URL，generation 忽略迟到音频；合成已发出时只取消播放意图，直到该请求结束前禁用重复合成，不能声称网络请求已被中止。播放有 30 秒上限。未知 IPC 异常不向界面泄露正文、路径或凭据。旧 tts.ts 的 previewTts 不再被设置页调用。
- `tts-cloud.ts` 的 `mergeCloudTtsConfig` 用于主进程保存：同后端普通保存可保留 Key，换后端不携带上一家的 Key；明确提供当前新 Key 时才保存它，非法 backend 拒绝。UI 切换后端清空未提交密钥并提示重新保存。当前不是每后端密钥仓库，切回仍需重新填写；未动正式加密文件或配置。

验证：新增默认套件 14 项（voice-preview 13 + 真实服务 SFC setup/保存 1），执行生产主进程 handler、真实播放器控制器、实际 Vue/Pinia 组件保存逻辑。完整应用 **640 项：635 通过、5 跳过、0 失败**；插件 **104/104**、node/web 类型、构建与三份契约检查通过。5 项历史 DS 输入 skip 不算通过。

真实 Electron 证据位于 `D:/Frankenstein/Uta-Workspace/operations/voice-settings-2026-10-24/`：verify.mjs、electron-results.json（9 项通过）、错误/完成截图及测试日志。使用受控回环 HTTP server 输出有效两秒 PCM WAV，观察真实 Audio.currentTime 推进、volume=页面草稿、请求 speed=页面草稿和 ended；上方公开偏好仍为原存储值，草稿未被试听保存。另验缺云端 Key、HTTP 失败、合成中取消、播放停止、跨领域卸载、连接页跳转与后端换 Key。没调用外部云端 TTS、没用真实密钥、没验证具体音色/人工听感/麦克风。截图已查看；补齐此前无效 label prop 导致的滑块标签缺失。

最终临时实例 PID 30124，创建时间本机 2026-10-24 02:09:51，profile `voice-settings-20261024`，userData `D:/Frankenstein/Uta-Workspace/runtime/profiles/voice-settings-20261024`。已正常退出，9284/9285 无监听、临时端点已清理；本地测试 HTTP server 已关闭。首次脚本误用 publicSettings.read 名字导致验收中断，修正脚本后完整通过，未为此改产品 API。此前两个临时 PID 24788/10192 已退出，记录保留，不按旧 PID 清理其他实例。正式 AppData/模型、日常 ZIP/stable 和四份原有脏文档保持。

体验：重启开发版 → 语音 → 配置本地或云端 → 试听当前声音 / 停止试听。顶部“保存偏好”管理播报行为；下方服务/密钥有独立保存说明。真实服务需用户已有可用服务与密钥，不能把受控 PCM 测试写成用户音色验收。

## 本轮完成：当前实例旧偏好预检与确认导入

起点 main `9fd4b667fffaad191cf4eabb983e6ffbc257216c`。关于与诊断新增 `SettingsImportPanel.vue`。只检查当前 renderer origin 的 `deskpet/ui-state-biophilic-v1` / `deskpet/ui-state`，不是扫描正式 AppData 或所有开发实例；`legacy-preferences.ts` 先做十二字段白名单投影，错误字段只提示数量，原 blob/端点/Key/模型/预设不跨 IPC、不删除。已有 current claim 的字段默认保留；未 claim 的单一旧来源默认补入，多个不同来源默认当前值，用户可逐项改选。

### 提交与备份

- `shared/settings-import-contracts.ts` / preload.settingsImport 提供 preview/apply/cancel。main `settings-ipc/import-preview.ts` 只认设置窗口准确页面与主 frame，持有一份不可变的已校验来源快照；不暴露任意文件读取或路径。两分钟 token 与 sender/frame/revision 绑定，单次消费。新预检、取消、导航、崩溃、销毁、退出均回收旧 token 与计时器；慢旧预检不覆盖新预检。
- `SettingsImportRequest` 增加可选 selections；原 importLegacy 行为兼容。带 selections 时必须覆盖本批所有字段，每项只能 current 或实际包含该字段的来源 ID。`legacy-importer.applyReviewedSelections` 在同一个 candidate 中处理最终值/claim/来源收据，不先 import 再 patch。原来未展示的历史 conflicts 原样保留，本次已明确选择不再制造新的冲突。过期 revision 拒绝，不自动 force/retry。
- `AtomicWriter.ensureImportBackup` 只为首次无主文件的明确导入额外写 rollback 文档，通过独占临时文件/fsync/rename 发布；已有主文件继续走原先写入前备份。确认导入前已有当前设置备份，旧 localStorage 原记录不变。备份或候选写入失败保留内存/原值，清理自建临时文件。首次候选 rename 失败时可能仅剩有效 backup；下次启动必须阻断等待恢复，不能当作新装写默认值，恢复 UI 是下一轮。
- UI 有顶部草稿时禁用导入；来源相同 digest 已处理则跳过。导入广播沿用既有 SettingsClient/逐字段草稿合并，宠物和设置同步。没有开放 stable/canonical-stable，没有自动改正式数据，也未迁服务或模型旁车。

### 验证与真实现场

新增默认登记 `settings-import-preview.test.cjs` 13 项，涵盖白名单/只读预检、首次备份、明确覆盖/保留、格式拒绝、并发 revision、token 归属/过期/生命周期、重复导入、磁盘故障、保留旧冲突与慢旧预检。完整应用 **653 项：648 通过、5 跳过、0 失败**；插件 **104/104**、node/web 类型、构建、三份契约通过。

证据目录 `D:/Frankenstein/Uta-Workspace/operations/settings-import-2026-10-24/`。最终 `verify-final.mjs` 实际操作 9 项通过：预检不创建主/备份文件、宠物无导入权限、逐字段选择与双窗口同步、首次 rollback 备份/不带敏感字段、重复无写、并发拒绝、取消无写且 token 失效、刷新 token 失效、草稿门控。`verify-restart-final.mjs` 新进程验证导入值和后来宠物改动保留。截图已查看，`electron-results.json`、`restart-results.json` 与测试日志保留。首次脚本 probe 等待 profile 初始化不足，曾看到 Electron 尚未覆盖的默认路径；最终脚本等待 userData 确认后才操作，未向该默认路径写设置。

最终数据 profile 为 `settings-import-final-20261024` / `D:/Frankenstein/Uta-Workspace/runtime/profiles/settings-import-final-20261024`，导入 PID 9260（02:26:19）、重启 PID 26184（02:26:29，本机时区）。**退出质量边界**：导入实例正常退出，重启实例在 runtime 端点已删除、main inspector 已关闭后，Chromium 9286 端口/浏览器进程仍残留并不响应；断开 renderer CDP 后仍曾复现。此前 PID 36376 同样有残留。均按本轮记录核对真实路径、创建时间和测试命令行后仅清理这些自建实例，未动用户开发实例；不能写成所有正常退出验证通过。

另用无 Chromium 浏览器调试端口、仅 main inspector 的 `settings-exit-probe-20261024` 验证同一最终 app/out：加载真实模型和设置后 app.quit，PID 32428（02:28:42）正常退出。证据 start-exit-probe.ps1 / verify-exit.mjs / process-exit-probe.json。它说明该场景可退出，不证明浏览器调试残留的根因已解决；留在质量阶段复查。当前所有本轮 9286/9287/9289、临时端点和这些验证进程均应已清理，交接前重新检查。

没有验有声/外部平台/ZIP，没有发布。正式 AppData、DS 源模型、日常版本与四份原有脏文档保持原样。

## 本轮完成：损坏设置的备份恢复与重新读取

起点 main `a68504d573ce9bee6111c3dcd2ffa7ce3237eda7`，主目录实施，stable 默认工厂禁用保持。旧阻断页只有重试且重试仍读内存阻断态；现在使用 `settings-window/recovery-screen.ts`，在 Pinia/模型/宿主/音频初始化之前显示恢复页面。查看备份与确认恢复分开，默认焦点落在取消；取消不改文件，较新版本说明清楚且不提供降级恢复。被阻断的设置文档仍登记 clean close 回执，原生关窗/退出不会因缺少完整设置组件而卡住。

### 技术边界

- `shared/settings-recovery-contracts.ts` / preload.settingsRecovery 增加 preview、restore、retry 与 recovered 订阅；main `settings-ipc/recovery.ts` 要求已登记 UI、准确页面、主 frame。token 绑定 owner/frame，导航/崩溃/销毁清理；主进程不接收任何路径或任意文件名，只调用当前 canonicalSettingsStore。stable 未初始化新 store 时不绕过禁用。
- `settings-store/recovery.ts` 只读/写固定 `settings.v1.json` 和 `settings.v1.backup.json`。backup 受既有 1 MiB/完整 schema 校验，损坏 main 最多 4 MiB；超出/不可读/链接不自动处理。底层有界读取检查 lstat、文件句柄 inode/dev 与大小，拒绝文件链接、目录与 junction。校验有效备份后发两分钟 token，记录主/备份内容 SHA；恢复开始和替换前重新核对，变化拒绝。
- 确认恢复时先把原件原始 Buffer 独占写入 `settings.v1.json.recovery-original.<时间>.<UUID>.bin` 并 fsync，再写备份临时文件并 rename 替换 main。有效 backup 不动；原件含非 UTF8 字节也保留一致。失败清自建 scratch，主文件/备份保持；名字来自内部固定模板，不由 renderer 提供。若主文件原本缺失，则不虚构损坏原件。
- 不依赖启动时缓存的 reason 判断未来 schema：preview/restore 的实际文件读取也识别较新 schema（含 BOM），防止文件启动后被外部新程序更新而遭旧 backup 覆盖。原文件过大或不可读只停用自动恢复，不用默认值替代。
- SettingsService 新增可选 previewRecovery/restoreBackup/retryRead，沿用同一事务队列；成功恢复发布新 ready document。retryRead 真正重新读取当前文件，仅接纳有效的现存主文件；原先阻断目录后来主/备份都消失时继续 blocked，不当作新装默认值。重复读取更新 blocked reason/backupAvailable。
- bootstrap 订阅 settings-recovered 后仅对未挂载客户端重试，复用 epoch 防旧初始化覆盖；恢复页面销毁时取消异步 DOM 更新、退订 close。另一窗口恢复后两个 renderer 都能自动重试，不需要创建第二个模型。此时没有活跃旧模型，恢复旧 revision 不会倒灌到已挂载 store。

### 验证和现场

新增 `settings-recovery.test.cjs` 15 项：只读预检、字节保全/有效备份不覆盖、主文件缺失、未来 schema/外部升级、过期/重放、双文件变化、rename/fsync 故障、最后时刻外部修改、手动重读不默认化、文件链接元数据拒绝、真实目录 junction、身份/文档生命周期与真实阻断页确认/关窗。文件链接分支使用模拟 lstat 元数据，避免要求 Windows 文件符号链接权限；实际 junction 单独执行，不把模拟当作 OS 文件链接实测。原 bootstrap 测试更新 DOM 宿主和标题，仍执行真实 bootstrap/恢复页。

最终应用 **668 项：663 通过、5 跳过、0 失败**；插件 **104/104**、node/web 类型检查、构建与三份契约检查通过。5 项 skip 仍为历史 DS 输入用例。

本机 `D:/Frankenstein/Uta-Workspace/operations/settings-recovery-2026-10-24/` 保存 verify-final.mjs、五份 *-results.json、截图、测试日志和 cleanup 记录。最终数据 profile 为 `settings-recovery-final-{corrupt,future,manual,external}-20261024`，位于仓库外 runtime/profiles；全为自己构造的公开偏好/无效字节夹具，不取正式配置。实际 Electron 五次启动共 11 项检查：双窗口阻断且零模型、查看/取消零写、确认恢复后双窗口正常加载与原件 hash 一致、恢复后新进程读取、未来版本不降级且可原生关窗、手动修复后 read 当前新值、外部升级后旧 token 不覆盖。

最终进程：24500（02:48:55，损坏恢复）、35912（02:48:57，恢复后重启）、35928（02:49:15，未来版本）、23276（02:49:17，手动修复）、23436（02:49:19，外部升级），均为本机 2026-10-24；身份记录在相应 process-*.json，首次 corrupt 进程另存 process-final-corrupt-before-restart.json。全部正常退出，cleanup 的 requiredResidualProcessCleanup 均为 false、endpointRemoved 为 true；9290/9291 已无监听。较早四次试跑亦退出，没有按历史 PID 停其他进程。本轮不能证明上轮 Chromium 调试残留根因已解决，质量记录继续保留。

截图已查看，恢复确认在常规设置窗口尺寸下可读、可取消。没有正式设置/模型写入，没有候选 ZIP 或日常版本更新。

## 本轮完成：真实数据环境标签与深色文字修复

起点 main `70533ee6e2971f416e32760edce3882ce9bd4bb8`。`services/environment-label.ts` 只投影 profile/packaged/isStable；main environment-info 增加真实 isStable 字段。仅 profile=stable 且主进程确认正式目录时显示“日常数据”；源码显示开发实例，独立打包环境显示独立实例，信息不足显示数据实例或环境未确认，读取失败不回显异常。没有把 profile 名称等同发布验收。

`SettingsWindowApp.vue` 的顶部 chip/导航 footer 和 recovery-screen 的数据环境行均使用该结果。长标识有省略/完整 title，恢复页允许换行；组件卸载后忽略迟到结果。查看实际截图发现 root/card 标题使用未定义的 --uta-text-primary/secondary，使深色下继承黑字，已统一改为现有 --uta-ink/secondary，未新造第二套色板。

新增默认登记 environment-label.test.cjs 5 项，覆盖稳定/独立/源码分类、stable 名称但目录非正式、非法/过长标识、敏感字段投影排除和桥失败。完整应用 **673 项：668 通过、5 跳过、0 失败**；node/web 类型检查、最终构建通过。最终只改稳定标签措辞后补跑 5 项，未为 CSS/文案重复插件测试；插件与契约上轮通过且本轮未改相关逻辑。

证据 `D:/Frankenstein/Uta-Workspace/operations/environment-label-2026-10-24/`：verify.mjs、normal/blocked-results.json、深浅/阻断页截图、测试日志。复用上轮受控 profile，前后 canonical 文件字节相同；正常页真实 header/footer 指向实际 profile，长标识无横向挤压，阻断页标识正确且未来版本恢复仍禁用。正常页标题/说明/卡片说明/环境标签在深浅两种主题共 8 组 computedStyle 对比度抽样 ≥4.5，截图已查看；不是整页无障碍/所有背景及控件的完整认证。

最终进程 2752（2026-10-24 本机 03:00:36）、6380（03:00:38）分别使用 settings-recovery-final-corrupt / future 受控数据，身份记录仅保存在本轮 operations；未覆盖上轮证据。两次正常退出，cleanup.requiredResidualProcessCleanup=false，端点与 9292/9293 清理。正式 AppData/模型/ZIP/stable/原四份文档未改。本轮 main 只补诊断字段，但整体开发体验仍需重启以加载此前新增的 main/preload API。

## 接着做什么

1. 接下条“日常公开偏好迁移”已完成的结果，准备独立 ZIP 候选：干净源码构建、来源/hash、解压启动、隔离数据的新装/升级/恢复验证。真实 0.1.1 日常数据副本、跨 origin/跨实例导入尚未验收，不把源码 stable 夹具当成打包升级证明。不得覆盖宿主全局 APPDATA、写真实正式数据或提升日常登记。
2. 完整 Live2D 控制尚有大量待办：真实 SDK 逐阶段轨迹、更多通道及语音/眼睛仲裁、长期 owner 边界与性能记录。现有 headX 仅为短时试验，不能对外标成默认新引擎；继续复用受控 DS，不碰正式模型，不替换 PIXI。
3. 旧服务/工坊草稿统一、语音试听错误、正式设置迁移与候选 ZIP 继续按主方案串行实现。日常替换仍等用户最终验收；当前无人值守授权允许继续开发/验证和独立候选，不允许伪造外部平台或音频验收。

后续只更新 CURRENT、本文件和主方案对应阶段，不恢复批量派单或三平台各做一部分的安排。

## 本轮完成：日常公开偏好迁移与成功标记

起点 main `be58ff71aa78085af35f9ed248605b497903b561`，统一主目录实施。启动只读取当前固定 `settings-authority.v1.json`，缺失仍 legacy，不启动 canonical store；schema/scope/大小/链接或格式异常均进入 canonical-stable 的阻断状态，不回退旧写入。有效标记才初始化 canonical-stable，并要求实际新文件存在；丢失 main/backup 不再算新装。开发模式仍走 canonical-dev。

### 提交顺序与界面

- `settings-store/stable-migration.ts` 管理独立 pending store，用户点击迁移预检才创建，不影响在跑的 legacy authority/hover。复用当前 origin 两来源白名单和逐字段预检，确认前比较页面来源快照；token 仍绑定 sender/frame/revision，有效两分钟、单次使用，异步 getStore 之前即消耗确认 token，避免并发重复。
- `SettingsService.ensurePersisted` 通过同一队列确保预检修订已落盘，文件被外部替换则拒绝；无来源确认也实际写 defaults + rollback backup。随后对版本/公开偏好 scope/初始 revision/完成时间的标记独占写临时文件、fsync，以 hard link 原子落名且不覆盖已有未来标记，清自有临时文件。仅适用于支持该操作的本地文件系统；失败明确保留 legacy，可重试，不以写了一部分声称迁移完成。
- 文档先提交、标记后提交；标记失败时已写入的文档/收据保留。重新预检跳过相同来源，沿用当前值完成标记，不重复导入或覆盖原备份。接受后本进程仍 legacy，设置页提示从托盘退出重启；重开设置通过主进程 settingsRestartRequired 再显示该提示。下次启动两个真实窗口都由新文档水合。
- `SettingsMigrationApp.vue` / `SettingsMigrationRecovery.vue` 在完整设置/Pinia/模型之前分流。初次无来源列出十二项默认/当前值，必须主动确认。pending 文件被阻断可查看备份、取消、确认恢复或手动修复后重新读取；恢复原件/未来 schema 的现有保护复用，恢复本身不写成功标记，返回迁移确认。recovery IPC 只窥视已由预检打开的 pending store，不自动开它。
- canonical Pinia 现在同时支持 dev/stable。七项旧语音服务字段另写 `deskpet/voice-service-v1`，只投影这七字段覆盖读取旧服务 fallback；原 `deskpet/ui-state-biophilic-v1` / 更早记录保持原文，新公开偏好不再被镜像回去。这还不是主进程服务配置权威统一，也不包含密钥。

### 最终验证和现场

新增 17 项测试：stable migration 15 项、实际 Pinia 两模式保留来源/独立服务记录/重建水合 2 项。最终应用 **690（685 通过、5 跳过、0 失败）**，插件 **104/104**，node/web 类型检查、构建、三契约通过。model-migration 的 main 入口依赖夹具补登记了新模块；其模型迁移行为检查保留。日志在本机 `operations/stable-migration-*.log`。

真实验收证据：`D:/Frankenstein/Uta-Workspace/operations/stable-settings-migration-2026-10-24/`。测试入口在独立 Electron 进程 ready 之前 `app.setPath('appData', <证据目录下的隔离目录>)`，加载真实 app/out/main；没有改宿主 APPDATA，也没有把临时 UTA_USER_DATA_DIR 冒充 stable。实际 resolver/IPC 确认 isStable=true。六个成功场景共 18 项：fresh/restart/empty/future/lost/interrupted，含真实按钮、源变更拦截、迁移重启/新保存→宠物同步、标记门控、缺失文件、非 UTF8 损坏原件逐字节保留、恢复后确认及完成后关窗重开。

仅六个最终成功场景计入通过。最初包装器使用错误的 Electron 模块导入导致入口异常（保留 failed-wrapper 日志），一次重启脚本用错误按钮文字失败（保留 restart-attempt1 进程记录）；二者修正后重跑。失败测试实例的进程残留按本轮实际路径与创建时间核对后清理；这不是退出质量通过。六个成功场景本身正常退出，最新 cleanup 文件均 false；端点与 9294/9295 已清理。历史 PID 不作为后续停止依据。

边界：这是新设置的当前 origin 十二项公开偏好迁移与源码 true stable 分支验收，尚非全来源迁移、真实旧日常副本升级或 ZIP 验收。模型/预设、宿主、加密密钥仍原有存储。正式数据、正式 DS、四份原有脏文档、stable.json 与日常 0.1.1 exe/ZIP 未变。下一轮在干净构建目录产出独立候选，不提升日常；持续推进其他既定任务。

## 最新现场：0.2.0-alpha.1 已构建，exe 启动验收失败

实现提交 `f6590ba`，版本/授权/构建说明提交 `181dce4`，独立体验入口提交 `5860a244031e39ef1fd26c68d2bc51e64abea545`。统一主目录仍 main，四份原脏文档未动。应用版本进入 alpha 并不表示日常 exe 已改变。

- 构建区：`D:/Frankenstein/Uta-Workspace/build/codex-020-alpha1`，detached HEAD `5860a24`，独立 npm ci 依赖，无目录链接。应用的 worktree 工具未识别父级非 Git 工作目录，因此使用 Git worktree 创建；未恢复旧 Worker 目录。该构建区保留供复现，不能当第二开发入口；源码修复仍在主目录提交后再更新构建区。
- 最终 ZIP：构建区 `app/release/Uta-0.2.0-alpha.1-win-x64.zip`；SHA256 `5ce00c1787611e9f90ff07b0fef0155c1a2eda399148d69eef948c7313d2ac96`，manifest 同路径加 `.manifest.json`，source dirty=false。首轮 `181dce4` 包仅作中间产物，最终用 `5860a24`。
- 解压：`D:/Frankenstein/Uta-Workspace/artifacts/candidate-0.2.0-alpha.1-5860a24/`。检查实际包含 Uta.exe、FIRST-READ.md、LICENSE-Uta.txt、THIRD_PARTY_LICENSES.md、Try-Uta.bat；asar 共 59 条路径，保留 Hiyori ReadMe，未含 can3/cmo3。主源码的根 start-uta.bat 和 stable.json 不变。Try-Uta.bat 的数据固定在该候选独立目录，不使用正式 AppData/uta；仍不把启动器存在视为可用证明。
- 构建日志：`operations/candidate-020-alpha1-{install,build-final}.log`。主要验收现场：`operations/packaged-candidate-020-alpha1/`。旧 0.1.1 ZIP hash 与 stable 登记一致，另解压到该现场的 old-011-fixture，没有启动或修改原日常程序目录。
- **未通过**：新、旧解压 exe 均很早退出 `0x80000003`，无 runtime 端点/应用日志，真实旧版数据尚未由旧 exe 成功生成，故“打包版升级测试”没有通过。带/不带调试参数均复现；获得 fatal exception 栈，见 probe5-result.json。不可通过修改 settings/删除用户目录等盲试去掩盖。
- 原生最小复现：`native-repro/` 从现有官方 Electron 34.5.8 runtime 复制到自己的目录，只有写一份测试标记并退出的入口；asar 和普通 resources/app 两种布局都在 JS 执行前同样退出，main-executed.json 未生成。候选 .text/.rdata 等执行节与原始 Electron 相同，fuse 官方工具读取一致，原生 DLL/资源/locale hash 一致；仅资源版本/图标等 .rsrc 不同。RunAsNode 可运行，但不是桌面验收。只说明故障可独立于 Uta 代码复现，尚未定位根因。
- 对照：使用源码的 Electron.exe 显式加载最终候选 asar 可启动，进程环境/路径见 asar-probe-result.json；这是开发运行方式，**不能替代解压 Uta.exe 验收**。该探针按实际 profile、路径与创建时间核实后正常退出，asar-probe-cleanup.json forced=false，9296/9297 与端点已清理。旧、新早退探针均已退出；一次无回执的父 shell 探针由其工具会话中断，未按历史 PID 杀进程。

有同类原生启动现象的外部线索：[Electron issue](https://github.com/electron/electron/issues/51770)、[DSH discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/10067)。版本/栈并不完全相同，只作后续假设来源，不认定同一故障。不为打包通过而关闭 sandbox、改变全局安全规则或修改系统环境。下一次诊断必须说明新增了什么可检验假设，避免重复上述矩阵。

## 后续直接执行入口

用户已决定继续由当前 Codex 执行，不换 Luna，不恢复外部 Agent 分工。先读 AGENTS → CURRENT 顶部 → 本节，再按实际 Git/进程核对现场。总路线足以解释产品方向，但不能把 0.3–1.0 的条目当作已冻结的详细实现。一次只做一个可验收目标，测试/真实操作/提交/更新本文件后继续；不要重新通读全仓或复做已完成迁移。

### 已完成：预设优先保留用户版本，停止自动写共享模型

用户可见目标：修改自己的预设后重载仍保留；两个隔离实例使用同一个模型时互不改写模型旁文件。该数据正确性修复原已纳入主方案工坊/升级约束，可以先于受阻的候选验收执行。

入口与已核实问题：

1. `app/src/renderer/stores/deskpet.ts` 的 persistPresetsMap 当前先写当前 origin 的 STATE_PRESETS_KEY，再自动调用 saveModelPresets；存储/IPC 失败被吞。ensureModelPresetsSeeded 当前总让非空 diskPresets 覆盖本地已编辑桶，可能在重载时丢掉新编辑。
2. `app/src/main/index.ts` 的 saveModelPresetsToDisk 直接把 deskpet-presets.json 写在模型旁；save-model-presets IPC 未限制 sender，且不是原子写。模型旁的旧文件应当只作种子/旧来源，本轮不再自动镜像写入。
3. 读取 `model-path-safety.ts`、`useStageModelLifecycle.ts` 的模型读取调用链，以及实际工坊保存调用方；用 rg 定位测试中的 saveModelPresets / ensureModelPresetsSeeded / preset persistence，再做范围明确的最小修复，不搬迁或删除原模型文件。

本轮冻结行为：

- 按“本 profile 已保存的模型桶（包括显式空数组）→ 模型旁旧预设/默认种子”读取；本地桶已存在时，不得被旧旁车覆盖。现有工作状态预设补种/迁移标记需单独回归，不得每次重载把用户删除项加回。
- 取消自动把用户修改写入模型目录；主进程旧 IPC 不能保留一条仍可自动写共享模型的旁路。兼容旧方法时明确返回失败/不支持；将来显式导出另设计，不在此轮开放任意路径。
- 本轮可以暂用已存在的当前 profile/origin 本地预设存储，写清是过渡方案；不要未经设计扩充十二项公开偏好 schema 或把任意模型/预设 JSON 塞入该契约。若需要把预设迁到主进程文件，这是下一轮有版本/模型标识/并发/回执的新契约，不临场混入。
- 保存失败必须可见，保留待保存内容并能重试；不能继续给出保存成功。先追实际工坊调用关系，再选最小状态接口，避免所有同步动作临场改成异步而破坏已验的执行回执。

验收必须含：旧旁车和用户桶不同的重载保留、显式空桶、无用户桶的旧种子兼容、用户改完重启保留、两个独立 profile 使用同一只读模型时所有模型文件 hash 不变、写入失败保留草稿/重试。临时目录/模型副本验证即可，不碰正式 DS。执行受影响行为测试、typecheck、build；范围涉及 main/preload/store 后再跑完整应用/插件/共享契约。真实 UI 仍在开发 Electron 中验，明确候选 exe 尚未通过。

下一轮完成后，继续服务配置草稿与错误/关闭提示的单领域收尾，再补键盘/缩放/空态等局部体验。每个新领域先在本文件写清字段、当前来源、保存/失败行为和实际验收步骤，再实施。原生启动根因、完整 Live2D 仲裁替换、跨来源/密钥迁移和最终发布属于需要更强复核的节点；出现未预期的跨目录写入、协议改变或无法解释的回归时保留现场，先报告准确证据，不靠扩大改动范围“修到测试绿”。

### 本轮结果：预设保存与隔离

起点主目录 main `1292a5e9018648147304851f180e2a1133448755`。上方问题定位/冻结行为保留作实施依据，以下为最新事实，不重派该轮：

- 新 `services/preset-persistence.ts` 只操作当前 origin 的既有 `deskpet/state-presets-v3`。有界 4 Mi 字符读取、对象/桶/条目检查；错误保持原记录，拒绝新默认覆盖。每次编辑前重新读取并以最新完整 map 合并当前桶，减少旧窗口覆盖其他模型桶；这不是同模型多写者的事务/CAS 保证。长期仍需主进程预设覆盖契约。
- Store 从本地桶（含空数组）读起，没有桶才取只读旁车/默认种子。首次非空旁车可补缺的工作状态组，已有用户桶永不补回。旧 working-preset-migration 记录保留但不再写，不以单独 marker 的半成功控制是否加回用户删除项。读坏记录只给错误，不写默认。
- 成功 storage.setItem 后才替换运行列表；失败 saveCustomPreset=null/delete=false/restore=null，原列表、pin 与编辑器草稿保持。SettingsPanel 只有成功才解除编辑锁/切编辑对象；工坊和状态页均显示独立保存结果。`save-model-presets` 旧 IPC 明确返回 false，删除原模型旁写入实现；preload 保留弃用兼容签名，不开放新导出路径。
- Store 订阅当前 localStorage 的 storage 事件同步宠物/设置，dispose 解绑；旧 reload-settings 的非公开重读也刷新预设。**最终没有增加额外桥接通知或保存版本字段**。早期脚本误把 editingGroup 输入框当 customPresetName，导致按名称查找失败；已更正为 preset-name-input，并撤掉试加的桥接路径。不能把该测试错误写成产品存储事件故障。
- 新增 12 项实际 helper/Pinia 行为测试，最终应用 **702/697 通过/5 跳过/0 失败**；插件 **104/104**、类型、构建、三契约通过。日志 `operations/preset-persistence-{scoped,app-tests,plugin-tests,typecheck,build}.log`。现有 5 个真实 DS 跳过仍单列。
- 最终真实验收在 `operations/preset-persistence-final-2026-10-24/`：A/B 两个独立 profile 共用仓库 Hiyori runtime，第三次重启 A；共 9 项检查通过，包括实际滑块预览后注入 quota 错误→点击保存→草稿/锁/原值保留→重试→宠物同步、设置刷新、旧 IPC 拒绝、各自数据隔离。每次核对全部共享 runtime 文件 SHA256 一致，未改正式 DS/模型。最终三个验证实例正常退出，cleanup.forced=false；9298/9299 与端点清理。
- 早期失败脚本/进程身份记录在 `operations/preset-persistence-2026-10-24/`，仅供追溯，不计通过。一次销毁窗口后的调试进程残留按本次实际路径/创建时间清理；不能借最终三次正常退出认定历史退出质量问题已解决。

正式 AppData、正式模型、日常 0.1.1 和 stable 登记、四份原脏文档不变；候选 exe 启动仍未通过。下一步只推进语音服务保存方式与错误/关闭草稿的一块，不重复 native 诊断或预设迁移。

### 已完成：STT 保存不吞新输入，云服务不复用别家密钥

基线 main `b7790d0`。只改 SttSettingsSection、STT 合并配置的纯函数及接线/行为测试，不调用外部识别服务或麦克风。普通连接字段保持自动保存；密钥只通过明确保存提交。读取失败禁用编辑并可重试；慢保存只回填未被后续输入改变的字段，保存中的后续更改串行补写，失败保留输入并提供重试，离开页面时只收尾普通连接字段，不自动提交未保存密钥。切换 backend 或云接口 origin 时清旧密钥，明确输入的新密钥除外。STT 的总开关仍默认 false，autoSend 默认 false。

验收：实际组件慢回执/保存期间新输入/再次保存、初始化失败重试、不自动提交草稿密钥、切后端或 origin 不带旧密钥、失败/清除异常不暴露原始错误、组件卸载迟到回执不改后续页面；再做隔离 Electron UI 状态与本机配置 IPC 验收，不把这轮算成真实录音/识别通过。工坊/服务未保存密钥的统一关闭确认仍是后续事项，不声称本轮已覆盖。

实现与结果：

- `main/stt.ts` 新增 `mergeSttConfig`，区分旧文件宽容读取与主动保存校验；主动保存拒绝坏 URL、非 HTTP(S)、URL 凭据和非回环本地接口，不再悄悄换默认值后返回成功。旧密钥只保留给同 backend/云接口 origin，明确新密钥或 clearKey 优先；原加密文件写入路径不变。
- `SttSettingsSection.vue` 读取失败禁用表单/可重读；普通字段自动保存，密钥仅明确按钮提交。慢回执只回填仍与请求相同的字段，后续输入串行补写；换服务不回填旧密钥状态。错误保留输入，用固定提示代替原始异常。页面卸载只收尾普通字段，迟到回执不改卸载后的状态。
- `services/stt-config-queue.ts` 在同一渲染进程内跨组件重建串行化配置读写，避免旧面板收尾写入覆盖新面板初始化。不是跨进程版本化事务，也不是服务全字段统一迁移。离开页面不会自动保存未提交密钥，目前用明确文字提示，不声称已有关闭确认。
- 新 `stt-settings-save.test.cjs` 9 项已登记默认套件；最终应用 **711 项（706 通过、5 跳过、0 失败）**，插件 **104/104**、node/web 类型检查、构建和三契约通过。日志 `operations/stt-save-{scoped,app-tests,plugin-tests,typecheck,build}.log`。插件在补严格 URL 校验前已通过；该补丁不改插件路径。
- 最终真实验收 `D:/Frankenstein/Uta-Workspace/operations/stt-save-final-2026-10-24/`：profile `stt-save-final-a-20261024`，初次与重启共 7 项检查通过。真实输入/按钮确认：初次打开不写默认文件、自动保存不提交密钥草稿、明确保存加密、换服务清密钥、无效本地地址拒绝且文件字节不变、切页不提交未保存密钥、重启保留配置。截图只截到语音页顶部，STT 结论以实际表单/IPC/文件检查为据，不把截图当下方表单视觉验收。
- 两次最终进程均正常退出，cleanup.forced=false、endpointRemoved=true，9300/9301 清理。早期真实验收发现无效地址被默认值替代，补严格保存校验后才有上述最终通过，早期失败记录保留在 `operations/stt-save-2026-10-24/`。未使用真实密钥/录音/外部识别请求，不宣称听感或转写验收。

正式 AppData/DS 模型、stable 登记、日常 0.1.1 与四份原脏文档不变。下一轮先核对设置六个分区的键盘操作与缩放布局，选实际缺陷修复；服务/工坊关闭确认、完整新 Live2D 控制和候选原生启动继续保留为未完成事项，不扩成一次大重构。

### 已完成：设置小窗口与键盘操作

基线 main `1beefeb`。真实源码 Electron 隔离 profile `settings-accessibility-20261024` 已复现：主题预览为不可聚焦 DIV；桌面分区三个开关没有可读名称；680×500 窗口在渲染缩放 150% 下有效内容约 445×309，导航底部超出窗口，顶部按钮文字被挤成竖排。证据 `operations/settings-accessibility-2026-10-24/before.{json,png}`，进程正常退出；渲染缩放是压力测试，不冒称 Windows 系统 DPI 验收。

本轮只修设置外壳和现有公共控件：主题改原生按钮，补开关名称/标签关联和选择状态，使用原生按钮键盘行为与可见焦点；窄窗口允许操作栏换行、导航变紧凑网格、内容独立滚动，不改 Bento 色板、保存规则/协议或数据源。无效 domain 参数回到已有默认语音分区，避免空白。普通大小保留侧栏；不把本轮算旧工坊所有子控件无障碍认证。验实际键盘 Space/Enter/Tab、有效/无效分区、六页在常规/最小窗口与 125/150% 渲染缩放的导航和保存可达性、关闭弹窗焦点回归；保留原实例与正式数据。

最终结果与边界：

- 改动为 `SettingsWindowApp.vue`、`SettingsNavigation.vue`、`SettingsToggle.vue`。主题 DIV 改原生 button，去掉 switch 手写 Space 拦截，公共开关有名称/label，颜色与 Orb 选择有 aria-pressed，公共控件聚焦有 outline。窄于 620 CSS px 时导航变三列双行，环境仍显示在顶部；620–800 收窄侧栏，矮窗口侧栏自身可滚动。操作栏换行且按钮不压缩竖排；内容最小尺寸解除。切分区重置正文滚动位置，不改变焦点/草稿。
- 新增 1 项实际 SFC 无效 domain 回退且不写配置的回归，原有效 appearance 初始化由既有测试覆盖。默认应用 **712（707 通过、5 跳过、0 失败）**，node/web 类型检查与最终构建通过。日志 `operations/settings-accessibility-{scoped,tests,typecheck,build}.log`；最终改动未涉及 main/preload/插件/共享契约，未无意义重复插件测试。
- 真实验收最终 `results.json` 共 7 项，包括六分区 × (880×640/100%、1024×640/125%、1024×640/150%、680×500/100%、680×500/125%、680×500/150%) 共 36 个场景。检查正文无横向溢出、导航和保存按钮在视口内；Enter 切主题、Tab 到带名称颜色按钮且 outline 可见、Space 单次切开关、Enter 保存、最窄窗口关闭弹窗焦点循环/Esc、跨分区滚动归零。已查看普通浅色与紧凑深浅截图。只是 renderer zoom，非系统 DPI、读屏器或每个旧工坊子控件认证。
- 页面查询参数有现成安全约束：`isSettingsPage` 仅忽略 hash、不忽略 query，未配置 query 的页面被拒绝。初始真实脚本尝试带 query 验组件回退，被正确拒绝；**没有为测试放宽主进程鉴权**。最终真实检查验证拒绝与恢复原配置 URL，组件非法分区回退由 SFC 回归证明，不宣称支持可用的 query 直达链接。
- 早期脚本还遇到后台窗口键盘未聚焦、缩放下 outline 像素取整，以及误用 `settings` 而非 `publicSettings` 的测试 API；修正测试后最终 `final2` 全部通过。各过程/失败日志保留，不算通过。`process-final2.json` 对应本轮验证进程，正常退出，cleanup-final2.forced=false、endpointRemoved=true；9302/9303 清理。未按旧 PID 操作原开发实例。

四份原脏文档 hash 不变，正式数据/模型、stable、日常 exe/ZIP 不变。下一轮转回主方案的 Live2D 控制：先读已实现 headX 短时试验与 SDK 写入阶段，再限定一个可验收扩展，不把现有单通道试验当完整新引擎。

### 已完成：Live2D 实际帧阶段与绘制前值

基线 main `0d780e5`。已读实际安装的 pixi-live2d-display 0.4.0 `dist/cubism4.es.js` update：motion → saveParameters → expression → 条件 blink → focus → natural → physics → pose → beforeModelUpdate → Core.update → loadParameters。Uta 在 natural 包装中写参数栈/mixer/口型，在 beforeModelUpdate 再写直接覆盖参数/口型/部件。当前 `ModelPerformanceView.sample.applied` 只是 mixer 物理前写入，却在 UI 标“最终”，需要改成准确分段。

本轮只加预览期间、单模型、只读的 headX 实际阶段采样；按真实被调用的方法记录，缺失/被跳过阶段不伪造。保留最近一帧和计数/阶段集合，限制每帧条数，未预览不逐帧读取参数、不写文件。展示物理前与 Core.update 前的真实值；停止保留上次诊断但释放所有控制，换模型清诊断。实例方法包装保留 this/参数/返回值/原异常，不改 SDK 顺序、不补不存在阶段。冻结 mixer 和公开设置契约不变，内部只读视图扩展；不宣称新默认引擎或所有通道已接入。

验收：无预览零读取、阶段顺序/物理后值/有界内存、缺失阶段/方法返回与异常/停止重启/换模型；真实受控 DS 与 Hiyori 的旧/新四秒预览、阶段值与 Core 绘制前值、停止和新预览，确认受控模型 hash 不变和临时实例清理。证据独立保存，不重复原生 exe 启动矩阵。

最终实现与实测：

- `services/performance/sdk-trace.ts` 对实例方法一次包装，保持调用 this/参数/返回值与原异常。实际外层 update 界定完整帧，按实际方法调用采样 motion/save/expression/blink/focus/natural+Uta/physics/pose/Core/load；保留最近完整帧、阶段集合和计数，每帧上限 16 项。停止后 wrapper 仍传递调用但不读 Core/不创建样本；模型随 WeakMap 回收，不建文件日志或无界历史。诊断读取失败不打断原生帧，不伪造缺失阶段。
- `model-runtime.ts` 在短时预览启动/停止/prepare 接线，`ModelPerformanceView` 仅扩内部只读 trace 与 sample.rendered；公开偏好、first-wave/mixer 冻结契约和对外 SDK 不变。before-core-update 读取当帧实际 headX，不把物理前 applied 当最终值；停止 sample 仍清空，trace 留上次供查，prepare 清旧模型 trace。技术详情标明当前/上次对照，不把历史诊断当仍在控制。
- 默认登记的 model-performance.test.cjs 新增 3 项：模拟物理改写后 rendered=17 而 applied<9、实际调用顺序/条件跳过；1 万帧仍只保留一帧，停止后零读取/快照隔离/新预览重置/prepare 清空；缺失方法、this/参数/返回值、原始异常和诊断读异常不改变 SDK 行为。最终应用 **715 项（710 通过、5 跳过、0 失败）**，插件 **104/104**、类型、构建和三契约通过，日志 `operations/model-trace-{scoped,app-tests,plugin-tests,typecheck,build,contracts}.log`。最后仅把“最近正在进行的”改成“当前”的文案修正不重复整套测试。
- 真实验收 `D:/Frankenstein/Uta-Workspace/operations/model-trace-2026-10-24/`，profile `model-trace-20261024`。从冻结 DS 基底校验后复制 59 份声明 runtime/授权文件到自有 profile，未用正式 AppData。Hiyori/DS 各跑旧/新四秒对照，实际按钮、独立 Core.update 前读数、UI 阶段列表与图像均核对；共 8 项通过，四组捕获每组约 39–40 帧。自动/手动停止释放 preview/编辑锁，停止后计数与帧不再变，换模型旧 trace 为 null，59 份文件 hash 全不变。
- Hiyori 该次有 physics/pose，但没有执行 expression/blink；DS 有 expression/blink/physics，没有 pose，面板准确反映。DS mixer 样本 native=1.2624545、applied=2.5412578、rendered=2.5412579，Hiyori 对应 4.9636979/6.2406817/6.2406816，只是该帧浮点精度差异；不能推论眼嘴/body 不受物理影响。真正物理覆写差异仅由上述夹具证明，不编造真实差异。
- 本轮无失败重跑，验证进程正常退出，cleanup-a.forced=false、endpointRemoved=true，9304/9305 清理。已查看 DS 对照截图；仍非 60–90 秒同脚本录像、性能预算、真实语音或 ZIP 验收。正式模型/数据/日常/stable 未写，四份原脏文档 hash 保持。

接下来：按已实测阶段选择一个眼睛或嘴部短时控制目标，明确旧写入退出、SDK blink/motion 与 post-physics 的边界后再实施；不要直接把 mixer 的全 neutral 输出逐帧灌入 Core，不开放 DS body 物理输出，不把当前 headX 演示标成新默认引擎。

### 已完成：双眼闭合与原生眨眼的短时仲裁

基线 main `40becdb`。在“模型表现”新增明确点击的四秒双眼闭合预览，不持久化/不改默认引擎。只有双眼标准映射均已确认、available、非物理输出、范围有效才开放。接管时仅跳过这两参数的 Uta 旧栈写入；SDK motion/expression/blink 仍执行。beforeModelUpdate 既有旧栈/口型/部件之后，用当帧物理/pose 后的真实双眼值作为 base，以 post-physics multiply 降低开合，保持闭合后平滑退到因子 1，再释放；不写其他 mixer neutral 通道，不改 savedParameters，不强行睁开原生已闭眼。

开合按 [min,max] 归一化后乘因子、映回同一范围；因子 1 保留原生值（包括高于默认的睁大），不借 signed/default-anchor 头部映射套眼睛。时间为关闭约 400ms、保持到 2400ms、1200ms 恢复、余下时间随原生，再在 4000ms 释放；减少动画偏好不播放。内部设置命令白名单加一个 preview-eyes，沿用模型/会话代次、工坊互斥和释放，不开放宿主外部协议。阶段诊断扩明确参数 ID，眼睛预览只记录左眼阶段，另显示双眼物理后写入，避免冒称 headX。

验收：夹具强制 blink/physics 再次睁眼后仍保持闭合；原生已闭眼不被打开、非对称范围/睁大保留、只写双眼/旧眼栈退出、停止后旧控制恢复、缺失/物理输出不开放、慢帧超时释放。真实受控 DS/Hiyori 点按钮，在保持/恢复/停止/离页检查两个眼睛的 Core 更新边界与画面；模型文件 hash 不变，正式数据不写。

最终实现与结果：

- `model-runtime.ts` 分出 head/eyes 短时 owner；`startEyePerformance` 创建独立可销毁 mixer/4 秒计时器。映射只接受标准 ID、available/confirmed/非物理输出/有效开合范围；缺一只眼均拒绝。`performanceOwnsParameter` 只让双眼退出旧 Uta 栈。`applyEyePerformance` 仅在 loader `beforeModelUpdate` 的旧部件/口型收尾后执行，读真实 post-physics 双眼作为 base，以 factor=1→0→1 的 post-physics multiply 映回原范围。只写两个 eye 参数，停止后下一帧由原 motion/blink/旧栈恢复，不修改原 savedParameters 或物理方法。
- 设置内部白名单加 `preview-eyes`（无参数载荷）；pet bridge 沿用已有模型上下文和会话绑定，executor 用工坊锁互斥并走相同释放。没有改变外部 MCP/宿主 SDK。面板新增“闭眼并恢复”，停止与来源是两种测试公用；减少动画不播放、切域/折叠/卸载沿用释放。只读 trace 增 parameterId，闭眼诊断记录左眼真实阶段，双眼另显示物理后原生/约束值，不再混用头部标签。
- 6 项新增测试：五项实际 runtime/loader/executor 行为（宽眼/原生闭眼/只写眼睛/原 saved 不变；物理/眨眼重开后保持/旧眼栈退出与释放恢复；缺眼/物理输出/闭合默认拒绝；大间隔/坏值释放无迟到重启；工坊互斥/结束会话拒绝），一项无参数命令不可夹带任意参数写入。最终应用 **721（716 通过、5 跳过、0 失败）**，插件 **104/104**，node/web 类型、最终构建、三契约通过。日志 `operations/eye-performance-{scoped,app-tests,plugin-tests,typecheck,build,contracts}.log`。
- 真实 `D:/Frankenstein/Uta-Workspace/operations/eye-performance-2026-10-24/`，独立 profile `eye-performance-20261024`，从冻结 DS 基底校验复制 59 文件；Hiyori 与 DS 均从实际按钮开始，保持段六组 IPC 样本与 Core 更新前连续 20 帧双眼=0，原生基准约 1；4 秒后真实 Core 双眼恢复约 1。并验证手动停止、切语音域、减少动画、原生关设置窗口释放锁/preview，共 7 项通过。截图 before/closed/restored 已实际查看，DS 确有闭眼与恢复画面；不是音频或整段动作观感认证。
- 本轮真实脚本一次通过，进程正常退出，cleanup-a.forced=false、endpointRemoved=true；9306/9307 清理。59 份受控文件 hash 不变。最终仅把两测试共用停止按钮移到两组测试下方并重新构建，未为纯布局移动重复整段动作测试；后续若复测用保留 verify.mjs。四份原脏文档 hash 保持，正式数据/DS/stable/日常 exe/ZIP 未改。

下一轮入口：先追 loader 的 lipSyncActive/lipSyncValue 与 mouth-motion/reply-speech 生命周期，明确音频开合、无音频表情开口和嘴形的 ownership，再冻结一个短时目标。禁止把实际说话时的原生开合当 neutral 覆盖、禁止把 DS mouthForm [-2,1]/default -0.5 当对称值。完整持续 owner、表达事件接线和候选原生启动问题仍未解决；不宣布 0.3 或 1.0 完成。

最新收尾：上述双眼控制已提交 `fa583d8`，同次继续执行还提交了 STT `1beefeb`、设置可操作性 `0d780e5`、实际帧诊断 `40becdb`。main 当前只余接管前四份受保护文档未提交，hash 与 inventory 相同；本次自建验证实例全部退出，9300–9307 无监听，原开发实例未停止。CURRENT 顶部现有简短最新状态/体验入口，避免从旧批次历史猜进度。后续仍 Codex 单独串行实施，不恢复派单；最终日常 exe 替换需要真实解压启动验收。

### 已完成：嘴形与无语音开口分开，语音优先

基线 main `bb41104`，统一主目录串行实施，保留四份原脏文档。已追 `useStageRenderLoop` → `setModelLipSync` → natural/beforeModelUpdate：TTS 实际播放优先，另有流式文字时钟回退；静音段 active=true 仍占口型，收口尾值 >0.001 也仍接管，停止才恢复当前旧参数栈。`reply-speech` 只负责文本判重/缓冲，不能用它判断音频当前占用。

本轮新增四秒明确点击的“微笑并张嘴”测试。嘴形只接受已确认/非物理输出的标准有符号映射，按真实 default 锚分段换算，保留 DS [-2,1]/default -0.5；开合只接受安全的单向 min=default<max 映射。post-physics 读取真实原生值，400ms 进入、保持到 2400ms、1200ms 回退、4000ms 释放，复用已有双眼测试节奏。只写实际接管的 mouthForm/mouthOpen，不写其他 neutral，不改模型/savedParameters/持久设置。

语音状态从现有 setModelLipSync 的真实 active/尾值同步到当前模型 runtime，不改合成/播放实现。无语音时接管开合；语音/流式口型及收口尾段占用时立即让出开合，只保留嘴形，句中静音不能被表情张嘴覆盖。开始测试时已经说话同样只改嘴形，旧语音结束后仅在预览余下时间内允许恢复表情开合。停止/离页/减少动画/模型替换仍释放；保留语音占用，不因停止测试把说话标为结束。

范围：内部设置白名单加无载荷 preview-mouth，沿用模型/会话绑定与工坊互斥；面板说明语音优先并显示实际嘴部采样。冻结公开偏好/外部 SDK/mixer 契约不变，不升级默认引擎。验收含非对称映射、无声音也能张嘴、speech active=0/尾段交接、只写实际通道、停止后原控制恢复、缺失/物理输出/范围不确定拒绝；真实 DS/Hiyori Core 和画面、隔离语音占用验证、文件 hash 与退出清理。若未实测真实语音合成/听感就明确不宣称通过。

最终实现与结果：

- `model-runtime.ts` 增 mouth 短时 owner，沿用独立 mixer/4 秒租期。嘴形安全门槛保持 min<default<max，开合保持 min=default<max。post-physics replace 使用当帧真实 base，嘴形分段映回真实 raw，只有无说话占用才加入/写 mouthOpen；只按实际 mask 写，不把其他 neutral 输出灌进 Core。共用已有四秒 envelope，原双眼节奏不变。preview 停止清诊断采样但保留 speechActive；同模型重新 prepare 也保留既有说话占用。
- loader 的 `setModelLipSync` 将 active 或 value>0.001 同步进 runtime，真实声音、句中静音和收口尾段都维持开合优先级；`beforeModelUpdate` 在既有口型/部件之后应用 mouth，语音占用时只写 form。没有更改合成/播放器/文字回退实现，不把 reply 去重状态当音频状态。内部无载荷 `preview-mouth` 沿用绑定与互斥，不接受外部 speechActive 覆盖；不改对外 MCP/公开偏好/mixer 契约。
- 新增 8 项实际 runtime/loader/executor/命令行为测试，含 DS 非对称值、无声开口、真实 lipSync 接线的 active=0/尾段交接、预览结束不清语音、同模型 prepare、旧栈恢复、物理/缺失/边界拒绝、非法值/长间隔、模型/会话/工坊与载荷过滤。最终应用 **729 项（724 通过、5 跳过、0 失败）**，插件 **104/104**，类型/构建/三契约通过。完整通过后只追加了 Hiyori 上界默认值的同一条测试断言，再跑受影响 52 项全部通过，未重复无关全套。
- 本次执行权限从 unrestricted 切到 restricted 后，首轮完整测试的 127.0.0.1 连接报 EACCES，构建 realpath 报 EPERM；失败原日志保留，不能算通过。按用户已授权范围通过工具受控执行权限重跑后，`operations/mouth-performance-{app-tests,plugin-tests,build}-verified.log` 才是最终通过；`typecheck/scoped/contracts` 日志在同目录前缀下。没有修改全局权限、系统设置或沙箱代码。
- 真实证据 `D:/Frankenstein/Uta-Workspace/operations/mouth-performance-2026-10-24/`，profile `mouth-performance-20261024`，端口 9308/9309。`results.json` 10 项通过：Hiyori 实际 form [-2,1]/default=1 不符合范围门槛，按钮禁用，直接调用返回 mouth-unavailable，且没有取得工坊锁；DS form [-2,1]/default=-0.5、open [0,1]/default=0，真实按钮稳定输出 form≈0.175/open≈0.45，结束自动释放。已查看 DS before/smile/restored/静音段画面。
- PCM 验收使用仅绑定本机的临时 HTTP 服务返回 8 秒已知音频，owned main 调试器投递一条合成的 rp_reply 到本实例 renderer；经过真实 RuntimeCommandController → TTS IPC → Audio → 解码包络 → stage → setModelLipSync。没有经过真实宿主发现/HTTP 握手，不能当作外部平台验收。volume=0，证明真实播放时钟/控制交接，不声称听到音色。静音段 Core open≈0.0011–0.0019，speechActive=true、只写 form；预览结束而音频未结束时 speechActive 仍 true，音频自然 ended 后才 false。
- 初次真实脚本错误假定 Hiyori 必定满足安全范围，a 记录失败；查真实范围后修正验收为禁用回退，**生产门槛没有放宽**。最终 b 场景全部通过，cleanup-b.forced=false/endpointRemoved=true，a 同样正常退出；9308/9309 与假服务均清理。59 份受控 DS 文件 hash 未变，四份原脏文档 hash 未变；正式 AppData/模型/stable/日常 exe/ZIP 未写。

下一轮：检查 TtsMouthTracker 在 audio 有对象但包络未就绪、缓冲/暂停/结束/取消及模型替换时的行为，针对实际缺陷限定修复；不因为本轮 PCM 正常结束就宣称所有声音生命周期已通过。Hiyori 嘴形边界需另作模型语义/校准决策，不私自把本次标准映射门槛改松。完整新默认引擎、持续表达事件接线、同脚本录像和可用 ZIP 仍待完成。

### 已完成：音频口型的暂停/缓冲与时间基准

起点 main `26bd569`（上轮嘴部控制）。已定位 `TtsMouthTracker.level` 只有 envelope 已存在时才看 audio.paused；audio 存在但包络未就绪时，直接用墙钟推进文本，暂停/缓冲/跳转与音频结束也可能张嘴。此外 speakHttp 每次 onplaying 都重新 start/解码，同一个音频从等待恢复时会重置已获得的包络。

本轮只修 mouth tracker 和 HTTP 播放的重复 playing 接线：audio 对象存在时，paused/ended/seeking/readyState<3 返回零；无 envelope 的文字回退也使用 currentTime，不以墙钟推进，且明确仍是文字回退而非实测振幅。无 audio 的既有文字时钟保持。非法时间/电平不传 NaN，时间零是合法起点。一个 audio 只初始化一次口型/解码，恢复播放不重新开始文字和清空包络；取消/换 audio 的旧结果仍拒绝。不混入播放超时/服务配置重构或替换默认口型策略。

验收：先用实际 tracker 复现暂停但包络未就绪的错误；再验有/无 envelope 的暂停/结束/寻位/缓冲、恢复时沿音频时间、非法读数和清除后迟到 envelope；实际 TTS 控制器连续 playing 不重置 tracker。真实独立 profile 验暂停导致原控制器结束、受控 buffering/seeking 状态闭合/恢复、取消后不迟到重开。若用属性注入模拟缓冲，必须标为受控状态，不冒称真实断网流式缓冲测试。

最终结果：

- 先用实际 `TtsMouthTracker` 新回归得到失败：无 envelope 且 paused=true 时电平约 0.6449，日志 `operations/audio-mouth-before.log`，不是只按推测改动。修复后任何有 audio 的路径统一检查 paused/ended/seeking/readyState<3；无包络时仍属文字回退，但以 audio.currentTime 取样，不再随渲染时间向前走。后退 seek 重置文本索引；0 时刻合法，非法时间/包络值返回有限 [0,1]，clear 后迟到 envelope 或旧 audio 结果拒绝。
- `speakHttp` 一个 audio 只启动一次 tracker/解码，重复 playing 不再清掉已有包络；shouldAbort 在 playing 前检查，取消后首次迟到 playing 也不能 start。结束/失败 finally 解除四个事件处理器并保留原 URL 释放。不改变合成/公开设置/外部 SDK，不引入新播放器或播放超时策略。
- 新增 7 项 tracker/实际 TTS controller 回归，覆盖无 envelope 暂停/结束/缓冲/seek、按音频时间与回退、已解码的暂停/恢复、0/非法值、旧 envelope、重复 playing 与取消前尚未首次 playing 的迟到事件。默认应用 **736（731 通过、5 跳过、0 失败）**，类型和构建通过，日志 `operations/audio-mouth-{scoped,app-tests,typecheck,build}.log`。插件 104/104 与三契约上一轮通过，本轮不改其代码/协议，不重复无关检查。
- 真实独立 profile `audio-mouth-20261024`，证据 `D:/Frankenstein/Uta-Workspace/operations/audio-mouth-2026-10-24/`。本机 PCM 实际 Audio 播放、包络解码回调延迟 3 秒；在未得到包络时注入 readyState=2 / seeking=true，真实 Core open 降低至 <0.03 且 speechActive 保留，恢复时不重复解码。真实 currentTime seek 到已知静音区、自然 ended、真实 pause、捕获的迟到 playing、取消后延迟解码均验。PCM volume=0；属性注入只是受控状态，不是实测网络流式欠载或人工听感。
- 首轮 a 的脚本等待不到 fallback 开口样本而失败，`failed-a.json` 保留，没有足够证据确定原因。b 增加初始等待/只读栈诊断后 6 项通过；为排除诊断副作用，c 去掉 stack 调用，仅等 Core 实际采样就绪后独立重启复验，6 项再通过。最终 `results.json` 为 c，`results-b.json` 为 b；不把这两次通过当成首次启动时序根因已修复。
- a/b/c 都记录了本轮实际身份并正常退出，cleanup 均 forced=false / endpointRemoved=true；9310/9311 与本机假服务清理。原开发实例未停止，四份受保护文档 hash 未变，正式 AppData/DS/stable/日常 exe/ZIP 不变。下轮继续模型替换时的口型尾状态交接，首次启动样本失败另保留追查；不是完整声音功能验收。

下一轮已准备限定任务单：`docs/workflow/NEXT-MODEL-MOUTH-TASK.md`。用户考虑切到 Luna 执行，当前仅准备说明，未切换模型、未派单。功能基线 `c00f49d`；重点是区分模型平滑/释放状态与仍在进行的音频/文本进度，先复现后修复，完成这一项后停止，不自动接手完整持续表现引擎。

### 已完成：模型切换时隔离口型尾状态

按上述任务单完成。修复前用真实 RAF composable 与真实 loader `setModelLipSync` 复现：A 收口尾值串到 B（B `ParamMouthB` 被写 `0.2543222993`，而 fixture 默认是 `0.6`）；同模型 mouth 参数从 A 改到 B 后，旧 A 仍停在 `0.6640890188`，未恢复默认 `0.25`。活动 TTS 换模型也会沿用旧平滑结果。

实现保持在 `useStageRenderLoop.ts`：绑定键为模型对象与 mouth 参数 ID；旧模型仍存活才通过既有入口释放，已销毁模型不读写 Core。新空闲绑定从本地归一化 0 开始且不强写目标模型；说话时从当前 TTS/文本输入样本接管。流式文本时钟在无模型期间继续推进，不重播、不清空 Audio。`gain` 是归一化值输出乘数而非绑定键；同绑定调整 gain 继续平滑归一化输入，不携带旧模型 raw 值，新增用例验证此选择与限幅。

结果记录：[`docs/workflow/results/model-switch-mouth-2026-10-24.md`](results/model-switch-mouth-2026-10-24.md)。8 个新 RAF/loader 回归通过；全应用 **744 项（739 通过、5 跳过、0 失败）**；node/web 类型检查、构建通过。最终构建实际 Electron 从内置 Hiyori 换到 DS：同一个静音 PCM Audio id=1，播放器 `0.358577s → 1.062553s`；DS Core 有声段约 1，静音段 8 帧最大开度 `0.000565` 且 speechActive 保持，自然结束后释放。59 个冻结 DS 文件 hash 不变。

证据位于 `D:/Frankenstein/Uta-Workspace/operations/model-switch-mouth-2026-10-24/`。profile `model-switch-mouth-20261024` 的 Electron 进程已退出，9312/9313 无监听、临时 endpoint 已清理。受限环境首轮全测因 localhost EACCES / 临时路径 EPERM 失败；正常工具审批后重跑通过。最终复核接管前四份受保护文档 hash 全部一致，正式 AppData、模型、stable、日常 exe/ZIP 未写。本轮到此停止，不开始持续表现控制或其他下一项。

## 本轮完成：日常微表现的待机/思考/工作/回复接入

起点 main `a16a264`。用户明确授权 Qoder 接手，覆盖旧“仅 Codex 开发”安排；继续在主目录单会话串行开发，四份既有未提交文档保持原字节。本轮提交：

- `58c22e6` `fix(runtime): deliver host events to the pet window`
- `8006f83` `feat(live2d): connect everyday micro-performance to real states`

### 用户可见结果

- 待机：头部缓慢小幅左右摆动，偶尔一次比原生眨眼更慢的放松闭眼，嘴形保持轻微柔和。
- 思考：头部轻微偏向一侧、眼睛轻微收窄、嘴形略收；现有“思考”预设仍是基础。
- 工作/工具执行：头部小幅慢扫、眼睛保持专注、嘴形接近中性；不打断“专注/好奇”预设。
- 回复/流式：嘴形轻微上扬；嘴部开合仍完全由真实语音/文本口型控制，日常层不写开合。
- 等待审批/错误：使用低幅等待姿态；错误结束回到待机。
- 设置 → 角色与动作 → 模型表现新增“日常表现 · 状态演示”，待机/思考/工作/回复各最多 4 秒，结束自动回到真实状态；“技术详情”显示状态、语义贡献和 Core 原生/应用样本。

### 技术落点与边界

- `services/performance/ambient-state.ts` 是纯状态选择：待机开关、减少动画、窗口可见性、模型就绪、工坊编辑/预览、审批、TTS/流式回复、宿主工作状态各自有明确优先级；显式编辑和预览永远让路。
- `services/performance/model-runtime.ts` 新增常驻 owner：头部在物理前以当前原生/预设值为基准做小幅 add；眼睛在物理后乘性约束；嘴形在物理后小幅 add。只使用已确认的 `headX`、双眼、`mouthForm` 三个安全通道，不写 `mouthOpen`，不写其他 neutral，不接管原生动作/物理，不修改 `savedParameters`。
- 平滑时间常数分别约 320/240/360ms；状态切换从当前值过渡，不硬跳。空闲慢眨眼的间隔约 19 秒，首次约 6 秒后出现，不替代原生眨眼。
- `loader.ts` 只在既有阶段末尾追加：`applyAmbientHead` 在旧栈/手动预览之后、物理之前；`applyAmbientPost` 在双眼/嘴部预览和部件之后。短时预览开始时暂停常驻层，结束后恢复真实状态。
- `DeskpetStage.vue` 直接观察真实 `agentWorkingState`、`isSpeaking`、`ttsSpeaking`、审批、`idleActionsEnabled`、`presetEditingLocked`、`presetPreviewActive`、减少动画和页面可见性；换模型/卸载释放旧模型。
- 设置命令新增无任意参数的 `preview-ambient`，走既有模型/会话绑定、工坊互斥、超时和关闭释放。演示只是临时覆盖真实状态，结束恢复；不持久化、不新增公开设置字段。
- 修复旧集成缺陷：运行桥原先可能把宿主事件发给“第一个可用窗口”，设置窗口打开时桌宠收不到。`windowCommandSink` 现在可显式指定窗口，主进程只投递宠物主窗口；新增回归测试。
- 本轮不使用新设置 schema，不恢复旧平台分工/任务区/监听；不重做 `NEXT-MODEL-MOUTH-TASK.md`，也不把首次音频采样追查作为下一项。

### 验证与证据

- 应用 **756 项（751 通过、5 跳过、0 失败）**；插件 **104/104**；node/web 类型检查、构建、三份共享契约检查通过。新增 12 项测试：10 项日常表现运行时/状态选择、1 项 ambient 命令白名单、1 项运行桥窗口选择。
- 真实 DS（`ambient-performance-20261024` profile，ports 9314/9315）18 项通过：247 参数/44 表情/8 动作；待机头部约 -0.9～+0.75 缓慢变化，嘴形 -0.5→-0.32；真实宿主 HTTP `thinking`/`tool_running`/`streaming` 产生不同姿态；完成/错误回到待机；四个设置演示自动和手动结束；头部预览暂停后恢复；减少动画暂停；设置窗关闭释放；59 份受控 DS 文件 SHA256 与冻结清单一致。
- 证据目录 `D:/Frankenstein/Uta-Workspace/operations/ambient-performance-2026-10-24/`：`electron-results.json`、`samples.json`、`hash-check.json`、`ds-ambient-*.png`、`ds-demo-*.png`、`ds-ambient-section*.png`、`verify.mjs`、`start.ps1`、`process-full-run.json`、`process.json`。截图已实际查看：待机两帧姿态不同，思考/工作头部朝向与眼睛开合不同，回复有可见微笑。
- 完整验收实例 PID 33064（2026-10-24 14:11:23 本机时区）与补截图实例 PID 25632（14:12:38）均已正常退出；9314/9315 无 LISTENING、临时 endpoint 已删除。不按历史 PID 停止其他实例。
- 未重测真实有声 TTS/PCM 口型；本轮“回复”使用真实宿主流式状态，语音占用逻辑沿用上轮已验证链路，并有“日常层不写开合”的行为测试。未验外部平台发现、真实麦克风、ZIP 候选或日常 exe；正式 AppData/模型、stable、日常 0.1.1 与四份受保护文档未改。

### 下一步

先按实际观感调整四态幅度与节奏，补审批等待/错误恢复的细节和句级语音重音；是否增加独立“表现强度/安静模式”设置需另做迁移设计，不临时扩公开设置 schema。继续使用受控 DS，不把本轮四态微表现标成完整情绪导演或新默认引擎。首次音频采样追查不列为下一项。

## 本轮完成：语音重音、审批等待与常驻预设让路

起点 main `a4eb73b`。统一主目录串行实施，四份原有受保护文档保持原字节。提交 `ca56d61`。

### 用户可见结果

- 回复朗读时，真实口型电平会轻微加强嘴形，并在响度上升的句首给头部一个很小的方向重音；嘴部开合仍完全由现有语音/文本口型链路控制。
- 审批出现时角色进入更安静的等待姿态（轻偏头、轻微收眼），批准/拒绝后回到日常；错误状态沿用同一低幅等待段，结束后回待机。
- 设置里“钉为常驻”现在会同步给桌宠；日常微动立即让路，取消钉住后恢复。设置重新打开会从宠物快照读回钉住状态。

### 技术落点

- `setModelLipSync` 现在同时把真实口型电平写入性能 runtime。只有 `active` 时才计入，收口尾段不计重音；电平阈值约 0.35、静音间隔约 450ms、重音冷却约 1200ms，重音包络 700ms、语义增益 0.028，并在约 90ms 内平滑。重音只加在 `headX`，不写 mouth open、不写其他通道。
- 回复态 `speaking` 的嘴形随电平增加最多约 0.04 语义，头部摆动幅度随电平最多增加约 0.015；仍在原安全范围内 clamp。
- `waiting` 姿态调整为更安静：头部偏移 0.08、振幅 0.015、眼睛乘性 0.97、嘴形 +0.02。
- 状态选择新增 `holdPresetPinned`：`activeHoldPresetId` 非空且不是 `neutral` 时暂停日常层；`neutral` 视为控件重置，不是用户钉住。
- 新增内部设置命令 `set-hold-preset`（只接受 ≤200 字符的字符串，空串表示取消）。设置窗 `togglePinPreset` 在钉住/取消时同步；恢复默认、清空控件、删除自定义预设也同步。宠物快照现在带 `activeHoldPresetId`，设置窗 hydrate 回填，避免重开后 UI 与宠物不一致。
- `ModelPerformanceView.ambient` 新增 `accent` 与 `speechLevel` 诊断；“技术详情”显示语音电平/重音，Core 样本仍是原生→日常。

### 验证与证据

- 应用 **760 项（755 通过、5 跳过、0 失败）**；插件 **104/104**；node/web 类型检查、构建、三份契约通过。第二轮新增 4 项：语音重音/嘴形、等待姿态、hold-preset 白名单、宠物常驻槽同步；第一轮新增 12 项。
- 真实 DS 第二轮（`ambient-refine-20261024`，ports 9316/9317）5 项通过：
  - 本地受控 8 秒 PCM（volume=0）只请求一次；真实口型电平到 1.0，句首重音最大约 0.0204；回复嘴形约 0.17→0.216 随电平变化；Core 开合仍由语音链路驱动（有 >0.1 的开口），结束后闭合；日常样本只报 `ParamMouthForm`，不写开合。
  - 真实 `/approval/ask` 弹出审批卡，日常状态进入 `waiting`，点击批准返回 `allowed-once`，随后回 `idle`。
  - 通过真实设置 UI 的 `.capsule-pin-btn` 钉住预设，宠物 `activeHoldPresetId` 更新、`ambient.state=null`；取消后恢复 `idle`。
  - 59 份受控 DS 文件 SHA256 不变。
- 证据目录 `D:/Frankenstein/Uta-Workspace/operations/ambient-refine-2026-10-24/`：`electron-results.json`、`captures.json`、`hash-check.json`、`ds-speech-accent.png`、`ds-speech-restored.png`、`ds-approval-waiting.png`、`ds-pinned-preset.png`、`verify.mjs`、`start.ps1`、`process.json`（PID 13372，2026-10-24 14:33:54 本机时区）。进程正常退出，9316/9317 无 LISTENING，临时 endpoint 已删除。
- 边界：PCM 使用 `volume=0` 的本地受控音频，只验证播放时钟/包络/画面，不是人工听感或外部云端 TTS；未验真实麦克风、外部平台、ZIP 或日常 exe。第一轮 `ambient-performance-20261024` 证据保留不变。

### 下一步

按实际观感调整重音强度、四态幅度和节奏；补错误恢复细节（如短暂停顿后再回待机）与可选安静模式。若增加独立“表现强度”设置，需要单独做公开设置 schema 迁移，不能临时塞字段。首次音频采样追查仍不作为下一项；完整情绪导演、句级语义重音和候选 ZIP 仍待后续。

## 本轮完成：等待演示与 Hiyori 日常兼容

起点 main `35a8e40`。提交：

- `136f3d4` `fix(live2d): keep ambient off unsafe mouth-form defaults`
- `447c302` `feat(settings): add the waiting posture to the daily demo`

### 用户可见结果

- “日常表现 · 状态演示”现在有待机/思考/工作/回复/等待五个入口；等待演示可直接看审批时的低幅姿态，不必发真实审批。
- 内置 Hiyori 没有安全的嘴形通道时，面板明确提示“回复演示只使用头部和眼睛”；日常待机只驱动头部/眼睛，不再尝试写不安全嘴形。

### 发现并修复的兼容缺陷

Hiyori 的 `ParamMouthForm` 默认值位于范围上界（`-2..1`、default=1）。手动嘴部测试原本会拒绝它，但日常层直接用了 `mappedParameter('mouthForm')`，只校验“已映射/非物理输出”，没有复用“默认值两侧都有空间”的安全门槛，导致 Hiyori 待机仍会写嘴形。现在新增 `safeMouthForm`，日常可用性和应用路径都使用同一门槛；新增回归：默认值在范围边缘时零嘴形写入、`mouthSample=null`、原生值保持。

### 验证与证据

- 应用 **761 项（756 通过、5 跳过、0 失败）**；插件 **104/104**；node/web 类型检查、构建、三份契约通过。新增 1 项嘴形默认边界回归；此前两轮共新增 16 项。
- 内置 Hiyori 真实 Electron（`ambient-hiyori-20261024`，ports 9318/9319）3 项通过：
  - 日常待机只驱动头部/眼睛；`mouthSample` 始终为 null；头部样本有可见变化；眼睛样本存在。
  - 新增“等待”演示在 Hiyori 上正常运行、eye 收窄、自动结束并释放工锁。
  - 面板显示“当前模型没有已确认的嘴形通道，回复演示只使用头部和眼睛”。
- 证据目录 `D:/Frankenstein/Uta-Workspace/operations/ambient-hiyori-2026-10-24/`：`electron-results.json`、`hiyori-ambient-idle.png`、`hiyori-ambient-panel.png`、`hiyori-waiting-demo.png`、`verify.mjs`、`start.ps1`、`process.json`（PID 10940，2026-10-24 14:41:20 本机时区）。进程正常退出，9318/9319 无 LISTENING，临时 endpoint 已删除。
- 前两轮 DS 证据保留不变；Hiyori 只验证日常待机/等待演示，未重跑全部表情/动作，也未验 ZIP/日常 exe。四份原有受保护文档保持原样。

### 下一步

继续按实际观感调整重音/幅度与节奏；补错误恢复细节和可选安静模式。若增加独立“表现强度”设置，需要单独做公开设置 schema 迁移。首次音频采样追查仍不作为下一项；完整情绪导演、句级语义重音和候选 ZIP 仍待后续。
