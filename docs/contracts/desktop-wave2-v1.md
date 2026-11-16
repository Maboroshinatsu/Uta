# 桌面第二批冻结接口 v1

日期：2026-10-23。主控 Codex；基于已集成桌面首批的 main。确切 base、profile、文件 hash 以各任务 `.uta-task/assignment.json` 为准。两个 Worker 只改自己的实现目录，不改本文、shared 契约、另一任务或公共入口。发现接口缺口先记录，继续可独立完成部分，不能自行分叉协议。

## 1. 本批完成到哪里

- Antigravity：**公开偏好设置存储内核与显式旧来源导入**，只在临时目录测试。不是生产迁移、不是整个设置中心接线。
- Qoder：**已初始化 Cubism Core 的真实参数读取与资源元数据转换**，输出首批的 `ModelInspectionInput`。不是新模型加载器，也不写模型参数。
- Codex 后续串行负责 main/preload/renderer 接线、启动 gating、窗口与同步；只有通过集成审查才进入下一阶段。日常 ZIP 不随源码变动。

冻结文件：`first-wave-contracts.ts`、`settings-contracts.ts`、`model-inspection-contracts.ts`、两批 fixtures、本文及首批契约说明。第一批纯 profile builder 直接复用，不另起一份映射算法。

## 2. 设置数据与版本

导出 `createSettingsStore(directory: string): Promise<SettingsService>`，位于 `app/src/main/settings-store/index.ts`。directory 必须是调用者已经解析的绝对 profile userData；本模块不读 APPDATA、Electron app 或环境变量、不寻找正式目录。缺失/相对路径拒绝打开。同一进程同一规范目录只开一个实例，重复打开拒绝；本批不声称实现跨进程锁，生产接线前需复用 Electron 单实例约束。无后台 watcher。

唯一主文件 `settings.v1.json`，备份 `settings.v1.backup.json`；临时文件仅由本模块在该目录生成，不接受请求路径。首次无主文件且无备份时，read 返回 revision=0 的完整新 profile 默认值，尚不落盘。主文件丢失但有备份时阻塞，不能把已有 profile 当首次启动。导入旧值优先于默认值，不能为了 Bento 风格覆盖用户旧主题/主题色。

本批只收十二个 public 字段。完整字段由 `PublicSettings` 确定：六个外观/行为字段，以及语音启用、provider、rate、volume、旁白和回复开关。布尔严格布尔；theme/orb/provider 枚举严格；accentColor 只接受 `#[0-9a-fA-F]{6}`，规范化小写；ttsRate 有限且 0.5..2；ttsVolume 有限且 **0..1**。不自动 clamp 非法值。百分比由未来 UI 边界除以100，存储不得改成80代表80%。

明确不含：密钥、endpoint、云提供商配置、模型路径/视图/预设、宿主选择、工坊、技能、记忆。原 safeStorage 文件与旧设置暂保持原行为。后续迁移这些项目需自己的 schema 和任务；不得把本批写成“所有实例的设置已统一”。所有 API 入口按 unknown 验证，不相信 TS，未知键、非普通对象、数组、空补丁、NaN/Infinity、危险原型键、错误 schema 均拒绝，不把坏字段滤掉后假装成功。

document 为 schemaVersion=1、非负安全整数 revision、完整 values、claimedKeys、imports、conflicts。claimedKeys 去重并按字段名排序；工厂默认不算已声明；成功 patch/import 即使值等于默认，也声明该字段。只有非空状态变化（值、claim、receipt、conflict）才增加一次 revision。完全相同且已声明的 patch 不写盘、不增加版本、不通知。revision 达 Number.MAX_SAFE_INTEGER 则 limit-reached，不回绕。

## 3. 原子写、错误、订阅

所有 read/patch/import/close 在服务内顺序化。patch/import 的 expectedRevision 在进入队列后与当前已提交版本比较，过期返回 revision-conflict，不落盘；提供 currentRevision 供后续 UI 刷新。read 返回深副本；返回值、监听器收到的数据不能修改内部状态。只给成功提交通知，不在 staging/失败时发事件；unsubscribe 可重复调用；一个监听器 throw 不影响其他监听器和已成功的写入。listener 不得被 await，回调重入的异步 read 不死锁。

先验证/生成候选，再写同目录独占临时文件并 flush/close；已有有效主文件则保留其上一完整版本为备份（也用临时替换），最后原子 rename 主文件。任何写入/备份/rename 失败保留内存已提交版本，不通知；主文件仍可读且与已提交状态一致。清理只删本次创建的临时文件，不扫目录其他文件；失败不能留下以后会被当成正式数据自动采用的 pending。不得 truncate 后原地覆写、先删除原主文件再 rename 或全量删除目录。首次写失败也不得创建伪成功状态。测试要覆盖备份与主 rename 各阶段故障。

最大主文件/单次请求 JSON 体各 1 MiB；读取先检查大小。单次导入最多16来源，累计最多64个(sourceId,digest) receipts、128条去重冲突；超限整次拒绝，不静默丢记录。document 校验含 metadata，不只 values；主文件无效时禁止 fallback 写新默认。损坏或更高 schema 返回 blocked，保留主文件原字节；备份存在不等于备份有效，backupAvailable 仅在备份可解析且 schema=1/有效时 true。更高 schema 主文件不得回退旧备份覆盖。恢复动作本批不开放 API；交付恢复建议与测试证据，后续主控接线才设计用户操作。

