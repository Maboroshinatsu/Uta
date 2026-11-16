# 宿主适配检查与修复（2026-11-05）

范围：Codex、DeepSeek Harness、Claude Code、Qoder、ZCode、OpenCode。排除 Antigravity 的配置、安装与运行验收。
基线 main@c6f4f13；进入时有 23 个 DSH 宿主改名相关未提交文件，本轮审核整合，不丢弃原改动。
不发送真实聊天消息；验证使用明确的独立 profile、配置目录和本地测试会话。

## 初始核验

- 非 Antigravity 插件基线：112/112 通过。
- 本机入口版本：Codex 0.166.0-alpha.6、Claude Code 2.1.138、ZCode 0.17.1、OpenCode 1.14.31。
- 本机 DSH 的安装归档元数据：dsh-desktop-host、dsh-tools、dsh-user-approval 均为 0.2.1-rc.5。
- Qoder 桌面安装存在；本轮未检测到 CLI 程序，不把桌面安装等同于可注入 CLI 会话。

## 已完成的修复

- DSH：统一 `deepseek-harness` 身份，迁移旧绑定、保持原计划源与存储键，修复绑定与审批宿主 ID 不一致。独立提交 `4579dfd`，详见 [身份整合记录](dsh-host-identity-20261105.md)。
- Claude：优先原生程序并排除 Windows shell shim；显式 JS 入口经 Node 执行；新路径即时生效，避免两类路径覆盖项互相遮挡。检测区分已禁用插件和仅添加市场。独立提交 `39e30ed`，详见 [发现与连接记录](host-discovery-20261105.md)。
- OpenCode：增加 1.14.31 `server(input) → Hooks` 入口，保留现有 `setup(ctx)` 接口，共用会话校验与表现逻辑。官方契约：[插件类型](https://github.com/anomalyco/opencode/blob/v1.14.31/packages/plugin/src/index.ts)、[宿主加载器](https://github.com/anomalyco/opencode/blob/v1.14.31/packages/opencode/src/plugin/index.ts)。
- OpenCode：适配 SDK 的 path/query/body 与 data/error 返回结构；异步接收显示“已发送”，有明确 queue 回执才显示“已排队”；目标会话或所属原生桥失效时拒绝改投。
- OpenCode：处理真实 `permission.asked/replied`，只回单次批准或拒绝；宿主已回答时撤销桌宠卡片，避免迟到决定覆盖宿主；`question.asked` 只提示回宿主选择。用户消息和旧消息片段不会当成助手回复播报。
- 连接页：Qoder、Claude、OpenCode 的文件已部署不等同于工具已验证；OpenCode 安装尊重自定义配置目录，审批卡补齐 ZCode/OpenCode 名称。
- 插件测试入口改为目录自动发现，避免新增兼容回归测试被漏跑。

## 验证证据与边界

| 宿主 | 本轮实际验证 | 尚未证明 |
| --- | --- | --- |
| Codex | 本机 CLI 在独立 CODEX_HOME 完成本地市场登记、插件安装；真实 hook 子进程 → Uta 状态与回复 | 新安装插件的 hooks 信任、真实模型工具回合 |
| DeepSeek Harness | 本机归档的 Cordis 4.0.5 实际加载插件，真实事件总线审批归属正确；Uta 窗口审批按钮往返；受控原生桥精确投递 | 完整桌面进程里的真实模型回合 |
| Claude Code | 本机 CLI 校验隔离构建插件清单；真实 hook 子进程 → Uta 状态与回复；路径/禁用状态回归 | 日常插件当前已禁用，未自动启用；真实模型回合 |
| ZCode | 本机 CLI 校验隔离构建插件清单；真实 hook 子进程 → Uta 状态与回复；保留登记的权限模式 | 真实模型回合 |
| Qoder | 实际 Qoder hook 子进程 → Uta 状态与回复；桌面会话不显示未经证实的反向输入能力 | 未检测到 CLI 程序，CLI 路线仍为试验能力；完整宿主模型回合 |
| OpenCode | 本机 1.14.31 在独立配置启动服务、加载打包插件、创建真实测试会话、登记到运行时、销毁时清理原生桥 | 真实模型回合；实际宿主权限弹窗与桌宠共同操作 |

六个宿主均在真实 Uta 窗口中用受控事件验证：思考状态、完成气泡、带宿主归属的审批卡、点击批准得到 `allowed-once`、其他宿主指令被 403 拒绝。
DSH/OpenCode 的窗口输入验证使用受控原生桥，不能算成实际宿主已经收到聊天。没有发送真实模型提示词。

证据：[窗口结果](../../validation/host-adapters-20261105/window-result.json)、[OpenCode 实际服务](../../validation/host-adapters-20261105/opencode-host.json)、[DSH 实际事件总线](../../validation/host-adapters-20261105/dsh-cordis.json)、[隔离构建与宿主校验](../../validation/host-adapters-20261105/bundle-validation.json)。同目录保留六张审批卡截图，无端点凭证和用户数据。

最终源码回归：应用测试 1350 项，1344 通过、6 项既有跳过、0 失败；插件目录自动发现并排除 Antigravity 后 118/118；Node/Web 类型检查、独立输出目录构建、diff 空白检查通过。
应用全量套件包含原有 Antigravity 回归守卫，不表示本轮对该宿主进行了适配或运行验收。

## 当前现场与下一步

- 基线与本轮变更均在 main；源码、证据和交接随对应实现提交。没有修改日常设置，也没有全局更新现有宿主插件或日常 exe。
- 临时服务/测试窗口已关闭；进程现场用 `Get-CimInstance Win32_Process` 按命令行重新核对，勿使用历史 PID。
- 剩余工作是各真实宿主的账号/模型回合验收、安装激活与最终打包版复验；Qoder 桌面反向输入仍使用宿主窗口，不能声称已实现。
