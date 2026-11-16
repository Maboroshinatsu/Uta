# Uta Desktop Pet for Codex

把 Codex 的工作状态、完成提示、工具审批和角色表现接到 Uta 桌宠。

## 安装

```powershell
# 先构建出自包含插件与本地市场
cd d:/Frankenstein/Uta/app
npm run plugin:build

# 注册本地市场并安装
codex plugin marketplace add d:/Frankenstein/Uta/plugin/dist/codex-marketplace
codex plugin add uta-deskpet@uta
```

安装后新开一个 Codex 聊天，再在 Uta 的「面板设置 → Agent 工作型宿主」中选择 **Codex**。
首次使用时，需要在 Codex 的 `/hooks` 中审查并信任插件 hook。
换一台机器、或以后修改了插件里的 hooks 命令后，需要重新审查并信任。
未信任时 Codex 会跳过 hook，但 MCP 角色工具仍可用。

## 0.2.1：MCP 启动修复

修复部分 Codex 版本无法展开插件路径导致角色工具不显示的问题。升级插件后，新开聊天检查角色工具。

## 0.2.0：共享 SDK 接入

- 状态、回复和角色工具现在带有 Codex 身份，使用 Uta 协议 v2；旧版桌宠自动使用兼容模式。
- 会话开始或提交新消息时，把该 Codex 聊天绑定到桌宠；其他聊天的后台事件不会自动抢走当前绑定。
- hooks 传递宿主提供的会话和轮次。角色工具进程能获得会话标识时也会传递；拿不到时只标记 Codex，不猜测其他聊天的身份。
- 完成提示来自 hook 的最终回复；本适配不提供逐字流式镜像。

## 调试时先检查

1. Uta 已启动，并且当前宿主选择 **Codex**。选成独立待命或其他宿主时，v2 指令会被过滤。
2. 新开 Codex 聊天，发送一条消息，让插件登记并绑定当前聊天。
3. 用 `deskpet_get_capabilities` 检查连接和模型支持的预设，再调用 `deskpet_notify` 或 `deskpet_set_preset`。
4. 工具能用但工作状态不变化时，检查 `/hooks` 是否已信任，以及是否需要新开聊天加载新插件。

桥返回成功只表示已投递给桌宠窗口；当前宿主不匹配、聊天未绑定或模型不支持对应动作，仍可能没有可见表现。

技术排查可查看 `%APPDATA%/uta/hooks/codex-events.jsonl` 和运行时 `/context` 的会话快照。
前者只记录事件与字段摘要，不记录提示词、工具参数或回复正文；后者需要使用本机端点文件中的认证信息，不要公开端点令牌。

开发验证：在 `app` 中运行 `npm run test:plugin` 和 `npm run plugin:build`。

接入依据：[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[插件打包与信任规则](https://developers.openai.com/plugins/build/plugins)。

## 能力

- 会话开始、思考、工具执行、完成等状态实时映到桌宠；
- 任务完成时在桌宠气泡显示短摘要（长回复只提示回 Codex 查看）；
- 工具执行期间桌宠会用短句说明“在找/在读/在改/在测/在查”，完成/报错/中断时切换对应神态；
- 需要权限确认时，桌宠弹出审批卡片，可在桌宠上直接批准/拒绝；
- 模型可通过 MCP 调用 `deskpet_notify` / `deskpet_set_emotion` / `deskpet_set_preset` / `deskpet_play_animation` / `deskpet_get_capabilities`；后者会返回当前模型的状态预设分组。

桌宠没启动、审批超时或用户取消时，插件会静默退回 Codex 自己的审批弹窗，不会替用户放行。
