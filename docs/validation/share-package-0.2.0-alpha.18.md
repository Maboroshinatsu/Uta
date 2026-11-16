# 分享包验收：0.2.0-alpha.18（DSH 一键注入）

日期：2026-10-26。产物：给他人试用的 Windows x64 分享包，包含 DS 鼠控版、Hiyori、MaiBot 适配器和 DSH 一键插件安装。

## 产物与提交

- ZIP：`app/release/Uta-0.2.0-alpha.18-win-x64.zip`
- SHA-256：`8ab16619d459f811cbb977cbcf30d4505bfef8a26f0a271b035e2904070ff394`
- 来源：`69758f36d16d9a217dc2b3b459efba1f9e417853`，`dirty=false`
- DSH 功能提交：`164623b`；版本与分享说明：`69758f3`
- 应用测试：939 项（934 通过、5 跳过、0 失败）
- MaiBot 适配器：17/17
- node/web 类型检查与 `electron-vite build` 通过
- ZIP 完整性测试通过；`Try-Uta.bat` 已移除；根目录包含 `README-FIRST.md`、`FIRST-READ.md`、`DS-MODEL-NOTICE.md`、`MAIBOT-ADAPTER.md`；资源中包含两套模型、`maibot-adapter` 与 `uta-plugins/deepseek-harness`。

## DSH 修复内容

- 自动发现常见 DSH 安装位置：`%LOCALAPPDATA%\Programs\DeepSeek Harness`、`Program Files`、`D:/DeepSeek-Harness`，并保留 `UTA_HARNESS_EXE`/`UTA_HARNESS_CLI` 覆盖。
- DSH 数据目录优先使用显式 `DSH_HOME`/`UTA_DSH_HOME` 或用户在引导里选择的 `.dsh`；不会再在显式路径不存在时悄悄改用另一个 `.dsh`。
- 引导 DSH 卡片新增“安装 Uta 插件”：完全退出 DSH 后，先备份 `package.json`、`cordis.patch.yml`、`cordis.yml`、`pnpm-lock.yaml`，再调用 DSH 自带的 exe + `dsh-desktop-host/lib/cli.js` 执行 `plugin --profile desktop add`，最后回读依赖、bundle 和 `node_modules/@uta/deepseek-harness-plugin` 链接。
- 失败恢复备份；DSH 运行中直接拒绝安装；安装超时保留锁和备份，避免半写入后继续。
- 找不到程序/数据目录时提供“选择 DSH 程序”“选择 DSH 数据目录”，并允许先跳过宿主继续引导，不再停在一条不可执行的 `dsh` 命令上。

## 真实验收

### 隔离假 DSH 数据 + 真实 Electron

用假的 DSH `home/profiles/desktop`、假 CLI（真实 Node 执行）和假 `DeepSeek Harness.exe` 覆盖：

- 来源源码构建窗口与解压后的 alpha.18 `Uta.exe` 都从引导里完成了“选择 DSH → 安装 Uta 插件”。
- 结果：插件依赖写入、bundle 追加、`node_modules` 链接创建；安装结果回读为“插件已安装”；显示备份路径、需要重启 DSH、需要新开会话。
- 成品包的链接指向 `release/win-unpacked/resources/uta-plugins/deepseek-harness`，证明 extraResources 路径正确。
- 真实 `C:\Users\Administrator\.dsh\profiles\desktop\package.json` 的 mtime 和内容均未改变；测试只写入隔离的假 profile。
- 截图：[解压成品包](screenshots-0.2.0-alpha.18/dsh-packaged-install.png)、[源码构建](screenshots-0.2.0-alpha.18/dsh-source-install.png)。

### 真实 DSH CLI

只对真实 DSH 执行了只读的 `plugin --profile desktop list`，确认 Uta 侧推导的 exe + asar CLI 调用方式可用；没有在真实 profile 上执行安装写入。真实安装留给朋友机器上的第一次点击。

## 未验收边界

- 没有用真实的 DSH 日常 profile 执行一次 `plugin add`；第一次真实安装仍需观察 DSH 自带 CLI 的输出与重启后的工具列表。
- 没有验证 DSH 重启后的 `uta_express`、系统提示注入、审批卡片；这些依赖同一个 DSH 插件，需在朋友机器上确认。
- 分享包未签名；SmartScreen 提示预期。
- 真实 MaiBot + QQ 端到端仍未验收；MaiBot 适配器只经过组件/模拟运行时测试。
- 8 小时/7 天、多屏 DPI 未覆盖。
