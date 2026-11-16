# 静默失效清扫方案（2026-11-03）

基线：`main` @ `78c3ad3`。来源：4 路只读排查子代理（通道覆盖 / 静默失败 / 抢占闸门 / 数据漂移）
+ 主控复核。参数过滤那路未执行，其通道层面问题已由「通道覆盖」路覆盖。

## 复核后的修正（两路独立复核，已推翻原方案 3 条前提）

- **批次 3 的「零 Source 孤儿物理设置」前提不成立**：上一路探针读 physics3 用错 schema
  （Cubism3 是 `PhysicsSetting[].Source[].Id`，不是 `Sources`）。按正确键名重跑：大肥鱼 131 个设置
  全部有输入、292 个 Destination 全部被驱动、孤儿为 **0**。`ParamBrowLAngle/RAngle` 是
  PhysicsSetting38→39 / 40→41 的两级平滑链。所以「只收有 Source 的通道」这条修法对本模型是空操作，**撤回**。
- **批次 4 的 `isProfileExportDestination` 方向反了**：`return true` 在调用点意味着「判为 profile 内 → 拒绝导出」，
  本来就是 fail-closed；照原方案改会**真的**开出可写 profile 的洞。**撤回**，只保留「区分 realpath 失败并给专门错误码」。
- **批次 5 对大肥鱼不成立**：迁移与「恢复默认」都走 `buildNaturalPresetsForModel` → `buildDafishNaturalPresets`，同源。
  真正的缺陷是**恢复默认会丢掉用户自建预设**（`persistPresetBucket(key, seeded)` 未保留 `source==='user'`，
  而 dafish 清理分支专门保留了），且无二次确认还顺手播放第一个预设。批次 5 据此重写。
- 批次 1 追加：`isNewSequence` 与打断 warn 读的是 cancel **之后**的状态，必须取消前取一次；
  另存在反方向假阴性（重播已钉为常驻的预设时闸门判为「没在播」），本轮以特征测试记录，不额外加标志位。
- 批次 2 修正：过滤条件必须是「`motion.group` 缺失**且无兜底动作**」，因为 `resolvePresetMotion`
  在组缺失时还会按 id/emotion 找可用动作，直接按组名过滤会误杀能演出的预设。
- 路径更正：`renderer/services/runtime-command-controller.ts`、`renderer/services/live2d/model-discovery.ts`。
- 范围裁定（风险评审）：**批次 1 采用缩小版**（状态来源不变，只补终态写回），不做显式序列位；
  在 `useMotionPriority` 异步分支仍会无条件归零之前，**不扩大取消入口**；批次 2/5 与批次 3 的物理排除集改动推迟。

排查样板：刚修的 `56d0393`——「开心」动作缺 `Param56/57`，被 `keys()` 的 `tracks.has()` 守卫
**静默跳过**，手被画到本体后面。共性是 **失效没有信号**：不报错、不日志、不体现在清单里，
测试也发现不了。下面按「同一根源优先合并，能收敛就不打补丁」排序。

## 附：自查后撤回的两笔视线改动

`d90c1f1` 与 `6838107` 已回滚，`loader.ts` 回到会话前基线。原因：前者删掉「播放期间压视线」
却没能真正启用让位（判定只读 `step.parameters`，大肥鱼的眼神在动作曲线里，9 预设 30 步命中 0 次），
等于用一个回归换一个症状；后者源自把「闲置动作」误读成「视线动作」，且带一个无依据的 0.5 系数。
症状改由时长解决：`RETURN_GAZE_MS` 320 → 600，回退路径视线交回同一时长，语义回到改前。
通道归属的真正收敛（判定读动作层实际归属、三套权重并成一套）留在 T1。

## 批次 1：序列生命周期改成显式状态（最高优先，与刚修的同族且更严重）

现状：`store.presetSequenceActive` 是从 `activeRunningPresetId ≠ neutral 且 ≠ activeHoldPresetId`
**推导**出来的（`stores/deskpet.ts:845-852`），而真正代表序列存活的 `seqToken/seqTimer` 在控制器闭包里。
于是多条退出路径杀了序列却不复位 id，推导结果反过来**永久为真**：

