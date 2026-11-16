# 首批桌面任务契约 uta-desktop-wave-1

状态：2026-10-23，本批冻结。唯一类型来源：`app/src/shared/first-wave-contracts.ts`；合成输入样例：`app/tests/fixtures/first-wave-v1.ts`。这只是C01首批子集，不声称设置持久化/窗口/所有派单接口全部冻结，也不是已接入的运行时API。

## 共同规则

Worker只能import这里的类型，不复制一套改名版。需要改变字段/语义时写本任务结果的“接口请求”，先完成不依赖变更的部分；不能修改契约、另一个Worker或main。契约由commit固定；本机assignment另登记完整SHA与三个契约文件的SHA256，续接时复核。

### 模型输入与输出

Qoder实现 `buildModelCapabilityProfile(input: ModelInspectionInput): ProfileBuildResult`，建议导出于 `services/performance/profile/index.ts`。函数实际调用方后续负责把loader.ParameterInfo的`default`转成`defaultValue`，以及提供模型内容签名；本批不改loader、不读磁盘、不加载模型、不计算资产哈希。

输入是完整合成参数/资源快照，schemaVersion只能1。参数id/签名非空；id唯一，min/max/default必须finite，min≤default≤max；零范围可存在但不能作为可用连续控制。physicsOutput是事实标记，默认不自动映射。模型签名沿用调用方提供的opaque字符串，不能由路径冒充内容签名。

能力列表必须按SemanticChannel联合类型顺序覆盖全部15个通道（包括unsupported）。先取已确认且合法的用户override，再标准ID，再标签建议。标准ID只在真实参数存在且范围有效且不是物理输出时标available；标签猜测标needs-calibration，不能自动confirmed。不能从“看起来像个参数名”推导Core真实存在。

标准候选：headX/Y/Z→ParamAngleX/Y/Z；bodyX/Y/Z→ParamBodyAngleX/Y/Z；gazeX/Y→ParamEyeBallX/Y；eyeOpenLeft/Right→ParamEyeLOpen/ParamEyeROpen；mouthOpen/Form→ParamMouthOpenY/ParamMouthForm；browLeft/Right→ParamBrowLY/ParamBrowRY；breath→ParamBreath。direction默认normal，人工可reversed。不要推断所有模型完整FACS；私有参数、服装/部件、非线性曲线均留后续。

用户override指向不存在参数→ok:false/unknown-override-target；非法channel/direction、重复channel、多义同通道override→invalid-override。物理输出/零范围的合法override仍不可自动available，标needs-calibration；未确认override标unconfirmed。映射不得更改输入对象，重复调用结果确定，不带Date.now/随机值。

原生表情保留Add/Multiply/Overwrite和值，未知参数发warning，不创造参数；motion同理。资源名称非空，group/index组合唯一，index非负整数，expression name唯一；非法结构/非finite值返回invalid-resource。所有输入格式错误都返回结构化issues，不静默过滤成成功；可一次收集多项。路径`parameters[0].min`等只用于诊断，不泄漏真实文件路径。

runtime边界的unknown校验可以由模块内私有validator实现；公开类型不意味着可以跳过来自JSON的畸形结构。首批测试至少覆盖null/错类型/未知schema，并明确unknown额外字段策略：输入/参数/override/resource未知字段拒绝，错误归入对应invalid-*。字符串字段不trim后改写资源身份，只校验trim后非空。

### 表现意图与诊断（仅冻结数据语义）

本批不实现导演/仲裁/桥接。PerformanceIntent的epoch/generation为非负安全整数，intensity∈[0,1]，VAD∈[-1,1]，seed为0..2^32-1整数，ttlMs为1..60000整数，issuedAtUnixMs为非负安全整数；到本机后另记单调接受时间计TTL，不能直接用来源时间决定本地过期。host/speech须有sessionId；其他来源可null。取消仅取消同会话/epoch范围的targetIntentId。

Snapshot里的current/target是映射后的真实参数单位，非统一[-1,1]；channels是当前实际采样通道，可空。phase区分物理前输入与物理后约束；ownerId=null表示未接管。音频偏差未知为null。UI订阅以后做低频，不IPC逐帧广播。本批不新增任何宿主公开工具/API。

### 语音代表页（仅mock）

fixture是UI演示数据，不是生产settings schema。endpoint固定example.invalid域，不联网；secretState只展示示例配置状态，不读/写真实Key。volume为0..100。服务编辑有独立draft；测试使用明确标注的草稿配置，测试不保存；保存只更新页面内mock快照，刷新丢失并显著标示。

UI必须区分editing/testing/saving/error/saved；测试中取消或改字段使旧结果失效；服务商切换保留各自草稿；错误就地显示且不清空输入。Enter在composition期间不提交。模拟延时必须叫模拟，不显示虚构真实设备成功。测试/保存可用独立request generation防旧回调。

## 验收入口

Codex运行 `node scripts/check-first-wave-contracts.cjs`，检查正样例类型及负样例的类型拒绝。它不证明全部数值/范围的运行时校验，范围/坏JSON/不变性等由Qoder的行为测试证明。两Worker的类型检查/构建分别在独立app/node_modules下进行。

C02本批只有合成参数样例/事件脚本准备；真实三类模型GUI与音频基线未录制。Qoder这项限定为纯数据子任务，可先开发；不得据此标记整个Q04或C02完成。
