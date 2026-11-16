# 候选验收：0.2.0-alpha.15

日期：2026-10-25

## 产物

- ZIP：`app/release/Uta-0.2.0-alpha.15-win-x64.zip`
- SHA-256：`805ddbc121cfb8454f5efb1725f42ae327e07dde5c50af809ca939cf7409e6e2`
- 解压目录：`app/release/Uta-0.2.0-alpha.15-win-x64/`
- 来源提交：`ad27385cdf05c2fc9ade7093d48d21dab6ce8cc8`（`dirty=false`；修复 `e625184`、发布准备 `ad27385`）
- 构建时间：`2026-10-25T09:33:45.692Z`
- `Try-Uta.bat` 指向 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.15`，profile 为 `candidate-020-alpha15`
- `FIRST-READ.md` 为本版体验说明；`resources/app.asar` 内 `package.json` 与 `out/build-info.json` 均为 `0.2.0-alpha.15`，来源提交与 manifest 一致

## 自动验证

- 应用：**907 项（902 通过、5 跳过、0 失败）**
- 插件：**105/105**
- `npm run typecheck`（node + web）通过
- `npm run build` 通过
- `npm run dist:zip` 完成插件构建、三端构建与 ZIP 打包；打包期间源码无变化

## 本轮修复

1. **快捷面板双击关闭**：面板内的 `dblclick` 会冒泡到舞台根节点，触发 `onDoubleClick` 并关闭面板。现在面板、输入框和消息记录浮窗都 `@dblclick.stop`，`onDoubleClick` 也检查事件目标是否在这些面板内。
2. **模型独立大块**：原“角色”分组改名为“模型”，从普通列表行改成带边框、圆角、内边距和当前模型名的独立卡片；标题栏仍只有“快捷设置”和关闭按钮，下方有分隔线。
3. **回复气泡停留时间**：文本气泡最短停留从约 2.8秒 提升到 5秒，长回复按字数继续延长，上限 16秒。

## 真实窗口验证（隔离实例）

- 开发实例 `dev-f7e444bba875`：模型卡片显示正常；“模型”文字和当前模型名在卡片内；在面板内双击后面板保持打开。
- 打包实例 `candidate-020-alpha15`：`Try-Uta.bat` 启动后模型卡片布局一致，在面板内双击仍保持打开；验证后已退出并删除 smoke 数据。
- **Qoder 输出诊断**：用户当前运行的稳定实例（alpha.14，profile stable）已绑定 Qoder，`/context` 显示 `qoder:069c2355...` 会话，Qoder hooks 持续写入 `qoder-events.jsonl`。向该实例发送回复事件时，气泡立即显示；通过已安装的 Qoder Stop hook 发送最终回复，文本实际进入消息记录。之前的“看不到输出”主要是回复气泡停留短、以及新实例启动后还没有完成一次 Stop；不是 host 断开。
- 为验证链路，曾向当前稳定实例发送 4 条测试回复；它们只存在于本轮内存消息记录中，重启后清空。

## 未验证与边界

- Qoder 只在回合结束时发送最终摘要；工作过程中是否出现模型主动发言仍取决于模型是否调用 `deskpet_notify`，本轮没有自动转发全部助手正文。
- 本机 Qoder 插件缓存仍是旧版本（0.1.9）；没有改写用户的日常宿主配置。插件更新后的行为另行验收。
- 锁定穿透真实点击、真实 Qoder 插件切换后的重连、真实 DSH 桌面安装、真实麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏与贴靠图标同步仍未验收。
- 日常 0.1.1/stable 未替换；用户正在运行的 alpha.14 稳定实例未被停止或替换。
