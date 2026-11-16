# 宿主适配与 Coopanion 借鉴实施结果

日期：2026-10-31。工作区 `D:/Frankenstein/Uta`，`main`。用户授权实施并确认 DSH 会话收尾后接手；未安装真实宿主插件、未重启宿主、未改日常数据或执行真实账号任务。

## 本轮完成

| 范围 | 已落地行为 | 验证边界 |
| --- | --- | --- |
| 公共发送 | 固定会话与配置；区分排队、接收、完成、确定未发、结果未知；未知不补发或恢复重发草稿 | 真实生产桥 + 本地 HTTP/假 CLI、历史重启 |
| Codex | 精确线程队列，显示“已排队”，保留 CODEX_HOME/cwd | 官方参数 + 隔离程序回归；不代表模型已处理 |
| Claude | 指定项目/配置续跑，JSON 按 ID 解析，处理失败不当作未发送 | 结构化回执与配置隔离；真实并发仍待验收 |
| ZCode | 显式继承已登记权限，未知模式不发送；JSON 匹配会话 | 已核实本机 prompt 默认 yolo 风险；真实账号未运行 |
| Qoder CLI | 显式启动器登记 CLI/配置/插件，只有已确认空闲的 CLI 可试验性续跑 | 参数与模拟进程验证；真实 CLI JSON/并发仍待验收，桌面输入保留宿主 |
| OpenCode 2.x | 插件原生输入箱、会话所属桥、鉴权与目录复核，显示排队；所有事件归属与成功后 Todo | 模拟真实 SDK 契约 + 本地 HTTP；不使用独立 1.14 CLI 接管 2.x |
| Antigravity | conversation 归属、单/多工作区区分，未知停止不冒充成功 | 真实 hook 子进程；各宿主表面实际采用仍待验收 |
| 角色导入 | 文件夹/ZIP 暂存、预检、独立 Live2D/立绘预览、同名确认、失败回滚与中断恢复 | 文件系统与 ZIP 回归 + 私有 Electron 画面 |
| 能力变化 | 当前 ready/kind/revision/动作；换角色更新，过期动作在主进程/renderer 均被拦截 | HTTP/MCP/renderer 回归 + Electron 换模上下文 |

MaiBot/AstrBot 的既有适配保留；本轮没有新增未经验证的外部输入接口。人格、记忆和内容决策仍归宿主。Coopanion 只借鉴交互与数据流程，没有复制其代码或资产。

## 源码与检查

- DSH 基线整合：`636560d`。
- 公共投递与权限：`e5075de`。
- 能力来源、结构化结果与 OpenCode：`00b04aa`。
- Qoder CLI：`4ac30c5`。
- 导入与能力版本：`66564c8`。
- 最后一批会话/忙碌/原生桥收口与本文一起提交，见 Git 最近记录。
- 应用 **1147 通过、6 跳过、0 失败**；插件 **124/124**；Node/Web 类型、应用与所有插件构建通过。
- Electron 私有 `host-import-test7`：保存前后都是 Hiyori，点击使用才切换立绘；两种预览通过；换模后能力版本改变，立绘无 Live2D 动作/预设；1080/760 无横向溢出。

本机证据：`.tmp/host-adaptation-20261031/` 内 `app-acceptance-tests.log`、`plugin-acceptance-tests.log`、构建日志、`gui-import-result.json`、`import-preview.png` 与 `import-live2d-preview.png`。测试进程退出、端点移除，截图/日志保留；7 个隔离 `gui-profile*` 目录的递归清理被自动审批拒绝（仅返回 blocked by policy），因此保留测试数据；没有留下服务。

## 仍待完成的验收与可选范围

源码可审查、可构建；仍需各真实目标版本的插件安装、收发、取消/失败、实际权限采用及最终 ZIP 验收。Qoder CLI 明确是实验路线；未将它或 OpenCode 模拟上下文当成真实宿主验收。当前 `app/out` 已更新，旧分享 ZIP 未替换。

互动回传、异步问题卡、本地 STT 包、OBS、走动、Cortico 等仍是可选后续范围，未在本轮默认启用。状态延时/去重继续使用现有控制器，本轮没有把 Coopanion 的数值未经体验验证就替换进去。
