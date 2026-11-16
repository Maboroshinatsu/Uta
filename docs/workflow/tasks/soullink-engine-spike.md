# Qoder：Soullink纯引擎选型与DS基准试验

用户授权CLI实施，固定DeepSeek-Flash，显式max与1000000上下文；CLI返回未验证档位如实记，不回退Auto。只在 `D:/Frankenstein/Uta-Workspace/tasks/qoder-soullink-engine-spike`。先读AGENTS、CURRENT、第二批审查、Live2D参考研究/表现计划、DS基准、assignment，再preflight。不开子Agent、不调用桌宠/联网模型、不改真实模型。

允许新增 `experiments/soullink-engine/**`（仅Uta自有driver/adapter/合成场景/断言/ADR）、本任务progress/result；不改app/plugin/依赖/lock/现有算法/公共文档。外部源码/产物/真模型只在忽略的`.uta-task`，不入Git。引擎源来自本地Soullink HEAD `02cd75ac0a085a87d84d1a885f1b33eca8742d53` 的受控快照；原库package-lock脏改不得带入或修改。复制的LICENSE/NOTICE情况和逐文件hash见输入manifest。

目标：验证稳定public导出可否支撑Uta，而不是再次泛写研究报告。先核对package.json的exports/public.ts，caller不从/internal导入；用app已安装typescript/esbuild在任务忽略目录构建纯engine public入口并实际运行。无须npm install/pull到外部参考库，不新增第三方依赖。不把自行bundle的源码入口写成已测试官方npm发布包，报告该口径与局限。

真实DS样本位于`.uta-task/model-input`，只读验证manifest/hash后，使用已合并Core读取器+profile生成可信输入（可复用support采集器，结束释放）。物理输出/未确认映射不驱动；保留嘴形[-2,1]/default=-0.5，不能强制对称/默认0。真模型JSON/参数完整转储不入Git，测试只提交自有合成fixture与摘要数值。

四步小commit：1公开API/版本/许可/最小build；2自有中立driver把公共engine输出过滤到真实profile白名单；3固定seed/dt场景与对照实验；4ADR/可重复脚本/结果。对比三路线：公共engine依赖、带署名裁剪移植、参考自研；允许结论“不采用”，但须证据。

场景至少：neutral→正/负情绪渐变/hold/衰减；无语音惊讶张嘴（重点核实mouth gate）；语音中静音/结束/取消；动作替换/释放和旧generation；dt=0/正常/100ms/休眠大步；缺参数/私有参数/物理输出/非对称嘴形。引擎无原生能力的取消/generation须在Uta隔离wrapper实现或明确缺口，不能把synthetic自研行为冒充Soullink自带。断言有限值/合法范围/能力白名单、不越权写physics、确定性和取消尾部；不写真实Core。

运行有warm-up、固定输入/seed、样本数的CPU/输出分配近似指标，给median/p95与方法，不把一次耗时称性能保证；不要为凑表伪造自有完整导演，与明确最小线性基线比较即可。保留原始结果在任务忽略目录，提交可重复脚本与自有ADR；许可证Apache-2.0、版权/NOTICE/修改记录分别说明，不改Uta代码或模型许可。

无需运行无关全app构建；运行实验行为测试、public入口实际导入、冻结契约/相关profile检查，准确记录命令/退出码。result列base/head、输入签名、公开与internal区别、实测支持/缺口/建议/风险/下一步、无GUI/Core写入。每阶段progress/commit，完成result后task-handoff submit，不合main/发包，不自动进入mixer/renderer接线。
