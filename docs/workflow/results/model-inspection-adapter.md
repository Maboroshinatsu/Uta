# 结果：真实 Cubism Core 模型能力读取适配器

状态：**已提交待主控审查**（不等于 Codex 已验收；不等同 Q05/Soullink、PIXI 接线或视觉验收）。

## 交付信息

- 任务：`model-inspection-adapter` / `docs/workflow/tasks/model-inspection-adapter.md`
- owner：Qoder
- 分支：`task/qoder/model-inspection-adapter`
- base：`c64bafa5a772fba9ddab57dddddf9d2f67f3031b`
- 交付 head（本结果文件提交前）：`45833d9`
- 最终 head：以 `node scripts/task-handoff.mjs submit` 回执与 `git log` 为准
- 提交：
  - `e94024d` docs(workflow): start model inspection adapter progress
  - `78ff05f` feat(inspection): convert real core state into inspection input
  - `45833d9` test(inspection): cover real core and resource conversion
  - 本条结果与 progress 收尾提交

## 改动文件

- `app/src/renderer/services/performance/inspection/index.ts`（新增）
- `app/src/renderer/services/performance/inspection/README.md`（新增）
- `app/tests/support/model-inspection-fixture.cjs`（新增，仅 Node 测试使用）
- `app/tests/model-inspection-adapter.test.cjs`（新增，未改 `app/package.json`）
- `docs/workflow/results/model-inspection-adapter.md`（本文件）
- `docs/workflow/progress/model-inspection-adapter.md`

未修改 loader、emotion-adapter、Stage、stores、shared 契约、既有 profile、package/lock、renderer/Core 库、模型资产、主分支或其他任务。`git ls-files .uta-task` 为空，模型副本未入 Git。

## 实现内容

导出 `inspectCoreModel(core: CoreModelView, request: CoreInspectionRequest): CoreInspectionResult`，以及限制常量：

- Core 快照只读校验：`count` 0..4096 整数；四个 ArrayLike 长度必须等于 count；ID 非空唯一；min/max/default 有限且 `min ≤ default ≤ max`；支持普通数组/typed array；getter 抛错返回 `invalid-core`；复制成普通数组，不保留 Core 引用。
- metadata 转换：
  - CDI `Parameters[].Id/Name` → label 建议；未知 Core Id 忽略，不伪造参数；重复 Id/非法记录拒绝。
  - physics `PhysicsSettings[].Output[].Destination` 中 `Target=Parameter` 的 Id → `physicsOutput`；**Destination 同时支持单对象与对象数组**；其它 Target 不采集；未知 Id 不会创建 Core 参数。
  - exp3 `Parameters[].Id/Value/Blend` 原样保留 Add/Multiply/Overwrite；空 Parameters 合法。
  - motion3 `Curves[]` 只把 `Target=Parameter` 的 Id 去重进 `parameterIds`；Model/PartOpacity 曲线不计入参数。
  - 请求/metadata/expression/motion 包装层拒绝未知字段；CDI/physics/exp3/motion3 文档内部允许 Cubism 未消费字段。
- 限制：资源总数（expressions + motions）≤1024；单文档规范化 JSON ≤8 MiB；采集器另做原始 JSON 文件字节上限。
- 输出：`schemaVersion=1`、调用方 signature 和 overrides；参数/表达式/motion/override 都是新对象或新数组，不共享输入可变引用。
- 调用既有 `buildModelCapabilityProfile` 校验输出；builder 失败统一映射为 `invalid-profile`，保留原 builder 路径并在 message 保留原错误码；物理输出/未知映射等首批约束不被绕过。
- 纯模块无 fs/hash/网络/PIXI/Vue 依赖；运行时只 import 既有 profile builder。

## 真实 DS 样本证据

只读任务内 `.uta-task/model-input/`；未访问 manifest 里记录的源 AppData 路径，未写模型文件。

- manifest：59 文件、4,141,300 字节；逐文件 size/SHA256 全部匹配；引用集合无缺失/额外；内容签名 `8f6042a7ff5060b5f4f84684d49f3a4fd48e81270616124467baf0a8815341c9` 与 manifest 一致。
- 真实 Core（Cubism Core 5.1.0，83951616）：
  - 247 参数 / 92 parts / 269 drawables，与独立 `core-inspection.json` 0 mismatch。
  - 有界就绪：MOC 第 2 次尝试约 43ms，Model 第 1 次约 36ms；上限 5s，未把固定 sleep 当保证。
  - `ParamMouthForm` min -2 / max 1 / default -0.5；`ParamMouthOpenY` min 0 / max 1 / default 0。
- CDI：247 条标签，Id 唯一、Name 非空；适配器输出 247 个 label。
- physics：22 个 PhysicsSettings、56 个 Output.Destination；本样本 Destination 全部是单对象格式；56 个 Parameter 输出 ID 全部存在于 Core。
- exp3：44 个表情、105 条参数记录，Blend 全部为 Add；Multiply/Overwrite 由 synthetic 测试覆盖并完整保留。
- motion3：8 组 / 8 个 motion、184 条曲线，全部 `Target=Parameter`；Model/PartOpacity 排除由 synthetic 测试覆盖。
- LipSync 组为空，但 `ParamMouthOpenY` 存在；未把空 LipSync 组解释为嘴部缺失。
- 适配器输出与样本逐项对照：247 参数（id/min/max/default/physicsOutput/label）、44 表情、8 动作、56 个 physicsOutput 全部一致。
- 对输出调用 profile builder 的实测摘要（仅本样本，不硬编码进算法）：
  - 12 available：headX/Y/Z、gazeX/Y、eyeOpenLeft/Right、mouthOpen/Form、browLeft/Right、breath；
  - 3 needs-calibration：bodyX/Y/Z，reason `physics-output`；
  - 0 unsupported；12 条 `standard-id` 映射；4 条资源 warning。
  - `mouthOpen` / `mouthForm` 均 available，parameterIds 分别为 `ParamMouthOpenY` / `ParamMouthForm`。

