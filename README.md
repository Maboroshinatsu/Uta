<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/uta_logo_dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/uta_logo_light.svg">
    <img alt="Uta Logo" src="docs/assets/uta_logo_dark.svg" width="380">
  </picture>
</p>

<p align="center">
  <strong>A Live2D desktop companion for AI agent hosts on Windows.</strong>
</p>

<p align="center">
  面向 AI Agent 的 Windows 桌面伴侣，提供角色表现、状态同步、桌面审批与轻量交互入口。
</p>

<p align="center">
  <a href="https://github.com/Maboroshinatsu/Uta/releases"><img src="https://img.shields.io/badge/version-0.3.0--beta.1-blue?style=flat-square" alt="Version"></a>
  <a href="#"><img src="https://img.shields.io/badge/platform-Windows%20x64-informational?style=flat-square" alt="Platform"></a>
  <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D22.12-success?style=flat-square" alt="Node Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://github.com/Maboroshinatsu/Uta/issues"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome"></a>
</p>

<p align="center">
  <a href="#核心能力">核心能力</a> •
  <a href="#自然语言编辑模型预设">自然语言编辑预设</a> •
  <a href="#live2d-模型兼容性">Live2D 模型兼容性</a> •
  <a href="#从源码运行">从源码运行</a> •
  <a href="#初次使用">初次使用</a> •
  <a href="#宿主支持矩阵">宿主支持矩阵</a> •
  <a href="#语音与模型">语音与模型</a> •
  <a href="#项目架构">项目架构</a> •
  <a href="#构建与打包">构建与打包</a> •
  <a href="#许可与声明">许可与声明</a>
</p>

---

## 项目简介

**Uta** 是面向 AI Agent 宿主的 Windows 桌面伴侣。你可以用自然语言为当前 Live2D 角色编排动作、调整状态预设，再在桌宠窗口预览和修改。Uta 会读取模型自身的动作、表情、部件与参数，自动适配可识别的视线和身体跟随通道。

核心对话、推理和自然语言编排由连接的 Agent 宿主负责；Uta 提供模型能力、动作校验、实际播放与预设编辑，也会展示宿主的工作状态、回复、审批和提醒。

