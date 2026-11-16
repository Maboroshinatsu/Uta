# Uta

Uta 是面向 AI Agent 的 Windows 桌面伴侣。它用 Live2D 角色展示宿主的工作状态、回复、审批和提醒，也支持语音、日常待办与模型导入。

对话、推理和工具执行由你连接的宿主负责，Uta 提供桌面上的角色表现与交互入口。

## 当前状态

当前版本为 **0.3.0-beta.1**，处于预发布阶段，主要面向 **Windows x64**。本仓库提供源码，尚未发布公开的 Windows 安装包；可以按下面的步骤运行或自行打包。

源码提供七种 Agent 宿主连接器，以及 MaiBot、AstrBot 两种聊天适配。不同宿主的功能范围和验证程度有差异，见下方说明。

## 能做什么

- **跟随工作状态**：在空闲、思考、回复、工具执行、出错和完成时切换角色表现，并显示简短气泡。
- **桌面审批**：支持的宿主可在桌宠上显示批准、拒绝和交回宿主处理的卡片；需要选择方案或回答问题时，提示你回宿主窗口处理。
- **模型与动作**：支持 Live2D、静态立绘、文件夹和 ZIP 导入、表情、原生动作、部件开关及预设编辑。宿主也可以通过角色工具驱动表情和动作。
- **待办提醒**：管理个人待办，设置一次或每日提醒；支持的宿主可同步自己的计划，宿主计划在 Uta 中只读。
- **语音**：回复摘要播报、声音试听、麦克风录音，以及单独配置的本地或云端语音识别。语音播报默认关闭。
- **桌面交互**：拖动、视线跟随、鼠标穿透、待机小动作、专注模式及前台全屏隐藏。

## 从源码运行

准备 Windows x64、Git 和 **Node.js 22.12 或更新版本**。CI 使用 Node.js 24。

```powershell
git clone https://github.com/Maboroshinatsu/Uta.git
cd Uta/app
npm ci
npm run assets:prepare
npm run electron:install
npm run dev
```

首次准备资源需要联网。Core 从 Live2D 官方 SDK 获取，Hiyori Pro 使用 AIRI 的下载源；下载有固定 SHA256 校验，并缓存在本机。`dev` 和 `build` 也会自动补齐缺失资源，已有文件会保留。

源码开发版使用独立数据目录。打包后的 `Uta.exe` 默认使用 `%APPDATA%/uta`，两者的数据归属不同。[开发与运行说明](docs/workflow/OPERATIONS.md)

## 初次使用

1. 在首次引导中选择 Hiyori Pro 或静态示例。暂时不连接宿主也可以独立待机。
2. 打开「设置 → 连接与会话」，选择要连接的平台。Codex 和 DeepSeek Harness 可以从引导安装连接器；其他宿主按[宿主安装指南](plugin/HOST-INSTALL.md)操作。
3. 重开宿主会话，确认状态能同步到桌宠。Codex 需要在 `/hooks` 中审查并信任 Uta 钩子，宿主的运行环境也需要能找到 `node`。
4. 双击桌宠打开文字输入框。可发送消息的宿主会显示目标会话；会话变化时，草稿会保留，等待你确认目标。

一只 Uta 绑定一个平台，可在「连接与会话」中切换。自行打包后，`Pets` 目录中的启动器可以分别启动使用独立数据目录的桌宠。

## 宿主支持

下表描述源码提供的消息入口，实际可用性还取决于宿主版本、插件是否启用及当前会话状态。

| 宿主 | 从桌宠发送文字 | 使用说明 |
| --- | --- | --- |
| Codex | 异步投递到选定会话 | 需要 Node.js；状态和审批钩子需要在 `/hooks` 中信任 |
| DeepSeek Harness | 原生会话通道 | 安装或更新连接器前，先完全退出宿主 |
| Claude Code | 通过命令行续接原会话 | 需要可用的宿主命令行入口 |
| OpenCode | 原生插件通道 | 手动安装需要同时复制插件脚本和 MCP 文件 |
| ZCode | 通过命令行续接原会话 | 按宿主指南安装连接器 |
| Qoder | 桌面版不支持；CLI 路线为试验能力 | 桌宠审批后，宿主仍可能显示自己的权限框 |
| Antigravity | 不支持文字注入 | 可用角色工具与事件同步；审批为可选功能 |