- `usePresetController.ts:726`（快捷面板「保持部件」→ `handleControlAction`）、`:420`（工坊单步预览）、
  `:763`（滑块同步）、`:776`（停预览）都是裸 `cancelPresetSequence()`，不带 cleanup：
  running id 残留、临时控件不收、动作层不释放（`:146-148` 要求 `cleanupPresetControls=true` 才释放）、
  loop 动作不停（`useMotionPriority.ts:126-132` 令牌仍有效）。
- `:597-605` 的 `settle` 收尾分支只恢复视线，永不把 running id 复位；宿主 `set_preset …mode=hold`
  （`runtime-command-controller.ts:151`）就会走到这里。

用户后果：① 点一下保持部件，正在播的预设被无声击杀，之后**空闲小动作和悬停反应再也不来**
（我刚修的那个闸门被残留状态反向卡死）；② 大肥鱼身体 loop 永动，最长约 45 秒才被顶掉；
③ 宿主下发 hold 后桌宠永远静止。

方案（缩小版，已实施）：推导关系保留，只补「终态写回」，不新增必须记得复位的时机。
- `cancelPresetSequence` 末尾把 `activeRunningPresetId` 写回 `activeHoldPresetId || 'neutral'`。
- `settle` 分支（hold 型与单步 loop，不经过 revert）同样写回终值。
- `applyPresetByEntry` 在 cancel 之前取一次 `wasActive`，供打断诊断与 `isNewSequence` 共用同一事实
  （原先两处读的是不同时刻的推导值，语义已不一致）。
验证：`preset-edit-lock.test.cjs` 三条——控件动作终止后回到终值、hold 型演完自行解除闸门、
重播常驻预设的假阴性作为特征测试记录。**前两条已反向验证：抽掉修复即失败。**
显式序列位（覆盖 6 个复位时机 + 跨窗口快照 + 静默死亡超时兜底）留给 T1 所有权收敛一并做。

## 批次 2：预设注册与动作安装绑定，清单只报真实可播

现状：只有「开心」有「动作没装上就不显示预设」的单点过滤（`stores/deskpet.ts:1064`，
`6f2fd8f` 引入）；其余 8 个预设照样注册。`registerDafishGeneratedMotion` 返回 false 时
（`dafish-happy-performance.ts:188-200`）安装点 `useStageModelLifecycle.ts:399-446` 零日志。
`/context` 的动作清单取 `motionGroups ∪ emotionAdapter.animations 键`（`useStageModelLifecycle.ts:287`），
`emotion-adapter.ts:431-433` 第 1 分支不校验就返回映射。被用户否定的 3 个开心实验动作仍注册进动作组，
并出现在工坊原生动作下拉（`useStageModelLifecycle.ts:375-391` + `preset-motion-options.ts:13-32` 只滤场景动作）。

用户后果：重导入或改版模型缺必需通道时，点「委屈/好奇…」只变脸不演身体，没有任何提示；
宿主看到清单调用不存在的动作，收到 accepted 却毫无反应。

方案：把单点判断换成通用规则——预设带 `motion.group` 而该组不在实际 `motionGroups` 里 → 过滤掉并
一次性 warn；宿主与工坊清单都只报实际可播的组；被否定的实验动作不再注册（即 HANDOFF T3 减法项）。
验证：装载缺 `Param59` 的参数表，断言对应预设不进面板、不进 `/context`，且有日志。

## 批次 3：通道静默丢弃 + 一条永久守卫测试

现状（探针结论）：真实大肥鱼 physics3 里有 4 个「零 Source 的孤儿设置」，把
`ParamBrowLAngle/ParamBrowRAngle` 判成物理输出，于是动作 `add()` 与滑块**双层静默丢弃**；
`dafish-body-led-angry.ts:192` 的步骤仍写 -0.7，只能靠 `loader.ts:1797-1806` 物理后回写硬推，
与物理求值同帧对抗。委屈/惊讶/说教的眉形斜度同理为 0 条出片。
`dafish-body-led-shy.ts:217-244` 四步写 `ParamCheek`，而真实模型 509 个通道里没有这个 id
（近似名是 `CheeckPuff*`），写入被 try/catch 吞掉。

