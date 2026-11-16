# 迁移说明：从 maibot-deskpet-plugin 到 Uta

日期：2026-10-11

## 结论

**核心渲染与宿主边界可直接复用，不需要重写。** 迁移后 70 项测试通过、类型检查通过、构建通过。

## 可直接复用的部分（原样复制）

| 来源 | 说明 |
|---|---|
| `services/live2d/` | 加载、适配校验、情绪映射、模型发现 |
| `services/imageset/` | 静态立绘（含 DP-013 的 probe-guard 修复） |
| `services/host/contracts.ts` | 宿主契约，与宿主无关 |
| `services/host/event-controller.ts` | 事件应用，依赖注入 |
| `services/host/fake-host.ts` | 测试用适配器 |
| `stores/deskpet.ts`、`stores/chat.ts` | 角色状态、聊天记录 |
| 7 个 composables | 动作层级、情绪回退、缩放、拖拽、待机 |
| `components/StaticStage.vue`、`ChatBubble.vue`、`QuickInput.vue` | 立绘舞台、气泡、输入框 |
| `main/runtime-bridge.ts`、`main/runtime-commands.ts` | 角色指令端点与校验 |
| `codex-plugin/` | Codex 轻量插件包 |

**核查方式**：逐个文件检查 import。上述模块**零 MaiBot 依赖**，只依赖 pixi / vue / pinia 与彼此。

## 需要改造的部分

| 文件 | 改动 |
|---|---|
| `DeskpetStage.vue` | 移除 `useChimeraTransport`，改为 `getActiveAdapter()`；移除麦克风按钮、语音、唇形同步、PTT、截图订阅 |
| `SettingsPanel.vue` | 重写：去掉 WS 地址/Token、STT 地址、MaiBot 服务项；新增宿主状态 |
| `main/index.ts` | 移除 `ServiceManager`（14 处引用）、截图、STT IPC、解释器信任流程 |
| `preload/index.ts` | `electronAPI` → `utaAPI`；去掉 MaiBot 相关 IPC |
| `env.d.ts` | 重写类型（`utaAPI`） |
| URL 协议 | `deskpet://` → `uta://`（`deskpet-images.json` **格式名保留**，兼容现有模型包） |

## 不带的部分

`plugin.py`、`_manifest.json`、`config.toml`、`stt-bridge.py`、`gpt-sovits-bridge.py`、`cloud-tts-bridge.py`、`hotkey-bridge.py`、`watchdog.py`、`start.bat`、`services.ts`、`ServicesSection.vue`、`services/protocol.ts`、`services/transport/`、`useWebSocket.ts`、`services/host/maibot-protocol.ts`、语音相关 composables。

## 新增的部分（Uta 特有）

| 文件 | 作用 |
|---|---|
| `services/adapters/codex.ts` | Codex 适配器（声明能力：仅角色工具） |
| `services/adapters/index.ts` | 宿主注册表（可插拔核心，harness/maibot 占位） |
| `services/adapters/active.ts` | 当前生效适配器（单例 + 切换） |
| `services/media/contracts.ts` | 语音接口预留（第一期不实现，明确返回不可用） |
| `services/media/index.ts` | 媒体提供者注册表 |

## 语音接口预留说明

用户要求「先不带语音，但留好接口」。做法：

- 定义 `SpeechRecognitionProvider` / `SpeechSynthesisProvider` / `AudioPlaybackProvider` 三个契约
- 默认实现为 `unavailable*()`，**明确返回 `not-implemented`，不抛异常、不静默成功**
- 第二期接入时替换 `setMediaProviders()` 即可，UI 与控制器无需改动

## 验证结果

| 检查 | 结果 |
|---|---|
| 测试 | 70/70 通过 |
| 类型检查（Node + Vue） | 通过 |
| 生产构建 | 通过 |

测试从原项目搬迁，去掉了 MaiBot 专属的 `maibot-protocol` 边界断言。

## 未迁移 / 未验证

- **未在真实 Codex 中验证 Uta**：原项目的插件已装在 Codex，但 Uta 的插件包尚未安装（`plugin/` 目录已就位）
- L1（hooks）未实现
- 语音未实现
- 安装包未制作
