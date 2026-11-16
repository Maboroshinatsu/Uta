# Uta Desktop Pet for ZCode

把 ZCode 的工作状态、完成提示、工具审批和角色表现接到 Uta 桌宠。

## 安装

```powershell
# 先构建出自包含插件与本地市场
cd d:/Frankenstein/Uta/app
npm run plugin:build

# 注册本地市场并安装（ZCode CLI 随客户端提供）
node "D:/Zcode/resources/glm/zcode.cjs" plugins marketplace add d:/Frankenstein/Uta/plugin/dist/zcode-marketplace
node "D:/Zcode/resources/glm/zcode.cjs" plugins install uta-deskpet@uta
```

也可以在 ZCode 的「设置 → 插件管理 → 发现」里添加本地市场目录后安装。

## 能力

- 会话开始、思考、工具执行、完成等状态实时映到桌宠；
- 任务完成时在桌宠气泡显示短摘要（长回复只提示回 ZCode 查看）；
- 需要权限确认时，桌宠弹出审批卡片，可在桌宠上直接批准/拒绝；
- 模型可通过 MCP 调用 `deskpet_notify` / `deskpet_set_emotion` / `deskpet_set_preset` / `deskpet_play_animation` / `deskpet_get_capabilities`；后者会返回当前模型的状态预设分组。

桌宠没启动、审批超时或用户取消时，插件会静默退回 ZCode 自己的审批弹窗，不会替用户放行。
