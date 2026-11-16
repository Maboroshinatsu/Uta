# `@uta/deepseek-harness-plugin`

Uta 桌宠对 **DeepSeek Harness** 的原生插件（基于 Cordis 插件架构与 `dsh.bundle` 规范）。

## 核心功能

1. **桌宠卡片直接交互式审批（Approval Seam）**
   - 监听 DeepSeek Harness 的 `approval/request` 瀑布流事件。
   - 当 Agent 请求执行需要审批的工具（如 `bash`、文件修改等）时，直接在 Uta 桌宠窗口弹出审批卡片，提供 **「批准」**、**「拒绝」** 与 **「转交宿主」** 按钮（审批期间自动临时解除鼠标穿透锁）。
   - 用户点击「批准」返回 `'allowed-once'`，点击「拒绝」返回 `'rejected'`；若点击「转交宿主」或桌宠未运行，自动调用 `await next()` 无缝回退至 DeepSeek Harness 原生审批界面。
   - 支持宿主 `AbortSignal` 取消联动（超时或宿主侧取消时自动收起桌宠审批卡片）。

2. **模型工作状态实时映射（Agent & Tool Lifecycle Seams）**
   - 监听 `agent/request`、`agent/assistant-stream`、`tools/execute`、`tools/result`、`agent/status`、`agent/error`。
   - 自动驱动 Uta 桌宠顶部的状态胶囊（思考中 / 回复中 / 执行工具 / 异常 / 待机）并触发对应的 Live2D / ImageSet 状态神态预设。

3. **模型情绪与预设上下文（System Prompt Context）**
   - 通过 `ctx.systemPrompt.context`（`uta:model-presets`）只同步当前 Live2D 模型可用的情绪与自定义预设名称。
   - 插件**不注入人设、不改变主回复语气或称呼**，也不要求模型在正文输出 `[uta:…]` 之类的神态标签。
   - 旧版模型如果仍输出这类标签，流式解析只会把它从桌宠气泡文本中过滤掉；DeepSeek Harness 主窗口的原文不受插件改写。

4. **主动表达工具（Tools Seam）**
   - 注册 `uta_express` 工具，供 Agent 主动触发桌宠的中文预设分组（`preset`）、基础情绪（`emotion`）、动作（`animation`）或气泡短句（`text`）。
   - 模型只在关键节点主动说话，通常一轮 1–2 次；整轮没主动说话时，`turn/end` 只补一条短摘要兜底。

5. **结构化用户提问（User Questions Seam）**
   - 监听 DSH 的 `user-questions/request` 瀑布流；`ask_user_question` 出现时，桌宠显示重点色「需要你选择」气泡，
     并附带问题与选项摘要。
   - 桌宠不代答，答案仍由 DSH 自己的问题卡片收集；插件只调用 `next()` 放行。

6. **人类侧 `/uta` 命令（Commands Seam）**
   - 在 DSH 的命令面板里注册 `/uta`，直接控制桌宠，不产生模型消息、不消耗 token：
     - `/uta status`：查看桌宠是否在线；
     - `/uta mood <emotion>`：切换基础情绪或中文预设；
     - `/uta preset <name>`：应用状态预设；
     - `/uta say <text>`：在桌宠气泡显示一句话。

7. **Uta 技能（Skills Seam）**
   - 注册运行期技能 `uta-deskpet`，让模型在 DSH 技能目录里发现 Uta，并知道何时调用 `uta_express`，
     不再只依赖 system prompt。

8. **原生消息入口（Agent followup）**
   - 每个 DSH 实例独立登记本机连接。桌宠把消息发送到所选聊天所属的实例。
   - 原生连接明确不可用时，Uta 可通过命令行续接同一个聊天。投递结果不确定时，请先在宿主确认。
   - 桌宠里的发言仍由模型通过 `uta_express` 决定；模型没主动说话时，回合结束只补一条短摘要。

## 安装与使用

```bash
# 1. 启动 Uta 桌面端（自动在本机 userData 目录写入 runtime-endpoint.json）
cd d:/Frankenstein/Uta/app
npm run dev

# 2. 将插件包安装到 DeepSeek Harness（GUI 使用 desktop，CLI 使用 default）
dsh plugin --profile desktop add d:/Frankenstein/Uta/plugin/plugins/deepseek-harness
dsh plugin --profile default add d:/Frankenstein/Uta/plugin/plugins/deepseek-harness
```

装完**一定要重启一次 DeepSeek Harness**。DSH 没有插件热重载：profile 的 `package.json` 里即使写着
`patchReload: "live"`，这个字段在 `0.2.1-rc.3` 的整份 `app.asar` 里也是零命中，改完源码不重启，
运行中的宿主仍然是旧版本。

## 兼容性

- 当前版本 `0.5.7`，兼容性基线为 DeepSeek Harness `0.2.1-rc.3`（Electron 44.7.0 / Node 24.21.0 /
  `hostProtocolVersion: 4`）上按运行期行为验证。基线与验证时间记在 `package.json` 的 `dsh.compat` 里，
  只作记录，不参与依赖解析。
- 插件**不声明** `peerDependencies`：`@deepseek-ai/*` 都是 asar 内置包，一旦声明，包管理器会去 registry
  解析并失败。

## 常见问题

**桌宠往宿主发消息被拒（`busy` / `no-session`）**

DSH 的 `dsh-headless --session-id` 是「接管已有会话」的语义，接管有四个前提：会话的工作目录必须等于子进程的
工作目录、会话不能带 agent preset、不能是 subagent / fork、不能已经在本进程里活着。插件会按会话登记里的
`cwd` 启动子进程；如果会话带了预设，请换一个不带预设的会话再试。

**任务老是被归到 DSH 的设置目录**

那是 0.5.3 的 bug。新版的工作目录取自 `session.header.cwd`，不再是宿主进程的当前目录。

**会话登记文件在哪**

`%APPDATA%\uta\hooks\harness-session.json`，内容是 `{ host, sessionId, cwd, updatedAt }`。注意这个目录跟着
Uta 的 endpoint 文件走：如果 endpoint 被指到别的目录（隔离测试时常见），`hooks` 也在那里。

**提示「消息可能已经送到宿主，为避免重复投递…」**

这是有意为之，不是报错。原生桥把消息交给宿主后，如果回执在路上断了（超时、连接被断开），Uta 无法判断
消息到底进没进去。以前这种情况会自动改用命令行再发一次，可能让你的一句话出现两遍；现在改成停下来提示你
先去宿主里看一眼。只有**确定一个字节都没送到**（宿主没开、桥已过期）时才会自动换方式重发。

**提示「目标会话已经不存在了」**

你选的会话在宿主里已经关闭或换了工作目录。这条消息没有发出去，也**不会**改投给别的活跃会话 —— 以前会，
结果消息跑进另一个项目的对话里。