MaiBot 和 AstrBot 使用各自的后端适配器，可接收文字、图片及表情包回复。桌宠输入框目前发送文字。MaiBot 后端源码在本仓库的 `maibot-adapter/`，AstrBot 后端单独安装。

- [宿主安装指南](plugin/HOST-INSTALL.md)
- [连接器与角色工具](plugin/README.md)
- [MaiBot 适配器](maibot-adapter/README.md)
- [第三方 HTTP 适配器说明](docs/ADAPTER-PLUGINS.md)

## 语音与模型

在「设置 → 语音」打开「让 Uta 开口」，选择本地或云端服务，保存配置后试听。云端播报可配置硅基流动、DeepSeek、百炼、MiMo、Fish Audio、GSV2P 或 OpenAI 兼容接口，具体选项以设置页为准。

语音输入支持单独配置的本地识别服务和云端接口。默认识别后填入输入框，开启「识别后直接发送」才会交给当前宿主。可以使用侧边麦克风按钮，或设置页显示的实际快捷键。

在「设置 → 模型与动作」中导入模型。Uta 会先显示候选、错误和警告，再由你确认保存；同名替换需要确认。模型的动作、部件和视线效果取决于模型自身提供的参数与资源。

Uta 与宿主连接器使用本机通信。云端语音会把待合成文本或录音发送到你配置的服务，API Key 在 Windows 上加密保存在本机。

## 本地打包与检查

在 `app` 目录执行：

```powershell
npm run typecheck
npm test
npm run test:plugin
npm run dist:zip
npm run verify:windows -- --candidate
```

ZIP 和来源清单位于 `app/release/`。打包要求源码已经提交且工作区干净，下载资源和缓存不会计入未提交改动。完整解压后运行 `Uta.exe`；`Try-Uta.bat` 使用独立试用数据。[ZIP 使用说明](docs/releases/ZIP-FIRST-READ.md)

## 已知限制

- Qoder、Antigravity 和 Claude Code 请按手动指南安装；当前自动安装入口存在误报连接器文件缺失的问题。
- 部分宿主尚未完成真实账号、模型回合及最终程序包的完整验收；安装文件存在或接口接收成功，不代表宿主已完成一次实际对话。
- 复杂动作、不同模型的参数联动、多屏、独占全屏和长时间运行仍需继续验证。
- 云端语音的声音、延迟、费用及账号权限取决于所配置的服务；本仓库不提供服务密钥。

复现问题时，请说明 Uta 版本、宿主及版本、操作步骤和预期结果。分享日志或截图前，请移除密钥、端点凭据和私人聊天内容。[提交问题](https://github.com/Maboroshinatsu/Uta/issues)

## 项目结构

- `app/`：Electron 桌面程序。
- `plugin/`：Agent 宿主连接器与角色工具。
- `maibot-adapter/`：MaiBot 后端适配器。
- `docs/`：使用、接口、开发和验证说明。

## 许可与来源

Uta 自有源码采用 [MIT](LICENSE)。前端源自 [maibot-deskpet-plugin](https://github.com/Maboroshinatsu/maibot-deskpet-plugin)，随后独立演进。

Live2D Core、Hiyori Pro 及其他第三方模型保留各自条款，不属于 Uta 的 MIT 授权范围。Core、Hiyori 素材和可编辑工程不在当前源码树中，Hiyori 的 Uta 适配与预设配置继续随源码提供。[第三方声明](THIRD_PARTY_LICENSES.md) · [构建资源清单](app/scripts/live2d-assets.json)
