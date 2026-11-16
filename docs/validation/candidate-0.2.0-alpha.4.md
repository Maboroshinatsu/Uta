# 候选 0.2.0-alpha.4 验收记录

更新：2026-10-25。候选版本 `0.2.0-alpha.4`，源码提交 `61fe21727f81b6d8fa1982597f4e3cea2031fc3e`，构建时间 `2026-10-24T19:45:46.060Z`。

## 交付物

- ZIP：`app/release/Uta-0.2.0-alpha.4-win-x64.zip`
  SHA-256 `8b40c85cae6142dcc9aa7d727f143fee2b0a188709bbe12e66dc21cf177b6ba4`
- 来源清单：同目录 `.zip.manifest.json`，`dirty=false`，记录提交、构建时间、Node 版本和 SHA-256。
- 解压目录：`app/release/Uta-0.2.0-alpha.4-win-x64`，包含 `Try-Uta.bat`、`FIRST-READ.md`、授权文件。
- `Try-Uta.bat` 使用独立体验数据 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.4`，不读取或改写日常 Uta 数据。
- 候选从干净工作区构建；唯一的既有未提交文档在打包前临时收起，未进入 ZIP，打包后已恢复原字节。

## 本候选包含的主要内容

| 内容 | 提交 | 用户可见结果 |
| --- | --- | --- |
| 首次引导与安全安装内核 | `3507a6f` | 欢迎/宿主/角色/语音/开始五步；真实检测；备份优先；安装失败具体报错；可跳过、可重入 |
| 安装与界面审查修复 | `a085c0b` | 备份失败即中止；精确插件身份；原子恢复；窄屏顺序；深色对比；标题栏状态同步；工坊断点 |
| 蓝调生息设计规范 | `3507a6f` | 暖纸色、低饱和蓝、纵向关键帧栈、宽屏双栏、深浅主题 |
| 自绘标题栏与克制动效 | `3507a6f` / `a085c0b` | 无 Windows 原生标题栏；拖动/最大化/最小化/关闭；减少动态；隐藏时暂停漂浮 |

## 自动验证

- 应用：`npm test` **875 项（870 通过、5 跳过、0 失败）**。5 项跳过是需要本机真实 DS 输入的既有用例，不计作通过。
- 插件：`npm run test:plugin` **103 项全部通过**。
- 类型：`npm run typecheck` 的 node/web 两侧均通过。
- 构建：`npm run build` 通过；提示 `live2dcubismcore.min.js` 为普通 script 无法 bundle，是已知既有提示，退出 0。
- 打包：`npm run dist:zip` 从干净提交构建 ZIP 并生成 manifest；打包后再次核对提交和工作区未变化。

新增/更新的测试覆盖：

- `host-onboarding.test.cjs`：备份失败中止、伪装/禁用/未知 marketplace 拒绝、DSH 手动边界、精确插件解析与 hooks 展示。
- `onboarding-state.test.cjs`：pending/completed、升级已有 profile 抑制引导、原子临时文件。
- `onboarding-flow.test.cjs`：16 项，包含真实挂载流程、错误原文、汇总不虚报、窄屏/减少动态 CSS。
- `settings-close` / `settings-window` / `settings-pinia`：引导 URL、窗口工作区、默认主题色与草稿同步。
- `settings-runtime-review`：22 项，包含并发保存、远端事件和清理。

## 真实窗口验证

本轮使用隔离 profile `visual-review-20261025`、隔离用户数据目录和独立 Electron 源码实例；没有停止或覆盖用户日常 Uta，没有在你的真实 Codex 配置上点击“安装并连接”。

- 首次启动自动打开设置窗口，显示五步引导；欢迎页可退出、可开始设置。
- 宿主步骤读取到本机 **7 个宿主**的真实检测结果：Codex 显示已安装插件 `v0.2.2`、MCP/hooks 阶段状态，DSH/Qoder/Antigravity/Claude Code/ZCode/OpenCode 按手动或兼容方式展示；没有执行安装。
- 完成“跳过宿主”路径后引导关闭，`onboarding-state.json` 写入 `completed:true, hostId:"skipped"`；重新启动不再自动弹出。
- 从“关于与诊断 → 重新打开首次引导”可重新进入；顶部显示“返回设置”，点击后回到关于页，现有偏好未清空。
- 自绘标题栏的最大化/还原按钮实际可用，图标随状态更新；窄屏标题只保留品牌与窗口按钮。
- 窄屏（最小 560px 内容宽）下步骤条横向滑动、滚动条隐藏；动作区按“上一步 / 跳过 / 主操作”自上而下排列。
- 宽屏（2048 CSS px）下工坊为左右两栏：左侧 380px 关键帧栈，右侧动作与部件；窄窗口自动单列。
- 浅色/深色设置页、工坊、引导均实际渲染；深色下修复了“预览序列”深棕字配深棕底的问题；主按钮对比度按 4.5:1 复核。
- 截图证据在 `docs/validation/screenshots-0.2.0-alpha.4/`：
  - `settings-main-light-880.png`
  - `workshop-two-column-light-wide.png`
  - `workshop-two-column-dark-wide.png`
  - `onboarding-reentry-dark-wide.png`
  - `onboarding-reentry-dark-560.png`
  - `packaged-about-alpha4.png`

## 打包版验证

- ZIP 已解压到 `app/release/Uta-0.2.0-alpha.4-win-x64`；ZIP 内包含 `Uta.exe`、`Try-Uta.bat`、`FIRST-READ.md`、授权文件和 `resources/uta-plugins/codex-marketplace`、`resources/uta-plugins/deepseek-harness`。
- 用隔离 profile `packaged-alpha4-20261025` 启动解压后的 `Uta.exe`，首次引导自动弹出，标题栏显示独立实例；点击“这次先跳过”后 `onboarding-state.json` 写入 `completed:true, hostId:"skipped"`，设置窗口关闭。
- 再次打开设置并进入“关于与诊断”：显示 `v0.2.0-alpha.4`、构建提交 `61fe21727f81`、工作区状态“干净 (clean)”、交付模式“打包发行版 (Packaged)”、Profile `packaged-alpha4-20261025`。
- 本次验收记录与截图证据的后续文档提交不改变 ZIP；ZIP 的源码提交以 manifest 的 `61fe217` 为准。

## 宿主安装的验证边界

- 安装内核的备份失败中止、插件身份、marketplace 冲突、恢复原子性由单元和隔离环境覆盖。
- 之前隔离 `CODEX_HOME` 环境中的实际安装曾成功写入插件与 MCP，并验证重复安装幂等；本候选构建没有再次在你的日常 Codex 配置上执行这一操作。
- hooks 信任和新会话加载只能在 Codex 重启/新会话后确认；引导会把“等待中”保留为等待中，不显示为已验证。
- DSH 的桌面 profile 由宿主独占，Uta 不自动改写，只给出手动步骤；本候选没有验证 DSH 真实桌面会话。
- Qoder、Antigravity、Claude Code、ZCode、OpenCode 只验证检测与手动说明，没有验证真实安装或会话。

## 未完成或未验证

- 真实 Codex 安装点击（本轮刻意未触碰日常宿主配置）、真实 DSH 桌面安装、其他宿主真实安装。
- 恢复页自绘标题栏的真实窗口、Windows 贴靠/外部缩放后的图标同步、深色快捷面板逐项无障碍。
- 真实麦克风、真实云端 TTS 音色、人工听感、真实拔插显示器、跨机器和完整无障碍。
- 8 小时连续运行、7 天日常使用：时间条件未满足，不能标记通过。
- 本轮没有录屏；只保留静止截图。
- 本候选未替换日常 0.1.1/stable，也未配置代码签名。

## 操作过程中的透明记录

- 早期 DSH 调研执行 `dsh plugin --profile tui --help` 时，DSH 在 `C:\Users\Administrator\.dsh\profiles\tui` 初始化了一个空 profile。已检查内容，只删除该次调研创建的空目录；没有安装插件、没有改动 DSH 设置或日常 profile。
- 设置窗口在窄屏拖动时按最小宽度停在约 560 CSS px，符合窗口配置；不是布局失效。

## 8 小时 / 7 天试用步骤（待执行）

1. 解压候选，使用 `Try-Uta.bat`，不要直接替换日常 exe。
2. 正常使用至少 8 小时，中途保留一次休眠/唤醒；每小时记录一次托盘进程 CPU、工作集和当前模型是否仍在动。
3. 8 小时结束后检查：设置保存、语音试听、工坊撤销/重做、模型切换、宿主连接是否仍正常；退出再启动一次，确认预设和主题保留。
4. 7 天试用期间每天至少启动一次、切换一次模型并保存一个预设；记录任何白屏、卡死、掉帧、重复回复、语音失败和窗口跑出屏幕。
5. 结束时保留 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.4` 作为证据；回退只需退出候选并启动旧版，不删除数据。

## 回退

1. 右键托盘图标退出候选。
2. 启动保留的旧版 Uta（不要删除 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.4`）。
3. 若旧版无法启动，保留整个体验数据目录并记录版本号；不要把新数据复制进日常 `uta` 目录覆盖。
