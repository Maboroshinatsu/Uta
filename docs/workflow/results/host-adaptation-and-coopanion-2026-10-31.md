# 其他宿主适配与 Coopanion 对比交接

日期：2026-10-31。仅方案与源码对比，没有业务代码改动。

## 交付

- [其他宿主适配方案](../../HOST-ADAPTATION-PLAN-2026-10-31.md)：公共目标/投递/能力规则，Codex、Claude、Qoder、Antigravity、OpenCode、ZCode 和其他适配器的范围、影响文件、依赖与验收。
- [Coopanion 对比](../../COOPANION-COMPARISON-2026-10-31.md)：优先借鉴互动事件、模型导入、能力变化通知和状态节奏；提问回答、本地 STT 等列为后续专项。

## 现场与证据

- Uta：`main / f98bbef`，开始时已有 10 个文件的他人未提交 DSH 修复/说明；未修改、暂存或提交这些文件，也未改动已被修改的 CURRENT/HANDOFF。本任务以独立交接文档留痕。
- Coopanion：`04ce022a8c1e96e6053d9cbbe8f6dc555aa93f33`，工作区干净；未改动。依赖与 Cortico 子模块均不完整，未运行应用/测试。
- 只读 CLI 帮助/版本：Codex `0.166.0-alpha.5.1`、Claude Code `2.1.138`、Qoder CN `1.1.76`、OpenCode `1.14.31`、ZCode `0.16.9`。没有执行真实会话任务。
- 使用 OpenAI Docs 核对 Codex 文档，并查阅其他宿主官方 hooks/CLI/server 文档；来源直接链接在方案相应段落。
- 重要新事实：Qoder 有官方 CLI 续会话路线，但桌面活会话可否共享未验证；Codex 入队与开始执行分开；ZCode prompt 帮助的默认权限 mode 需优先验证；OpenCode 1.x 与 v2 分开适配。

## 待验证与下一步

本文各方案尚未实施。建议先选公共目标/投递规则，随后 Codex/Claude，再做 Qoder/OpenCode 专项；模型导入可独立形成一批。对 Coopanion 的判断为源码审阅，不作为其画面、性能或真实语音验收。

没有新建运行 profile、后台服务或遗留本任务进程；没有安装依赖、修改账号/宿主配置或打包。纯文档交付仅做内容、链接与 Git 范围检查，不重复运行应用测试。
