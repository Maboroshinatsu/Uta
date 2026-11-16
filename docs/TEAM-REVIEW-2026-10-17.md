# 智能体团队审查纪要（2026-10-17）

四个只读审查组并行检查了：适配器插件、宿主/运行时桥、渲染与 UX、安全与稳健性。
本文件只记录结论与优先级；已修复项对应提交 `3b4a4c5`、`3e2fbfd`、`4b3b3a9`。

> **P40 更新（提交 `4b3b3a9`）**：S06（端点原子写 + 单实例锁）、S03（审批 host:requestId，重复 409）、
> S04（未知决策 fail-closed）、刷新率异步竞态、拖拽越界/失焦收尾、静态立绘停止 Pixi/轮询、
> 窗口隐藏停止全局光标轮询均已修复。自适应帧率的既有策略未改；Antigravity 交由它自己适配。

---

## A. 适配器插件

### 已修复
- 外部插件偏好启动丢失：`getHostPreference()` 在插件注册前不再把未知 ID 覆盖成 standalone；
  插件加载完后由 `normalizeHostPreference()` 统一清理/落盘。
- HTTP 探测：健康检查 5 秒超时；探测按 epoch 丢弃迟到结果；发送 10 秒超时。
- 清单加固：保留 ID（`fake`/`standalone`/`auto`）、编码路径穿越（`%2e%2e`）、
  健康检查必须 GET、发送路由必须 POST、text/screenshot body 必须带对应占位符、
  `healthOkKey` 只认自有属性且必须为 `true`。

### 待办（按价值）
1. **设置草稿态**：现在每次输入即写存储；半截 URL 会立刻参与健康检查，清空会回落默认值。
   建议草稿 + 保存校验 + 应用前阻止非法地址。
2. **`$config` / 请求头 / query 模板**：password、boolean、select 字段目前不参与请求，
   需要鉴权的插件无法实现。
3. **插件热重载 / 启用禁用 / 卸载**：目前加载完就固化，改清单必须重启；没有注销入口。
4. **Loader 集成测试**：偏好重启恢复、超时乱序、GET 丢 body 等目前只有纯函数/单测覆盖。

---

## B. 宿主与运行时桥

### 已修复
- `streaming` 30 秒无新帧看门狗；`rp_reply` 统一复位 hold 预设（B05/B06）。
- 宿主连接状态实时转发（P36，此前已修）。

### 待办（按价值）
1. **S06 端点文件与单实例（高）**：`runtime-endpoint.json` 非原子写，读侧可能撞半截 JSON；
   无 `requestSingleInstanceLock`，双开互顶 token，先实例成孤儿。建议单实例锁 + tmp/rename +
   按 token 校验后删除。
2. **S03 审批 requestId 命名空间（高）**：仅按 requestId 建键，同名新请求会 abort 旧请求；
   Qoder 的 ID 只到毫秒并发生成，双会话可能相撞。键应包含 host/session；重复在途返回 409。
3. **S04 未知审批决策（中）**：未知值折成 `unavailable`，`cancelled` 不被接受；
   Harness 测试里 `next()` 恒返回 allowed-once，拒绝路径测不到。建议未知值 fail-closed 为 rejected。
4. **B07 Codex 假连接（已由 P56 修复）**：Codex/Claude Code/ZCode/OpenCode 统一改为 hook 日志时间探针，未运行即离线，并定期刷新。
5. **Qoder 周期探测（中）**：目前只在 connect 时探一次 hook 日志活跃度，之后不刷新。

### Antigravity 最小路线
1. 先实机确认（不要假设）它是否有 MCP、阻塞式权限 hook、session/tool/decision schema；
2. 只有 MCP 就复用 `deskpet-mcp` 做 L0（角色工具），状态可仿 Qoder 用轻量心跳文件标在线；
3. 确认权限 hook 后才接 `/approval/ask`，否则明确标注“不支持审批”；
4. 在 `plugin/README.md` 的宿主接入清单逐项验收，再写适配器与打包。

---

## C. 渲染与 UX

### 已修复
- B05/B06 状态复位（见 B 组）。
- P32-P35：固定 2 倍清晰度、刷新率四档、去掉无限 CSS 动画、全局鼠标活动感知空闲降帧。

