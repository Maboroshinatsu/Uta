# Uta 交接现场

> 本文件只描述「现在」，**每轮原地覆盖，不追加历史**。历史条目在 `archive/`，规则见 `HANDOFF-DISCIPLINE.md`。
> 上一轮（11-04 T5/常驻基准）的现场正文由 git 保护：`git show 7b99faf:docs/workflow/HANDOFF.md`。

更新：2026-11-04 18:46（base `7b99faf`，本轮把 DSH 宿主 ID 统一为 `deepseek-harness`，**尚未重启复验、尚未提交**）

## 1. 仓库与版本

- 开发主目录与唯一体验入口：`D:/Frankenstein/Uta`，分支 `main`，base SHA `7b99faf`。
- 工作区状态：21 个未提交改动，全部属于本轮改名（`app/src/main` 5 个、`app/src/renderer` 8 个、
  `app/tests` 5 个、`plugin/` 3 个）。无其他会话的改动混入。
- `app/package.json` 版本 `0.2.0`。
- 被测宿主侧：DSH 安装 `D:\DeepSeek-Harness`，CLI `0.2.1-rc.5`，`hostProtocolVersion: 4`；
  插件 `@uta/deepseek-harness-plugin` v0.5.6 以 `link:` 指向源码 Junction ⇒ 「已安装」等于「最新源码」。
- `D:/Frankenstein/Uta-Workspace` 已弃用，不得向其写任何证据、任务或包。

