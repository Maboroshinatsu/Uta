> 整批收尾更新（2026-10-23）：同批Antigravity设置接入也已补正并通过源码验收，见 [设置接入审查](settings-runtime-integration-review.md)。本文末尾“仍执行/监听继续”是当时现场，当前以CURRENT为准。

# CLI第三批：Soullink纯引擎试验审查

日期：2026-10-23；Codex在`codex-cli-wave3-review`独立worktree/profile审查。base为`b8c87c262e98f2d36878bff2561f46112298c9a1`；Qoder候选head `938a4d59f9b3c56ec226ceca36d42ce8a58e7956`，preflight通过、干净、冻结接口/改动范围正确。候选先合入验收分支，原Worker分支未改。

结论：**补正后接受隔离试验交付**，保留“暂不进入产品默认路径”的裁决。公开engine可运行，但不直接承担完整Uta导演/渲染控制。Qoder原result是候选自测，本报告是主控独立复验；精确集成提交见本文件所在commit与operations/cli-wave3-monitor的审查回执。

## 主控发现与修正

原driver检查confirmed但不检查mapping.direction。用原Worker代码设置headX的confirmed reversed后，实际仍将ParamAngleX加入白名单并使用add规则，方向被静默忽略。主控改成所有非normal映射显式排除，诊断unsupported-direction；如果全部映射不可用，返回带诊断的BridgeError。新增2项行为回归，并在README/ADR写明这是实验桥实现边界，不能声称Soullink不支持反向变换。没有给生产控制器增加未冻结的变换策略。

只修实验代码与文档，未改app/plugin/shared/依赖/lock或Worker工作区。DS当前标准normal通道的结果不变。眼睛/眉毛合并映射等通用rig语义仍需后续独立校准，不能因DS通过就保证任意模型表现正确。

## 独立验证

本验收区独立npm ci成功。从主控DS冻结快照和Qoder受控参考输入复制到本任务忽略目录；重新构建产物，不复用Worker的bundle/结果。构建前确认递归清理的绝对目标仅为本验收区`.uta-task/soullink-build/engine-src`。未向AppData或原参考仓库写入。

- `npm run build`（experiments/soullink-engine）：退出0；88文件/411,844字节sha校验、来源commit、LICENSE通过；TypeScript noEmit通过，public/internal/adapter构建成功。公开导出30、internal100；public bundle245,661字节/65模块。自建快照bundle，不是官方npm发布物。
- `npm test`（同实验目录）：**28/28、0skip**，含4项真实DS测试及2项主控方向补测。
- `node scripts/run-experiments.mjs`：退出0，synthetic7/7与real7/7通过；真实DS参数247/parts92/drawables269、44表情/8动作与hash匹配，Core释放。输出仅12个已确认非物理目标，body三通道不驱动；原生动作场景用合成映射，不声称DS资源已完成视觉策展。
- 两批check-contract脚本通过；Core inspection/profile相关测试 **150/150、0skip**。无产品代码改动，未重复全app构建/插件测试。
- 主控本次10,000帧测得engine+wrapper median0.0678ms、p950.1218ms；最小线性基线median0.001ms、p950.0016ms。不同于Qoder单次采样，说明数值有波动；方法只表征本机CPU实验，不保证渲染总帧时间/分配/跨机性能。

原始主控结果：`D:/Frankenstein/Uta-Workspace/tasks/codex-cli-wave3-review/.uta-task/soullink-runs/latest.json`，本次sha256 `4eb73041eb4653df74762727d3688313abf62d274d115692ac637d34badc5c86`。模型资产/参考源/产物不入Git。

## 采用边界与现场

已实际复现无语音时mouthOpen强制归零，即使manual FACS请求张嘴；这是与Uta非语音表情需求的明确冲突。generation/cancel/release由Uta wrapper提供，不是engine原生能力；逐通道owner、native动作完成/取消、音频时钟和真实画面均未验。后续若采用public依赖，须先解决这些接缝，不直接移入PIXI7或绕过原控制权方案。未授权新的runtime/mixer实现。

Qoder真实CLI会话已正常退出，无对应CLI进程；原任务保留审计。验收命令均已结束，无新常驻端口。Antigravity设置接入任务仍由独立CLI执行，未收取其变化，也不将本次试验接受当成整批验收。正式设置/模型、stable与日常ZIP不变；主目录四份既有脏文档保留。监听继续，待另一项完成后由Codex接管文件测试/提交。
