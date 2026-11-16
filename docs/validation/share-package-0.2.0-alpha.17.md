# 分享包验收：0.2.0-alpha.17

日期：2026-10-26。用途：给其他人试用的 Windows x64 分享包，包含 DS 鼠控版、Hiyori 和 Uta-MaiBot 适配器。

## 产物

- ZIP：`app/release/Uta-0.2.0-alpha.17-win-x64.zip`
- SHA-256：`f970d6311a489d87ddeebf9d49ccf8e8cb027eb731c57b5c3fcd55bbf77b6df4`
- 来源：`9a087a62c22e14256c07745749b8f58755d01b32`，`dirty=false`
- 适配器与引导提交：`a7b9a77`；分享打包提交：`9a087a6`
- 应用测试：932 项（927 通过、5 跳过、0 失败）
- 适配器测试：17/17 通过（使用 MaiBot SDK 2.5.2 与真实 `maibot_sdk`）
- node/web 类型检查、`electron-vite build` 通过

## 包内容核对

- `resources/maibot-adapter/`：`plugin.py`、`_manifest.json`、`config.toml`、`README.md`；未包含 `tests/` 或 `__pycache__`。
- `resources/app.asar` 内：
  - `out/renderer/models/DS-control/c_0120.model3.json` 及全部纹理、动作、表情、物理文件；
  - `out/renderer/models/DS-control/MODEL-NOTICE.txt`；
  - `out/renderer/models/hiyori_pro_zh/.../hiyori_pro_t11.model3.json` 及完整 runtime；
  - `out/build-info.json` 记录 `sharePackage=true`、`models=["DS-control/c_0120","hiyori_pro_zh"]`。
- ZIP 根目录：`README-FIRST.md`、`FIRST-READ.md`、`DS-MODEL-NOTICE.md`、`MAIBOT-ADAPTER.md`、许可证、`Pets/`、`Uta.exe`。
- 已从分享 ZIP 中移除 `Try-Uta.bat`：候选启动器使用独立 profile，不会发布 `host-pets/maibot` 端点，MaiBot 适配器无法发现该实例。
- app.asar 未发现 `pet-binding.json`、`runtime-endpoint.json`、`settings.json`、TTS 密钥等个人数据文件。

## 真实窗口与运行时验收

### 1. 首次引导里的 MaiBot 卡片

用生产构建 + 全新隔离 profile（`share-check2`）启动，首次引导检测到 8 个宿主。MaiBot 卡片显示：

- 名称“MaiBot 适配器”，标签“兼容接入”；
- 徽标“随包适配器 / 需放入 MaiBot”；
- 阶段：检测宿主“随包提供，无需自动检测”（已验证）、安装插件/桥接工具（需手动）、运行时（已验证）、绑定会话/回声校验（等待中）；
- 三条手动步骤完整显示。

截图：[onboarding-maibot.png](screenshots-0.2.0-alpha.17/onboarding-maibot.png)

### 2. 绑定与 v2 运行时回复

在上述隔离实例完成引导并绑定到 MaiBot（`pet-binding.json` 写入 `"hostId": "maibot"`）。读取该实例的 `runtime-endpoint.json` 后，按适配器的完全相同的 v2 信封发送：

- `agent_state thinking`；
- 两段 `rp_reply`（同一 `requestId`，`streaming=true, done=false`）；
- 空文本收尾 `done=true`；
- `agent_state completed`、`set_emotion happy`。

全部返回 `200 / ok:true / accepted:true / hostId:maibot`。桌宠气泡显示“适配器联调成功，鲸鱼娘已上线。”，说明主机过滤、流式拼接和气泡渲染都真实工作。

截图：[runtime-reply.png](screenshots-0.2.0-alpha.17/runtime-reply.png)

### 3. 成品包内模型加载

直接启动 `app/release/win-unpacked/Uta.exe`，使用全新的 `share-verify` 隔离 profile：

- 引导角色列表显示 3 个模型：`DS-control / c_0120`、`hiyori_pro_zh / hiyori_pro_t11`、`sample_static`；
- 选择 DS-control 后显示“桌面正在使用”；
- 桌宠窗口实际渲染 DS 鲸鱼娘模型（从 app.asar 经 `uta://` 协议读取纹理、moc3 与物理）。

截图：[model-picker-ds.png](screenshots-0.2.0-alpha.17/model-picker-ds.png)、[packaged-ds.png](screenshots-0.2.0-alpha.17/packaged-ds.png)

### 4. 随包适配器可加载

从解压后的 `resources/maibot-adapter` 直接导入并创建插件，真实 SDK 识别到：

- `HOOK_HANDLER:uta_inbound_state`；
- `MESSAGE_GATEWAY:uta`；
- 版本 `0.1.0`。

## 未验收边界

- 没有启动真实 MaiBot + QQ 账号做端到端收发；`/input/text` 注入与 `chat.receive.before_process` 只在单元测试/真实 SDK 组件层验证。首次真实使用时按 `MAIBOT-ADAPTER.md` 排查。
- 包未做代码签名；Windows SmartScreen 提示是预期现象。
- MaiBot 其他平台的回复不会进入 Uta，这是刻意设计，不是漏收。
- 分享包运行稳定的 `Uta.exe`；已移除候选启动器。不要用源码开发 profile 的端点手动测试后把结果当作分享包自动发现通过。
- 日常 stable 数据、用户正在运行的日常实例和 MaiBot 日常配置均未触碰。

## 清理现场

- 验证实例 `share-check`、`share-check2`、`share-verify` 及对应 Electron/Uta 进程已停止，测试 profile 已删除。
- 截图归档在 `docs/validation/screenshots-0.2.0-alpha.17/`，`.tmp` 原图可丢弃。
- 分享 ZIP 与 manifest 留在 `app/release/`。
