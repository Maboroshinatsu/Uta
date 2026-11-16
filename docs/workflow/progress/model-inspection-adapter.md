# 真实Core读取适配器：进度

状态：implemented-pending-review（2026-10-23；适配器、真实 Core 采集器与 87 项行为测试完成，全量检查通过；不等于 Q05/Soullink 或生产接线）。

## 现场与模型设置

- 工作目录：`D:\Frankenstein\Uta-Workspace\tasks\qoder-model-inspection-adapter`
- 分支：`task/qoder/model-inspection-adapter`
- base / 启动时 head：`c64bafa5a772fba9ddab57dddddf9d2f67f3031b`
- dirty：false；profile：`qoder-model-inspection-adapter`
- preflight：`node scripts/task-handoff.mjs preflight` 退出码 0，`checkedAt=2026-10-23T11:18:04.958Z`
- 模型：**DeepSeek-Flash**（桌面固定）。思考/上下文可见档位：**不可设置/未验证**——会话内无法读取或修改桌面模型 UI，未另启 CLI、未开子 Agent。
- 契约 hash：7 个冻结文件按 LF 规范化后 SHA256 全部与 `.uta-task/assignment.json` 一致；工作区因 `core.autocrlf=true` 为 CRLF，非契约内容变化。

## 只读预检结果（真实样本）

- 任务内样本 `.uta-task/model-input/`（Git 忽略）：
  - manifest 59 个文件、4,141,300 字节；逐文件 size/SHA256 全部匹配；内容签名 `8f6042a7...5341c9` 与 manifest 一致；无缺失/额外引用文件。
  - 许可：CC-BY-NC-SA-4.0；`MODEL-NOTICE.txt` SHA256 `f3fbeff8...d29d4b`；原署名文件未改、未入 Git。
- 真实 Core（任务副本 MOC，Cubism Core 5.1.0）：
  - 247 参数 / 92 parts / 269 drawables，与独立 `core-inspection.json` 逐项一致（0 mismatch）。
  - 有界就绪检测实测：MOC 构造第 2 次尝试成功（48ms）；未用固定 sleep 当就绪保证。
  - `ParamMouthForm` [-2,1] 默认 -0.5；`ParamMouthOpenY` [0,1] 默认 0。
- physics3：22 个 PhysicsSettings、56 个 Output.Destination；**本模型 Destination 是单对象而非数组**，全部 `Target=Parameter`，56 个 ID 均真实存在于 Core。
- CDI：247 条参数，Id 唯一、Name 均为字符串。
- exp3：44 个表情、105 条参数记录，Blend 全部为 Add（Multiply/Overwrite 需 synthetic 测试覆盖）。
- motion3：8 组 / 8 个 motion、184 条曲线，全部 `Target=Parameter`（Model/PartOpacity 排除需 synthetic 测试覆盖）。
- LipSync 组为空；`ParamMouthOpenY` 存在，空组不表示嘴部缺失。

## 计划（5 步）

1. [x] preflight、契约 hash、真实样本/Core 预检、记录现场与模型设置。
2. [x] 实现 `inspectCoreModel`：Core 快照校验、CDI/physics/exp3/motion3 转换、复用 profile builder、错误码映射，附模块 README。
3. [x] 编写 Node 测试采集器：manifest 校验、有界 Core 就绪、真实资源读取、释放。
4. [x] 行为测试：坏输入矩阵、typed arrays/冻结/getter throw、真实 247 参数与 44 表情/8 动作对照、能力摘要。
5. [x] 运行根契约检查、测试、typecheck、`npm test`、build；results 与最终提交进行中。

## 已完成

- 新增 `app/src/renderer/services/performance/inspection/index.ts`：
  - Core count/ids/min/max/default 校验与普通数组复制；0..4096；getter 抛错转 invalid-core。
  - CDI label、physics 物理输出（Destination 单对象/数组双格式）、exp3 Blend、motion 曲线转换。
  - 资源总数 1024、单文档规范化 JSON 8 MiB 上限；请求/包装层未知字段拒绝，Cubism 文档未消费字段允许。
  - 输出交给 `../profile/index` 的 `buildModelCapabilityProfile` 校验，失败统一映射 `invalid-profile`；输出不与输入共享可变数组。
