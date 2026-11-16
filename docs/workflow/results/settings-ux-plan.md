# 设置 UI/UX 改造方案交付

日期：2026-10-23。状态：方案已完成，待用户评审后再开产品实施任务。

## 已完成

- Codex 在 `task/codex/settings-ux-plan`，base `21583ac`，独立文档任务区完成源码审查与方案整合；未安装依赖、未修改产品文件。
- Antigravity 在独立 `task/antigravity/settings-ux-audit`，准备后 base `5ee44da`，实际通过官方 agy CLI 1.4.5 完成首版和指定会话修订。真实会话 `34077020-4e28-4833-b99f-5259b66251b1`、模型 Gemini 3.8 Flash (High)。工具事件仅 read_file，无实现/提交/合并。每轮旧 Uta 插件停用后已恢复。
- 主控核实并纠正：适配器静态 sendInput 与实际文本桥不一致、共享模型旁车写回、过期动作补播、保存后自动播放、未测性能断言和 sandbox 降级等问题。审查输入不等于自动采纳。
- 在已构建候选 app/out、独立 integration profile 查看真实旧界面。记录七段设置、328×520 面板、465px 可见区和本次配置下 2688px 内容高；查看状态/设置/语音/工坊截图。使用原先验证过的同 SHA Electron 引擎，不使用日常 exe/用户数据。
- 可点击单文件线框通过浏览器检查：页面导航、语音字段标签/配置展开、测试草稿仍保留 dirty、平台说明、搜索跳转、工坊进入/预览/保存/退出守卫与焦点恢复。为退出对话框加背景 inert，避免键盘焦点落入背景。

## 交付入口

- [主控完整方案](../../design/settings-ux-proposal.md)：功能迁移表、六领域导航、九条用户旅程、保存规则、连接/能力证据模型、工坊状态、技术边界、实施依赖与验收。
- [Antigravity 修订与主控裁决](../../design/settings-ux-antigravity-audit.md)：真实执行方报告及未采纳项。
- [可点击线框](../../design/settings-ux-wireframe.html) 与 [阅读指南](../../design/settings-ux-review-guide.md)：虚构示例，无网络/密钥/存储/设备调用。
- [线框窄布局预览](../../design/settings-ux-preview.png)。

## 现场与待验收

全部产品源码、插件、日常 ZIP/正式配置未变化。主目录三份既有未提交规划文档不纳入本任务。Antigravity 任务工作区保持干净；其审查由 Codex 在方案分支归档。

真实旧页面观察进程已按 PID/路径/启动时间/调试口归属检查后关闭，状态记录在仓库外 operations/settings-ux-20261023/ui-process.json。保留单文件线框的只读本地预览供用户评审，监听 127.0.0.1:9281；PID/文件/状态见同目录 preview-process.json，不应将它当作另一份 Uta 实例或设置来源。任务完成后可关闭该预览进程，HTML 文件仍独立可用。

未声称完成产品 GUI 重构、全 DPI/无障碍认证、IPC 性能测量、新服务测试接口、存储迁移或打包发布。本轮只做 HTML 脚本语法/文档链接/变更范围检查，不为纯方案重复运行上一批 288/104 项产品测试。

下一步由用户评审三个核心产品决定：独立设置中心、六领域导航、可逆偏好即时生效而连接/工坊显式保存。确认后先锁数据/窗口/能力接口，再分别给 Antigravity 与 Qoder 派实现任务，Codex 验收。DSH 仅承担其宿主兼容性测试。
