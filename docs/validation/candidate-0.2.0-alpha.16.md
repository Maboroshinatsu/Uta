# 候选验收：0.2.0-alpha.16

日期：2026-10-25

## 产物

- ZIP：`app/release/Uta-0.2.0-alpha.16-win-x64.zip`
- SHA-256：`666f601bafd75f7a4a5a5bb3a90e801d3f72369c37f447ac9b689893e3f1c1f7`
- 解压目录：`app/release/Uta-0.2.0-alpha.16-win-x64/`
- 来源提交：`2b5466579c3d1793d6641093275b1a4ca21e3305`（`dirty=false`；功能 `56ee39e`、发布准备 `2b54665`）
- 构建时间：`2026-10-25T09:44:29.904Z`
- `Try-Uta.bat` 指向 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.16`，profile 为 `candidate-020-alpha16`
- `FIRST-READ.md` 为本版体验说明；`resources/app.asar` 内 `package.json` 与 `out/build-info.json` 均为 `0.2.0-alpha.16`，来源提交与 manifest 一致

## 自动验证

- 应用：**913 项（908 通过、5 跳过、0 失败）**
- 插件：**105/105**
- `npm run typecheck`（node + web）通过
- `npm run build` 通过
- `npm run dist:zip` 完成插件构建、三端构建与 ZIP 打包；打包期间源码无变化

## 修复内容

1. **根因**：主进程的文本清洗把所有换行替换为空格，导致 Markdown 的列表、标题、代码块结构丢失；行内加粗和斜体仍能解析，所以会出现“加粗生效但 `**` 也可能露出”的不一致。
2. **保留消息换行**：新增 `sanitizeMessageText`，用于 `notify`、`choice_hint`、`rp_reply`；保留换行与列表缩进、清理控制字符、限制长度。状态标签和工具名仍使用单行 `sanitizeText`。
3. **安全渲染**：新增纯 token Markdown 解析器和 Vue 渲染组件，支持加粗、斜体、删除线、行内代码、代码块、有序/无序列表、标题、引用、分隔线、`http/https` 链接。不使用 `v-html`；HTML 按普通文字显示。
4. **接入位置**：浮动气泡中的 assistant 文本和消息记录中的 assistant 文本都使用同一渲染；状态和用户消息保持纯文本。链接在消息记录中可点击，气泡中显示链接样式但不可点击。

## 真实窗口验证

- 开发实例 `dev-f7e444bba875`：发送包含 `**加粗**`、`*斜体*`、列表和 fenced code block 的回复，气泡显示加粗/斜体、项目符号和代码块底色，没有裸露的 `**` 或反引号。
- 打包实例 `candidate-020-alpha16`：独立绑定 zcode，同一段 Markdown 在打包版气泡中同样正确渲染；验证后已退出并删除 smoke 数据与测试端点。
- 解析器回归覆盖加粗、斜体、删除线、行内代码、代码块、列表、标题、引用、分隔线、未闭合标记、危险链接降级、原始 HTML 文本化，以及气泡只走 token 渲染（无 `v-html`）。

## 未验证与边界

- Markdown 表格暂不排版为表格，仍按普通文字显示；HTML 不解析。
- 链接只允许 `http/https`；浮动气泡不可点击链接，消息记录可点击。
- 极复杂嵌套格式会按普通文字降级；本轮未做完整 CommonMark 兼容。
- 真实 Qoder 插件更新后的行为、锁定穿透、真实宿主切换重连、真实 DSH/麦克风/云端 TTS、8 小时/7 天、多屏 DPI 仍未验收。
- 日常 0.1.1/stable 未替换；用户正在运行的 alpha.14 未停止、未替换。
