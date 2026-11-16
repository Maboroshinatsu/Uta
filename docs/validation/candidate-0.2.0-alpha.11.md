# 候选 0.2.0-alpha.11 验收记录

更新：2026-10-25。候选版本 `0.2.0-alpha.11`，源码提交 `3dd17fe8749a17011754e812520ef37fb76b30fb`，构建时间 `2026-10-25T06:21:15.548Z`。本版专门修复 [alpha.10 全面复审](../REVIEW-2026-10-25-ALPHA10.md) 记录的 11 项问题（1 项 P1、10 项 P2），并把对应触发路径转成了正式回归。

## 结论

- 复审 11 项均已修复，并各自有回归：应用测试从 878 项增至 **902 项（897 通过、5 跳过、0 失败）**，插件 **103/103**，node/web 类型检查与构建通过。
- 最终 ZIP 已解压，用隔离 Uta 数据、隔离 `CODEX_HOME` / `DSH_HOME` 启动；关于页显示 `v0.2.0-alpha.11`、提交 `3dd17fe8749a`、工作区干净、打包发行版。
- 真实窗口完成了草稿保护、静态立绘切换回执、跨窗口快捷面板拦截、琥珀强调色对比度、宿主卡片措辞和包内宿主材料的验收；没有点击真实宿主安装。
- 仍不能给出“宿主完整可用”结论：真实 Codex 安装点击、MCP 握手、其他宿主真实会话、真实麦克风/云端 TTS、8 小时/7 天和多屏 DPI 未验收。

## 修复清单

1. **[P1: 安装超时后解除互斥，允许尚未退出的进程并行写宿主配置]**
   - `host-onboarding` 新增持久阻断：安装命令超时且 `stillRunning` 时，后续 `install()` 不再执行任何写入；阻断写入运行目录的 `host-install-block.json`，重启 Uta 后仍然有效；只有显式 `unblockInstall()` 才删除阻断并清除内存状态。
   - 首次引导卡片在阻断时显示“安装已暂停”和“已退出 Codex，解除安装阻断”，禁用重复安装。
   - 回归：`an unsettled timed-out install blocks consecutive retries until released` 验证连续重试只调用一次市场写入，**新 service 实例（模拟重启）仍被阻断**，解除后才允许再次安装。
2. **[P2: 重开首次引导会销毁尚未保存的密钥和工坊草稿]**
   - 从关于页重开引导前，若有未保存密钥/工坊草稿，先显示“保存草稿并进入 / 放弃草稿并进入 / 继续编辑”；保存失败会留在当前页。
   - 回归：`reopening onboarding guards unsaved drafts...`、`saving drafts before reopening onboarding...`；真实窗口验证了取消、保存后进入重入引导和“返回设置”。
3. **[P2: 切换模型会清掉未保存的工坊内容及撤销历史]**
   - 设置中心换角色先询问保存/放弃/取消；保存调用工坊自身的保存路径，取消不会切换。
   - 快捷面板通过跨窗口 `localStorage` 信号检测设置窗口的工坊草稿，发现时直接阻止切换并提示先保存或放弃；信号带 30 秒心跳和 2 分钟过期，窗口卸载时清除。
   - 回归：`switching models offers save, discard or cancel...`、`discarding the workshop draft...`、`the quick panel refuses to switch...`；真实窗口验证了快捷面板拦截。
4. **[P2: 会话列表的迟到结果会串到另一个宿主]**
   - 会话列表、固定会话、宿主路径查询都捕获 hostId 和请求代数；切换宿主立即清空列表、固定 ID、加载状态和路径，迟到结果丢弃。
   - 回归：`connections-domain-race.test.cjs` 两个用例分别覆盖旧宿主列表和旧会话选择迟到。
5. **[P2: 静态立绘尚在挂载时就被判成切换失败]**
   - 新增 `model-load-gate`：切换前先武装等待，`StaticStage` 真正完成挂载后才回执成功/失败；切到 Live2D 或再次切模型会取消旧等待。
   - 回归：`model-load-gate.test.cjs`、`static-switch-gate.test.cjs`；真实窗口从 Live2D 切到 `sample_static` 后显示“已在桌面载入 / 角色在线”，没有“模型加载失败”。
6. **[P2: 工坊撤销和重做会把循环预设改成播完恢复]**
   - `applyWorkshopSnapshot()` 现在完整恢复 `hold` / `revert` / `loop`，未知值才回退 `revert`。
   - 回归：`workshop undo and redo preserve the loop finish mode`。
7. **[P2: 重复事件在首次投递完成前就被确认成功]**
   - `RuntimeSessionRegistry.duplicateState()` 区分已提交和正在投递；桥接层用 delivery promise 让在途重复等待第一次结果，只有已提交事件才立即返回 duplicate 成功。
   - 在途重复在第一次失败时返回同样的 503；第一次成功后才返回 200 duplicate。只有极少数“已预留但没有投递归属”的窗口返回 409 pending/retryable，不再假成功。
   - 回归：`an in-flight duplicate waits for the first delivery and mirrors its failure`、`an in-flight duplicate reports duplicate only after the first delivery succeeds`。
