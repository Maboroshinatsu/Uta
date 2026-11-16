# 独立设置窗口与公开偏好最小闭环：交付报告

> 任务代号：`[TASK-SETTINGS-WINDOW-CORE: 独立设置窗口与公开偏好最小闭环]`  
> 执行模型：Antigravity (`gemini-3.8-flash-high`)  
> 工作区：`D:\Frankenstein\Uta-Workspace\tasks\antigravity-settings-window`  
> 分支：`task/antigravity/settings-window`  
> Base Commit：`42938defc67c6d016fdab1f972ddd93feb065e38`  
> 交付状态：`submitted-awaiting-codex-review`

---

## 一、方案与实现概述

根据 `NEXT-BATCH-PLAN-2026-10-23.md` 第 5 节任务定义与用户选定的 Bento Box Grid (`settings-v2`) 视觉规范，本项目交付了独立的桌面设置窗口与公开偏好最小闭环，完全符合各项架构约束与边界原则。

### 1. 主进程设置窗口生命周期与双窗口 IPC 纳管
- **独立单实例管理**（`app/src/main/settings-ipc/window-manager.ts`）：
  - 实现 `SettingsWindowManager` 单实例窗口管理器。窗口尺寸固定为 `880x640`，背景色 `#f5f5f7`，具有标准原生窗口边框（最小化、最大化、关闭）与标题 `Uta 设置 [profile]`，禁用菜单栏与无用快捷键。
  - 用户从托盘菜单或已有窗口请求再次打开时，若窗口已存在且处于最小化，自动调用 `restore()` 并 `focus()` 唤起已有窗口，绝不重复创建。
  - 安全导航：通过 `setWindowOpenHandler` 和 `will-navigate` 拦截所有外部未知跳转，外链交由系统默认浏览器打开。
  - 级联销毁：主进程关闭时不阻塞，应用退出（`before-quit`）时级联清理设置窗口资源，而关闭设置窗口不会导致桌面宠物退出。
- **IPC 权威目标合法性登记**（`app/src/main/index.ts`）：
  - `getSettingsTargets()` 纳管 `[mainWindow.webContents, settingsWindow.webContents]`。
  - 主进程设置 IPC 发送者校验 `isValidSettingsSender` 严格限制必须为 `senderFrame === mainFrame`，拒绝任何 iframe 或跨域子 frame。
  - 页面地址校验 `isSettingsPage` 在匹配目标 URL 时通过剥离 `.hash` 规范化，安全接纳带 `#settings` 路由的设置页面。

### 2. 渲染进程零 Live2D 路由分流与轻量加载
- **路由解耦判定**（`app/src/renderer/route.ts`）：
  - 提取纯函数 `isSettingsWindowRoute()`，精准检测 URL `#settings` 哈希或 `?window=settings` 参数。
- **零 Live2D / 零 Pixi 启动分流**（`app/src/renderer/main.ts`）：
  - 当命中设置路由时，直接动态导入 `SettingsWindowApp.vue` 挂载，**完全不执行** `installPixiUnsafeEval`、`loadAdapterPlugins()`，**完全不初始化** `@pixi/core`、`ShaderSystem`、Pinia 或桌面宠物画布，零音频播放器开销。
- **产物构建与代码分割证据**（`electron-vite build`）：
  - `SettingsWindowApp` 被打包为完全独立的 chunk：`SettingsWindowApp-CxbURfNl.js`（仅 **44.23 kB**）。
  - 包含 Pixi 与 Live2D 核心的宠物主渲染 chunk 为 `index-D0dRPZF4.js`（**1,514.34 kB**）。
  - 设置窗口打开时仅加载 44 kB 轻量 chunk，实现了彻底的运行时与代码级隔离。

