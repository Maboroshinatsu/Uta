# 候选验收：0.2.0-alpha.14

日期：2026-10-25

## 产物

- ZIP：`app/release/Uta-0.2.0-alpha.14-win-x64.zip`
- SHA-256：`fad4d1216dc33f638e4753e95b42784c5bf9bbe4751b8b9bf625190fe2f4939b`
- 解压目录：`app/release/Uta-0.2.0-alpha.14-win-x64/`
- 来源提交：`80043970451883a51f151f5da3cc8d564430cfb4`（`dirty=false`；功能 `6da2248`、发布准备 `8004397`）
- 构建时间：`2026-10-25T09:18:11.952Z`
- `Try-Uta.bat` 指向 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.14`，profile 为 `candidate-020-alpha14`
- `FIRST-READ.md` 为本版体验说明；`resources/app.asar` 内 `package.json` 与 `out/build-info.json` 均为 `0.2.0-alpha.14`，来源提交与 manifest 一致

## 自动验证

- 应用：**907 项（902 通过、5 跳过、0 失败）**
- 插件：**105/105**
- `npm run typecheck`（node + web）通过
- `npm run build` 通过
- `npm run dist:zip` 完成插件构建、三端构建与 ZIP 打包；打包期间源码无变化

## 真实窗口验证（隔离实例）

开发实例 `dev-f7e444bba875`，打包实例 `candidate-020-alpha14`；日常 `uta` 数据、正在运行的 alpha.12 实例和 alpha.13 包均未改动。

1. **面板新结构**：标题栏只剩“快捷设置”和关闭按钮，下方有分隔线；“角色”“部件”“宿主”“外观”“桌面”都是正文分组，各分组之间也有分隔线。
2. **模型区**：当前模型名显示在“角色”分组右侧并加粗；点开后才出现 Live2D/静态立绘切换、刷新与模型列表；模型仍为 DS-control，折叠面板保持紧凑。
3. **宿主区**：显示“独立待机”或当前平台；展开后列出 7 个 agent 平台，选中另一个平台会出现内联确认：“切到 X 后，桌宠会重新加载”，按钮为“取消 / 切换并重载”。
4. **真实切换**：从独立待机切到 ZCode，桌宠重载且模型仍是 DS；再切到 OpenCode，再切回 ZCode。`pet-binding.json` 依次写成 `zcode`、`opencode`、`zcode`；每次切走都会删除旧平台的 `host-pets/<旧平台>/runtime-endpoint.json`，新平台端点重新发布。
5. **跨窗口同步**：设置窗口停在“连接与会话”时，从快捷面板把 OpenCode 切成 ZCode；设置窗口未重开即从“当前连接 OpenCode / 平台绑定 OpenCode”更新为 ZCode。
6. **打包实例**：用 `Try-Uta.bat` 启动解压后的 `Uta.exe`，主窗口正常加载默认 Hiyori，快捷面板显示同样的标题分隔线、角色/部件/宿主分组和“独立待机”；验证后已退出并删除 smoke 数据。

## 未验证与边界

- 没有从快捷面板切到本机正在运行的 Qoder、Codex、Antigravity 或 DeepSeek Harness，避免把这些真实插件的事件接到隔离开发实例上；只使用了当时没有进程运行的 ZCode / OpenCode。
- 因此“切换后真实宿主插件重新连接并驱动桌宠”尚未验收；本轮验证的是绑定写入、旧端点清理、桌宠重载和设置窗口同步。
- 切换宿主会重载桌宠，当前正在进行的对话会中断；这是有意的行为，不是无缝切换。
- 快捷面板宿主列表只包含 agent 平台，不含独立运行和外部 HTTP 适配器；解除绑定仍在“关于与诊断”。
- 真实 DSH 桌面安装、其他宿主真实会话、真实麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏与贴靠图标同步仍未验收。
- 日常 0.1.1 / stable 未替换；切换验证产生的 `pet-binding.json`、ZCode/OpenCode 端点已删除，开发实例已停止。`host-pets/qoder` 目录来自此前实例且为空，未触碰。
