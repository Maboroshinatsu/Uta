# Qoder：首批模型能力识别纯模块

状态：用户已授权本项实施，桌面会话待启动；不是整个Q04已完成。入口基线、目录、branch、profile、契约hash在当前工作区 `.uta-task/assignment.json`，不能使用聊天中的旧SHA。先运行 `node scripts/task-handoff.mjs preflight`。

## 开始与模型设置

只在 `D:/Frankenstein/Uta-Workspace/tasks/qoder-model-capability-core` 工作；打开该文件夹作为Qoder项目根，不打开Uta主目录。先读根AGENTS、本文、`docs/contracts/first-wave-v1.md` 和三个契约/fixture文件。

Qoder模型固定DeepSeek-Flash；桌面有可配置思考/上下文选项就设最高/最大。CLI的max/1000000参数不能当作桌面已经生效；若桌面没有对应项，在PROGRESS.md记录“不可设置/未验证”，不自行换模型，不另启CLI任务。不开子Agent，不调用桌宠MCP，不修改全局账号/插件。

## 目标与文件范围

实现 `buildModelCapabilityProfile(input: ModelInspectionInput): ProfileBuildResult`；输入是已读取的合成参数/原生资源，输出经过校验的能力/映射/降级说明。纯函数，无PIXI/Vue/fs/网络/持久化依赖。

允许：

- `app/src/renderer/services/performance/profile/**`（本任务专属新目录）
- `app/tests/model-capability-core.test.cjs`
- `docs/workflow/results/model-capability-core.md`
- `docs/workflow/progress/model-capability-core.md`

不修改：loader、emotion-adapter、Stage、store、shared契约、app/package.json及lock、全局文档、另一个任务、主分支。需要新测试注册只在结果中给主控准确路径/命令。本任务不需要新增依赖。可只读loader的ParameterInfo/getParameterInfos和emotion-adapter了解旧语义，不复制整个旧适配器。

## 分步实施

1. preflight，记录真实目录/branch/base/dirty与桌面模型设置；创建progress记录，计划3–5步。
2. 严格验证unknown输入，包括schema、签名、参数范围/重复ID、资源/override结构；错误返回issues，不throw给调用者、不把坏输入滤掉后伪装成功。
3. 按已冻结优先级生成15通道能力与映射；缺参数/未知私有参数/物理输出/零范围保守降级；表情blend和native motion目录原样保留，缺目标发warning。
4. 补行为测试与有用的独立模块文档；阶段性小commit；运行检查并提交结果。

契约的数值范围、通道顺序、未知字段、override优先级是硬约束。对“label-guess”可只支持少量明确中英别名，模糊/多目标不要猜，标needs-calibration/ambiguous。没有映射的通道必须出unsupported，不能用通用fallback伪造能力。

## 最少验收矩阵

- standardModel、minimalModel、privateModel：能力及方向准确，全部15通道顺序稳定。
- null/数组代替对象/未知字段/未知schema/空签名/参数重复/NaN/Infinity/min>max/default越界：结构化失败。
- 未确认override、未知target、重复override、physicsOutput与零范围：按契约拒绝或降级。
- 原生Add/Multiply/Overwrite完整保留，未知资源参数warning，非法motion index/重复资源拒绝。
- 输入深冻结仍可运行，输出不会共享可变数组污染输入；相同输入结果确定，不含时间/随机值。
- 只读最小映射结果，不写真实Core，不触发任何Uta实例。

在当前worktree/app运行 `npm ci --no-audit --no-fund` 安装自己的依赖，不共享node_modules。测试沿仓库现有typescript.transpileModule+node:test模式，业务测试不能仅匹配源码字符串。

验证命令：根目录 `node scripts/check-first-wave-contracts.cjs`；app内 `node --test tests/model-capability-core.test.cjs`、`npm run typecheck`、`npm run build`。失败如因已有基线问题，保留完整错误并对比基线，不暗改范围外文件。

## 进度与续接

每个阶段更新progress：当前状态、已完成、正在做、下一步、最近commit、检查结果、剩余问题、所属进程。可用 `node scripts/task-handoff.mjs checkpoint` 更新本机回执，但它不代替文字交接。

会话中断后先读同一个progress与本地status，再检查git现场；不重新建目录、不reset、不自动重做已提交步骤。同一目录同时只运行一个Qoder开发会话；本机回执不是互斥调度器。

完成：结果列base/head、真实命令/退出码、已做/未做、风险、运行进程（纯模块通常无），提交本任务文件后 `node scripts/task-handoff.mjs submit`。它只登记待审，不等于Codex验收。最后回复“已提交待主控审查”及结果路径和SHA。

允许继续的收尾仅限本任务：补缺失验收用例、修范围内失败、完善本任务文档；不要自己开始Q05/Q06或接线。卡住时写具体接口请求与复现；保留可审查成果，等待主控。
