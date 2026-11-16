# 结果：Soullink 纯引擎选型与 DS 基准试验

状态：**已提交待主控审查**。不代表 Codex 已验收，也不代表产品接线、PIXI 替换、GUI/音频或真实宿主链路通过。

## 交付信息

- 任务：`soullink-engine-spike` / `docs/workflow/tasks/soullink-engine-spike.md`
- owner：Qoder；executionMode：CLI
- 工作区：`D:/Frankenstein/Uta-Workspace/tasks/qoder-soullink-engine-spike`
- 分支：`task/qoder/soullink-engine-spike`
- base：`aba335d914fac58cc2c35fa0e7fc40e139fa51f3`
- 交付 head（本结果文件提交前）：`0bb2285`
- 最终 head：以 `node scripts/task-handoff.mjs submit` 回执与 `git log` 为准（本结果提交后即为最终 head）
- profile：`qoder-soullink-engine-spike`
- 模型请求：DeepSeek-Flash，显式请求 max 思考与 1,000,000 上下文；**CLI 未回传实际生效档位/窗口，不声称已验证**，未回退 Auto。
- 提交：
  - `56aa01d` feat(experiments): build pinned Soullink public engine surface
  - `6302de8` feat(experiments): bridge public engine output to Uta profile whitelist
  - `0bb2285` test(experiments): add deterministic engine scenarios and CPU baseline
  - 本条结果/ADR/progress 收尾提交

## 改动文件

只改任务允许范围：

- `experiments/soullink-engine/**`：实验 driver/adapter/合成 fixture/场景/断言/基准脚本/测试/ADR/README。
- `docs/workflow/progress/soullink-engine-spike.md`
- `docs/workflow/results/soullink-engine-spike.md`（本文件）

未改 `app/**`、`plugin/**`、依赖、lock、shared/冻结契约、现有算法、主分支、公共文档或其他任务。外部源码快照、构建产物、真实模型与原始运行结果都在忽略的 `.uta-task/**`，未入 Git。

## 输入与签名

- Soullink 受控快照：本地 HEAD `02cd75ac0a085a87d84d1a885f1b33eca8742d53`，88 文件/411,844 bytes，逐文件 sha256/size 全部匹配；manifest sha256 `f949b9807ea4e22d64041c42f3e4d1dfa009760307705f12e3fce57d00f7719a`。原库脏 `package-lock` 未复制、未修改。
- 许可：根/engine LICENSE 均为 Apache-2.0，sha256 `9838629be61bce3130144bc684e0579f687a3cddd024f67de5340a4f25cc5626`；快照内无独立 NOTICE（`standaloneNoticeFound=false`），未虚构版权人。
- DS 真实样本：任务内忽略 `.uta-task/model-input`；manifest 59 文件/4,141,300 bytes，逐文件 hash 匹配，内容签名 `8f6042a7ff5060b5f4f84684d49f3a4fd48e81270616124467baf0a8815341c9`；`MODEL-NOTICE.txt` sha256 `f3fbeff85b49c2770f3d776d0bda56cddd693eb50e3979b090cdb04227d29d4b`。
- 真实 Core（Cubism Core 5.1.0，83951616）：247 参数 / 92 parts / 269 drawables，与冻结 `core-inspection.json` 0 mismatch；44 表情 / 8 动作。用已合并 `inspectCoreModel` + `buildModelCapabilityProfile` 生成可信输入，读取后 `release()` 并断言已释放。
- 未访问模型 manifest 记录的 AppData 源路径，未写真实模型/设置；未读取凭据/端点 token。

## 公开入口与构建口径

public 入口从快照源码实际构建并运行，使用 app 已安装 TypeScript 5.9.3 / esbuild 0.21.5；TEMP/TMP 指向任务内 `.uta-task/tmp`。

- `@soullink-emotion/engine@0.2.0-beta.1`：`type=module`、`sideEffects=false`、运行时/peer 依赖 0；exports 仅 `.` 与 `./internal`。
- public 导出 30 个运行时符号，internal 100 个；public 是 internal 严格子集。`ModelProfileAdapter`、`LipSyncController`、`LayeredParameterMixer`、`MotionMixer`、`RuntimeExpressionGenerator` 等只在 internal。
- public bundle：245,661 bytes / 65 input modules；internal：249,326 bytes / 64；Uta Core inspection/profile adapter：38,466 bytes / 3。
- public 源码闭包 65/66 文件、9,220 行；仅 runtime 入口也要 61 文件、8,762 行；无外部包 import。
- **口径**：这是本地快照源码自建 bundle，不是官方 npm 发布包；未 `npm install`、未发布、未下载外部仓库。实验调用方不导入 `/internal`；internal bundle 只用于表面比较。

## 实现内容

