# 在其它宿主里安装 Uta 插件

这份说明跟着 Uta 安装包一起提供。所有用到 `uta-plugins` 路径的地方，都在 Uta 的安装目录下；
例如 `D:\Program Files\Uta\resources\uta-plugins`。不需要安装开发工具，也不需要自己编译。

## Qoder

1. 打开 Qoder 的「扩展 → 插件 → 添加插件」。
2. 选择 `uta-plugins\uta-qoder-plugin.zip`。
3. 重启 Qoder 会话，在 Uta 的「连接与会话」里选择 Qoder。

命令行版：先把 ZIP 解压到任意目录，再执行
`qoderclicn plugins install "<解压后的插件目录>"`。

## Antigravity

Uta 的安装按钮更新全局副本。需要使用当前项目的工作区副本时：

1. 解压 `uta-plugins\uta-antigravity-plugin.zip`。
2. 把解压出的 `uta-deskpet` 文件夹放进当前工作区的 `.agents\plugins\`。
3. 重启 Antigravity 会话，在 Uta 的「连接与会话」里选择 Antigravity。

## Claude Code

在终端执行：

```powershell
claude plugin marketplace add "<Uta 安装目录>\resources\uta-plugins\claude-marketplace"
claude plugin install uta-deskpet@uta
```

然后重启 Claude Code 会话。首次使用时按 Claude Code 的提示确认 hooks。

## ZCode

在 ZCode 的终端里执行：

```powershell
plugins marketplace add "<Uta 安装目录>\resources\uta-plugins\zcode-marketplace"
plugins install uta-deskpet@uta
```

然后重启 ZCode 会话。

## OpenCode

1. 如果还没有 `%USERPROFILE%\.config\opencode\plugins`，先创建它。
2. 把 `uta-plugins\uta-opencode-plugin\uta-opencode.ts` 复制进去。
3. 创建 `%USERPROFILE%\.config\opencode\uta-deskpet-mcp`，把随包同目录的 `deskpet-mcp.mjs` 复制进去。电脑上需要能直接运行 `node` 命令。
4. 重启 OpenCode 桌面端，或执行 `opencode reload`。

使用自定义配置目录时，将这两个文件分别放进该目录的 `plugins` 和 `uta-deskpet-mcp` 文件夹。

## Codex 与 DeepSeek Harness

两者都可以在 Uta 首次引导或「连接与会话」里安装。安装 DeepSeek Harness 插件前先完全退出宿主，安装后重开会话。Codex 需要能运行 `node`，状态与审批还需要在 Codex 的 `/hooks` 里信任 Uta 钩子。

更新 Uta 或移动程序目录后，在「连接与会话」里重新检测并更新连接器。DSH 会核对插件版本及安装目录；多个 Uta 实例不能同时安装到同一份 DSH 数据目录。安装超时且结果未确认时，完全退出 DSH 后点击「已退出 DSH，解除安装阻断」，再重试。

## 仍然连不上时

1. 确认 Uta 正在运行，桌宠窗口没有完全退出。
2. 在宿主的插件列表里确认 Uta 插件处于启用状态。
3. Codex 的 MCP 需要电脑上能直接运行 `node` 命令；没有 Node.js 时先安装 Node.js。
4. 在 Uta 的「连接与会话」里点「重新检测」，再选择一个新开的会话。
