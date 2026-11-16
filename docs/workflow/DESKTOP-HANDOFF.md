# 桌面应用开发交接

> 历史流程，2026-10-24 起暂停执行。当前由 Codex 单独开发，先读 [CURRENT](CURRENT.md) 与 [HANDOFF](HANDOFF.md)。下方打开旧目录、粘贴启动说明等步骤不是当前操作要求，未经用户新授权不得续接。

用户使用Qoder/Antigravity桌面应用开发。首批不再从后台CLI投递实施任务；CLI只读研究的历史会话不作为这次开发的执行会话。

## 用户怎样开始

本机总入口：`D:/Frankenstein/Uta-Workspace/handoffs/desktop-wave-1/README.md`。里面有两个工作目录、各自可复制的启动说明，以及Codex回来时的续接说明。路径都在本机，不涉及云端上传。

1. 在Qoder里用“打开文件夹”打开 `D:/Frankenstein/Uta-Workspace/tasks/qoder-model-capability-core`，新建本任务会话，粘贴总入口里的QODER-START.md内容。
2. 在Antigravity里打开 `D:/Frankenstein/Uta-Workspace/tasks/antigravity-blue-settings-page`，新建本任务会话，粘贴ANTIGRAVITY-START.md内容。
3. 后续通常让它们按任务做完即可；若主控不在线，把疑问写入progress，不要求用户解释技术接口。完成后告诉Codex“检查桌面首批交付”，无需粘贴整段日志。

不要让两个桌面应用都打开Uta主目录开发；文件夹名称是隔离边界。worktree不是权限沙箱，仍需按允许范围操作。

## Agent从哪里接手

每个worktree有被Git忽略的 `.uta-task/assignment.json`：确切base/branch、环境变量、允许路径、契约hash、任务文档。它不是密钥文件；不含token/个人设置。先根AGENTS→任务单→契约→progress→git现场。`agent.md`仍只指向AGENTS，避免重复规则漂移。

本批已授权：

| 平台 | 完整任务 | 交付位置 |
| --- | --- | --- |
| Qoder | 模型能力识别纯模块（Q04的合成输入子任务） | `docs/workflow/results/model-capability-core.md` |
| Antigravity | 蓝色组件与语音代表页（A01） | `docs/workflow/results/blue-settings-page.md` |

固定契约为 `uta-desktop-wave-1`；本批不包含生产设置IPC、独立窗口、loader接线或全天自动调度。C01仅完成本批子集；C02真实模型画面基线仍待录制，已授权纯数据任务不需要等待真实模型测试才编写模块，但不得宣称完整Q04已通过GUI。

## 文件交接协议

- progress：每阶段更新，记录已完成/当前/下一步、commit、真实检查、阻塞与进程；换会话时先读，避免重做。
- result：最终验收证据、base/head、范围、测试与GUI/音频分别状态、风险与未做项。
- 本地回执：根目录 `node scripts/task-handoff.mjs checkpoint` / `submit`。submit要求干净提交和结果文件，并校验目录/branch/契约/改动范围。**它只登记候选，不运行测试、不验证模型选择、不代表主控验收。**
- git：只提交本任务路径，小步commit，不merge/rebase主分支、不发布、不改stable。进度记录和实现可分阶段提交。

`node scripts/task-handoff.mjs preflight`：启动检查；`status`：只读现场；`checkpoint`：保存本地进行中回执；`submit`：保存待审回执。没有跨进程锁/心跳/自动续领能力，不能并开两个会话靠此脚本防冲突。

## 中断后怎样继续

同平台新会话仍打开同一任务目录，粘贴原启动说明并加“续接已有现场”。读progress、本地status和git，不reset/clean，不从main重新复制。未提交但属于本任务的改动可以按记录恢复；归属不明的变更先记录停点，不覆盖。

任务做完只允许补本范围测试/文档和修验证失败。没有明确后续派单不自行进入下一模块。主控暂不可用时，成果提交待审即是正确停止点。

## Codex回来如何收口

从总入口CODEX-RESUME.md读取两项assignment和progress/result，再核对实际git head/diff/status。按契约和用例复查；在独立集成区跑必要验证，决定合并或给具体修订。任何Worker的“完成”和本地submitted都不能自动更新main。

GUI旧桌宠插件可能独立触发日常实例；本方案没有修改桌面全局插件。若遇此问题先记录，不把worktree/profile存在当作插件也已隔离的证明。
