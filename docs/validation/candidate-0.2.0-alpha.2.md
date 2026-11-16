# 候选 0.2.0-alpha.2 验收记录

更新：2026-10-25。候选版本 `0.2.0-alpha.2`，源码提交 `1695fcaac330803ca898c9acc48d07f06aa35338`（在 `c3679f3` 修复之上只增加版本号、独立体验入口和首次阅读说明）。

## 交付物

- ZIP：`app/release/Uta-0.2.0-alpha.2-win-x64.zip`
  SHA-256 `d6dd441147c5b15469d86911f24001f37cc3851e417c489dea5501a7f30e9f08`
- 来源清单：同目录 `.zip.manifest.json`，`dirty=false`，记录提交、构建时间、Node 版本和 SHA-256。
- 解压目录：`app/release/Uta-0.2.0-alpha.2-win-x64`，包含 `Try-Uta.bat`、`FIRST-READ.md`、授权文件。
- `Try-Uta.bat` 使用独立体验数据 `%LOCALAPPDATA%\Uta-Candidates\0.2.0-alpha.2`，不会读取或改写日常数据；直接打开 `Uta.exe` 才使用日常数据。
- 候选构建从干净 worktree 生成，三份未提交根文档没有进入 ZIP，也不影响 `dirty=false` 校验。

## 冒烟验收

用候选程序的独立体验 profile `candidate-020-alpha2` 实际操作：

- 默认角色 Hiyori Pro；桌宠画布正常；
- 快捷面板可打开，显示当前角色、日夜/主题色和三个桌面开关；
- 完整设置窗口可打开，六个领域全部存在：角色与动作、连接与会话、语音、桌面与交互、外观与性能、关于与诊断；
- 切到静态立绘 `sample_static` 后图片实际渲染（`naturalWidth=138`），再切回 Hiyori；
- 快捷面板切到夜间后关闭并重启，主题仍为夜间，模型仍为 Hiyori；候选数据环境显示 `独立实例 · candidate-020-alpha2`。

三项验收修复的复核：

- 旧发送失败覆盖新草稿：在与候选同一源码的打包构建上，用延迟 2 秒返回 HTTP 500 的本机适配器发送 A，期间输入 B；A 失败后 B 保留，状态提示未回填旧草稿。
- `.cmd/.bat` 宿主入口：路径发现不再返回批处理 shim，Claude 在无原生 exe 时解析 `node + cli.js`；相关回归通过。
- Runtime 并发同序号：seq-only、同 seq 不同 eventId 的并发预留均只允许一个；失败释放后可重试。

## 主宿主流程（Codex）

使用隔离 profile `host-flow-20261025` 和临时工作目录，通过真实 `codex exec`（ChatGPT 登录，只读沙箱，未使用用户已有会话）验证：

- 新 Codex 会话写入隔离 profile 的 `hooks/codex-session.json`，钩子事件为 SessionStart → UserPromptSubmit → Stop → SessionEnd；
- 桌宠状态从 `thinking`（工作循环 `continuous_work`）切到 `idle`；
- 助手回复 “Uta host flow two” 显示在消息记录；
- Stop 后短暂触发 `happy` 预设，再回 `neutral`；
- 把 `codex-events.jsonl` 的 mtime 调旧并在设置页“重新连接当前宿主”，界面显示“待命或离线”；恢复 mtime 后再次重连，恢复“已连接”；
- 通过已安装 Codex hook 的 Interrupt 事件路径发送取消，桌宠回到 `idle`，随后回 `neutral`。

证据在仓库内忽略目录 `Uta/.tmp/host-flow-20261025/`：`codex.log`、`codex-2.log`、`codex-events.jsonl`、`host-presentation.png`、`codex-chat.png`。没有使用用户现有 Codex 会话，也没有向真实聊天对象发送消息。

## 已知限制与边界

- 本候选没有随包附带 DS 鼠控版；真实 DS 表现仍使用用户本地模型。
- 真实麦克风、人工听感、云端 TTS 音色和外部语音服务没有在本轮重新验收。
- 仅验证 Codex；DSH、Qoder、Antigravity 的真实连接仍按路线图后续批次处理。
- 跨机器安装路径、多屏/高缩放、长时间运行和完整无障碍没有完成。
- 密钥草稿和工坊草稿的统一关闭保护仍未完成。
- 真实 Codex 只读沙箱 + 新会话用于链路验证，不代表所有 Codex 版本/权限模式都可用。

## 回退

先退出候选（右键托盘 → 退出），再启动保留的日常 0.1.1；候选数据在独立目录，日常数据未被改写。不要为了回退删除数据文件。日常入口和 stable 尚未提升。

## 日常入口

本轮只交付候选，不替换 `start-uta.bat`、日常 0.1.1 或 stable。用户实际验收候选后，再决定是否提升。
