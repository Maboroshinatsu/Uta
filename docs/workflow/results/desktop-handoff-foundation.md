# 首批接口冻结与桌面任务交接

日期：2026-10-23。用户授权本批准备和任务实施，明确Qoder/Antigravity使用桌面应用。Codex主控在独立worktree完成基础，产品旧运行路径和日常exe不变；不从CLI自动启动实施Worker。

## 已交付

- 纯类型契约`uta-desktop-wave-1`：模型检查输入/能力输出、表现意图/诊断快照、语音UI fixture。无网络/磁盘/渲染/持久化执行。
- 合成fixture：标准参数、缺能力、私有参数/反向人工映射、思考意图、空闲快照、语音示例；三个非法shape编译拒绝。
- 明确优先级/数值/资源/失败语义的契约文档；这是C01本批子集，未冻结生产settings/window全部接口。
- 两项桌面任务单：Qoder“模型能力识别纯模块”和Antigravity“蓝色组件与语音代表页”；允许范围、真实检查、提交与停止点齐全。
- 各任务progress入口、文件交接规范、本机assignment/启动说明与Codex续接入口。当前Worker状态为prepared-awaiting-desktop-start。
- `scripts/task-handoff.mjs`：preflight/status/checkpoint/submit。校验目录、branch、base祖先、契约hash和diff路径；submit拒绝脏工作树/空实现/缺结果。仅回执，不运行检查、不调度、不代主控验收。

## 验证

- 本任务app独立npm ci，无共享node_modules；未改lock。
- `node scripts/check-first-wave-contracts.cjs`：通过，正fixture及3个预期非法shape检查。
- `npm run typecheck --prefix app`：node/web通过。
- `node --check scripts/task-handoff.mjs`：通过。
- `node --test scripts/tests/task-handoff.test.cjs`：1项场景通过，覆盖目录/branch/hash/范围拒绝、LF/CRLF一致、checkpoint与clean submit、缺结果/脏工作区拒绝。
- 本批新类型没有接入产品执行路径；未跑完整应用/插件测试或真实GUI/音频，不冒充新产品验收。

模型能力的坏JSON/范围/不变性等运行时测试由Qoder实现；语音代表页/截图/模拟流程由Antigravity实现。本轮尚未交付两项Worker代码。

## 现场与交接

基础任务目录`codex-desktop-handoff-foundation`，基线`87e976dd927683948f31974f7ca01a035ffbfc31`。主控提交/合并后建立两新worktree，确切提交及契约hash写各自`.uta-task/assignment.json`和仓库外operations/assignments，不用浮动main。用户总入口位于`D:/Frankenstein/Uta-Workspace/handoffs/desktop-wave-1/README.md`。

主目录三份既有脏文档不暂存/提交；参考仓库不改；不装真实平台插件、不启动日常Uta、不占用9292。已有9281线框服务不是本轮新Worker产品预览。未来应用运行须显式使用assignment里的profile/env。

Codex回来从桌面总入口读取实际progress/result/git再审，不按本文件的准备态推断任务仍未启动。每个目录同时一个开发会话，脚本没有自动互斥/心跳；桌面旧插件隔离也未因此解决。