8. **[P2: 停用的 MCP 配置仍会显示工具阶段已验证]**
   - 新增结构化 `parseCodexMcpList()`，精确匹配 `uta-deskpet` / `uta-deskpet@uta`，读取 `enabled` / `disabled`；非 JSON 或相似名字不再命中。
   - 工具阶段不再因为“配置已登记”就显示绿色已验证：即使配置正确，也保持“等待中”，文案写“新会话握手后才能确认工具可用”；MCP 停用时显示需手动。
   - 回归：`a disabled Uta MCP entry is not reported as verified tools`、`MCP identity parsing ignores lookalikes and unstructured output`。
9. **[P2: 发布包里的其他宿主手动接入没有可执行材料]**
   - `extraResources` 现在随包附带 Qoder ZIP、Antigravity ZIP、Claude 市场目录、ZCode 市场目录、OpenCode 单文件插件和 `HOST-INSTALL.md`。
   - 每张手动宿主卡片直接给出带随包绝对路径的步骤；Qoder/Antigravity 的检测徽章改为“暂不支持自动检测 / 插件状态未知”，不再写“未检测到安装”。
   - 回归：`other hosts ship packaged artifacts and honest detection wording`、`host badges only repeat what detection reported...`；最终包目录已核对上述文件均存在。
10. **[P2: 自动接入没有检查 MCP 必需的 Node 运行环境]**
    - 检测和安装前用与 Codex 命令相同的环境执行 `node --version`；失败时在写入配置前停止，并说明 Codex 的 Uta MCP 需要 node。
    - 工具阶段文案区分“缺 Node”“MCP 未登记”“MCP 停用”“等待握手”。
    - 回归：`a missing node runtime blocks install before any host config write`。
11. **[P2: 快捷面板和旧工坊的强调色文字仍可能难以辨认]**
    - 两套变量改用同一个 WCAG 相对亮度/对比度算法；中等亮度强调色在品牌深色与纯黑之间选择，保证普通文字至少 4.5:1。
    - 强调色悬停底色按文字明暗方向调整（白字加深、深字提亮），设置窗口同时写入 `--dp-accent-text` 和 `--dp-accent-hover`。
    - 回归：`color-contrast.test.cjs` 覆盖琥珀、蓝、亮色和中等亮度颜色；真实窗口琥珀 `#c87137` → 文字 `#0d1a20`，正常对比度 **4.95:1**，悬停 `#d87a3b` → **5.71:1**，桌宠窗口同样为 `#0d1a20`。

## 自动验证

- `npm test`：**902 项，897 通过、5 跳过、0 失败**。
- `npm run test:plugin`：**103/103**。
- `npm run typecheck`：node/web 均通过。
- `npm run dist:zip`：宿主插件构建、electron-vite 构建、electron-builder ZIP 均通过；保留 Cubism 普通 script 无法 bundle 的既有提示。
- 新增正式回归文件：`color-contrast.test.cjs`、`model-load-gate.test.cjs`、`static-switch-gate.test.cjs`、`connections-domain-race.test.cjs`、`workshop-draft-signal.test.cjs`、`settings-workshop-undo.test.cjs`；同时扩充了 `host-onboarding.test.cjs`、`runtime-bridge.test.cjs`、`settings-window-draft.test.cjs`、`onboarding-flow.test.cjs`。

## ZIP 与来源

- ZIP：`app/release/Uta-0.2.0-alpha.11-win-x64.zip`
- SHA-256：`68143ab8c33600a16854d8136969ec2a5021bad0a791688a08066ec1d8ffe86a`
- Manifest：`app/release/Uta-0.2.0-alpha.11-win-x64.zip.manifest.json`，`dirty=false`，源码 `3dd17fe8749a`，构建 `2026-10-25T06:21:15.548Z`。
- 解压目录：`app/release/Uta-0.2.0-alpha.11-win-x64`，包含 `Try-Uta.bat`、`FIRST-READ.md`、授权文件。
- `Try-Uta.bat` 使用独立体验数据 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.11`。
- 包内 `resources/uta-plugins/` 已核对包含：`codex-marketplace`、`deepseek-harness`、`uta-qoder-plugin.zip`、`uta-antigravity-plugin.zip`、`claude-marketplace`、`zcode-marketplace`、`uta-opencode-plugin`、`HOST-INSTALL.md`。

## 真实窗口验收

- 最终实例 profile `packaged-alpha11-final`，用户数据 / 运行时 / 端点全部在 `%LOCALAPPDATA%\Uta-Candidates\alpha11-final-20261025`，`CODEX_HOME` / `DSH_HOME` 也在该目录下；没有读写日常 Uta 数据，没有点击宿主安装。
- 首次引导欢迎页、宿主卡片、Qoder 手动步骤和重入引导均在真实窗口读取；Qoder 卡片显示 `resources\uta-plugins\uta-qoder-plugin.zip` 的随包路径。
- 最终包宿主卡片：Qoder / Antigravity 显示“暂不支持自动检测 / 插件状态未知”；Codex 显示真实检测结果，工具阶段等待安装/握手，不显示绿色已验证。
- 工坊写入“验收草稿”后切换展示方式，出现“换角色前保存工坊草稿？”；取消后保持原模型，保存后成功切到 `sample_static`，角色页显示“已在桌面载入 / 角色在线”。
- 设置窗口保留工坊草稿时，桌宠快捷面板点“静态立绘”不再切换，提示“设置窗口里有未保存的工坊草稿。请先在设置里保存或放弃，再换角色。”
- 关于页“重新打开首次引导”在有工坊草稿时显示保存/放弃/继续编辑；取消后仍在关于页；保存后进入重入引导，“返回设置”正常回到设置。
- 琥珀强调色实测：`--uta-accent` / `--dp-accent` 均为 `#c87137`，两套文字变量均为 `#0d1a20`，正常 4.95:1、悬停 5.71:1；快捷面板选中项与按钮文字清晰。
- 关于页显示 `v0.2.0-alpha.11`、提交 `3dd17fe8749a`、工作区“干净 (clean)”、交付模式“打包发行版 (Packaged)”、Profile `packaged-alpha11-final2`。版本/诊断证据来自最终落盘阻断构建；其余交互截图来自同一源码树的上一构建，两者 UI 相同，仅主进程阻断持久化不同。

