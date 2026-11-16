# ADR-001：Soullink 纯引擎选型试验

- 状态：Proposed（待 Codex 主控审查）
- 日期：2026-10-23
- 范围：仅本任务 `experiments/soullink-engine/**`，不接产品默认路径，不替换 PIXI，不写真实 Core/模型
- 输入：Soullink 本地受控快照 HEAD `02cd75ac0a085a87d84d1a885f1b33eca8742d53`；DS 鼠控版真实 Core/资源样本（任务内忽略目录）

## 1. 背景

Uta 的 Live2D 方案需要评估：连续情绪、语义通道、模型 Profile、种子化待机、语音节奏与原生资源协调能否由 Soullink 的纯 engine 承担。之前只有源码/结构研究，本轮要求实际构建 public 入口、用真实 DS profile 跑固定场景，再在三条路线中给出有证据的选型。

**口径限制**：本轮 bundle 来自上述本地源码快照，不是官方 npm 发布包；没有 `npm install`、没有下载外部仓库、没有新增第三方依赖。所有“可用”只代表快照源码 + 本机行为测试，不代表官方发布物或服务端上限。

## 2. 决策

**本轮不把 Soullink runtime 接入 Uta 产品默认路径。**

若未来有经批准的产品化任务需要其连续情绪/待机/口型能力，优先路线是 **A：以公共包依赖接入，并由 Uta isolation wrapper 承担 generation/cancel、嘴部最终所有权和白名单过滤**；不推荐直接大规模裁剪移植（B）；自研（C）只吸收 profile 白名单、固定 seed、指数平滑等思想，不复制实现。

本任务只交付隔离实验、可重复脚本和本 ADR，不生成产品接线。

## 3. 证据

### 3.1 路线 A：公共 engine 依赖

| 项目 | 实测 |
| --- | --- |
| 包元数据 | `@soullink-emotion/engine@0.2.0-beta.1`，`type=module`，`sideEffects=false` |
| exports | 仅 `.` 与 `./internal`；public 30 个运行时导出，internal 100 个；public 是 internal 严格子集 |
| 运行时依赖 | 0，peer 依赖 0；源码无外部包 import |
| 类型/构建 | app TypeScript 5.9.3 对快照源码 `--noEmit` 退出 0；app esbuild 0.21.5 构建 public 245,661 bytes / 65 modules |
| 实际导入/运行 | public bundle 被场景脚本实际导入并每帧调用；node tests 26/26 通过 |
| 确定性 | 同 seed/dt 的 300 帧 happy/sad trace 字节一致 |
| 许可 | Apache-2.0；根与 engine LICENSE 同 hash；快照内**没有** NOTICE 文件，也没有可见版权人声明行 |

**成立的能力**：VAD/FACS 连续情绪、hold/decay、idle（呼吸/眨眼/注视/微动/种子化动作）、程序/真实音量口型、native directive 解析、逐参数指数平滑、profile 覆盖诊断。

**关键缺口**（全部实测）：引擎在 `voicePlaybackActive=false` 时强制 `mouthOpen=0`，连 manual FACS、惊讶表情都被清零；无原生 `cancel`/generation；无逐通道 owner/lease/release；native directive 没有播放完成/取消回调；public 不导出 `ModelProfileAdapter`，接入方必须自己构造完整 `ModelProfile`。

**接入成本**：public 入口闭包 65/66 文件、9,220 行；即使只取 runtime 入口也需要 61 文件、8,762 行。依赖公共包不会让代码量变小，但可避免永久 fork。

### 3.2 路线 B：带署名裁剪移植

- Apache-2.0 允许修改与再分发，但需要保留许可证/署名、标注修改，并在存在 NOTICE 时保留；本快照没有独立 NOTICE，也没有可复制的版权人行，移植方需要自行补齐来源与修改记录，不能虚构。
- 裁剪收益有限：runtime 闭包仍 61 个文件；public 已把几乎全部模块拖入，只有 `public.ts`/`index.ts` 等边缘文件可省。
- 需要长期跟随上游修 bug/改协议，并承担与 Uta PIXI6/自定义 channel owner 的适配分叉。
- 结论：除非上游停止维护或必须改内部算法，否则不推荐。