当前版本为 **0.3.0-beta.1**（Windows x64 预发布），提供 [ZIP 解压版和安装版](https://github.com/Maboroshinatsu/Uta/releases/tag/v0.3.0-beta.1)，也支持从源码运行或自行打包。

---

## 核心能力

### 用自然语言编排动作、编辑预设

- **描述想要的表现**：在已连接的宿主会话中提出动作要求，让 Agent 读取当前模型能力、选择原生动作，搭配表情、部件和参数编排时间线。
- **先预览，再保存**：支持即时播放和停止，也能为日常、思考、开心等状态生成预设草稿，导入后在工坊继续编辑。[使用示例](#自然语言编辑模型预设)

### Live2D 自动适配与模型导入

- **读取模型实际资源**：支持 Live2D 与静态立绘、文件夹与 ZIP 导入、结构预览和同名替换确认；Live2D 模型会识别自身的表情、原生动作、部件和可调参数。
- **适配不同参数与物理结构**：结合模型参数、物理关系和 VTube Studio（VTS）配置识别头部、眼球与身体输入，处理方向和范围差异；已有的显式适配优先。
- **跟随与动作协作**：待机偏移可以叠加鼠标跟随，表演结束后恢复自然状态；支持自由拖拽、鼠标穿透、专注模式及前台全屏隐藏。[兼容范围](#live2d-模型兼容性)

### 工作状态双向同步
- **实时状态映射**：随宿主处于空闲、思考、回复、工具调用、报错或完成等状态，即时切换 Live2D 动作与表情，并弹出对应状态气泡。
- **轻量会话入口**：双击桌宠唤起输入框，向当前连接的宿主注入消息或补充上下文；宿主会话变动时草稿自动保留。

### 交互式桌面审批
- **操作卡片直通**：当宿主执行高危命令或修改敏感文件时，桌宠侧弹出悬浮审批卡片，支持直观的批准、拒绝或交回宿主处理。
- **复杂流程引导**：遇到复杂多选方案或自由文本提问时，自动提示引导切回宿主主界面处理。

### 多宿主连接矩阵
- **Agent 宿主**：提供 Codex、DeepSeek Harness、Claude Code、OpenCode、ZCode、Qoder、Antigravity 的连接器与 MCP 工具。
- **聊天机器人适配**：包含 MaiBot 后端适配源码，并支持对接 AstrBot 独立适配服务，接收富文本、图片与表情包回复。

### 语音与多模态交互
- **TTS 语音播报**：支持回复摘要自动朗读与试听，可配置硅基流动、DeepSeek、百炼、MiMo、Fish Audio、GSV2P 或本地端点。
- **STT 语音输入**：支持本地识别模型或云端语音转文字，可选择填入输入框手动确认后再发，或识别后直接投递。
- **本地安全加密**：云端 API Key 在 Windows 本机使用操作系统凭据隔离加密存储。

### 桌面伴侣日常工具
- **待办与提醒**：本地日常待办项管理，支持单次与每日定时提醒。
- **宿主计划同步**：支持同步宿主工作计划并在桌宠侧提供只读查阅。

---

## 自然语言编辑模型预设

连接 Uta 与宿主、确认连接器的角色工具可用后，在宿主会话中描述想要的动作。例如：

> 先读取当前模型的能力，把「开心」预设调成先轻轻歪头，再微笑，最后回正。先给我预览；确认后生成可导入的预设草稿，保留其他预设。

也可以继续提出修改，例如「动作幅度再小一点」「停顿短一点」「保留当前服装」「日常待机时继续跟随鼠标」。Agent 会根据当前角色能用的原生动作、部件开关和参数重新编排。

1. **读取能力并编排**：优先复用模型自带动作，再用部件与参数补充；Uta 检查参数范围、通道冲突、时序和当前模型是否一致。
2. **在桌宠上看效果**：预览后继续调整节奏、幅度和收尾，也可以要求停止。先确认有代表性的动作，再扩展整套状态预设。
3. **导入并继续编辑**：宿主生成预设 JSON 草稿后，在「设置 → 模型与动作 → 用户预设」导入；可在「预设工坊」调整分镜、部件、表情、过渡与停顿，并选择「播完恢复」「持续保持」或「循环往复」。预设支持导入和导出。

生成草稿本身不会写入动作库。预设按模型区分，切换模型后需要重新读取能力；其他模型缺少的原生动作不能直接套用。当前宿主临时编排的时间线上限为 **12 秒**，长原生动作仍可在模型动作库中使用。是否自然、循环是否顺畅，需要在实际画面中确认。

这套流程通过随连接器提供的 `uta-live2d-motion` 技能和 `deskpet_motion` 工具实现，语言理解依赖所连接的宿主。详情见 [从宿主会话编排 Live2D 动作](plugin/README.md#从宿主会话编排-live2d-动作)。

## Live2D 模型兼容性

Uta 按每个模型的实际结构识别能力。导入后会读取模型清单、表情、原生动作、物理及可用的 VTS 绑定，生成能使用的控件、滑块和跟随映射；模型提供的自定义适配与预设会优先使用。

| 适配内容 | 当前支持 |
| --- | --- |
| 表情与部件 | 识别表情资源、服装与道具开关、多档位控件，以及模型中可确认的部件切换 |
| 原生动作 | 保留动作组与具体片段，支持动作库预览、预设引用及编排；无名称的动作组也可识别 |
| 视线与身体跟随 | 根据参数、物理关系与 VTS 绑定识别可写输入，处理反向眼球及自定义身体通道，避免重复驱动物理联动 |
| 待机与表演 | 协调鼠标跟随、自然眨眼、物理、状态预设与临时动作，切换或结束时释放动作控制 |
| 手动调整 | 可在工坊微调参数和部件，也可通过模型适配配置补充自动识别无法确定的映射 |

开发验收使用过 **Hiyori、大肥鱼、冰糖、艾莲、RetrynowMiku** 的资源副本，覆盖资源识别、控件开关与恢复、原生动作及跟随等不同项目。其中大肥鱼、冰糖、艾莲还用去掉 Uta 专用适配、匿名改名的副本验证了自动跟随，Hiyori 用于标准参数路径验证。详细记录见 [自动参数适配](docs/workflow/results/automatic-parameter-adaptation-20261108.md) 与 [模型资源识别](docs/workflow/results/model-resource-discovery-20261108.md)。

自动适配依赖模型提供的资源与元数据。任意编号参数、缺失的绑定、特殊的非线性联动仍可能需要手工配置；没有对应可动参数或部件的效果，无法凭描述补出来。自定义第三方模型需要自行准备，并遵守各自的使用条款。

---

## 从源码运行

### 环境准备
- 操作系统：**Windows 10 / 11 (x64)**
- 开发环境：**Git**、**Node.js >= 22.12**（CI 推荐 Node.js 24）

### 启动步骤

```powershell
# 1. 克隆仓库
git clone https://github.com/Maboroshinatsu/Uta.git
cd Uta/app

# 2. 安装依赖并准备 Live2D 核心资源
npm ci
npm run assets:prepare
npm run electron:install

# 3. 启动开发版
npm run dev
```

> [!NOTE]
> 首次执行 `npm run assets:prepare` 需要联网。脚本会自动从官方源获取 Live2D Core，并从指定源下载 Hiyori Pro 示例模型。下载包均受 SHA-256 完整性校验并缓存在本地。
> 源码开发版与打包版使用独立的数据隔离目录：开发版使用独立数据，打包后的 `Uta.exe` 默认使用 `%APPDATA%/uta`。[详细说明见运维文档](docs/workflow/OPERATIONS.md)。

---

## 初次使用

1. **选择外观**：启动后的首次引导中，选择加载预设的 Hiyori Pro 或静态立绘示例；未连接宿主时也可作为独立桌宠待机。
2. **连接宿主**：打开「设置 → 连接与会话」，选择所使用的 Agent 平台：
   - Codex 与 DeepSeek Harness 支持引导页辅助安装。
   - 其他宿主请参考 [宿主安装指南](plugin/HOST-INSTALL.md)。
3. **建立通信**：重开宿主会话，确认角色状态能随宿主思考或执行工具正常流转。Codex 需要在宿主 `/hooks` 中审查并信任 Uta 钩子。
4. **消息交互**：双击桌宠打开输入框，输入文字后直接发给宿主当前会话。

一只 Uta 实例绑定一个活动平台。打包后可利用 `Pets/` 目录下的启动器分别启动多个独立数据配置的伴侣实例。

---

## 宿主支持矩阵

源码提供的通道与能力分布如下（实际可用性依宿主版本与当前会话状态而定）：

| 宿主平台 | 文字发送通道 | 状态监听与审批 | 说明与配置指引 |
|:---|:---:|:---:|:---|
| **Codex** | 异步投递 | 完整支持 | 需要 Node.js 运行环境；状态与审批钩子须在 `/hooks` 中确认信任 |
| **DeepSeek Harness** | 原生通道 | 完整支持 | 安装或更新连接器前，请先完全退出宿主主进程 |
| **Claude Code** | 命令行续接 | 状态同步 | 依赖本机命令行环境中可用的宿主 CLI |
| **OpenCode** | 原生插件 | 状态同步 | 手动安装需同步复制插件脚本与 MCP 描述文件 |
| **ZCode** | 命令行续接 | 状态同步 | 按宿主指南部署连接器即可接入 |
| **Qoder** | CLI 试验能力 | 桌面版受限 | 桌宠审批后，宿主桌面端仍可能弹出自带系统权限框 |
| **Antigravity** | 仅状态与工具 | 工具与审批 | 通过 MCP 角色工具与事件同步驱动，审批为可选扩展 |

对于聊天框架适配：
- **MaiBot**：后端适配源码位于仓库 `maibot-adapter/`。
- **AstrBot**：支持使用独立的配套插件对接。

相关文档：
- [宿主安装指引 (HOST-INSTALL.md)](plugin/HOST-INSTALL.md)
- [连接器与 MCP 角色工具规范 (plugin/README.md)](plugin/README.md)
- [MaiBot 适配器说明 (maibot-adapter/README.md)](maibot-adapter/README.md)
- [第三方 HTTP 适配器协议规范 (docs/ADAPTER-PLUGINS.md)](docs/ADAPTER-PLUGINS.md)

---

## 语音与模型

### 语音服务配置
在「设置 → 语音」中启用语音功能并配置对应密钥与端点：
- **语音播报 (TTS)**：支持配置硅基流动、DeepSeek、百炼、MiMo、Fish Audio、GSV2P 或兼容 OpenAI 协议的接口，支持试听与语速调节。默认处于关闭状态。
- **语音输入 (STT)**：支持本地识别或云端接口，提供侧边麦克风快捷键触发。可配置“填入输入框手动确认”或“识别完毕即刻发送”。

### 模型导入与动作自定
进入「设置 → 模型与动作」导入自定义模型文件：
- 导入前提供模型结构预览、警告信息展示与同名覆盖提示。
- 表情预设与动作触发依赖模型自身包含的 Motion 与参数结构。

---

## 项目架构

```
Uta/
├── app/                  # Electron 桌面应用本体 (Vue 3 + Vite + TypeScript)
│   ├── src/main/         # Electron 主进程、窗口管理、本地通信桥接与系统集成
│   ├── src/renderer/     # 渲染进程、Live2D 舞台组件、气泡系统与设置面板
│   └── tests/            # 单元测试与环境验证套件
├── plugin/               # Agent 宿主插件与连接器
│   ├── plugins/          # 针对各 Agent 平台的专用连接器与 MCP 角色工具服务
│   └── shared/           # 跨宿主共享的协议定义与通信钩子
├── maibot-adapter/       # MaiBot 专属后端适配器模块
└── docs/                 # 架构设计、协议规范、发布计划与验证文档
```

---

## 构建与打包

在 `app` 目录下运行标准检查与构建流水线：

```powershell
# 类型检查与测试
npm run typecheck
npm test
npm run test:plugin

# 同时打包 ZIP 解压版和 Windows 安装版
npm run dist

# 验证本地打包候选件
npm run verify:windows -- --candidate
```

打包产物与来源清单生成在 `app/release/` 下，包括 `Uta-<版本>-win-x64.zip`、`Uta-Setup-<版本>.exe`、各自的 `.manifest.json` 和 `SHA256SUMS.txt`。只需要 ZIP 时运行 `npm run dist:zip`。打包要求源码已提交且工作区干净。

ZIP 完整解压后运行 `Uta.exe`；`Try-Uta.bat` 使用独立试用数据。安装版可选择安装目录并创建快捷方式，卸载时保留用户数据。两种版本默认均使用 `%APPDATA%/uta`。[ZIP 使用说明](docs/releases/ZIP-FIRST-READ.md)

GitHub [Windows verification](https://github.com/Maboroshinatsu/Uta/actions/workflows/windows-check.yml) 会自动检查推送和 PR。手动点击 **Run workflow**，保留勾选 `candidate`，通过检查后可在该次运行的 **Artifacts → Uta-windows-x64** 下载 ZIP 和安装版，附件保留 14 天。推送与应用版本完全一致的标签时，工作流会自动发布到 [Releases](https://github.com/Maboroshinatsu/Uta/releases)；当前版本使用 `v0.3.0-beta.1`，带预发布标识的版本会标为预发布。也可以先创建对应标签的 Release 或草稿，工作流会保留标题和说明、补传附件；同名附件内容不同时会停止。

当前程序未做 Windows 代码签名，下载或运行时可能出现系统提示。

---

## 已知限制与注意事项

- **安装入口**：Qoder、Antigravity 和 Claude Code 目前推荐按手动指南部署，暂不依赖向导的自动安装检测。
- **长程会话**：部分宿主接口就绪不代表已完成多轮复合上下文对话，长程运行稳定性与极端网络重试机制仍在持续验证。
- **图形兼容性**：复杂模型的联动参数、多显示器缩放切换、独占全屏场景下的窗口层次仍处于迭代优化中。
- **云端服务**：云端 TTS/STT 响应延迟、账单用量与接口配额取决于服务商配置，仓库本身不内置任何商用凭据。
- **问题反馈**：如遇异常，欢迎在 [GitHub Issues](https://github.com/Maboroshinatsu/Uta/issues) 提交反馈，并附上 Uta 版本、宿主类型与复现步骤。提交前请确认抹除敏感日志或私有 API Key。

---

## 许可与声明

- **核心源码协议**：本项目核心源码采用 [MIT License](LICENSE) 开源。前端代码演化自 [maibot-deskpet-plugin](https://github.com/Maboroshinatsu/maibot-deskpet-plugin)。
- **第三方资产版权**：Live2D Core SDK 以及预设的 Hiyori Pro 等第三方模型保留各自版权所有权，不涵盖在 Uta 的 MIT 协议内。源码树默认不内置专有二进制资源，构建脚本在合法许可下动态下载并校验适配。[查看完整第三方许可声明](THIRD_PARTY_LICENSES.md) · [构建资源清单](app/scripts/live2d-assets.json)。
