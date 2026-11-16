# Qoder：模型能力识别进度

主控更新：原候选0814bfd已审查，shared include在集成分支修正，语义问题已裁决，源码集成通过。见 [主控结果](../results/desktop-wave1-review.md)。下面保留Worker原始交接；其“进行中/配置阻塞”不再代表合并后现场。

状态：implemented-pending-review（2026-10-23；纯模块与行为测试完成，存在一项范围外配置阻塞和两项待主控确认的语义判断；不等于 Q04/C02 完成）。

## 现场与模型设置

- 工作目录：`D:\Frankenstein\Uta-Workspace\tasks\qoder-model-capability-core`
- 分支：`task/qoder/model-capability-core`
- base / 启动时 head：`edca60b8f7f31dbbac4d607a4bb4e6ca64102bfe`
- dirty：false；profile：`qoder-model-capability-core`
- preflight：`node scripts/task-handoff.mjs preflight` 退出码 0，`checkedAt=2026-10-23T08:18:32.178Z`
- 模型：**DeepSeek-Flash**（启动说明固定）。桌面可见的“思考/上下文”选项：**不可设置/未验证**——本会话无法读取或修改桌面模型 UI，未另启 CLI、未开子 Agent、未把 CLI 参数当作桌面已生效。
- 契约 hash 复核：工作区因 `core.autocrlf=true` 为 CRLF；按 LF 规范化后三个文件 SHA256 均与 `.uta-task/assignment.json` 的 `contractHashes` 一致，契约内容未被改动。

## 计划与状态

1. [x] preflight、契约 hash 复核、记录现场与模型设置。
2. [x] 实现 `buildModelCapabilityProfile`：严格校验、15 通道映射/降级、原生表达式/motion 保留与 warning，附模块 README。
3. [x] 补行为测试（三份 fixture、坏输入矩阵、冻结/确定性/输出隔离）。
4. [x] 已运行全部验证并记录；官方 `npm run typecheck` 因范围外 tsconfig include 阻塞（见下）。
5. [ ] 写 results、最终提交、`task-handoff submit`（进行中）。

## 已完成

- 阅读根 AGENTS.md、`.uta-task/assignment.json`、任务单、`docs/contracts/first-wave-v1.md`、本 progress、fixture。
- 只读参考 `app/src/renderer/services/live2d/loader.ts` 的 `ParameterInfo`/`getParameterInfos` 与 `emotion-adapter.ts` 旧语义，未修改。
- 新增 `app/src/renderer/services/performance/profile/index.ts`：纯校验 + 15 通道映射/降级 + 原生资源保留/warning。
- 新增同目录 `README.md`：输入约束、校验表、优先级、降级与 warning 语义。
- 新增 `app/tests/model-capability-core.test.cjs`：56 个行为用例，覆盖三份 fixture、全 15 通道、标签/override 优先级、物理输出/零范围、坏输入矩阵、资源 warning、深冻结、输出隔离与确定性。
- 未修改 loader、emotion-adapter、Stage、store、shared 契约、package.json/lock、其他任务或 main；无 Uta 应用/桌宠进程。

## 检查结果（最终代码，2026-10-23）

- 根契约检查：`node scripts/check-first-wave-contracts.cjs` → 退出码 0（正样例通过，3 个预期非法形状仍被类型拒绝）。
- 本模块测试：`node --test tests/model-capability-core.test.cjs` → 退出码 0，56/56 通过。
- 单文件严格类型检查：`tsc --noEmit --strict ... profile/index.ts` → 退出码 0。
- 官方类型检查：`npm run typecheck` → 退出码 2。`typecheck:node` 通过；`typecheck:web` 报 `TS6307`：`profile/index.ts(18,8)` 引用的 `app/src/shared/first-wave-contracts.ts` 不在 composite 项目 `tsconfig.web.json` 的 include 内。临时把 `"src/shared/**/*.ts"` 加入 include 后同一命令退出码 0；该临时改动已原样还原，未提交。
- 构建：`npm run build` 默认 TEMP 下退出码 1，失败点为 esbuild 删除系统 Temp 临时文件 `Access is denied`（与模块无关，模块尚未被入口 import）；把 TEMP 指向 `app/node_modules/.uta-build-tmp` 后退出码 0，主进程/preload/renderer 全部构建完成。临时目录已清理。

## 剩余问题

1. **[范围外配置] web typecheck 阻塞**：`app/tsconfig.web.json` 是 `composite: true` 且 include 只有 `src/renderer/**`；任何 renderer 模块引用共享契约都会触发 TS6307。建议主控在该 include 追加 `"src/shared/**/*.ts"`（或改为项目引用）。执行会话因 submit 会拒绝范围外文件，未自行提交此改动。
2. **[接口语义待确认] 未确认 override 的优先级**：按契约“先取已确认 override → 标准 ID → 标签建议”，实现为未确认 override 仅在无任何其他来源时兜底为 `needs-calibration/unconfirmed`，不抢占可用的标准映射。若主控要求未确认 override 也优先，需要明确语义。
3. **[接口语义待确认] 零范围降级的 reason**：契约的 `reason` 联合类型没有零范围专用值，当前用 `ambiguous`；若希望区分，需要变更共享契约。
4. **[环境] 默认 TEMP 下 build 失败**：esbuild 临时文件删除被拒绝，需本机 `TEMP/TMP` 指向可写目录；不是代码缺陷。

## 最近提交

- `c48141a` docs(workflow): start model capability core progress
- `2f4ce83` feat(profile): add pure model capability profile builder
- `88d7837` test(profile): cover validation, degradation and determinism
- results 与本次进度更新随后提交，最终 head 见 submit 回执。

## 所属进程

- 无 Uta 应用/桌宠进程；仅 Qoder 桌面开发会话。
