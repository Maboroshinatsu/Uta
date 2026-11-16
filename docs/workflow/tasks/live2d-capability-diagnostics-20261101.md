# Live2D 能力事实与只读诊断

日期：2026-11-01  
状态：已完成
工作目录：`D:/Frankenstein/Uta`  
分支：`main`  
基线：`8791928025490ca2e803ed1bc6c96d128d223540`

## 目标

补齐 Uta 已有模型 inspection 的动作资源事实，并输出只读诊断，作为后续统一意图解析和表演谱编译的可信输入。

本轮不改播放，不做设置 UI，不生成默认表演谱，不修改日常模型、设置或宿主安装。

## 实施范围

1. 向后兼容扩展模型能力契约。旧的 `schemaVersion: 1` 输入仍可读取，新 inspection 为每个动作导出：
   - `durationMs` 与 motion3 `Meta.Loop` 声明；
   - `Parameter`、`Model`、`PartOpacity` 三类曲线各自的曲线数量和去重目标 ID；
   - 继续保留旧 `parameterIds` 兼容字段。
2. 输出只读诊断：
   - 多个情绪或动作语义共用同一原生 motion；
   - adapter 引用缺失的动作、表情或参数；
   - 情绪参数与口型张嘴参数重叠；
   - 动作资源尚缺语义画面验收。资源复用本身是待验收项，不直接判错。
3. 诊断输入区分模型运行时/Core 事实、磁盘资源事实和 adapter 声明，不把静态文件检查描述成画面验收。

## 验收

- Hiyori `Tap[1]` 导出 `2100 ms`、`loop: true`、33 条 Parameter 曲线、2 条 PartOpacity 曲线，并分别提示 `happy`、`wave`、`cheer` 共用该资源且仍需逐语义画面验收。
- 大肥鱼按当前日常模型实物验收：若模型没有 motion，则不得把 adapter 声明的 `IDLE` 误报为可用；`wave` 没有绑定；写入 `ParamMouthOpenY` 的情绪报告为说话时可能与口型争用。
- 相关单元测试、Node/Web 类型检查通过；真实导出来自隔离运行实例，不写日常 profile。

## 完成记录

- 实现提交：`29f29df`；导出入口与规范：`a43ca9a`。
- 真实结果见 [实施结果](../results/live2d-capability-diagnostics-20261101.md)。
- 真实大肥鱼目录当前没有任何 motion；原“IDLE 可用”前提已由运行时证据纠正，不降低为通过。

## 现场与交接要求

- 每个阶段形成小提交。
- 最终更新 `docs/workflow/CURRENT.md` 与 `docs/workflow/HANDOFF.md`，记录提交、测试、真实模型来源、隔离 profile、进程状态、未验证项和下一步。