普通 I/O 失败映射结构化错误，不返回完整磁盘路径/文件内容。初次不可读 read 为 blocked/io-error；打开失败不悄悄转到别目录。close 等待已排队事务并释放实例登记，关闭后 mutation 返回 closed，read 为本地最后状态（不能重新读写磁盘），不再通知。重新打开需要显式 createSettingsStore。

## 4. 显式旧来源导入与冲突

importLegacy 接收调用方**已经读取并提取的公开字段**，不接收任意 localStorage dump、文件名、URL或目录。sourceId 是 `[a-z0-9][a-z0-9._-]{0,127}` 的不透明标签，如 legacy.dev-a；不是真实用户路径。空来源/空values、重复sourceId、非法字段整次拒绝。原 `deskpet/ui-state-biophilic-v1` 的提取器、legacy key fallback、宿主/预设迁移本批不做；不能从真实浏览器/正式 profile 自动采集。

摘要以 sourceId 对应规范化 values 的键名排序 JSON 为输入计算 SHA256（UTF-8，六位hex已小写）。不是调用者任意传入摘要。相同(sourceId,digest)再次导入为 no-op。相同 sourceId 内容变化形成新 receipt，继续按同样冲突规则，不能时间戳覆盖。

同一次导入先按 sourceId 字典序处理，保证输入排列不影响结果。未 claim 字段接纳并 claim；已 claim 且相同则不改值；已 claim 且不同就保留当前值并登记 key/sourceId/sourceDigest/current/incoming 冲突。两个旧 origin 相互矛盾也按该规则保留候选；排序只用于确定性，**不表示排在前者更可信**，后续 UI 必须展示冲突再由用户选择。同条冲突去重；不同来源不同内容不能合并掉。导入事务只升一次版本，全部校验成功才写。

patch 是后续显式选择值的唯一写入口：成功 patch 对触及字段清除其所有冲突，即明确接受所提交的值；其他字段冲突保留。不接受没有 expectedRevision 的“最后写赢”。未解决冲突不阻塞读取/其他字段编辑。保存 current 是冲突发生时的快照，不能把它误作永远的实时值。

## 5. IPC / 窗口衔接预留

只冻结四个 channel 和 service 类型，不注册 handler、不暴露任意路径读写。未来 Codex 在主进程单例创建 store，并核对设置窗口来源、调用权限、payload大小；preload 暴露 read/patch/changed，importLegacy 只能在显式迁移流程中用。renderer ready 前 gate hydrate，不先从本地旧 origin 写默认。订阅先建立再read，按revision忽略旧事件并补快照，窗口关闭移除监听。接线前仍只有 mock 页面，不能另造 renderer 持久化源。

## 6. Core 读取接口

实现 `inspectCoreModel(core: CoreModelView, request: CoreInspectionRequest): CoreInspectionResult`，路径 `app/src/renderer/services/performance/inspection/index.ts`。只读取已初始化 raw Core 的 parameters.count/ids/minimumValues/maximumValues/defaultValues；不调用写值/setParameter、update、release，不触碰PIXI私有对象。Core生命周期由调用者负责，卸载后不可读的对象返回 invalid-core。count整数0..4096；四个数组长度必须恰好count，ID非空且唯一，数值有限/min<=max/default在范围，复制到普通数组；getter抛错转结构化错误。零参数合法，能力由原 builder 降级。

metadata 是已读取JSON：缺少可选 CDI/physics 用null；有值必须验证消费的树，允许 Cubism 标准中不消费的字段。CDI Parameters[].Id/Name 为字符串，标签只作建议；重复Id或非法记录报 invalid-metadata。physics PhysicsSettings[].Output[].Destination 中 Target=Parameter 的 Id 汇总为物理输出，不能只看标准参数名；其它合法目标不作为参数输出，不改物理配置。未知目标ID也不能伪造Core参数。

表达式输入带逻辑name与 exp3 JSON，读取Parameters的Id/Value/Blend，合法 Add/Multiply/Overwrite 原样保留，不规范成Overwrite；motion带group/index与motion3 JSON，读取Curves里 Target=Parameter 的 Id，去重为parameterIds；Model/PartOpacity曲线不算参数。缺字段、非法数值/blend/重复资源索引报 invalid-metadata，不静默丢文件。单份metadata JSON最多8MiB，资源总数最多1024；输入不得发生写入或保留可变数组引用。

输出schemaVersion=1和调用者content signature、overrides；调用既有 `buildModelCapabilityProfile` 校验输出，失败映射invalid-profile，不能绕过首批的物理输出/不确定映射约束。adapter不负责fs/hash/请求外网；label只能进入既有保守映射链。错误path指字段逻辑路径，不泄露磁盘路径。

真实资源测试使用任务内忽略的 `.uta-task/model-input/`；DS快照是验收样本，不是让算法硬编码247/作者私有参数。另测空/最小/未知私有模型。可写专用 **Node测试采集器** 从任务副本读取JSON（限制目录、拒绝路径越界），不得让renderer纯模块引入fs。模型文件不进Git；真实Core探针不能靠JSON回放冒充实际MOC读取。

## 7. 真模型证据和后继边界

DS基准说明见 `docs/models/ds-control-baseline.md`。已得到资源清单与Core结构，不代表已做画面/音频/所有动作兼容性验收。Qoder交付至少比较Core实际数值与独立检查结果、完整资源转换+profile结果、异常/物理输出降级；表情目录44条/动作8组不是保证44表情均视觉正确。

Soullink只作为**另一个后继任务**：比较稳定公开engine API、自有实现和有署名移植；不拉PIXI7 renderer进现有产品。先交选型/可复现纯引擎实验，再决定运行时接线。当前两个Worker完成后停在待主控审查，不因Codex额度不足自行推进未armed任务。
