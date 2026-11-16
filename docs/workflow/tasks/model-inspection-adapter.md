# Qoder：真实 Cubism Core 模型能力读取适配器

本批用户已授权。只在 `D:/Frankenstein/Uta-Workspace/tasks/qoder-model-inspection-adapter` 开发；确切branch/base/profile及冻结hash读 `.uta-task/assignment.json`。桌面固定DeepSeek-Flash，可见思考/上下文选项最大，无对应项记录不可设置/未验证，不切Auto、不启CLI替代、不开子Agent。

先读AGENTS、CURRENT、两批contracts、`docs/models/ds-control-baseline.md`与progress，再 `node scripts/task-handoff.mjs preflight`。旧model-capability-core是已合并历史任务，不在旧目录继续写。

## 目标和范围

实现冻结的 `inspectCoreModel(core, request): CoreInspectionResult`，读真实Core数组、CDI/physics/native资源，转给已合并profile builder校验。纯模块不引入fs/PIXI/Vue/网络，不写Core。空LipSync组不表示嘴部缺失。

允许：

- `app/src/renderer/services/performance/inspection/**`
- `app/tests/model-inspection-adapter.test.cjs`
- `app/tests/support/model-inspection-fixture.cjs`（仅Node测试资源采集/Core初始化）
- `docs/workflow/progress/model-inspection-adapter.md`
- `docs/workflow/results/model-inspection-adapter.md`

禁止修改：既有profile、loader、emotion-adapter、Stage、stores、shared、package/lock、renderer/Core库、模型和另一任务。不将Core源码或第三方模型JSON/纹理入Git，不连真实桌宠/正式实例，不改插件/用户数据，不合并/发布。profile缺陷交最小复现给主控，不暗改。无需新依赖。

## 本机真实样本

只读任务内忽略的 `.uta-task/model-input/`：资源、原MODEL-NOTICE、baseline-manifest与独立core-inspection报告。manifest里的source仅溯源，不能按它访问原AppData。Core库从本任务app/src/renderer/public读取。

先验证manifest逐文件SHA、引用和内容签名，再实际初始化Core/MOC，使用有界就绪检测/超时，不把固定200ms当永远就绪的保证。无公开ready Promise可对构造入口做带期限重试并记录。初始化失败报失败，不能回放JSON冒充实际Core；成功/失败均释放可释放对象，不能改压缩库。

预期247参数、92parts、269drawables、44表达式、8组/8motion；ParamMouthForm[-2,1]默认-0.5，ParamMouthOpenY[0,1]默认0。输出全部id/range/default与独立报告一致，另用最小/私有synthetic证明无硬编码。Group声明不能捏造参数。原署名保留，副本和源模型都不得写入。

## 步骤与验收

1. preflight/桌面档位记录/计划，独立npm ci。结构读取与异常捕获/副本先小commit。
2. metadata严格转换：CDI/physics、原生Blend、motion曲线；复用既有profile的警告/降级/override规则。
3. typed arrays/冻结输入/getter throw/count或长度错/重复id/非有限数/range/default越界/零参数/私有参数/缺metadata/坏资源/blend与索引/输出引用隔离/确定性测试。
4. 真Core+DS完整资源对照；报告物理输出集合、表情Blend数量、Parameter与Model/PartOpacity曲线区分、能力/需校准/缺失摘要。能力推导不等于画面通过，不硬编码可用通道数量。
5. 检查、result、提交待审。说明PIXI桥接未接、画面/音频未验。

根：`node scripts/check-first-wave-contracts.cjs`、`node scripts/check-desktop-wave2-contracts.cjs`。app：`node --test tests/model-inspection-adapter.test.cjs`、`npm run typecheck`、`npm test`、`npm run build`。本地有fixture必须真实执行Core用例；普通CI缺素材可显式skip，不能记真实通过。测试注册建议交主控；TEMP问题可用本任务局部TEMP重试并记录，不改全局配置。

每阶段写progress/commit。result列base/head、命令退出码、真实Core对照、profile摘要、许可保留、输入签名、进程。干净提交后 `node scripts/task-handoff.mjs submit`，回复待审SHA/结果路径。中断读现场续接，不reset/clean，同目录一个桌面会话。

## 后继：Soullink纯引擎选型（未armed）

完成即待主控审查，不同分支顺手装Soullink。下一任务会独立冻结基线/目录，读取 `D:/Frankenstein/soullink-emotion-sdk` 的确切HEAD/真实导出，对比稳定public engine、自有实现、有署名移植三路线；基于本批DS profile做确定性情绪过渡、无音频开口、取消/释放、dt尖峰实验，交ADR/成本/来源与许可/NOTICE记录。只研究纯引擎，不引PIXI7、不替换现有Core；选型和适配器审查后才决定正式表现管线。