### 3.3 路线 C：参考自研

本轮只实现了“最小线性基线”（同参数数量的指数平滑，不含 VAD/FACS/idle/语音），用于性能对照，不构成完整导演，也不冒充 Soullink 行为。

- 基线开销 median 0.0008ms、p95 0.0014ms（同 12 参数）。
- Soullink 引擎 median 0.0429ms、p95 0.0982ms；差额对应真实功能，而不是无意义开销。
- 自研要达到同等能力（VAD/FACS 表、idle 调度、防重复、口型、profile 映射、native 协调）工作量远大于本实验，且需要 Uta 自己的验收素材。
- 结论：短期不建议“从零复刻整套”；可参考其 profile/seed/平滑思想，在 Uta 自有通道 owner 内小步实现。

## 4. 真实 DS 基准结论

- Core 5.1.0 实读 247 参数/92 parts/269 drawables，与冻结报告 0 mismatch；44 表情、8 动作；读取后已 release。
- 12 通道 available：headX/Y/Z、gazeX/Y、eyeOpenLeft/Right、mouthOpen、mouthForm、browLeft/Right、breath。
- bodyX/Y/Z 因 56 个物理输出保持 needs-calibration，本实验不驱动。
- `ParamMouthForm` [-2,1]/default -0.5、`ParamMouthOpenY` [0,1]/default 0；桥接保留真实 min/max/default，不强制对称或默认 0。
- 原表情/motion 未映射到 DS 真实资源；动作生命周期场景使用自有合成 map，仅验证引擎 directive 机制。

## 5. 后果与约束

1. 不新增依赖、不改 app/plugin/lock/main；本轮只有实验代码和文档。
2. 若未来走路线 A，必须保留 Uta wrapper 作为唯一 generation/cancel/最终嘴部 owner：
   - 引擎嘴部 gate 与“无语音惊讶张嘴”冲突，不能把引擎规则直接当 Uta 默认；
   - 取消后由 wrapper 在 180ms（可配）内回到模型默认值，旧 generation 必须拒收；
   - 输出必须先过真实参数白名单、finite、范围、物理输出检查；私有/未确认参数默认不驱动；
   - 不得与旧 `useMotionPriority`/表情脉冲同时写同一通道。
3. 原生 exp3/motion 接入需要独立资源策展与完成/取消策略，不在本 ADR 授权范围。
4. 本结论不改变 Uta 代码许可或模型 CC-BY-NC-SA-4.0 许可；若集成 Apache-2.0 代码，需按 Apache-2.0 保留 LICENSE/署名/修改记录，并单独记录模型资产许可。
5. 未验证：官方 npm 发布物、GUI/画面/音频/TTS、物理反馈、跨机器性能、120Hz、真实宿主链路。

## 主控审查补充：映射方向边界

Codex复现原实验driver忽略confirmed reversed方向后，改为显式排除所有非normal映射并提供unsupported-direction诊断，避免给出相反动作。当前DS标准映射不受影响。现有实验不是完整校准适配器；接入反向rig前须另做逐通道、非对称范围与neutral一致的转换测试。此修正不代表Soullink原生不支持变换，而是Uta实验桥的实现边界。

## 6. 复现

```bash
# 工作目录：experiments/soullink-engine
node scripts/verify-inputs.mjs
node scripts/build-engine.mjs
node scripts/analyze-surface.mjs
node --test test/*.test.mjs
node scripts/run-experiments.mjs
```

原始结果写入忽略目录 `.uta-task/soullink-runs/latest.json`；构建/表面报告在 `.uta-task/soullink-build/`。需要任务内 `.uta-task/reference-inputs` 与 `.uta-task/model-input` 才能复现真实样本部分。
