> 主控说明（2026-10-23）：以下保留Worker原始未验交付，其“实测/保证/无残留”等陈述不构成主控验收证据。原Worker未执行测试或命令；主控已补正并完成源码验收，实际实现、测试、确切命令与限制以 [设置接入主控审查](../results/settings-runtime-integration-review.md) 为准。原始文件hash和工作区另存保留，勿据旧状态重复派单。

# 设置IPC与开发模式接入：进度

- 状态：implementation-complete-awaiting-codex-verification-and-commit
- 平台：Antigravity (gemini-3.8-flash-high)
- 运行工作区：`D:\Frankenstein\Uta-Workspace\tasks\antigravity-settings-runtime-integration`
- 分支：`task/antigravity/settings-runtime-integration`
- Base SHA：`aba335d914fac58cc2c35fa0e7fc40e139fa51f3`
- Profile：`antigravity-settings-runtime-integration`
- 模式约定：执行受限无命令执行环境，已严格遵循拒绝策略，全量代码与测试以 accept-edits 规范就绪，待主控 Codex 接管命令验证与 Git 提交。

---

## 实施阶段台账

### 阶段 1：主进程 IPC 注册与生命周期 (`app/src/main/settings-ipc/`, `app/src/main/index.ts`)
- [x] 新增 `app/src/main/settings-ipc/index.ts`：受控函数 `registerSettingsIpc`。
- [x] 裁决模式：严格由 `environment.isStable` 裁决，渲染层/环境变量无法改写。
  - `stable` 配置文件：模式返回 `legacy`，完全不创建 `SettingsService` 实例，无任何 `settings.v1.json` 磁盘 I/O；`read()` 固定返回 `null`，`patch()` 固定返回 `{ ok: false, code: 'store-blocked', currentRevision: null }`。
  - `canonical-dev` 配置文件：在 app ready 后解析 `environment.userData`，创建单一 `SettingsStore`，先于 `createWindow()` 注册 IPC。
- [x] 严格请求发送者校验：检查已登记的目标 `WebContents`，校验 `event.senderFrame === webContents.mainFrame`，彻底拒绝未知窗口与 iframe/子 frame 注入。
- [x] 广播：`onChanged` 仅发往活着的已登记窗口；
- [x] 接口收敛：绝不向渲染层暴露 `importLegacy` 或注册 `uta:settings:import-legacy` 写入通道。
- [x] 进程生命周期：在 `before-quit` 触发时安全卸载 handler、解除订阅并优雅 `close()` store。

### 阶段 2：Preload 客户端通道与类型声明 (`app/src/preload/index.ts`, `app/src/renderer/env.d.ts`)
- [x] 在 `app/src/preload/index.ts` 暴露 `window.utaAPI.publicSettings`，精确实现 `PublicSettingsBridge` 接口（`getMode`, `read`, `patch`, `onChanged`）。
- [x] 在 `app/src/renderer/env.d.ts` 声明可选的 `publicSettings?: PublicSettingsBridge`，保持对无 preload 预览环境的类型兼容。

### 阶段 3：渲染层客户端与启动门控 (`app/src/renderer/services/settings-client/`, `app/src/renderer/main.ts`)
- [x] 新增 `app/src/renderer/services/settings-client/`（`types.ts`, `client.ts`, `index.ts`）：
  - 维护单一客户端缓存与单调版本管理。
  - `canonical-dev` 模式下严格执行“先订阅 `onChanged`，再调用 `read()`，取最高 revision”的时序契约。
  - 重试初始化时不叠加订阅，`dispose()` 隔离晚到旧响应。
  - 客户端 `patch` 仅发送发生变更的十二字段，串行化并发队列处理，版本冲突返回结构化错误。
- [x] 启动门控 (`app/src/renderer/main.ts`)：
  - 在 `createPinia()` 和 `app.mount('#app')` 之前调用 `settingsClient.init()`。
  - 若 store blocked 或读取失败，阻止挂载 Pinia/App，渲染简洁的可重试错误屏，不静默回退 localStorage 或默认值。
  - 无 preload 环境（浏览器预览）和 legacy 环境保持原有行为。

### 阶段 4：既有 Pinia 接线与十二字段接入 (`app/src/renderer/stores/deskpet.ts`)
- [x] 十二字段初始化：`canonical-dev` 模式下仅从 `settingsClient.getCurrentSettings()` 快照水合；未迁移字段（TTS 密钥、endpoint、后台配置等）继续从 localStorage 读取。
- [x] 启动回写防护：十二字段的本地 `watch` 设为 `{ immediate: false }`，启动时绝不向 client 派发 patch 回写默认值。
- [x] 变更同步与防环：
  - 本地修改触发 `settingsClient.patch(changes)`；失败时暴露 `store.settingsSaveError`。
  - 远端变更订阅更新响应式 ref 时通过 `isApplyingRemoteSettingsUpdate` 标志拦截，绝不形成通知回写环。
- [x] localStorage 隔离：`canonical-dev` 模式下 localStorage 仅写入未迁移字段，不镜像十二字段。
- [x] 现有行为回归：`legacy` 模式下保持原全量 localStorage 读写与 watcher 行为。

### 阶段 5：行为与集成测试用例编写
- [x] `app/tests/settings-runtime-integration.test.cjs`：验证主进程注册、非法 sender 与子 frame 拒绝、stable 模式零 store I/O、广播机制与多 profile 隔离。
- [x] `app/tests/settings-client-integration.test.cjs`：验证客户端生命周期、先订阅后读取、乱序高版本单调吸收、重试去叠、并发串行化与冲突拒绝。
- [x] `app/tests/settings-pinia-integration.test.cjs`：验证 Pinia 十二字段水合、无启动默认回写、双向更新防环、localStorage 字段隔离与 legacy 回归。

---

## 待主控验证与提交项
- 见交付文件 `docs/workflow/results/settings-runtime-integration.md`。
