# 桌面第二批：Codex审查与源码集成验收

日期：2026-10-23。结论：**原交付需修正；主控补正后通过源码集成验收**。不是设置迁移上线、Live2D视觉验收或新ZIP发布。

## 基线与候选

主控区 `D:/Frankenstein/Uta-Workspace/tasks/codex-desktop-wave2-review`，分支 `task/codex/desktop-wave2-review`，base `c64bafa5a772fba9ddab57dddddf9d2f67f3031b`，独立npm依赖/profile。两项原工作区干净、preflight通过、冻结接口未改、无范围外文件；分别在主控区合并候选，未改Worker原分支。

| 交付 | 审查的完整head | 结果 |
| --- | --- | --- |
| Qoder：真实Core模型能力读取适配器 | `af103d270d04cdec95f291ef6c55a577d8d641d4` | Core读取/真实DS对照成立；补稀疏数组拒绝与异常文本边界 |
| Antigravity：公开偏好存储内核与显式旧来源导入 | `11a29c05b9d4ae5e74043a749cf22cbd418df0fc` | 存储/导入基础有效；补文件错误识别、请求/元数据校验与事务边界 |

主控修正提交：`0598a02`。本报告所在提交为最终文档基线，确切合入main head及现场回执在仓库外 `operations/desktop-wave2-review/completion.json`。Worker报告中的“全部严格验收”只代表其自测，以下主控复现/修正是本轮接受条件。

## 发现、复现与修正

### 设置文件与写入保全

- 文件stat的所有异常原先都按“不存在”处理；注入EACCES时read返回默认ready，后续patch可绕过原主文件备份。改成仅ENOENT表示缺失，其它错误blocked/io-error；写前stat失败终止事务。主文件路径是目录时也不能当首次启动。
- 目录登记只按path.resolve字符串，Windows大小写/短路径/目录junction可打开同一目录的第二个writer。改成realpath规范目录与Windows大小写归一键；主控测试真实大小写别名与junction重复打开拒绝。
- 默认临时文件原用 `open('w')`，不符独占创建要求。改成UUID名称+`wx`；临时文件碰撞返回io-error，既不truncate也不误删碰撞文件。保留同目录临时写/flush/备份/rename流程。
- 对主临时写、备份临时写、备份rename、主rename、写前stat分别注入错误，验证主文件原字节、内存revision、通知数量与临时清理。不是只有一个写失败用例代替整个矩阵。

### 设置请求、冲突和生命周期

- 请求外层及legacy source、document/receipt/conflict原先会忽略额外字段。现在只接受规定的自有数据属性，拒绝getter、symbol、未知键与非法revision；完整请求大小受限。文档拒绝重复receipt、重复/无对应来源或claim的冲突，避免坏metadata被“规范化”后重新写回。
- 原实现排队后才读调用者的可变request，调用后修改对象可改变最终写入。现在同步校验并复制输入后入队，expectedRevision仍在事务执行时比较。
- 原实现已排队通知不检查退订；一个监听器退订另一监听器后，后者仍收到回调。增加送达前存活检查；throw隔离/副本/异步重入read保留。
- sourceId排序改为与运行locale无关的字典比较；schema/范围、claim、冲突优先级不变。revision达到安全整数上限拒绝变化，真正幂等patch/import仍成功且不落盘。
- 增补128冲突容量的真实整次回滚测试（原容量测试实际只覆盖64receipt）；并验证跨profile、close排空/关闭后拒写/重开、未来schema与无效备份不被覆盖。

主控设置补测最初16项有10项失败，证明原代码存在遗漏；修正后加2项边界，共18项补测。原22项全部保留，当前设置专项40项通过。

### 模型元数据

- CDI/physics/exp3/motion及资源数组使用forEach会跳过空槽，带坏资源的输入可能被当成功。新增7项分别复现失败；改成显式遍历每个槽位，空槽按坏记录拒绝，不伪装缺资源也不改模型数据。
- 异常仍返回逻辑path/结构化code，取消向调用方回传任意getter/序列化异常原文。调整旧getter测试，要求返回invalid-core且不暴露异常原文。
- 原87项保留，新增7项，共94项通过。既有profile、shared冻结接口、loader/Stage/store、Core库未修改。

## 实际检查

| 命令/范围 | 主控结果 |
| --- | --- |
| 两个Worker `node scripts/task-handoff.mjs preflight` | 退出0；原head/base/branch、干净状态/范围/hash通过 |
| 本验收区独立 `npm ci --no-audit --no-fund` | 退出0；独立node_modules |
| `node scripts/check-first-wave-contracts.cjs` | 退出0 |
| `node scripts/check-desktop-wave2-contracts.cjs` | 退出0 |
| `npm run typecheck` | 退出0，node/web均通过 |
| `npm test`（已注册四个新增测试文件） | **490/490，0失败，0跳过**：既有356+设置22+主控设置补测18+模型94 |
| `npm run build` | 退出0，主进程/preload/renderer构建成功；仅此命令的TEMP/TMP使用验收区node_modules/.uta-review-tmp |
| `git diff --check` | 通过 |

仅修改package scripts，不改依赖/lock。最初写package脚本时系统python别名不可用，没有产生文件修改；改用已有Node完成。未修改插件，未重复插件测试；未改变全局TEMP/ACL。构建现有CJS/Core script提示不影响退出码。

## 真模型验证与许可

将主控冻结快照复制到本验收区忽略的 `.uta-task/model-input` 后运行真实Core用例，没有从Worker报告推断测试通过。59文件/4,141,300字节的manifest/逐文件hash/引用集合与签名保持一致；Core 5.1.0实读247参数、92parts、269drawables，与独立report一致。44表情、8动作转换成立；mouthForm[-2,1]/default=-0.5，mouthOpen[0,1]/default=0。

样本推导为12通道available、bodyX/Y/Z因物理输出需校准；56个物理输出，4条资源warning均保留，不能解读为全通道都能直接驱动。原署名/CC BY-NC-SA 4.0记录保持，模型资产/个人预设不进Git。不向正式桌宠发控制，也未验证画面、口型、真实语音、动作结束释放。

## 交接与下一步

本验收区无新常驻进程/监听端口，安装/测试/构建命令已结束；旧预览不属于本任务，不按历史PID清理。主目录原有四份脏文件单独校验hash，不混入合并；正式settings/models、日常ZIP/stable登记未改。

两个任务本机review/status回执标记为主控补正后接受，原Worker提交保留以便审计；旧result/progress是候选历史，实时接受结论以本报告、CURRENT与本机review为准。

下一阶段先冻结并实施主进程settings单例、来源限制的IPC、启动hydrate gating与renderer revision订阅，再在隔离profile做跨窗口保存/冲突/回退验收。Qoder可另开Soullink纯引擎选型任务；在确切新base/任务范围准备前仍未armed。模型adapter的PIXI桥接、逐通道控制/释放和独立设置窗口/任务栏最小化分别安排，不让Worker在已交付分支顺手扩范围。新日常ZIP需后续产品/模型画面验收。
