# 候选 0.2.0-alpha.12 验收记录

更新：2026-10-25。候选版本 `0.2.0-alpha.12`，源码提交 `dc2ec01436c39cd3a12214d6f9b9531420f1d0b3`，构建时间 `2026-10-25T07:56:38.094Z`。本版按用户决定改为“一只桌宠只绑定一个 agent 平台”，平台内所有会话共用；同时处理 Codex 专项验收里的发言去重、hooks 信任和共享安装锁。

## 结论

- 绑定、端点、启动器、平台内共享会话和解除绑定都有正式回归；应用 **906 项（901 通过、5 跳过、0 失败）**，插件 **105/105**，node/web 类型检查和构建通过。
- 真实同时启动了两只独立桌宠（Codex / DeepSeek Harness），各自发布不同端点和 PID；向 Codex 桌宠投递 Harness 事件返回 403，投递 Codex 事件返回 200。
- 真实窗口验证了引导中的平台锁定、关于页平台绑定卡片、连接页只读绑定、解除绑定后端点/绑定文件删除且桌宠回到独立待机；打包 alpha.12 关于页显示 `v0.2.0-alpha.12`、提交 `dc2ec01436c3`、干净构建、打包发行版。
- 没有点击真实宿主安装，也没有让两个真实宿主插件同时连接。插件端点选择由单元/集成和构建产物核对，不是两个真实宿主会话的完整验收。

## 产品行为变化

1. **单平台绑定**：每个 Uta profile 的 `pet-binding.json` 只记录一个 `hostId`。绑定后，主进程运行时桥只接受该平台的 v2 事件；其他平台返回 `403 host-not-bound`。旧版无 meta 的指令只有在桌宠已绑定时才接受，未绑定桌宠拒绝。
2. **平台内会话共用**：`SessionScope` 只检查平台，不再按 session 拦截；同一平台的新会话可以驱动同一只桌宠。`session_bind` 仍会结束旧回合，避免两个流叠在舞台上。
3. **不再提供平台切换 UI**：连接与会话页显示只读的“平台绑定”；引导重入只显示已绑定平台。要换平台，从关于页解除绑定，或使用另一个平台的 `Pets` 启动器。
4. **多桌宠**：`Pets` 目录提供 Codex / DeepSeek Harness / Qoder / Antigravity / Claude Code / ZCode / OpenCode 启动脚本，每个使用独立的 `%LOCALAPPDATA%\Uta-Pets\<platform>` 数据目录，并预先设置 `UTA_BOUND_HOST`。
5. **宿主专属端点**：绑定桌宠额外写入 `%APPDATA%\uta\host-pets\<host>\runtime-endpoint.json`；插件优先读取它。端点包含 PID，读取端会跳过已退出进程留下的旧文件。
6. **升级迁移**：旧版只把平台存在 localStorage。升级后第一次启动会把它迁移为唯一绑定，并写入一次性 `uta/binding-migration-v1` 标记。解除绑定后该标记阻止旧偏好再次自动绑定。
7. **解除绑定**：关于与诊断 → 平台绑定 → 两次确认后清除绑定和宿主端点，并重载桌宠；桌宠回到独立待机，后续平台事件被拒绝。

## Codex 专项修复

1. **拒绝发言工具仍抑制最终回复**：`shouldMarkPetSpoke()` 只在 `PostToolUse` 且结果没有错误时返回 true；`PreToolUse`、`PostToolUseFailure`、`status:failed`、`is_error` 都不写发言标记。共享 hook、Qoder 和 Antigravity 都改用同一判定。
2. **单个 hook 信任误报**：`codexHookTrust()` 按插件 hooks 定义列出所需事件，逐个统计 `trusted_hash`/`trusted=true`；检测显示未信任、部分信任（x/8）或全部信任，不再因任意一个 Uta hook 就报“已信任”。定义内容变化仍以 Codex 自身的信任判定为准，本轮没有启动 app-server 逐项重新计算。
3. **共享 CODEX_HOME 安装锁**：锁文件按规范化 `CODEX_HOME` 哈希放在 `%APPDATA%\uta-host-locks`，所有 Uta profile 共用。超时未确认退出会留下 `blocked` 锁；重启或另一个 profile 仍被阻断；解除操作清除同一份锁。正常结束释放锁；权限失败会明确报错。
4. **发言标记回归**：Qoder 增加“拒绝桌宠发言工具后，Stop 仍保留最终摘要”；共享 hook 增加成功/失败判定用例。

## 自动验证

