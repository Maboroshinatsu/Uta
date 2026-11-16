# CLI第三批：定向派单记录

日期：2026-10-23。用户明确改为“直接通过CLI发任务”，本批不需要再手动粘贴桌面提示。冻结基线 `aba335d914fac58cc2c35fa0e7fc40e139fa51f3`；主控独立区 `codex-cli-wave3-foundation`。仅新增契约与派单文档，node/web类型检查通过；上一批490测试结论不冒充本批尚未完成的实现验收。

## 已投递的真实任务

| 平台 | 新工作区 | 实际会话ID | 模型/模式 |
| --- | --- | --- | --- |
| Qoder | `D:/Frankenstein/Uta-Workspace/tasks/qoder-soullink-engine-spike` | `5ee81de8-d923-473c-a4dc-7d7b4fb329c2` | CLI 1.1.76，DeepSeek-Flash；accept_edits；显式max/1000000，后端有效上限未回传 |
| Antigravity | `D:/Frankenstein/Uta-Workspace/tasks/antigravity-settings-runtime-integration` | `93db8778-3e7f-4f2b-b594-ae3d0098eb89` | CLI 1.4.6，gemini-3.8-flash-high；同会话续接accept-edits请求，但init仍报request-review，实际权限以工具结果为准 |

初始化实际cwd/model已核对；不使用continue选最近会话。两个任务各自独立npm ci、profile、允许文件/hash和preflight。Qoder拿到DS快照与Soullink指定提交的只读快照，原参考库脏package-lock未带入；资产/外部源码与构建放在忽略的.uta-task，不入Git。

Qoder限制可用内置工具并用严格空MCP/跳过用户项目配置；只修改实验目录。Antigravity暂用官方插件开关停用0.1.5桌宠插件，finally恢复，不复制认证、不整体改APPDATA；这是共享开关，不伪称单进程配置隔离。命令与配置依据本机help及 [官方CLI说明](https://www.antigravity.google/docs/cli/features)，没有使用跳过全部权限的flag。

## 实际遇到的权限限制与调整

Antigravity首轮 `--mode auto` 被账号拒绝并自动回到request-review；Git状态查询在headless无交互权限时被拒绝。CLI退出0/status SUCCESS但response为空，不能算完成或可实施交付。主控将其记录为permission-blocked-no-implementation，旧插件该轮结束已恢复。

按已验证真实conversation续接第二轮，只让Worker使用读写/编辑工具，明确禁止Shell/脚本/Git及任何替代执行被拒绝命令；复用主控在拒绝发生前已有的preflight证据。测试执行、范围核验和提交由Codex接管，Worker须写“待主控执行”，不能伪造测试通过。第二轮若写工具也受限，保留真实失败，不切bypass或修改全局allow规则。

Qoder初期有三条工具错误（命令退出/平台路径写入询问），后续公开入口已实际构建/导入，合法Windows任务路径的实验文件写入成功。工具错误逐条保留，不根据CLI退出码一概判成功；实现结果仍待主控审查。

## 实时现场与收取

派单器是仓库外一次性双任务脚本，不是已完成的持久调度器。执行/事件/提示/权限限制/退出记录在 `D:/Frankenstein/Uta-Workspace/operations/runs/<task-id>`；Antigravity `latest-attempt.json` 指向当前续接，不能只看首轮run.json。状态命令：`node D:/Frankenstein/Uta-Workspace/operations/status-cli-wave3.cjs`。记录中的PID是历史身份，操作前须检查真实进程，不按旧PID停止。

两项开始后允许按冻结范围继续，未验收前不合main。运行命令有期限，超时不等同于已证明服务端取消；进度/结果/git/工具错误需共同判断。Qoder完成commit/submit待审；Antigravity本轮只交文件，Codex测试后接管提交与集成。后续接手先读CURRENT、本文和实时状态；不得重复投递、重置目录或覆盖Worker改动。

主控不修改两边实现文件；正式数据/原模型/stable和日常ZIP保持原状态。设置接线只对开发profile启用，真实迁移/新窗口未授权本轮混做；Soullink只是公开引擎实验，未批准产品依赖/PIXI替换。收取后按行为测试、类型、构建与真实证据决定接受或修订。