## 2. 运行现场（用命令重新探测，不引用历史进程号）

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5173,64135,64136 | Select-Object LocalPort,OwningProcess
Get-Process electron,deepseek-harness -ErrorAction SilentlyContinue | Select-Object ProcessName,Id
Get-Content "$env:APPDATA\uta-development\dev-f7e444bba875\pet-binding.json"        # 开发绑定，改前 hostId 为 harness
Get-Content "$env:APPDATA\uta\pet-binding.json"                                    # 日常绑定，本轮未触碰
Get-ChildItem "$env:APPDATA\uta-development\dev-f7e444bba875\host-pets"             # 端点目录按宿主 ID 分目录
Get-ChildItem "$env:APPDATA\uta-development\dev-f7e444bba875\hooks"                 # 原生桥文件按宿主 ID 命名
```

**混合态是当前最大风险**：仍在跑的 Uta 是改名前代码，读 `hooks/harness-native-bridge.json` 并按
`record.host === 'harness'` 后的插件写 `deepseek-harness-native-bridge.json`、信封
`meta.hostId: 'deepseek-harness'`。只重启一边 ⇒ `/command` 403、桌宠→宿主投递退化为 headless `resume`。

## 3. 验证状态（本轮实测）

- `typecheck`（node + web）：**0 错误**。`npm run typecheck` 本身会因增量缓存被开发实例占住而报
  `EPERM: tsconfig.node.tsbuildinfo`，须把缓存写到别处：
  `npx tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile "$env:TEMP\tc\node.tsbuildinfo"`（web 同理）。
- app 侧逐文件 sweep：**148 个测试文件 / 1329 用例 / 1314 通过 / 9 失败**。9 条失败全部归因沙箱边界，
  且四个文件里有三个不在本轮改动清单：
  - `host-bridge` 2 条：派生假宿主 CLI 子进程 ⇒ `spawn EPERM`；
  - `host-delivery` 3 条：Qoder 借用 CLI 路由、queued native CLI 退出、ZCode 计划权限 —— CLI 派生失败被
    吞成 `not-sent` / `"undefined" is not valid JSON`，本轮 diff 未触及 qoder/zcode 分支；
  - `settings-runtime-review` 3 条：`EPERM: mkdtemp app\node_modules\.uta-settings-review-fixtures`；
  - `model-path-safety` 1 条：junction realpath 逃逸未在沙箱内被拦。
- 聚合入口 `npm test`（`node --test "tests/*.test.cjs"`）与 `npm run test:plugin` 在本沙箱**不可用**：
  runner 逐文件 `spawn` 子进程 ⇒ EPERM，属工具边界，不是测试失败。改跑单文件 `node <file>`。
- 插件侧改名链路：`deepseek-harness-plugin` **25/25**、`environment`、`runtime-client`、
  `narration-intent`、`todo-extraction`、`opencode-plugin` 全绿；`host-hook` 6 失败、`mcp-server` 21 失败、
  `antigravity-hook` 9 失败均为 hook/MCP 子进程派生 EPERM（后者表现为退出码 `null !== 0`）。
- 改名前已实测通过的接缝：`user-questions/request`（573/573 采样 `lastCommand: choice_hint`）、
  `session/event` → 桌宠待办镜像（`host-plans.v1.json` 内 4 条 `source: dsh-todo` 已完成项）。
- `approval/request`：改名前 **403 host-not-bound**。A/B 决定性证据——同一时刻
  `{host:'harness'}` 返回 200、`{host:'deepseek-harness'}` 返回 403。根因已按 §4 修掉，**待重启后画面复验**。
- 守护缺口（沿用上轮结论）：约四分之一 app 测试是对源码文本做正则的快照断言，**全绿不等于观感没退化**。

## 4. 已知未修问题（用户可感知优先）

- [P0: DSH 审批卡不上屏 → 已定位根因并修，未复验] `hostAllowed(host, legacy)` 对 `/approval/ask`
  **只认精确匹配** `meta.hostId === boundHostId`（`runtime-bridge.ts:510-517`），而 `/command` 只额外容忍
  无 hostId 的旧信封（`:601`）。插件信封曾带 `harness`，dev 绑定读出的也是 `harness`，
  但 `boundHostId` 取自 `petBindingStore.get()?.hostId`，改名后两侧必须同步；本轮统一到 `deepseek-harness`。
- [P1: rc.5 审批默认 fail-closed] `@deepseek-ai/dsh-user-approval` 在没有可用 answerer 时直接失败关闭；
  插件的 `catch → delegate()` 会把审批退回 DSH 原生 UI。需确认「桌宠离线时只在 DSH 侧出现」是否为期望行为。
- [P1: 双进程必须同时重启] 见 §2 混合态。
- [P2: 归档目录写入被 ACL 拒绝] `docs/workflow/archive/` 下 `Copy-Item` 报 `Access ... is denied`，
  本轮未能落新归档副本；已用 git 指针（文件头）兜住上一轮正文。
- [P2: 文本快照断言占比高] 全绿不代表观感未退化，动画观感无自动化守护。
- **尚未取到直接证据的接缝**：`tools/result` 错误路径、`agent/status` 的 idle/error、`agent/error`、
  `assistant-stream` 旁白与 `rp_reply`、`turn/end` 摘要、`/uta` 斜杠命令。
- [待报告: `/context` 的 `duplicates` 49→91 且 `incomplete: true`] 插件→运行时流存在 seq 空洞，
  尚未定性为缺陷，不得当作已验证结论引用。

## 5. 本轮已完成

**设计原则：只改身份匹配 ID，不改物理文件名、存储键与环境变量。**

- 插件 `plugin/plugins/deepseek-harness/src/index.mjs`：4 处身份站点（宿主探测 `host`、`UTA_HOST` 注入、
  `/command` 信封 `meta.hostId`、审批 POST 的 `host`）+ 原生桥文件名 `hooks/deepseek-harness-native-bridge.json`
  （**唯一文件名例外**：主进程按 `hooks/<hostId>-native-bridge.json` 推导，必须与插件同侧）。
- 主进程：`host-bridge.ts` 表键与 6 处判定、`index.ts` 启动/绑定/切换三入口、`host-paths.ts` 左值、
  `host-onboarding.ts` 发现与 `sessionStage`（漏掉会让 DSH 从设置页消失）。
- `pet-binding.ts`：新增 `canonicalPetHostId()` + `LEGACY_PET_HOST_IDS`，**并下沉到 `read()`/`bind()`/`rebind()`**
  —— 只在 `read()` 归一化会留下破口：`bind('harness')` 会把旧值写回磁盘，且 `current.hostId` 已归一化时
  对同一宿主误报 `already-bound`。下沉后旧磁盘绑定 `hostId:"harness"` 无需改文件即被解释为新 ID，回滚仍可行。
- 渲染层：`adapters/index.ts` 注册与 `BuiltinHostId`、`adapters/active.ts` 新增 `LEGACY_HOST_IDS` 归一化
  （否则陈旧 localStorage/binding 的 `harness` 会让 `findHost` 落空并静默退化成 standalone）、
  **删除** `SettingsWindowApp.vue:320` 与 `OnboardingFlow.vue` 两处 `deepseek-harness → harness` 反向桥、
  标签表保留双词表（历史消息记录仍写旧 ID）、`ConnectionsDomain.vue` 分支与选路径白名单。
- `plugin/shared/uta-todo.mjs`：`HOST_SOURCES` 用**双键**映射到同一个 `dsh-todo`。
  单键会落到生成的 `deepseek-harness-todo`，凭空开出第二个源并孤立现有 4 条已完成计划。
- **保留不改**：`harness-session.json`、`deepseek-events.jsonl`、存储键 `harnessExe`/`harnessCli`/`harnessHome`、
  `host-paths.json`、`UTA_HARNESS_EXE`/`UTA_HARNESS_CLI`/`UTA_DSH_HOME`、`scripts/workspace.mjs` 的任务目录参数。
- 测试同步：插件 4 处断言；app 侧 `host-bridge`（13 处调用 + 宿主循环 + 2 个桥文件名）、
  `host-delivery`（1 个 DSH 用例 4 行）、`host-selection`（注册表断言）、`pet-binding`（改为断言
  **旧 ID 输入迁移成新 ID 落盘**）、`model-migration`（`./pet-binding` 桩补 `canonicalPetHostId` 导出）。
  同步后：`host-bridge` 13/15、`host-delivery` 8/11、`pet-binding` 5/5、`host-selection` 12/12、`model-migration` 11/11。
- 端点无需手工迁移：`claimEndpointFile()` 在绑定派生的 `host-pets/<hostId>/runtime-endpoint.json` 路径发布，
  绑定/切换/启动时自动写新目录。

## 6. 下一步建议（按止损顺序）

1. **同时重启** Uta（含 Vite）与 DSH，让两侧都跑改名后代码；再复验审批卡是否真的上屏。
2. 复验审批三种收场：桌宠上做出决定 / 转交宿主 / 超时，并确认 `user-questions/request` 提示仍走宿主。
3. 复验桌宠→宿主投递仍为 `mode: 'native'`（未退化成 `resume`），`/health` 的 `approvalSupported: true`。
4. 用 §2 的 `hooks`/`host-pets` 两条命令确认新文件名与新端点目录已出现、旧目录不再被引用。
5. 逐个补 §4 里「尚未取到直接证据」的接缝，HTTP `accepted` 不能替代画面验证。
6. 在沙箱外补跑 `npm test`、`host-hook`、`mcp-server`、`antigravity-hook`，取一份可信的全绿基线。
7. 是否提交由用户决定（本轮未提交、未推送）。

## 7. 未核实项

- 改名后的审批卡画面、转交宿主路径、超时收场（源码已改，进程未重启，**均未复验**）。
- 改名后的桌宠→宿主原生投递实际可见结果。
- 打包版 `Uta.exe` 的宿主发现与设置页 DSH 条目（本轮只在开发实例上操作）。
- 真实多宿主并存的端点串写、多 DPI、长时间运行。
- 本轮未跑通聚合测试入口（沙箱 EPERM），只给出逐文件实测数字。