截图证据（`docs/validation/`）：

- `alpha11-onboarding.png`：引导欢迎页。
- `alpha11-final-hosts.png`：最终包宿主卡片和修正后的 Qoder/Antigravity 徽章。
- `alpha11-onboarding-qoder.png`：Qoder 随包手动步骤（该张来自徽章修正前的构建，步骤路径与最终包一致）。
- `alpha11-model-switch-draft-guard.png`：换角色草稿保护弹窗。
- `alpha11-static-switch-success.png`：静态立绘切换成功。
- `alpha11-quick-panel-draft-block.png`：快捷面板跨窗口拦截。
- `alpha11-reopen-onboarding-guard.png`：重开引导草稿保护。
- `alpha11-reentry-after-save.png`：保存后进入重入引导。
- `alpha11-amber-contrast.png`：琥珀强调色设置页。
- `alpha11-final-about.png` / `alpha11-final-about-diagnostics.png`：最终版本与诊断信息。

## 未验证与边界

- **没有点击真实 Codex 安装**：最终实例使用隔离 `CODEX_HOME`，只做检测。安装互斥、Node 检查和 MCP 解析由单元/集成回归覆盖，但没有在本候选包上真实点击“安装并连接”。第一次视觉验收曾用机器现有 Codex 做只读检测，`codex plugin list --json` 超时；没有执行安装、没有写入宿主配置。
- **没有验证 MCP 实际握手**：工具阶段按要求保持等待，不能把“配置已登记”当作工具可用。
- **安装超时/解除阻断的真实 UI 没有触发**：没有伪造会卡死的宿主进程；后端连续重试测试和卡片静态检查已覆盖。
- **其他宿主没有真实会话验收**：只核对了随包材料和手动步骤。
- **会话迟到和运行时在途重复**由真实组件脚本和真实回环 HTTP 测试覆盖，没有用两个真实宿主复现。
- **真实麦克风、云端 TTS 音色与听感、真实显示器拔插、多屏 DPI、8 小时连续运行、7 天日常使用**仍未验收。
- **恢复页标题栏、Windows 贴靠图标同步、深色快捷面板逐项无障碍**仍只有代码/尺寸检查。
- 复审报告中的界面打磨建议未在 alpha.11 处理：默认窗口动作栈位置、关键帧 DOM 身份、`.pressable` 回弹时长；它们不影响本轮的草稿、安装、状态和回执修复。
- 本候选未替换日常 0.1.1/stable，未配置代码签名。

## 现场与回退

- 最终自建实例主进程 `30492`（最终落盘阻断构建）及第一次视觉实例主进程 `37856` 均已连同子进程清理；清理前按可执行路径确认只属于 alpha.11 解压目录。
- 桌面上原有的 alpha.10 候选实例（PID `38280` 及子进程）不是本轮启动的，未停止、未覆盖；日常 Uta 0.1.1/stable 未触碰。
- 隔离体验数据保留在 `%LOCALAPPDATA%\Uta-Candidates\alpha11-verify-20261025`、`%LOCALAPPDATA%\Uta-Candidates\alpha11-final-20261025` 和 `%LOCALAPPDATA%\Uta-Candidates\alpha11-final2-20261025` 供复查；端点文件随进程退出。
- 打包前既有未提交文档 `docs/AGENT-PORTABILITY-PLAN.md` 在两次打包时临时收起，打包后原字节恢复，未纳入提交。
- 回退：退出候选，启动旧版即可；不要删除 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.11`，以免丢失体验数据。
