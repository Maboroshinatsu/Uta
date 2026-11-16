# Uta Desktop Pet for OpenCode

把 OpenCode 的工作状态、完成提示、工具审批和角色表现接到 Uta 桌宠。

## 安装

```powershell
# 先构建（会生成 dist/uta-opencode-plugin/uta-opencode.ts）
cd d:/Frankenstein/Uta/app
npm run plugin:build

# 把 uta-opencode.ts 复制到用户插件目录
mkdir "$HOME\.config\opencode\plugins" -Force
copy d:/Frankenstein/Uta/plugin/dist/uta-opencode-plugin/uta-opencode.ts "$HOME\.config\opencode\plugins\uta-opencode.ts"
mkdir "$HOME\.config\opencode\uta-deskpet-mcp" -Force
copy d:/Frankenstein/Uta/plugin/dist/uta-opencode-plugin/deskpet-mcp.mjs "$HOME\.config\opencode\uta-deskpet-mcp\deskpet-mcp.mjs"
```

本地插件放在 `~/.config/opencode/plugins/`，保留 `.ts` 扩展名。
如果使用自定义配置目录，请放到该配置目录的 `plugins/` 中。

修改后重启 OpenCode。

## 能力

- 会话开始、思考、工具执行、完成等状态实时映到桌宠；
- 任务完成时在桌宠气泡显示短摘要（长回复只提示回 OpenCode 查看）；
- OpenCode 请求权限时，桌宠弹出审批卡片，可在桌宠上直接批准/拒绝；
- 支持 OpenCode 1.14.31 的 server/Hooks 接口，同时保留现有 setup 接口；
- 桌宠文字通过当前插件发送到选定会话；1.14.31 显示“已发送”，支持队列回执的接口显示“已排队”；不另启 CLI 恢复会话；
- 宿主待办只在工具成功后同步，失败不会覆盖已有列表；
- 插件启动时加载随包的角色工具。连接 Uta 后，可以在 OpenCode 直接说「让 Uta 先侧目，再微笑，然后回正」。

## 接入角色工具（MCP）

通过 Uta 安装插件会一起安装 MCP 服务。OpenCode 配置里已有同名服务时，插件沿用用户的配置。手动指定服务时，可在 OpenCode 1.x 的 `opencode.jsonc` 配置：

```jsonc
"mcp": {
  "uta-deskpet": {
    "type": "local",
    "enabled": true,
    "environment": { "UTA_HOST": "opencode" },
    "command": [
      "node",
      "C:/Users/<你的用户名>/.config/opencode/uta-deskpet-mcp/deskpet-mcp.mjs"
    ]
  }
}
```

`deskpet-mcp.mjs` 是独立运行文件。重启 OpenCode 后，模型可按名字调用现有预设，也可用 `deskpet_motion` 编排时间线。

桌宠没启动、审批超时或用户取消时，插件保持 OpenCode 原生审批状态，不会替用户放行。
