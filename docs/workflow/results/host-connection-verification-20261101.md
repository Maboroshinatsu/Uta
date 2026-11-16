# 宿主连接能力实测与 Qoder 插件同步（2026-11-01 深夜）

基线：`main@03ea07c`，开始时工作区干净。被测对象是当时运行的源码开发实例
profile `dev-f7e444bba875`（PID 18932，运行时端口 60696，绑定 `qoder` + `sharedDiscovery`，模型大肥鱼）。
本轮只做实测与插件同步，未修改业务代码。

## 一、实测结论（应用侧连接能力，用当前源码构建的运行时驱动）

| 能力 | 结果 | 证据 |
| --- | --- | --- |
| v2 事件链路 | 通过 | `SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop → SessionEnd` 逐个经真实 hook 投递，`/context` 注册出 `qoder/uta-hosttest-20261101`，`sdkVersion 0.1.11`，`cwd` 正确 |
| 回复入档 | 通过 | Stop 正文实际写入 `chat-history.v1.json`，非仅 HTTP 200 |
| 宿主计划镜像 | 通过 | `TodoWrite` 的 PostToolUse 生成 `host-plans.v1.json` 一条含 3 项、`source: qoder-todo` |
| 审批往返 | 通过 | `/approval/ask` 挂起后 `/approval/cancel` 回显宿主原始 `requestId`，ask 侧收到 `outcome: cancelled`；hook 无决策时 stdout 为空，Qoder 保留自身对话框 |
| 单宿主绑定隔离 | 通过 | 伪造 `codex` 的 `/command`、`/approval/ask` 均 403 `host-not-bound`；绑定宿主 200 |
| MCP 角色工具 | 通过 | `deskpet-mcp v0.4.1` 完成 initialize/tools list；`notify`/`set_emotion`/`set_preset` 均驱动到画面，中文预设名（思考、脱捕、狗尾巴草打开）可用 |
| 端点发现 | 通过 | stderr 确认候选顺序把 `host-pets/qoder` 排在共享端点之前；死 PID 的共享端点被跳过 |

## 二、本机真实缺口（已修）

已安装的 Qoder 插件缓存是 2026-10-21 同步的 0.1.9：只读共享端点，不认 `host-pets/<host>`，
也不校验端点 PID 是否存活。当时共享端点文件指向已退出的 stable 实例（PID 19352 / 端口 57133），
因此这个会话里 hook 只在磁盘留下事件日志，宠物侧零会话，MCP 直连报 `ECONNREFUSED`。

处理：`node plugin/scripts/build-qoder-plugin.mjs` 重新构建（自包含检查 OK，manifest 0.1.11），
备份旧缓存到 `D:/Frankenstein/.tmp/qoder-cache-backup-20261101-225823/uta-deskpet-0.1.0`（6 文件），
再把 7 个产物文件覆盖进 `~/.qoder-cn/plugins/cache/local/uta-deskpet/0.1.0`
（目录名与注册表 version 保持 0.1.0，与既有做法一致）。
`hooks/hooks.json` 与旧版逐字节相同，因此 hook 命令未变，重启后无需重新信任。

装完立即复验：**hook 通道无需重启 Qoder 就生效**（每次事件现起 node 进程，直接读新文件），
本会话的真实 session `qoder:bd8a52fb-…` 出现在宠物 `/context`。
应用内 MCP 服务器仍按旧 `mcp.json` 的环境启动，没带新增的 `UTA_HOST=qoder`，
所以报的是"runtime 未运行/无配对"（新客户端跳过死端点后的正确语义），**需要重启一次 Qoder** 才会加载新 `mcp.json`。

## 三、遗留缺陷（本轮未改）

1. `play_animation` 的动作名走 `sanitizeToken`（`/^[A-Za-z0-9_-]{1,32}$/`），而 `/context` 广播的
   `modelContext.animations` 取自 `motionGroups` 键名，中文模型（大肥鱼、DS 鼠控版）的动作组名一律被拒；
   同名走 `set_preset` 反而可用。实测 `脱捕`、`狗尾巴草打开` 触发 `name must match …`。
   注意：收尾时工作区已出现另一实施会话对这 8 个文件的未提交修改，
   （`runtime-commands.ts` 新增 `sanitizeAnimationName` + `ANIMATION_NAME_PATTERN`，
   以及 `emotion-adapter.ts`、`useStageModelLifecycle.ts`、`plugin/plugins/deskpet-mcp/server.mjs` 和两份测试），
   正是此项修复。本记录只登记事实，不去改动或提交他人现场。
2. MCP 走 legacy 通道时会在 `/context` 留下无宿主身份的 `legacy:` 会话记录（`sdkVersion undefined`）。
3. dev 实例退出后 `host-pets/qoder/runtime-endpoint.json` 与共享端点文件都成了死文件残留；新客户端能跳过，
   但磁盘上仍留着过期配对。
4. 未验收：宠物窗口内的真实点击（审批卡片的允许/拒绝、快捷面板）、Uta → Qoder 的反向注入
   （Qoder 桌面无官方文本注入通道，CLI 通道需真实账号会话）、多宿主并发动画与语音通道。

## 四、现场与后续

- 本轮结束时**没有任何 Uta/Electron 进程在运行**（dev 实例在本轮中途退出，非本轮停止），
  两个端点文件为死实例残留。
- 自建测试数据已清理：`chat-history.v1.json` 5 条全部为本轮合成用例，已回到 0 条；
  `host-plans.v1.json` 1 条测试计划已回到 0 条。宠物预设被切到"日常待机"。
- 下一步：启动 dev 实例（`app` 下 `npm run dev`）→ 重启一次 Qoder → 在真实会话里看工作状态、
  回复气泡与审批卡片点击，才算这次连接能力验收闭环。
- 复现脚本保留在 `D:/Frankenstein/.tmp/uta-host-test-20261101/`（事件序列、MCP、审批、安装冒烟、清理）。