- `npm test`：**906 项，901 通过、5 跳过、0 失败**。
- `npm run test:plugin`：**105/105**（新增 host-specific endpoint 与无关/死 PID 用例）。
- `npm run typecheck`：node/web 通过。
- `npm run plugin:build`：Qoder/Antigravity/Claude/ZCode/Codex/OpenCode/DSH 产物全部重建；Qoder/Antigravity 的 `UTA_HOST` 配置和 `host-pets` 端点候选已核对。
- `npm run dist:zip`：electron-vite、electron-builder 和 ZIP manifest 通过。
- 新增正式回归：`pet-binding.test.cjs`、运行时桥的跨平台拒绝/宿主端点测试、会话共享测试、发言成功/失败测试和 hooks 部分信任测试。

## ZIP 与来源

- ZIP：`app/release/Uta-0.2.0-alpha.12-win-x64.zip`
- SHA-256：`e395d5189bd8e74b2d327ceaed26ad80aa279f3f211e5f6513fed67d1f450c50`
- Manifest：`app/release/Uta-0.2.0-alpha.12-win-x64.zip.manifest.json`，`dirty=false`，源码 `dc2ec01436c3`，构建 `2026-10-25T07:56:38.094Z`。
- 解压目录：`app/release/Uta-0.2.0-alpha.12-win-x64`。
- 包根包含 `Try-Uta.bat` 和 `Pets/`（7 个平台启动器 + `README.txt`）；`Try-Uta.bat` 使用 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.12`。
- 包内宿主材料延续 alpha.11：Codex/DSH 插件、Qoder/Antigravity ZIP、Claude/ZCode 市场、OpenCode 单文件与 `HOST-INSTALL.md`。

## 真实窗口与多实例验收

- 开发构建启动两只独立实例：
  - Codex profile `pet-codex-test`，端点端口 `56673`，数据目录 `%LOCALAPPDATA%\Uta-Candidates\multi-codex`。
  - Harness profile `pet-harness-test`，端点端口 `51411`，数据目录 `%LOCALAPPDATA%\Uta-Candidates\multi-harness`。
  - 两个实例分别写入 `%APPDATA%\uta\host-pets\codex` 和 `harness` 的端点文件，端口/PID/profile 不同。
- 向 Codex 端点投递 Harness 事件：`403 host-not-bound`，接收层 0 次；投递 Codex 事件：`200 accepted`。
- 引导页分别显示“这只桌宠已绑定到 OpenAI Codex / DeepSeek Harness”，只展示对应平台卡片，且没有“跳过宿主连接”。
- 解除绑定：两次确认后，`pet-binding.json` 和 Codex 宿主端点文件均删除；桌宠重载后不再自动绑回；向原端点投递 Codex 事件返回 403。关于页显示“尚未绑定平台 / 已解除绑定”。
- 最终打包实例 profile `packaged-alpha12-final3`，隔离 Uta 数据、`CODEX_HOME`、`DSH_HOME`；引导锁定 Codex，关于页显示 `v0.2.0-alpha.12 / dc2ec01436c3 / clean / Packaged`；连接与会话页显示“平台绑定 Codex / 这里不能切换平台”，没有旧平台目录。
- 截图证据（`docs/validation/`）：
  - `alpha12-binding-codex.png`、`alpha12-binding-harness.png`：两个实例的引导平台锁定。
  - `alpha12-unbind-confirm.png`、`alpha12-unbound.png`：解除绑定确认与结果。
  - `alpha12-packaged-about.png`：打包实例关于页。
  - `alpha12-packaged-connections.png`：打包实例只读连接页。
- 测试结束后已停止自建实例；`%APPDATA%\uta\host-pets` 中的本轮测试端点已删除。日常 Uta 0.1.1/stable 未替换、未启动。原有 `docs/AGENT-PORTABILITY-PLAN.md` 改动保留且未提交。

## 未验证与边界

- 没有点击真实 Codex“安装并连接”，没有在真实 Codex/DSH 会话中同时运行两个插件；端点路由和多实例连接只用真实 HTTP 与端点文件验证。
- **平台内所有会话共用是设计行为**。Codex 聊天 A 和 B 会共同驱动同一只桌宠；报告里“B 能影响已绑定 A”的行为不再按缺陷处理。如果将来要严格隔离单个聊天，需要另做会话级绑定。
- 同一个平台不要同时启动两只桌宠：插件只会连接最后发布端点的那一只，前一只会收不到新事件。需要换角色/配置时先退出再启动；本轮没有强制阻止同平台重复绑定。
- 自定义外部适配器 ID 可以写入绑定文件，但设置 UI 没有为它们提供新的绑定入口；本轮只保证内置平台和 `Pets` 启动器。
- hooks “定义变更”未通过 Codex app-server 逐项重算，只按配置中的完整事件集合判断；定义内容变化仍以 Codex 自己的 hooks 列表为准。
- 真实 DSH 桌面安装、其他宿主真实会话、真实麦克风/云端 TTS、8 小时/7 天、多屏 DPI、恢复页标题栏、贴靠图标同步仍未验收。
- 本候选未替换日常 0.1.1/stable，也未配置代码签名。