- 新增同目录 `README.md`：调用方职责、校验规则、错误码、测试采集器边界。
- 单文件严格类型检查通过：`tsc --noEmit --strict ... inspection/index.ts` 退出码 0。
- 新增 `app/tests/support/model-inspection-fixture.cjs`：
  - manifest 59 文件逐项 size/SHA256、引用集合与内容签名校验；路径越界/缺失/额外引用拒绝。
  - 有界 Core 就绪：MOC 与 Model 构造带 5s 期限重试；实测 MOC 第 2 次尝试成功（约 39ms）。
  - 读取真实 cdi/physics/44 exp3/8 motion3，计算独立期望值；只读，不写快照；结束释放 model/moc。
- 新增 `app/tests/model-inspection-adapter.test.cjs`：87 个用例，覆盖 Core/metadata 坏输入矩阵、Destination 单对象/数组、Blend 三态、Parameter 与 Model/PartOpacity 曲线区分、getter throw、冻结/隔离/确定性、profile 错误映射，以及真实 DS 247 参数/92 parts/269 drawables/44 表情/8 动作对照。`node --test` 87/87 通过。

## 检查结果（最终代码，2026-10-23）

- 根契约：`node scripts/check-first-wave-contracts.cjs` → 退出码 0；`node scripts/check-desktop-wave2-contracts.cjs` → 退出码 0。
- 本任务测试：`node --test tests/model-inspection-adapter.test.cjs` → 退出码 0，87/87 通过（真实 DS 用例 0 skipped）。
- 类型检查：`npm run typecheck` → 退出码 0（node + web）。
- 全量测试：`npm test` → 退出码 0，356/356 通过（本任务测试未注册进 package.json，另行直接执行）。
- 构建：`npm run build` 默认 TEMP 下退出码 1，仍是 esbuild 删除系统 Temp 文件 `Access is denied`（环境问题，与代码无关）；`TMP/TEMP=app/node_modules/.uta-build-tmp` 时退出码 0，主进程/preload/renderer 构建成功。临时目录已清理。

## 真实 DS 对照（本任务实测）

- manifest：59 文件 / 4,141,300 字节；逐文件 size/SHA256 全匹配；内容签名 `8f6042a7...5341c9` 一致；无缺失/额外引用。
- Core：Cubism Core 5.1.0（83951616）；247 参数 / 92 parts / 269 drawables，与独立 `core-inspection.json` 0 mismatch。
- 就绪：MOC 第 2 次尝试约 43ms；Model 第 1 次约 36ms；5s 期限，未用固定 sleep。
- physics：22 个设置、56 个 Destination，本样本全部为单对象格式；56 个 Parameter 输出 ID 全部存在于 Core。
- CDI：247 条标签，Id 唯一、Name 非空。
- exp3：44 个表情、105 条参数记录，Blend 全部 Add（Multiply/Overwrite 由 synthetic 覆盖）。
- motion3：8 组 / 8 个 motion、184 条曲线，全部 Parameter（Model/PartOpacity 由 synthetic 覆盖）。
- LipSync 组为空，但 `ParamMouthOpenY` 存在。
- 适配器输出与样本逐项一致：247 参数、44 表情、8 动作、56 个 physicsOutput；`ParamMouthForm [-2,1] default -0.5`、`ParamMouthOpenY [0,1] default 0`。
- profile 摘要：12 available（headX/Y/Z、gazeX/Y、eyeOpenLeft/Right、mouthOpen/Form、browLeft/Right、breath），3 needs-calibration（bodyX/Y/Z：physics-output），0 unsupported；12 条 standard-id 映射；4 条 warning。该数量只是本样本实测，不硬编码进算法。

## 剩余问题 / 接口判断

- physics `Destination` 单对象/数组两种格式均支持；真实 DS 样本是单对象。
- CDI 存在但缺少 `Parameters` 视为 invalid-metadata；本样本有完整 Parameters。若未来合法模型省略该树，需要契约确认是否允许“无标签”。
- 请求/metadata/表达式/motion 包装层未知字段拒绝；CDI/physics/exp3/motion3 文档内部未知字段允许（Cubism 标准字段）。
- 8 MiB：适配器检查规范化 JSON 大小；采集器检查原始 JSON 文件字节大小。两种口径都记录。
- 未接 PIXI/loader/Stage/store；未做画面、音频、口型验收；能力推导不等于视觉通过。

## 所属进程

- 无 Uta 应用/桌宠进程；仅 Qoder 桌面开发会话。

## 最近提交

- `e94024d` docs(workflow): start model inspection adapter progress
- `78ff05f` feat(inspection): convert real core state into inspection input
- `45833d9` test(inspection): cover real core and resource conversion
- results 与本次进度更新随后提交，最终 head 见 submit 回执。
