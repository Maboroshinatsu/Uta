# 宿主发现与连接状态修复（2026-11-05）

- Claude：Windows 优先原生入口，排除 npm shebang shell 启动脚本；显式 JS 入口经 Node 执行，选择另一种入口时清理旧的路径覆盖项。
- Claude：通过实际 `plugin list --json` 的精确插件 ID 与 enabled 状态判断；插件市场目录、同名其他市场插件、已禁用插件都不能显示已就绪。本机读取到已安装但禁用，未自动启用。
- 连接页：重新检测与安装即时读取新选的宿主路径。插件文件、工具实际加载、会话登记分别展示；Qoder、Claude、OpenCode 不再仅凭文件或安装返回码声称 MCP/事件已验证。
- OpenCode：检测、安装和手动说明都使用 `OPENCODE_CONFIG_DIR`，其次使用 `XDG_CONFIG_HOME/opencode`，默认仍为用户 `.config/opencode`。
- 审批卡补齐 ZCode、OpenCode 的显示名；保留 Antigravity 原有适配行为。

验证：路径与引导回归 43/43，通过真实 Claude Code 2.1.138 和 ZCode 0.17.1 的随机构建目录插件清单校验；Codex 0.166.0-alpha.6 在独立 CODEX_HOME 完成本地市场登记与插件安装。没有改写真实宿主的全局安装。

这轮修复解决的是发现与状态真实性；各宿主首次会话的 hooks 信任、工具握手和实际模型调用仍需按平台验收。
