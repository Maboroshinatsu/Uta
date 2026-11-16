# Antigravity：公开偏好存储内核与显式旧来源导入

本批用户已授权。只在 `D:/Frankenstein/Uta-Workspace/tasks/antigravity-settings-store-core` 开发；确切branch/base/profile与冻结hash见 `.uta-task/assignment.json`。沿用gemini-3.8-flash-high。桌面打开本目录，先读AGENTS、CURRENT、`docs/contracts/desktop-wave2-v1.md`、`docs/workflow/results/settings-migration-design-review.md`，运行 `node scripts/task-handoff.mjs preflight`。不要续写旧设计worktree。

## 目标和范围

实现冻结的 `createSettingsStore(directory): Promise<SettingsService>` 与十二字段规范、串行事务/订阅、原子写/备份、revision、显式导入与冲突。此前UI任务已结束；本项不画UI、不修改Bento方向。

允许修改：

- `app/src/main/settings-store/**`（专属新目录）
- `app/tests/settings-store-core.test.cjs`、`app/tests/settings-store-migration.test.cjs`
- `docs/workflow/progress/settings-store-core.md`
- `docs/workflow/results/settings-store-core.md`

禁止修改：main/index、preload、environment、deskpet store、模型旁车、共享契约、package/lock、公共文档、产品窗口、Qoder目录。不读写真实AppData/浏览器localStorage，不启动Electron/正式实例，不调用桌宠、不改全局插件、不合并/发布。Node内置模块足够，无新增依赖。所有测试只用自己创建的临时目录，失败不得回退正式数据。范围不含测试注册，结果给主控准确注册命令。

## 分步实施

1. preflight与独立npm ci；progress写现场/3–5步计划。先做unknown输入/document校验和无副作用默认值，测试通过小commit。
2. 实现串行事务、read副本、expectedRevision、订阅隔离/取消、close与同进程重复目录保护；再接原子写与备份。
3. 实现导入摘要/receipt幂等、claimedKeys、多来源冲突保留、patch解冲突及容量限制。不得加入旧localStorage/模型旁车读取器。
4. 故障/边界测试、类型检查/全套回归/构建，写result、恢复建议和限制，提交待审。接口缺口写具体复现，不自己减弱冻结约束。

## 必须验收

- 首次只读不落盘；写后重开保留；两个profile隔离；相对路径/缺失目录拒绝，无环境变量回退。
- 字段枚举/数值边界/秘密字段/unknown/prototype/oversize/metadata损坏校验；旧音量0.8不能变80，旧主题导入不能被默认蓝色覆盖。
- 同revision并发patch仅一个成功；no-op/首次claim区别；safe integer耗尽；read/通知数据副本隔离；listener throw/退订/异步重入；失败无通知；close排空不再写。
- 临时写/备份/主rename各阶段故障：原文件不truncate/删除，内存保留已提交版本，无误采用pending，备份确为上一版本。可设计内部可注入I/O边界，不能改factory签名或关闭生产原子写。
- 损坏JSON/非法document/未来schema保留原字节并blocked；有效/无效backup区分；有backup无主文件不能用默认覆盖；I/O失败不写别目录。
- 两来源冲突/来源换序/重复receipt/同源变化/已有值优先/新字段接纳/冲突去重/patch解冲突/容量超限整次回滚。

跨进程多写者、真实迁移、IPC/启动gating/设置窗口未做须明确，不能把测试内核说成全部设置已统一。

## 验证与交付

根：`node scripts/check-first-wave-contracts.cjs`、`node scripts/check-desktop-wave2-contracts.cjs`。app：`node --test tests/settings-store-core.test.cjs tests/settings-store-migration.test.cjs`、`npm run typecheck`、`npm test`、`npm run build`。系统TEMP删除拒绝可只为本命令设TEMP/TMP到本任务app/node_modules/.uta-review-tmp，记录原失败/重试，不改全局ACL/TEMP。

每阶段更新progress并小commit。result列base/head、接口、命令/退出码、故障证据、已做/未做、恢复建议、进程。提交后 `node scripts/task-handoff.mjs submit`，回复待审SHA与结果路径。中断先读progress/git，不reset/clean，同目录仅一个桌面会话。Codex暂不可用只补范围内测试/失败修复，不自行接main/preload/窗口或开始下一任务。