用户后果：眉毛只有高低没有斜度，怒/委屈/惊讶的辨识度下降；工坊里编辑一个不存在的参数会误导。

方案：物理排除集只收**确有 Source 驱动**的通道（先探针确认零 Source 是否每帧覆盖，确认不了就
保守地只排除有 Source 的目标）；删掉 `ParamCheek` 死参数；
新增守卫测试「源码欲写通道 ∖ 实际出片通道 = ∅」，9 个 dafish 动作文件共用——
这条是防止 `Param56/57` 类问题复发的永久防线。

## 批次 4：用户数据与安全的静默失败（本轮已做其中两条）

> 实施记录：`FIX-MODEL-LIST-FAILURE-CACHE` 与侧车损坏 warn 已做，并附真实模块测试（反向验证过）。
> `isProfileExportDestination` 一条按复核结论**不改**（现行为已是拒绝，改法会反向开洞），
> 只值得后续把 realpath 失败与「确实在 profile 内」区分成两个错误码。
> 「adapter 校验错误进诊断快照」**推迟**：主进程目前没有可写入的诊断存储，
> 为它新建基础设施不属于本轮清扫范围。

- `main/index.ts:742-749`：模型侧车 `deskpet-presets.json` 解析失败被 `catch {}` 当成「没有」，
  用户预设整桶凭空消失且无提示。改为区分「不存在 / 损坏」，损坏时保留原文件并上报
  （项目对 chat/daily 已有同类模式，照抄语义即可）。
- `main/index.ts:1980`：`isProfileExportDestination` 在 realpath 异常时 `return true` —— **fail-open**，
  可把数据写进 profile。改为 fail-closed。
- `main/model-discovery.ts:186-192`：扫描失败缓存空列表且非强制重扫永不重试 → 面板静默「无模型」。
  失败不进缓存。
- `adapter-validator.ts:149-173`：校验错误只 console.error，打包后不可见。写入诊断快照，
  让「装了但不工作」有地方可查。

## 批次 5：预设默认值的三份真相

现状：活数据是 `natural-presets.json`（迁移在 `stores/deskpet.ts:889-936`），但「恢复默认」用的是
TS 工厂包（`emotion-adapter.ts:1821-2400`），首次种入又用模型侧车 `deskpet-presets.json`
（`deskpet.ts:984-987`）。三者不同源。

用户后果：点一次「恢复默认」= 把已迁移的桶降级回旧工厂包并覆盖用户内容，且 v3 旗标不会回放。

方案：恢复默认与迁移共用同一包源（单一真相）；侧车只在「模型自带默认」时参与，且优先级写进文档。
验证：迁移后点恢复默认，断言桶内容等于当前活包且用户自定义项仍在。

## 本轮不做（明确记录，避免顺手扩大范围）

- `play_animation` 消费端不看编辑锁/序列（`useStageRenderLoop.ts:396-412`）——需要产品决定打断语义。
- 拖拽落位 `'placed'` 是否该给预设让路（`DeskpetStage.vue:1319-1346`）——同上。
- TTS 口型与预设张嘴关键帧的仲裁方向——需实机观察，无探针证据。
- 宿主显示名 4 份表、`harness`/`deepseek-harness` 双命名空间、大肥鱼/DS 判定 3 入口互斥
  （`natural-presets.ts:144-181`、`builtin-adapters/index.ts:19`、`vts-import.ts:153-154`）——
  属于命名收敛，单独一轮做，别和动画修复混在一个提交里。
- `companion-chat.json` 孤儿文件（含 encryptedApiKey，写入方 `ff79599` 已删）——清理属仓库外数据，
  单独确认后删。
- 已录未修：动作打断非动作路径的硬归零另一半、首步过滤不可达、动作层 5000→8000、
  撤销不回滚滑块与部件档位。