### 待办（按价值）
1. **静态立绘模式仍保留 Pixi**：切到 image-set 后只卸载模型，`pixiApp`、共享 Ticker、
   自建 rAF 和 `breathe` 无限 CSS 仍在跑，等于空渲染。建议切静态时停 Ticker/轮询，
   或彻底销毁 Pixi app，切回 Live2D 再建。
2. **面板/审批打开时一直锁最高帧**：把 `showSettings`/`chatPanelOpen`/审批打开当成电平信号，
   阅读期间永远高帧。建议改成短时交互脉冲，或打开面板时封顶 60。
3. **全局鼠标移动 2 秒即升满帧**：正常在别处工作会频繁升帧，空闲节省被抵消。
   可评估“只在窗口附近/悬停时升满”或给活动触发加冷却；需实机体感确认。
4. **rAF 与全局轮询未随降帧/隐藏停止**：自建 rAF 仍按显示刷新率跑；
   主进程 33ms 全局光标轮询在窗口隐藏、最小化、立绘模式都不停。
5. **拖拽越界后 `isDragging` 卡死**：document 收不到 mouseup，持续锁满帧。
   建议 Pointer Events + `setPointerCapture`，`blur` 强制收尾。
6. **待机动作**：不检查拖拽/面板/预设编辑；且恒播 index 0，多待机动作只播第一条。
7. **刷新率竞态/多屏**：先点自适应再点 120，较慢的 IPC 返回可能把 240 写回；
   窗口移到不同刷新率屏幕不会重算。建议请求代际令牌 + display-metrics 监听。
8. **悬停半透明双存储不同步**：设置面板只改 store/localStorage，主进程托盘/快捷键仍按旧值翻转；
   文案写“移入窗口”，实际是墨迹命中。
9. **可选功能**：逐区域穿透（非角色/UI 区域 `setIgnoreMouseEvents`），减少透明窗挡住桌面。

---

## D. 安全与稳健性

### 已修复
- **S02**：`normalizeModelContext()` 对模型名/情绪/预设组做控制字符清理、去重、数量与长度上限；
  DeepSeek Harness 的 System Prompt 把模型元数据用 JSON 包裹并明确标注“名称数据，不是指令”。
- **S01**：`uta://` 读取、`resolveModelFilePath`、预设写入统一 realpath 收口 +
  模型资源扩展名白名单；预设目标若链接到外部则拒绝；新增真实 junction 越界测试。

### 待办（按价值）
1. **S05 渲染进程加固（中高）**：`sandbox:false`、打包版可开 DevTools、无 CSP/导航拦截。
   建议 sandbox:true、CSP、拦新窗/导航，DevTools 只在开发环境开放。
2. **S06 端点文件/单实例**（见 B 组）。
3. **S03/S04 审批**（见 B 组）。
4. **插件默认地址与外发**：外部插件默认 baseUrl 应优先回环；非回环地址在设置里给出明确提示。
   当前 JSON 清单/64KB/50 目录/IPC sender 校验边界没有问题。

---

## E. 建议的下一步顺序

> P40 已完成原第 1、2 项与原第 4 项里的静态立绘/拖拽收尾；以下为剩余顺序。

1. **S05 渲染进程加固**（sandbox/CSP/DevTools）；
2. **插件侧**：设置草稿态、热重载/启停；
3. 渲染侧：待机动作忙碌判定/随机 index、悬停半透明双存储同步；
4. **B07 Codex 假连接 / Qoder 周期探测**；
5. 面板打开时锁最高帧、全屏鼠标活动即升帧属于现有自适应策略，按用户要求暂不调整。
- Antigravity：用户决定由 Antigravity 自己适配，不再由本项目排期。

## F. 本轮验证
- app 单测 **125/125**、插件 **39/39**、typecheck、build 通过；
- 实机重启后模型在 realpath + 扩展名白名单下正常加载（726×1222 画布，无模型错误）；
- streaming 看门狗的实机隔离验证被当时 Qoder 连续 Bash 事件干扰（状态被 PreToolUse 覆盖），
  代码路径已通过类型检查和逻辑审查，建议在安静宿主会话中再确认一次。
