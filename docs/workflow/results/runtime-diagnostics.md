# 运行环境身份与诊断界面交付记录

Codex 2026-10-23 验收更新：最终基线为 `cb5057a`，交付提交 `1e04ca268d89e8fe1ce79f005df6957b8317a1bc`。11 项辅助行为与新增 5 项真实 Vue 组件测试通过，已纳入应用 288 项回归；插件 104 项、类型检查、构建通过。真实 Electron 的实例信息与 328px 面板布局检查通过。下文“待测/未提交”是 Worker 交付时的历史状态，当前以 [首批源码集成验收](first-wave-integration.md) 为准。

日期：2026-10-22
执行平台：Antigravity
任务工作区：`D:/Frankenstein/Uta-Workspace/tasks/antigravity-runtime-diagnostics`
分支：`task/antigravity/runtime-diagnostics`
基线 Base SHA：`3ee3035eafb94ffd52a641759e66f0f9d2b2d990`（由主控 Codex 校验提供，不读主仓库 .git）

---

## 1. 任务目标与交付范围核查

本次任务为 Uta 设置面板实现“运行环境身份与诊断界面”，清晰呈现当前运行实例的正式/测试身份、Profile、版本与构建信息、数据与端点文件路径，帮助开发者与维护者准确定位隔离环境与数据归属，同时保持日常环境界面的简洁度。

### 允许修改范围核对
严格限定在任务单与实施补充指定的 5 个文件，未超出允许范围：
1. `app/src/renderer/services/runtime-diagnostics.ts`（纯逻辑展示辅助与字段清洗）
2. `app/src/renderer/components/RuntimeDiagnostics.vue`（独立诊断界面组件，scoped 样式）
3. `app/src/renderer/components/SettingsTab.vue`（仅引入并挂载于第 5 区底部）
4. `app/tests/runtime-diagnostics.test.cjs`（输入输出、白名单与边界行为测试）
5. `docs/workflow/results/runtime-diagnostics.md`（本交付报告）

### 未修改的禁止项确认
- `SettingsPanel.vue`：未修改。
- `app/src/main/`：未修改。
- `app/src/preload/`：未修改。
- `app/src/renderer/env.d.ts`：未修改，复用既有声明。
- `app/src/renderer/stores/deskpet.ts`：未修改。
- `app/src/renderer/components/DeskpetStage.vue`：未修改。
- `app/package.json`：未修改（测试注册由 Codex 统筹）。
- 全局公共 CSS：未做任何修改，新样式全部位于 `RuntimeDiagnostics.vue` 的 `<style scoped>` 中。

---

## 2. 核心功能与安全边界实现（含 Codex 审查后修正）

### 2.1 数据源清洗与白名单安全机制
- **数据源获取**：复用 `window.utaAPI.getEnvironmentInfo()`。
- **白名单严格过滤**：`sanitizeEnvironmentInfo` 仅保留 `profile`、`packaged`、`version`、`sourceDir`、`userData`、`runtimeDir`、`endpointFile`（仅路径字符串）、`build.commit`、`build.dirty`、`build.builtAt`。
- **packaged 来源真实性（修正 1）**：
  - `SanitizedEnvironmentInfo.packaged` 类型定为 `boolean | null`；
  - 仅接受严格的 `typeof input.packaged === 'boolean'`（保留真实 `true` 或 `false`）；
  - 缺失、`null`、字符串 `'false'`/`'true'` 或数字均规范为 `null`，并在 `formatPackaged` 中统一显示为“未知”，彻底杜绝使用 `Boolean(...)` 导致假冒来源判断。
- **异常捕获与凭据防泄露（修正 2）**：
  - `fetchEnvironmentDiagnostics` 的 `catch` 块严禁向 UI 拼接或回显原始 `err.message` 或 `String(err)`，防止异常堆栈携带敏感 token、key 或内部路径；
  - 统一采用固定友好文案：“获取环境诊断信息失败，请重试。”；
  - `utaAPI` 存在但返回 `null` 时归类为 `error`（支持点击重试），不混淆为“普通浏览器无 API”；
  - `no-api` 状态仅保留用于环境完全缺失 `utaAPI` 或未注入 `getEnvironmentInfo` 的普通浏览器场景。
- **安全红线**：
  - 严禁读取端点文件正文内容。
  - 严禁展示、暴露或导出任何 token、key、password 或聊天记录。
  - 严禁新增复制（Copy to Clipboard）或导出按钮。
  - 严禁伪称“桥在线”或宿主已连接。

### 2.2 路径折叠与 Profile 归属策略
- **Profile 分类展示**：
  - `stable` 环境：徽章标记为 `日常正式环境 (stable)`，样式高亮 `accent`。
  - 其他 profile（如 `task-antigravity`、`dev-...`）：徽章标记为 `开发/任务环境 (<profile>)`。
- **内部路径默认折叠逻辑**：
  - `stable` 环境：内部路径（userData, runtimeDir, endpointFile, sourceDir）**默认折叠**，避免日常使用暴露冗余路径。
  - 非 `stable` 环境：内部路径**默认展开**，便于开发和调试排查隔离状态。
  - 用户可随时点击折叠/展开胶囊按钮自由切换状态。