- `src/driver.mjs`：Uta 自有中立 driver，把首批 `ModelCapabilityProfile` 转成 Soullink `ModelProfile`（schemaVersion 2）。
  - 只映射 `available` + `confirmed` + 参数存在 + 非物理输出 + 范围有效的通道；缺失/未确认/物理输出记录为 skipped。
  - `ParamMouthForm` 用真实 min/max/default 生成 mouthSmile 加向 max、mouthFrown 减向 min 两个贡献；默认 -0.5 保留，不按 0 归一化。
  - 输出白名单只含已确认目标；私有参数（如 `ParamCheek38`）不进入驱动；输出逐帧检查 finite、范围、物理输出。
  - wrapper 自有：generation 拒收旧 update/trigger、cancel 后 180ms（可配）release tail、action handle generation 校验、voice/audio analyzer 状态。
- `fixtures/capability-profiles.mjs`：自有合成 fixture（完整/缺参数/物理输出/私有参数/原生 map）。
- `src/scenarios.mjs`、`src/benchmark.mjs`、`scripts/run-experiments.mjs`：固定 seed/dt 场景、CPU/输出指标、最小线性基线。
- `src/real-profile.mjs`：只在 Node 侧读取任务内真实样本，使用已合并适配器，结束释放 Core。
- `ADR-001-engine-selection.md`：三路线对比与选型建议。

## 场景与实测结果

synthetic 7 项 + real DS profile 7 项全部通过；real 的 action 场景只使用自有合成 expression/motion map 验证引擎机制，**不声称 DS 的 44 表情/8 动作已映射或画面可用**。

| 场景 | 实测摘要 |
| --- | --- |
| neutral→正/负情绪渐变、hold、衰减 | happy valence 峰值 0.6015、3s hold 0.6007、10s 衰减 0.2630；sad 峰值 -0.5213、hold -0.5206、衰减 -0.2279。mouthForm happy 最高 0.5548、sad 最低 -1.3732，均在 [-2,1] |
| 无语音惊讶张嘴 | 引擎强制 mouthOpen=0（surprise max=0）；manual FACS 0.9 仍为 0；voice active 时最大 0.5977；静音末值 0.000378；voice 结束 2.3e-9。确认为引擎原生 gate 缺口，wrapper 不覆盖 |
| 语音中静音/结束/取消 | 说话最大 0.5977；静音末值 <0.01；结束 <1e-4；cancel 后 wrapper release tail 最终 released、mouthOpen=0、旧 action 清除 |
| 动作替换/释放/旧 generation | happy→sad directive token 递增，旧 action handle 立即 stale；cancel 清空 action；generation 切换后旧 update/trigger 返回 stale 且不输出旧值 |
| dt=0/1/60/100ms/2.5s | dt=0 maxStep=0；其余全部 finite/白名单/范围内；2.5s 单步最大变化 2.479，指数平滑饱和未越界；不是帧率保证 |
| 确定性 | 同 seed/dt 的 300 帧 happy/sad trace 字节一致；happy sha256 `f41fdd44f1493c1557b6f9f7488ea9e9759fcd5144ce54421434662519caf504`，sad `4f82a46f337647315f6199d051cce30d4e6469c1c559b7462adb4f3c03ced3b7` |
| 缺参数/私有/物理/非对称嘴形 | synthetic 6 目标、real 12 目标可输出；body/ParamCheek38 从不出现；neutral mouthForm=-0.5；白名单丢弃/物理丢弃/非有限丢弃均为 0（引擎未越界） |

真实 DS profile：12 available（headX/Y/Z、gazeX/Y、eyeOpenLeft/Right、mouthOpen/Form、browLeft/Right、breath）；bodyX/Y/Z 因 56 个物理输出 needs-calibration，未驱动；`ParamMouthForm` [-2,1]/default -0.5，`ParamMouthOpenY` [0,1]/default 0。

## 性能近似指标

真实 DS profile；Node v24.14.0（实际 CLI 环境，非环境说明中的版本号）；Win32 x64；AMD Ryzen 5 5600，12 logical cores；1000 帧 warm-up + 5×2000 帧；dt=1/60；`process.hrtime.bigint` 包围单次 `session.update`：

| 实现 | median | p95 | p99 | mean | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Soullink public engine + Uta wrapper | 0.0429ms | 0.0982ms | 0.1932ms | 0.0540ms | 0.596ms |
| 最小线性基线（同 12 参数） | 0.0008ms | 0.0014ms | 0.0033ms | 0.0010ms | 0.4344ms |

- 引擎 5 批 median：0.0405–0.0463ms；基线 0.0006–0.0010ms。
- 输出近似：12 参数，平均 415.02 bytes JSON/帧（基线 420.67）；每帧白名单/物理/非有限丢弃均为 0。
- heap/RSS 差值受 JIT/GC 影响，仅作近似记录，不作分配保证。
- **方法限制**：单进程、无 CPU 固定、无 GC 控制；只代表本机本次采样，不是性能保证；未测 120Hz/GPU/渲染总帧时间。
- 原始结果：`.uta-task/soullink-runs/latest.json`，本轮 run sha256 `0a215f49ecb5e65e4d30574de8b36313f15712b5eb5dced039929f9d73938972`。

## 三路线结论

详见 `experiments/soullink-engine/ADR-001-engine-selection.md`，摘要：