## 验收矩阵与测试证据

`app/tests/model-inspection-adapter.test.cjs` 共 87 项，真实 DS 用例 0 skipped：

- Core：null/数组/字符串、缺 parameters、count 非整数/负数/超限、四个数组长度错、空/非字符串/重复 ID、NaN/Infinity、min>max、default 越界、4096 边界、零参数、typed arrays、getter throw、Proxy 写入陷阱。
- metadata：request/metadata 非对象与未知字段；cdi/physics undefined/非法树/重复 Id；physics Destination 单对象与数组、缺 Target/Id、未知参数 Id；exp3 缺字段/NaN/非法 Blend/重复 name/空 Parameters/三态 Blend；motion 缺字段/非法 index/重复 group#index/未知 Target/Parameter 与 Model/PartOpacity 区分/去重。
- 限制：1025 资源拒绝；>8 MiB 文档拒绝。
- profile：空签名、未知 override target、非法 channel/direction、重复 channel 均映射 invalid-profile；合法 confirmed override 传入 builder 并保留 reversed；物理输出标准参数降级为 needs-calibration/physics-output；未知资源参数只产生 builder warning。
- 不变性/确定性：深冻结 Core+request、输出与输入不共享可变数组、输入后续修改不泄漏、重复调用结果一致、无 Date.now/Math.random。
- 真实样本：manifest/签名/署名、独立 Core 报告、就绪时限、247 参数/标签/物理输出、44 表情/8 动作/曲线目标、profile 摘要、许可与 NOTICE。

## 验证命令与真实退出码

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node scripts/check-first-wave-contracts.cjs`（根） | 0 | 正样例通过，3 个预期非法形状被拒绝 |
| `node scripts/check-desktop-wave2-contracts.cjs`（根） | 0 | 第二批契约编译通过，3 个非法形状被拒绝 |
| `node --test tests/model-inspection-adapter.test.cjs`（app） | 0 | 87 tests / 87 pass / 0 fail / 0 skipped |
| `npm run typecheck`（app） | 0 | node + web 均通过 |
| `npm test`（app） | 0 | 356 tests / 356 pass（既有基线；本任务测试未注册） |
| `npm run build`（app，默认 TEMP） | **1** | esbuild 删除系统 Temp 文件 `Access is denied`，与代码无关 |
| `npm run build`（app，`TMP/TEMP=app/node_modules/.uta-build-tmp`） | 0 | 主进程、preload、renderer 构建成功；临时目录已清理 |

## 测试注册建议

`app/package.json` 未修改（范围外）。主控可运行：

```
cd app
node --test tests/model-inspection-adapter.test.cjs
```

如需并入 `npm test`，在 `test` 脚本中加入该路径。

## 许可与署名

- 模型资产按 CC-BY-NC-SA-4.0 记录；manifest 与 `MODEL-NOTICE.txt` 均保留。
- 原署名文本保留在忽略的任务样本中（角色：上善无形「溟月」→ ZipZipPipe 女仆鲸鱼娘 → 氵六青 Live2D 化；Live2D 绑定/动作/表情：氵六青；参考项目：Andersen216 / dsh-whale-girl-live2d）。
- `MODEL-NOTICE.txt` SHA256 `f3fbeff85b49c2770f3d776d0bda56cddd693eb50e3979b090cdb04227d29d4b`；未修改、未提交。
- 模型文件、纹理、MOC、资源 JSON 均未进入 Git；源码与资产许可分别记录。

## 未做 / 风险 / 接口说明

- 未接 PIXI/loader/Stage/store/main/preload；真实模型桥接与启动接线由主控后续负责。
- 未做画面、音频、口型、动作播放验收；能力推导与真实 Core 读取不等于视觉/音频通过。
- physics `Destination` 支持单对象和数组；真实 DS 样本是单对象。若未来出现其它结构，需要契约补充。
- CDI 存在但缺少 `Parameters` 时返回 invalid-metadata；本样本有完整 Parameters。若合法模型允许省略该树，需要主控确认“无标签”语义。
- 请求/包装层未知字段采用拒绝策略；CDI/physics/exp3/motion3 文档内部允许未消费字段。
- 8 MiB 由两层执行：适配器检查规范化 JSON，采集器检查原始 JSON 文件字节；纹理/MOC 等非 JSON 不受该 8 MiB 元数据限制。
- 系统 TEMP 下 esbuild 删除临时文件被拒绝，是本机环境风险；任务内 TEMP 可复现通过。

## 现场与进程

- 工作区：干净（结果提交前仅本文件与 progress 收尾改动）。
- 无 Uta 应用/桌宠进程；未使用 `qoder-model-inspection-adapter` runtime profile 启动实例。
- 模型：DeepSeek-Flash；桌面思考/上下文档位不可设置/未验证（未另启 CLI/子 Agent）。