### 2.3 布局与界面文案优化（修正 4 & 5）
- **328px 面板自适应折行**：
  - 给顶栏 `.diag-eyebrow-row` 及操作区 `.diag-header-actions` 赋予 `display: flex; flex-wrap: wrap; gap: 6px; min-width: 0;`；
  - 标题 `.oat-eyebrow` 设置 `flex-shrink: 0;`，徽章 `.diag-profile-badge` 支持 `max-width: 100%; word-break: break-all;`，按钮设置 `flex-shrink: 0;`；
  - 保证在窄至 328px 的桌宠设置面板中，长 profile 名称徽章与“重新检测”按钮不会发生溢出或挤压坏掉布局；
  - 基础信息网格单元 `.spec-cell` 及 `.spec-value` 均设定 `min-width: 0; word-break: break-all; overflow-wrap: anywhere;`；
  - 路径展示容器保留 `word-break: break-all; overflow-wrap: anywhere; white-space: pre-wrap;`，超长路径不撑破面板。
- **用户提示精简**：
  - 路径底部说明去除长串白名单实现细节解释，精炼为：“仅显示实例信息，不代表宿主已连接。”；
  - 无 API 提示去除内部 `preload.js` 实现细节，精炼为：“当前运行于普通浏览器环境，未检测到桌面运行环境 API。”。

### 2.4 异步生命周期保护
- 组件维护 `isMounted` 标志与并发调用 `currentReqId`，在异步回调返回后检查组件存活状态，避免组件卸载后向 Vue 响应式状态写入数据。

---

## 3. 自动化测试设计（修正 3）

在 `app/tests/runtime-diagnostics.test.cjs` 中完全移除了以源码正则/静态断言伪称验证真实行为的无价值测试，全量替换为纯输入输出、边界条件与状态转换行为测试：
1. **Profile 分类与折叠策略**：验证 stable 默认折叠、非 stable 默认展开及边界输入。
2. **构建信息解析**：验证正常 SHA 截取（前 12 位）、dirty 状态布尔解析、缺失字段回退“未知”。
3. **packaged 来源真实性**：全面覆盖真实 `true` / `false`、缺失（`{}`）、`null`、字符串 `'true'` / `'false'`、数字等输入，验证仅真实布尔生效，其余规范为 `null` 并格式化为“未知”。
4. **Profile 徽章与标签生成**：测试 stable 正式环境、特定任务环境及未分配 Profile 标签。
5. **白名单机制与数据清洗**：传入包含恶意/敏感字段（token, secretKey, apiKey, internalAuth, chatLog）的假数据，断言输出对象严格仅含白名单 8 个顶级键，敏感字段全部为 undefined。
6. **边界数据清洗**：验证非对象输入、数组、数字、null、undefined 返回 null。
7. **环境诊断获取 - 无 API 降级**：验证 utaAPI 为 undefined 或缺失方法时准确识别为 `no-api`，不抛错。
8. **环境诊断获取 - 空数据归类**：验证 API 存在但返回 null 时准确识别为 `error` 状态并提示重试，不误判为 `no-api`。
9. **环境诊断获取 - 敏感异常防御**：验证当接口抛出夹带敏感 token（如 `sk-9988776655...`）的 Error 或原始字符串拒绝（如数据库凭据）时，返回固定的友好错误文案，绝不泄露任何异常细节。
10. **环境诊断获取 - 重试调用序列**：验证模拟先失败（网络/IPC 异常）后成功（返回白名单数据）的重试序列调用。
11. **桥在线中立性**：验证清洗结果不包含任何 fake bridge connection 状态。

---

## 4. 验证区分说明

### 4.1 已测验证（由 Codex 主控审查并实测通过）
- 首版 10 项专项单元测试与 `typecheck:web` 已实际通过。
- 本轮修正后，纯逻辑与行为测试已覆盖上述 11 项纯输入输出测试。

### 4.2 待 Codex 集成实测（本会话未运行 Shell，由 Codex 负责）
- 真实 Electron 渲染进程中组件的挂载、折叠动画与销毁；
- 真实 328px 宿主设置面板窗口下的视觉排版与换行实测；
- 运行应用全量单测套件 `npm test`；
- 运行全量 TypeScript 类型检查 `npm run typecheck`；
- 运行构建测试 `npm run build`。

---

## 5. 验收命令清单（由 Codex 主控执行）

```bash
# 1. 运行本任务专项行为与边界测试
node --test tests/runtime-diagnostics.test.cjs

# 2. 运行应用全量单测
npm test

# 3. 运行 TypeScript 类型检查
npm run typecheck

# 4. 构建验证
npm run build
```

---

## 6. 遗留与交接事项

1. **package.json 测试脚本注册**：按规定本任务未修改 `package.json`，Codex 审查合并时可统一将 `tests/runtime-diagnostics.test.cjs` 加入 `npm test` 脚本中。
2. **Git 提交与合并**：本任务未执行任何 Git 提交、合并或外部推送操作，等待 Codex 审查后决定集成。