- **A 公共 engine 依赖**：快照 public API 实际可构建、可运行、确定性好、无运行时依赖；但必须配 Uta wrapper 解决嘴部 gate、cancel/generation、通道 ownership 和原生动作生命周期。若未来产品化，优先此路线。
- **B 带署名裁剪移植**：runtime 闭包仍 61 文件/8,762 行，裁剪收益小；Apache-2.0 需保留许可/署名/修改记录，且快照无 NOTICE/版权人行；不推荐直接移植。
- **C 参考自研**：本轮只实现最小线性基线，不构成完整导演；不建议短期复刻整套，可吸收 profile 白名单、固定 seed、指数平滑等思想。
- **本轮决定**：不进入产品默认路径，不新增依赖，不替换 PIXI，不自动进入 mixer/renderer 接线。

## 许可与署名

- Soullink 代码 Apache-2.0；根/engine LICENSE 保留，快照无 NOTICE 文件；未发现可复制的版权人行，未虚构。若未来集成，需按 Apache-2.0 补 LICENSE/署名/修改记录，并单独记录 Uta 修改。
- DS 模型 CC BY-NC-SA 4.0：保留原 `MODEL-NOTICE.txt` 与署名（上善无形「溟月」→ ZipZipPipe 女仆鲸鱼娘 → 氵六青 Live2D 化；Live2D 绑定/动作/表情：氵六青；参考项目 Andersen216 / dsh-whale-girl-live2d）。模型资产、个人设置、纹理/MOC/JSON 未入 Git；未修改模型。
- 本实验代码不改变 Uta 代码许可或模型许可。

## 验证命令与真实退出码

| 命令 | 工作目录 | 退出码 | 结果 |
| --- | --- | ---: | --- |
| `node scripts/task-handoff.mjs preflight` | 任务根 | 0 | branch/base/范围/契约 hash 通过，dirty=false |
| `node scripts/verify-inputs.mjs` | `experiments/soullink-engine` | 0 | 88 文件/411,844 bytes 逐文件 hash、sourceHead、LICENSE 通过 |
| `node scripts/build-engine.mjs` | `experiments/soullink-engine` | 0 | tsc `--noEmit` 通过；public/internal/adapter bundle 成功；TEMP 任务内 |
| `node scripts/analyze-surface.mjs` | `experiments/soullink-engine` | 0 | exports/许可/闭包报告生成 |
| `node --test test/*.test.mjs` | `experiments/soullink-engine` | 0 | 26/26 通过（含 4 项真实 DS） |
| `node scripts/run-experiments.mjs` | `experiments/soullink-engine` | 0 | synthetic 7/7 + real 7/7；基准写入忽略目录 |
| `node scripts/check-first-wave-contracts.cjs` | 任务根 | 0 | 首批契约/3 个非法形状拒绝 |
| `node scripts/check-desktop-wave2-contracts.cjs` | 任务根 | 0 | 第二批契约/3 个非法形状拒绝 |
| `node --test app/tests/model-inspection-adapter.test.cjs app/tests/model-capability-core.test.cjs` | 任务根 | 0 | 150/150 通过，0 skipped |
| `git diff --check` | 任务根 | 0 | 收尾提交前检查通过 |

未运行无关全 app 构建；未启动 GUI/桌宠/长期服务。

## 缺口、风险与未验项

- 引擎嘴部 gate：无语音时 `mouthOpen` 永远为 0，惊讶张嘴/手动口型需 Uta 自己决定是否在 wrapper 中绕过；本实验选择不绕过并记录。
- 无原生 cancel/generation/逐通道 owner/release；当前 release tail 与 generation 均为 Uta wrapper 行为，不是 Soullink 自带。
- native directive 只表示资源切换，不表示播放完成/取消；DS 44 表情/8 动作未映射，不能在产品中直接宣称可用。
- public 不导出 `ModelProfileAdapter`，接入方必须自己维护 profile 转换；公共入口会拖入 65 个模块。
- 未验证官方 npm 发布物、浏览器/Electron/PIXI 实际接线、真实语音/TTS、物理反馈、画面、GPU 总帧时间、120Hz、跨机器性能。
- 性能数字是单机单次采样，不构成保证；heap/RSS 差值不可作为分配结论。
- 本实验没有写真实 Core/模型/AppData，也没有启动 Uta 实例；无 GUI 证据。

## 现场与进程

- 本任务没有常驻进程、监听端口或后台服务；验证命令均已退出。未调用桌宠 MCP、浏览器、网络服务、消息工具或子 Agent。
- 未修改/停止其他任务进程；未合并 main、未发布/安装插件、未修改全局配置。
- 构建、测试与临时文件均在任务内 `.uta-task/**`（Git ignored）；工作区提交后保持干净。

## 下一步（需主控决定）

1. Codex 审查本 ADR/结果与实验代码，确认是否接受“本轮不接入产品默认路径”的结论。
2. 若未来批准路线 A，另开窄任务：Uta wrapper 作为唯一 generation/cancel/嘴部 owner；先做无 GUI 的纯模块/行为验收，再做开发 profile 单模型接线。
3. 原生 exp3/motion 策展、真实 TTS/音频时钟、物理反馈与 GUI 验收分别安排，不并入本任务。