### 3. 公开偏好最小闭环（12 字段真实绑定与冲突解决）
- **完整接纳 12 项公开偏好字段**（`app/src/renderer/settings-window/SettingsWindowApp.vue`）：
  - `themeMode`（'light' | 'dark'）
  - `accentColor`（预设与 Hex 颜色）
  - `hoverFadeEnabled`（布尔）
  - `gazeFollowEnabled`（布尔）
  - `idleActionsEnabled`（布尔）
  - `orbAction`（'model_picker' | 'toggle_window'）
  - `ttsEnabled`（布尔）
  - `ttsProvider`（'cloud' | 'http'）
  - `ttsRate`（0.5 .. 2.0 滑块）
  - `ttsVolume`（0.0 .. 1.0 内部存储域，界面安全转为 0..100% 滑块）
  - `ttsSpeakNarration`（布尔）
  - `ttsSpeakReplies`（布尔）
- **保存反馈（2026-10-26 起：即改即存）**：
  - 12 项公共偏好不再使用草稿 + 保存/放弃按钮；每次改动只提交变化字段（`settingsClient.patch`），绝不覆盖未变动字段。
  - 离散开关与选项立即提交；强调色、TTS 语速与音量等连续控件使用 160–220ms 合并防抖，避免拖动时刷盘。
  - 状态栏显示“正在保存到本机 / 已自动保存 / 保存失败 · 点击重试”；失败会保留本地值并自动重试一次。
- **跨窗口同步与写入冲突**：
  - 订阅 `settingsClient.subscribe`：宠物窗口或快捷面板修改后，设置窗口立即跟随；设置窗口的改动也即时推送到桌宠与快捷面板。
  - 提交前以最新 revision 写入；遇到 revision 冲突时客户端刷新快照后自动重试同一字段（最多 3 次），不再弹出冲突横幅。
- **关闭保护只覆盖即时保存之外的草稿**：语音服务密钥与预设工坊仍使用未保存草稿登记；关闭/退出时仅对它们弹出保存、放弃或继续编辑。公共偏好已即时落盘，不再阻止关窗。

---

## 二、测试验证与回归数据

### 1. 自动化集成测试
- 执行命令：`node --test tests/settings-window-integration.test.cjs`
- 结果：**6 tests, 2 suites, 6 pass, 0 fail (376ms)**
  - `✔ SettingsWindowManager enforces single instance and focus restoration`
  - `✔ Dual-window registration validates both mainWindow and settingsWindow`
  - `✔ isSettingsWindowRoute detects settings hash or query, separates from pet`
  - `✔ volume calculation preserves 0..1 storage domain and renders 0..100% percentage`
  - `✔ dirty check correctly compares all 12 public settings fields`
  - `✔ cross-window remote synchronization and conflict resolution logic`

### 2. TypeScript 类型检查
- 执行命令：`npm run typecheck`
- 结果：**退出码 0**（Node 端与 Web 端均通过，0 错误）。

### 3. 全量测试套件回归
- 执行命令：`npm test`
- 结果：**527 tests, 9 suites, 522 pass, 0 fail, 5 skipped (5810ms)**
  - 涵盖所有既有 516 项测试与新增加的 6 项设置窗口测试。

### 4. 生产环境构建
- 执行命令：`npx electron-vite build`
- 结果：**退出码 0**，成功生成独立主进程、preload 与轻量设置窗口分包 chunk。

---

## 三、边界与不变量遵守情况

1. **零 Live2D 实例化**：设置窗口不加载任何 `.moc3`，不初始化 Pixi 引擎，不占用 WebGL 上下文，无模型与音频播放器实例化。
2. **权威存储唯一性**：设置数据完全由主进程 `SettingsStore` 作为单一数据源权威管理，渲染层通过 `settingsClient` 双向通信，杜绝本地绕过存储写入。
3. **未引入越界改动**：没有修改 stable profile，没有触发历史数据迁移，未触碰云端 API Key 深度表单或未实现的服务端假功能。
4. **交接状态**：保持在当前分支 `task/antigravity/settings-window`，准备提交审查，不私自 merge 到 `main`。
