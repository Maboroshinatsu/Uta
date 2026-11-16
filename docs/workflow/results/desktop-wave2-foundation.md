# 桌面第二批：接口、模型基准与交接准备

日期：2026-10-23；Codex任务区 `codex-desktop-wave2-foundation`，分支 `task/codex/desktop-wave2-foundation`，起点 `5d3274a4bfbec9f972bdca9957b5d6502dd353aa`。本文件所在提交及其后主控操作日志为精确head依据；Worker base在各自assignment中，不能直接沿用此起点。

## 已完成

- 用户授权后冻结第二批shared契约、compile fixtures与行为规范；预留settings IPC命名但不注册handler。Node composite项目显式纳入shared目录，避免后续main引用时报include错误。
- 十二字段公共偏好存储内核派Antigravity；真实raw Core参数/资源转换派Qoder。任务和progress已入仓库；桌面启动状态以任务本地回执为准，不把“准备好”写成正在运行。
- DS原目录只读，声明引用资源加原署名冻结为仓库外快照；模型和个人预设未入Git。快照59文件/4,141,300字节，44表情/8动作。Core真实检查247参数/92parts/269drawables；嘴形范围不对称，空LipSync组不等于没有嘴部参数。详细许可/署名/分发要求见 `docs/models/ds-control-baseline.md`。
- 新桌面hub目标 `D:/Frankenstein/Uta-Workspace/handoffs/desktop-wave-2`。其中assignment/base/hash/profile/preflight、独立npm依赖与Qoder模型副本由主控准备；真实创建结果另在operations/desktop-wave2-foundation/completion.json登记。

## 验证

- 本任务独立 `npm ci --no-audit --no-fund` 成功。
- 两批contracts检查通过（第二批含三种应拒绝的编译形状）；这只是类型检查，运行时unknown校验由Worker实现/测试。
- app `npm run typecheck` 成功；`npm test` **356/356**通过，无skip。
- app `npm run build` 成功，TEMP/TMP仅对该命令设为任务内node_modules/.uta-review-tmp；现有Core script/旧CJS提示不影响退出码。
- 无插件改动，未重复插件测试；未做新设置store实现、IPC/renderer接线、GUI动作/口型、真实迁移或新ZIP验收。

## 现场与下一步

本任务无新监听服务/桌面Worker进程。旧9292预览不属于本任务，不按历史PID清理。原主目录四份已有脏文档不纳入本提交：AGENT-PORTABILITY-PLAN、IMPLEMENTATION-P2-L0、ITERATION-ROADMAP-2026-10-13、design/blue-block-design-spec。

先由用户在两个桌面应用打开新任务目录并粘贴hub启动文件。Worker小commit/进度/result/submit后，Codex核对实际git与测试、在隔离集成区审查合并，再做主进程/窗口/模型桥接。Soullink选型是未armed独立后继，不让Worker在旧分支扩范围。日常ZIP/正式数据/stable登记保持不变，新增契约不表示当前exe已具备新控制能力。
