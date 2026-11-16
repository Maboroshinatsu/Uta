# Uta Desktop Pet for Claude Code

把 Claude Code 的工作状态、完成提示、工具审批和角色表现接到 Uta 桌宠。

本版插件支持 Claude Code 2.1.78 及以上；宿主回复因接口错误结束时，桌宠会显示失败状态。

## 安装

```powershell
# 先构建出自包含插件与本地市场
cd d:/Frankenstein/Uta/app
npm run plugin:build

# 注册本地市场并安装
claude plugin marketplace add d:/Frankenstein/Uta/plugin/dist/claude-marketplace
claude plugin install uta-deskpet@uta
```

安装后重启 Claude Code 会话。可用 `/plugin` 查看插件是否启用，或用：

```powershell
claude plugin list
```

只想临时试一次、不写进已安装列表时，可以直接加载单插件压缩包：

```powershell
claude --plugin-dir d:/Frankenstein/Uta/plugin/dist/uta-claude-plugin.zip
```

## 能力

- 会话开始、思考、工具执行、完成等状态实时映到桌宠；
- 任务完成时在桌宠气泡和语音里只显示/念一两句摘要，完整内容留在 Claude Code；
- 需要权限确认时，桌宠弹出审批卡片，可在桌宠上直接批准/拒绝；
- 使用任务工具时，桌宠“待办 → 宿主”会显示接收到的任务和进度；Uta 不在线时可能错过部分变化，因此清单会提示可能不完整或有延迟；
- 模型可通过 MCP 调用 `deskpet_notify` / `deskpet_set_emotion` / `deskpet_set_preset` / `deskpet_play_animation` / `deskpet_get_capabilities`；`deskpet_get_capabilities` 会返回当前模型、可用情绪和状态预设分组。

桌宠没启动、审批超时或用户取消时，插件会静默退回 Claude Code 自己的审批弹窗，不会替用户放行。
