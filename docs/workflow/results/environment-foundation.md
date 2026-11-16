# 开发环境隔离与 ZIP 发布基础交付

Owner：Codex；基础提交 `094c0b35994aa2bc87155ac4b149c961e4ca78f4`。

## 已实现

- 主进程与插件共享目录契约。源码默认 dev profile；打包 exe 默认 stable。显式开发目录/端点不会读取日常数据，冲突路径拒绝。
- 非日常 profile 独立 userData/sessionData/锁，关闭自动旧模型迁移、全局快捷键、麦克风权限；窗口与托盘标明 profile。
- Codex、Qoder、Antigravity hooks 与 DSH 日志、会话、去重文件改走运行目录；主进程反向会话查询同样隔离。
- 显式目标不可用不回退；健康探测失败不误发裸指令；实例 token 变化重新握手；端点发布失败关闭监听。
- ZIP 包、来源与 SHA256 清单、诊断脚本、新建任务脚本；start-uta.bat 只启动登记过的解压包，不启动源码 Electron、不修改工作区权限。

## 检查证据

- `npm run typecheck` 通过；`npm test` 252/252；`npm run test:plugin` 104/104。
- 主控工作区外 `Uta-Workspace/environment-*.log` 记录检查和构建。
- 初始 dirty 候选包解压后两个 profile 同时运行，认证健康查询返回各自 profile/PID，角色均可用；第一个 profile 的真实 store/DOM 出现“隔离环境气泡验证”并切换 happy 预设。日常实例未被替换。
- 初始打包遇到系统 TEMP 权限问题，打包改用 app/build/tmp；解压目录继承 Low 完整性导致 Electron 崩溃，验证后仅对专用候选目录设置 Medium，未改父工作区或其他平台权限。

## 最终验收与集成

- 干净提交 `dcf1b3f6aca38ed3f46738771f7f7c8e9232dde6` 已生成 Uta 0.1.1 ZIP，SHA256 为 `c87eda3b12bdfc5b245483b5948391808efcbc41a844e571ab67fc94c30c2507`。包内构建记录 dirty=false。
- 最终解压包在独立 profile 启动，实际 IPC 返回 packaged=true 与上述提交；模型加载、MCP 能力查询、通知、开心预设均在实际渲染 store/DOM 验证。
- task 分支快进合入 main。日常设置已在关闭实例后备份至仓库外 backups，用户模型保留原位。正式 exe 读取原用户目录，实际确认 DS 鲸鱼娘模型与 Codex 偏好保留，无需导入测试设置。
- 最终 exe 位于 `D:/Frankenstein/Uta-Workspace/artifacts/dcf1b3f-0.1.1/Uta.exe`。operations/stable.json 登记入口、来源和验收；启动脚本还增加了独立日志及异常退出检查。当前普通主进程 PID 33596，无远程调试参数；PID 属当时现场，以实时查询为准。
- Codex 插件从 main 本地市场安装到 0.2.2。Qoder 0.1.10、Antigravity 0.1.6、DSH 0.5.3 等仅构建，未覆盖平台现有配置，真实宿主测试仍由后续任务完成。

## 后续范围

跨页面持久设置迁移、四个平台实际独立配置/派单、诊断界面尚待后续任务。当前更新的插件源码和构建产物不等于其他平台已安装新版。原渲染会话业务缺陷未混入本任务。
