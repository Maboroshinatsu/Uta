# Uta 桌宠 × DeepSeek Harness 插件 —— 交接文档

> 交接对象：`@uta/deepseek-harness-plugin`（`dsh` 侧）+ Uta 桌面端 runtime bridge。
> 最后更新：2026-10-31 / 0.5.6，移除默认 RP 注入与神态标签指令。
> 0.5.6 起不再注册 `uta:rp-persona`、不注入默认人设/称呼，也不要求模型输出 `[uta:…]`；下方历史章节中的 RP 注入与标签指令均属旧行为。旧标签解析仅用于桌宠气泡兼容过滤。

---

## 0. 先看这里

**当前状态**：插件已在 `desktop` 与 `default` 两个 profile 挂载，三处契约 bug 已修，**并已在真实宿主里验证过激活** —— 探针 profile 启动时 stderr 不再出现 `did not activate` 警告（§5.7）。

**还差一步**：**重启 DeepSeek Harness**。bundle 列表是启动时组合的，改完源码不重启不会生效。

**重启后怎么确认成功**（三个都成立才算好）：

1. 模型工具列表里出现 `uta_express`
2. 发给模型的 system prompt 里出现 `## 角色扮演与情绪伴侣设定（Uta）`
3. 触发一次需要审批的操作时，**审批卡片弹在 Uta 桌宠上**，而不是 DSH 原生界面

**如果还是不生效**：别急着重启第二次，先跑 §5.7 的探针 profile —— 它能在 30 秒内明确回答「插件激活了没有」，而这个信息 GUI 侧**完全看不到**。

---

## 1. 这个插件在做什么

四个 seam（全部基于 Cordis 插件契约）：

| Seam | 挂载点 | 作用 |
|---|---|---|
| 交互式审批 | `ctx.on('approval/request')` | 把待批准的工具请求推到桌宠卡片，提供「批准 / 拒绝 / 转交宿主」；桌宠离线或选「转交」时 `next()` 回退到 DSH 原生审批 |
| 工作状态映射 | `agent/request`、`agent/assistant-stream`、`tools/execute`、`tools/result`、`agent/status`、`agent/error`、`session/event` | 驱动桌宠状态胶囊（思考中 / 回复中 / 执行工具 / 异常 / 待机）与 Live2D 神态 |
| RP 语气注入 | `ctx.systemPrompt.section()` + `.context()` | 把 Uta 设置里的 RP 人设注入模型 system prompt，让主窗口与桌宠语气统一；同步可用情绪与预设分组 |
| 主动表达工具 | `ctx.tools.register()` | 注册 `uta_express`，让模型主动切预设 / 情绪 / 动作 / 发气泡 |

**数据流**：插件 → 本机 HTTP → Uta 桌面端 runtime bridge。

```
DSH 宿主进程 ──HTTP+Bearer──▶ 127.0.0.1:<port>
                              路由见 %APPDATA%\uta\runtime-endpoint.json
```

端点文件每次 Uta 启动都重写（**端口和 token 都会变**），所以插件每次请求都重新读文件，不要缓存。可用路由：`POST /command`、`GET /context`、`GET /health`、`POST /approval/ask`、`POST /approval/cancel` —— **全部要求 Bearer token**，连 `/health` 也要。

---

## 2. 目录结构

```
Uta/plugin/plugins/deepseek-harness/
├── package.json          # name/version + dsh.bundle.patch 声明（挂载入口）
├── cordis.patch.yml      # bundle patch：把 uta-deskpet 条目 insert 进 profile 配置树
├── README.md             # 面向使用者的说明
├── HANDOVER.md           # 本文件
└── src/
    ├── index.mjs         # 全部实现（单文件）
    └── index.d.ts        # 手写类型声明
```

`package.json` 里最关键的一行：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

**没有这个字段的包不能当 bundle**，会被静默跳过（见 §4.3）。

---

## 3. 挂载与生效机制

### 3.1 profile 是什么

`$DSH_HOME/profiles/<name>/` 下有：

- `package.json` —— 依赖 + **`dsh.profile.bundles` 有序列表**（这是唯一权威来源）
- `cordis.patch.yml` —— 该 profile 自己的 patch 层

启动时配置树的组合顺序：

```
空根 → 各 bundle 的 patch 层（按 dsh.profile.bundles 顺序）
     → profile 自己的 cordis.patch.yml
     → $DSH_HOME/cordis.patch.yml（机器级）
     → --patch 叠加层
```

本机 `$DSH_HOME` = `C:\Users\Administrator\.dsh`。

### 3.2 挂载命令

```powershell
# 本机桌面版 GUI 跑的是 desktop profile
dsh plugin --profile desktop add d:/Frankenstein/Uta/plugin/plugins/deepseek-harness
# default profile（按 README 的原始说明）
dsh plugin --profile default add d:/Frankenstein/Uta/plugin/plugins/deepseek-harness
```

`dsh plugin add` 一次做三件事：

1. 写入 `link:` 依赖
2. **把包名追加进 `dsh.profile.bundles`**（这步最关键，少了他 patch 不会应用）
3. 建立指向插件目录的 Junction

⚠️ **哪些 profile 是哪个**：本机 `dsh --profile desktop` 会被 CLI 拒绝（`profile "desktop" is managed exclusively by the Electron application`），但 `dsh plugin --profile desktop ...` 可以正常跑 —— 那个限制**纯粹是名字匹配**，没有更深的含义。

### 3.3 什么时候生效

**改源码后必须重启 DSH。** 桌面 profile 里的 `"patchReload": "live"` 只覆盖 `cordis.patch.yml` 那一层的热载，**不覆盖 `dsh.profile.bundles` 的变化，也不重新 import 已加载的插件模块**。

宿主进程参数长这样，可用于确认它在读哪个目录：

```
"DeepSeek Harness.exe" --expose-internals
  <asar>\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js
  <asar>\dsh                       ← argv[2] runtimeDir
  C:\Users\...\.dsh\profiles\desktop   ← argv[3] projectDir（profile 目录）
  <primary-runtime> <pnpm.mjs> <runtime\bin>
```

---

## 4. ⚠️ 三个 DSH API 契约陷阱（本次修的就是这三个）

这三条都是**静默失效**的典型来源。**按重要性排序 —— 第一条才是「插件从未生效」的真正根因**，后两条是潜伏 bug：只修第一条的话，插件会从「完全不动」变成「一说话就崩」，所以三个必须一起修。

### 4.1 `inject` 没有「可选」形态 —— 写错就永不激活（★ 真正的根因）

Cordis 只接受这两种形态（见 `@deepseek-ai/cordis/src/registry.ts`，TS 源码随包发布）：

```ts
/**
 * Array form requests services without intercept config.
 * Object form maps each service name to optional intercept config.
 */
export type Inject<M = Dict> = (keyof M)[] | { [K in keyof M]?: M[K] }
```

**数组的每一项、对象的每个「键」都是必需服务**；对象的值只是该服务的 intercept 配置。`inject` 里列出的服务只要有一个取不到，fiber 就永远停在 `PENDING`，`apply()` 一次都不会执行。

于是插件当初写的：

```js
export const inject = { optional: ['systemPrompt', 'tools', 'agents'] }
```

被解析成「我需要一个名叫 **`optional`** 的服务」。DSH 的启动审计代码正是这么读的：

```js
// dsh-app-boot / dsh-agent-preset-registry
const missing = Object.keys(fiber.inject).filter((service) => fiber.ctx.get(service) === void 0)
```

→ 永久 pending → 四个 seam 一个都没挂上。**这就是本插件长期静默失效的真正原因**，也是为什么在此之前怎么改工具定义、怎么重启都没有任何变化。

**正确写法：不要声明你做不到的可选语义。** 需要「有则用、无则跳过」时：

1. **什么都不声明**（本插件的选择）—— `apply()` 立刻执行，内部用运行时的 `ctx.inject([...], cb)` 等目标服务出现后再挂载对应 seam（`apply` 本来就是这么写的，两条路径互为快慢路）；
2. 声明为必需数组，如 `export const inject = ['systemPrompt', 'tools']` —— 更声明式，但任一服务缺失就会重演同一个静默失效，**慎用**。

**怎么验证**：见 §5.7。激活失败只会在启动时往 stderr 打一行 `pending (waiting for service: ...)`，GUI 侧完全看不到。

### 4.2 `ctx.tools.register()` 要的是原生 JSON Schema，不是规格 DSL

`@deepseek-ai/dsh-tools/lib/index.js`：

```js
register(definition) {
  const output = definition.output;
  if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || ...)
    throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
  assertSupportedJsonSchema(output.schema);      // ← 这里会炸
  ...
}
```

`assertSupportedJsonSchema` 只接受这个子集：

```js
const SCHEMA_TYPES = ["object","array","string","number","integer","boolean","null"]
```

**没有 `json`。** 而 DSH 同时存在另一套「规格 DSL」：

| 入口 | `parameters` 形态 | `output.schema` 形态 |
|---|---|---|
| `ctx.tools.register(def)` | 原生 JSON Schema | 原生 JSON Schema |
| `defineTool(options)` | **属性表**（`{ preset: { type:'string' } }`） | **规格 DSL**（`{ type:'json' }` 合法） |

`defineTool` 内部会 `parameterSchemaSpecToJsonSchema()` + `valueSchemaSpecToJsonSchema()` 把 DSL 编译成规范 JSON Schema。

**本插件原来把 DSL 直接喂给了 `register()`** → `{ type:'json' }` 不是合法 JSON Schema → 抛 `JsonSchemaError` → 冒泡出 `apply()` → **Cordis 回滚整个插件**。

> 一个 bug 三个症状：没有 `uta_express` 工具、system prompt 没有 RP 段落、审批卡片弹在 DSH 原生界面 —— 因为审批 seam 也一起被回滚了。

**修法**：改用 `defineTool()`（已导出）：

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

const utaExpressToolDefinition = defineTool({
  name: 'uta_express',
  description: '...',
  parameters: { /* 属性表，原样保留 */ },
  output: {
    schema: { type: 'json' },                       // defineTool 下合法，编译成 {}
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },
  isConcurrencySafe: () => true,
  async execute(args) { /* 不变 */ },
})
```

`'json'` 在 `defineTool` 里会编译成空 schema `{}`（= 任意 JSON 值），同样通过 `assertSupportedJsonSchema`。

**裸 `register()` 也可以**，但那时 `parameters` 必须自己写成 `{ type:'object', properties:{...} }`，`output.schema` 也必须用 `string`/`object` 等合法类型。

### 4.3 `systemPrompt.section()` / `.context()` 的 `text` **必须同步**

`@deepseek-ai/dsh-system-prompt/lib/index.js`：

```js
// 组装时
text: typeof section.text === "function" ? section.text(context) : section.text,
//                                          ^^^^^^^^^^^^^^^^^^^^ 没有 await

// 渲染时
function interpolate(input, variables, kind) {
  const text = input.text;
  for (let open = text.indexOf("{{"); ...)     // ← Promise 走到这里就 TypeError
```

契约是「**字符串或同步函数**」。本插件原来写的是 `text: async () => {...}`，一旦插件真的挂载成功，就会以 `text.indexOf is not a function` **炸在 prompt 渲染阶段，直接打断整个 agent 回合**。

**修法**：后台异步刷新一份快照，`text` 同步读缓存：

```js
let promptSnapshot = null
let promptRefresh = null

function refreshPromptSnapshot() {
  if (promptRefresh) return promptRefresh
  promptRefresh = fetchContextSafe()
    .then((s) => { if (s) promptSnapshot = s; return promptSnapshot })
    .catch(() => promptSnapshot)
    .finally(() => { promptRefresh = null })
  return promptRefresh
}

function promptSnapshotSync() {
  if (!promptSnapshot) void refreshPromptSnapshot()
  return promptSnapshot
}

void refreshPromptSnapshot()          // 挂载即预热，避免首个回合是空段落

// 之后
text: () => buildRpSystemPromptSection(mergedRp, promptSnapshotSync()?.modelContext),
text: () => buildModelContextText(promptSnapshotSync()),
```

> 这里有个**顺序陷阱**：如果只修 §4.2 不修 §4.3，插件会从「完全静默失效」变成「一说话就崩在 prompt 渲染阶段」。三条必须一起修。

### 4.4 为什么这些错误一直看不到

三层叠加，导致这类问题**完全静默**：

1. **桌面宿主是 Electron fork 的子进程**，异常只写进它自己的 stderr，GUI 应用没有控制台。
2. DSH 自己就是这个风格 —— `dsh-app-boot` 里 `reportSkippedBundles` 的注释直白写着 *"loading never prints"*；bundle 被跳过时只 `process.stderr.write`。
3. **Cordis 在 `apply()` reject 时会回滚该插件的全部注册**，所以一个 seam 的 bug 会让所有 seam 一起消失，而不是只坏一个。

**对策（已实现）**：任何一个 seam 挂载失败都只记录、不冒泡：

```js
const safeMount = (label, fn) => {
  try { fn() } catch (e) { console.error(`[uta-deskpet] ${label} mount failed: ${e?.message || e}`) }
}
safeMount('systemPrompt seam', () => mountSystemPrompt(ctx))

// mountTool 内部对 registry.register() 同样 try/catch，并置 toolMountFailed 防止无限重试
```

这样以后即使某个契约再变，也只是**该 seam 失效**，审批和 RP 不会被连带拖死。

> 建议上游：`section.text` 要么 `await`，要么在 API 上明确拒绝 async 函数（现在两者都没有，静默给出 Promise）。

---

## 5. 排障手册

### 5.1 判断插件到底有没有加载

按可信度排序：

| 方法 | 怎么看 |
|---|---|
| **模型工具列表** | 有没有 `uta_express`。最强信号 |
| **system prompt** | 有没有 `## 角色扮演与情绪伴侣设定（Uta）` |
| **会话日志 `request/header`** | 记录里有该次请求发给模型的**完整工具名列表** |
| **Uta 侧** | `GET /context` 能通只证明 Uta 活着，**不证明 DSH 在跟它说话** |

⚠️ 注意：**别用「工具返回里出现过 Uta 字样」来判断** —— 你自己的调试输出里就有，会误判。要搜就搜 `uta:rp-persona` 这种只可能出现在 prompt 里的串。

### 5.2 解压会话日志（多帧 zstd）

会话日志是 `$DSH_HOME/sessions/<项目>/<session>/session.v4.jsonl.zstd`，**追加式多帧 zstd**：`zstdDecompressSync` 只能解出第一帧（几百字节），必须逐帧解。

```js
// 用 ELECTRON_RUN_AS_NODE 跑
import fs from 'node:fs'
import zlib from 'node:zlib'

const buf = fs.readFileSync(SESSION_ZSTD)
const M = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; i + 4 <= buf.length; i++)
  if (buf[i] === M[0] && buf[i+1] === M[1] && buf[i+2] === M[2] && buf[i+3] === M[3]) offsets.push(i)

let text = ''
for (const off of offsets) {
  try { text += zlib.zstdDecompressSync(buf.subarray(off)).toString('utf8') } catch {}
}
```

有价值的记录类型：`request/header`（工具列表）、`approval/asked` / `approval/decided`（审批流实际走向）、`turn/start`、`tool/call`。

**多帧 zstd 不能用 `tar --zstd` 解** —— 那是 tar 包格式，这里是裸流。

### 5.3 读 `app.asar` 里的 DSH 源码

`D:\DeepSeek-Harness\resources\app.asar` 是归档，但 Electron 的 fs 补丁能直接穿透读：

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
Start-Process -FilePath "D:\DeepSeek-Harness\DeepSeek Harness.exe" `
  -ArgumentList 'D:\path\to\script.mjs' -NoNewWindow -Wait `
  -RedirectStandardOutput out.txt -RedirectStandardError err.txt
```

脚本里正常 `import fs` / `import()` 即可，路径写成 `.../app.asar/dsh/node_modules/@deepseek-ai/...`。

> `--check`、`-p` 这类短参数在 PowerShell 里容易因为引号被吃掉，**写成脚本文件再跑**最稳。
> 运行时会打印一条 `DEP0180 fs.Stats deprecated` 警告，无害。

### 5.4 复现 profile 组合（不启动宿主）

用 DSH 自己的代码组合配置树，**不需要 `--dump-config`，也不受「desktop 独占」限制**：

```js
const ASAR = 'D:/DeepSeek-Harness/resources/app.asar/dsh'
const mod = await import(`file:///${ASAR}/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`)

const projectDir = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'
const installAnchor = `${ASAR.replace(/\//g, '\\')}\\node_modules\\@deepseek-ai\\dsh\\package.json`

const profile = mod.loadProfileDirectory('dsh', projectDir, installAnchor)
console.log('成功:', profile.layers.map((l) => l.packageName))
console.log('被跳过:', profile.skippedBundles)          // ← 静默跳过的 bundle 在这里

const entries = mod.composeEntries([...profile.layers.map((l) => l.patches), profile.patches])
console.log('配置树条目:', entries.map((e) => e.id).join(', '))
```

**挂载问题必须先在这里排除**：如果 `uta-deskpet` 在 `entries` 里且 `skippedBundles` 为空，那问题一定在插件代码，不在挂载。

### 5.5 验证插件代码（带 resolve 钩子）

插件裸导入 `@deepseek-ai/dsh-tools`，脱离 DSH 直接 `import` 会解析失败。用一个 loader 钩子映射到 asar：

```js
// _loader.mjs
const TARGET = 'file:///D:/DeepSeek-Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
export async function resolve(spec, ctx, next) {
  if (spec === '@deepseek-ai/dsh-tools') return { url: TARGET, shortCircuit: true }
  return next(spec, ctx)
}
```

```js
// _verify.mjs
import { register } from 'node:module'
register('./_loader.mjs', import.meta.url)
const mod = await import('file:///D:/Frankenstein/Uta/plugin/plugins/deepseek-harness/src/index.mjs')
// 再喂一个 mock ctx 给 apply()，捕获 section/context/tools.register 的调用
```

**验收点**：`apply()` 不抛异常、`tools.register` 被调用、`section.text()` 返回 **string 而不是 Promise**。

### 5.6 直接跟 Uta bridge 对话

```powershell
$ep = Get-Content "$env:APPDATA\uta\runtime-endpoint.json" -Raw | ConvertFrom-Json
$h = @{ Authorization = "Bearer $($ep.token)" }
Invoke-RestMethod "http://127.0.0.1:$($ep.port)/context" -Headers $h
```

`/context` 会返回 `characterAvailable` 以及当前模型的 `emotions` 和 `presetGroups` —— 不用开桌宠就能确认 Uta 侧一切正常。

---

## 6. 环境相关注意事项

### 6.1 Windows ACL 会直接废掉 shell（已修）

`workspace-write` 模式下所有 shell 命令都会在**沙箱初始化阶段**失败：

```
SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\Frankenstein)
```

原因：`D:\Frankenstein` 的所有者是 `Administrators` **组**，而会话是非提权令牌 —— 组 SID 在令牌里是 deny-only，那条继承来的 FullControl 等于不存在，于是拿不到 `WRITE_DAC`。注意此时**能改文件**（靠 `Authenticated Users: Modify`），只是**不能改权限**，所以现象很迷惑。

修复（需管理员权限的 PowerShell，一次即可）：

```powershell
icacls "D:\Frankenstein" /grant "Administrator:(OI)(CI)F"
```

带 `(OI)(CI)` 会把继承传给现有子目录，**不需要 `/t`**。

> 判断要点：`read`/`write` 文件工具走另一条路，不受影响；**只有 shell 全废**。如果 shell 报这个错而文件工具正常，就是这个 ACL 问题。

### 6.2 审批流怎么走

`approval/asked` → `approval/decided`（`allowed-once` / `rejected`）记录在会话日志里，可以事后核对「到底有没有真的问过用户」——这在排查「卡片没弹」时非常有用。

审批策略 `never` 时**根本不会产生审批请求**（不是被拒绝，是压根不问）。要测审批，会话权限档位必须是会「询问」的（如 `workspace-write` + `ask`）。

### 6.3 沙箱会挡掉一部分诊断手段

`workspace-write` 下受限令牌会导致：

- `Get-CimInstance` / `Get-NetTCPConnection`（底层走 CIM）→ `无法从客户端中访问 CIM 资源`
- 替代方案：`Get-Process`、`netstat -ano`
- 向 `$DSH_HOME` 等**工作区外**写入会被拒（这是正确行为），需要一次提权审批

---

## 7. 已知问题 / 待办

- [ ] **重启 DSH 后走一遍 §0 的三项验收**
- [ ] 上游反馈：`dsh-system-prompt` 的 `section.text` 不 `await`，API 上也没拒绝 async —— 静默给出 Promise，很难排查
- [ ] 上游反馈：桌面宿主的插件挂载错误只写 stderr，GUI 侧完全不可见，建议至少落到一个日志文件
- [ ] `promptSnapshot` 与 `cachedContext` 是两套缓存：Uta 离线 / 切换 Live2D 模型后，prompt 侧最多滞后一个刷新周期。目前每次 `refreshPromptSnapshot()` 都会走 `fetchContextSafe`（1.5s TTL），够用，但切换模型后若想立刻生效需要额外触发
- [ ] `src/index.d.ts` 里 `apply(ctx: unknown, ...)` 类型偏弱，可以补一个最小 `CordisContext` 接口
- [ ] `package.json` 未声明 `peerDependencies` / `dsh.engines`：好处是永远不会被兼容性校验跳过，坏处是 DSH 大版本变更时不会有任何警告
- [ ] 测试文件 `C:\Users\Administrator\uta-approval-seam-test.txt`、`uta-approval-test-2.txt` 是我做审批联调时留下的，可删（在工作区外，删除需要一次审批）

---

## 8. 本次改动清单

| 文件 | 改动 |
|---|---|
| `src/index.mjs` | ① 新增 `import { defineTool } from '@deepseek-ai/dsh-tools'`；② 工具定义改用 `defineTool({...})` 包裹；③ 新增 `promptSnapshot` 同步快照缓存，`section`/`context` 的 `text` 由 `async` 改为同步；④ 新增 `safeMount` + `mountTool` 内 try/catch，单个 seam 失败不再回滚整个插件 |
| `src/index.d.ts` | 补上漏掉的 `requestRuntime`、`buildModelContextText` 声明 |
| `cordis.patch.yml` | 注释里那句自相矛盾的安装说明改为同时列出 `desktop` / `default` |
| `HANDOVER.md` | 新增（本文件） |

**验证结果**（用 §5.5 的钩子 + mock ctx 真跑）：

```
import OK / apply() 未抛异常
注册记录：on:approval/request, systemPrompt.section:uta:rp-persona,
         systemPrompt.context:uta:model-presets, on:agent/*, on:tools/*,
         on:session/event, tools.register:uta_express, inject, effect
工具定义：output.render 是函数，output.schema = {}（defineTool 编译自 {type:'json'}）
section.text()  → string，610 字符，含真实 RP 人设
context.text()  → string，含 "当前模型: Hiyori Pro" + 8 个预设分组（从线上实拉）
```

---

## 9. 2026-10-18 P55：移除 `@deepseek-ai/dsh-tools` 依赖

DSH 0.2.1-rc.2 的 profile 加载器会按 peer dependency 校验 bundle；旧插件声明
`@deepseek-ai/dsh-tools ^0.1.2-alpha.1`，与运行中的 0.2.1-rc.2 不匹配，导致整个 bundle
被跳过，`apply()` 从未执行。与此同时插件是软链接，Node 从源码 realpath 解析依赖，
也找不到 profile 里的 `dsh-tools`。

修复：
- `uta_express` 改为直接写 DSH 认可的 JSON Schema（`parameters` 为 object schema，
  `output.schema = {}`），不再 import `defineTool`；
- `package.json` 移除 `peerDependencies`，版本升到 `0.2.0`；
- 插件现在没有任何外部运行时依赖，DSH 0.2.x 可直接加载。

---

## 10. 2026-10-18 [BUG-03: DSH 思考链进入桌宠气泡]

DSH 的 `agent/assistant-stream` 使用 `StreamChunk` 区分正文与推理：

- 正文：`{ type: 'text-delta', index, text }`
- 思考链：`{ type: 'reasoning-delta', index, text }`

旧版 `parseStreamFrame` 只要发现 `text` 字段就当作正文，导致 `reasoning-delta` 被累加进 `rawText`，同时进入桌宠气泡和 TTS。

修复：
- `parseStreamFrame` 增加类型/块类型白名单：`reasoning-delta`、`thinking-delta`、`reasoning`、`thinking` 以及 Anthropic 风格的 `delta.type: thinking_delta` 全部返回 `kind: 'reasoning'`，流式处理器直接忽略。
- `assistant/message` 兜底优先使用结构化 `content` 数组，只取 `type: 'text'` 的 block；纯文本 `message.text` 降级为最后选择，避免混合推理的字段被误用。
- 版本升到 `0.2.1`，DSH 心跳 `PluginLoaded` 会显示新版本，便于确认实际加载的是修复后的代码。
- 回归测试新增两条：流式思考链不入气泡/TTS、`assistant/message` 兜底忽略 reasoning block。插件测试 60/60。

注意：两个 DSH profile（`default` / `desktop`）都是软链接到本目录，源码修复无需复制。desktop profile 的 live reload 已在 `2026-10-18T04:22:46Z` 自动加载 `0.2.1`（心跳 `PluginLoaded 0.2.1`），无需重启；`default` profile 如仍显示 `0.2.0`，重启对应 DSH 实例即可。

---

## 11. 2026-10-18 [BUG-04: DSH 流式文本重复拼接]

现象：桌宠气泡出现 `文件文件已经文件已经写文件已经写进去了……` 这类越来越长的重复前缀；DSH 最终落盘的 `assistant/message` 却是正常的短句。

根因：部分 provider/宿主路径把 **累计全文** 当作 `text-delta` 发送。插件按增量直接追加，导致每收到一帧就把已有前缀重新拼一遍；另外，未闭合的 `[uta`（还没出现冒号）不在旧版 `trimIncompleteTrailingTag` 的识别范围内，会先漏进气泡。

修复：
- 新增 `mergeStreamText`：识别累计快照、重复分片和旧前缀，累计时替换而不是追加；流式 chunk 与结束帧都走同一逻辑。
- `trimIncompleteTrailingTag` 同时暂存裸 `[uta` / `[emotion` / `[preset` 和 `<uta` 前缀。
- Uta 渲染层 `appendChatText` 增加累计快照替换和重复分片防线，作为跨宿主的第二道保险；TTS 的原文缓冲 `speechBuffers` 也使用同一规则，避免语音重复朗读。
- 新增“累计全文分片”和“裸 `[uta` 前缀”两条回归测试；插件测试 **62/62**，app 测试 **147/147**。
- 版本升到 `0.2.2`。

生效：源码已更新，但运行中的 DSH 仍加载 `0.2.1`；本次 live reload 没有自动跳到 `0.2.2`，需要重启 DSH 或重新加载插件。重启后心跳应为 `PluginLoaded 0.2.2`。

---

## 12. 2026-10-18 [BUG-04: DSH 流式气泡改用完整快照覆盖]

DSH 加载 `0.2.2` 后实测仍会重复；落盘的 `assistant/message` 始终正常，说明增量拼接在不同帧形态下无法保证正确。

最终修复：`rp_reply` 增加可选 `replace` 字段。

- DSH 每次发送 **完整 `stableText` 快照**，带 `replace: true`；Uta 渲染层对同一 `requestId` 直接覆盖文本，不再追加。
- 结束帧发送最终完整快照（空快照只收尾）；TTS 使用最终快照，不会重复朗读。
- 未带 `replace` 的宿主仍保持原有追加语义；渲染层保留累计快照/重复分片的兼容防线。
- 真实渲染验证：replace 快照只显示最终文本一次；普通增量正常追加；无 replace 的累计文本被去重为最终一句。
- 插件测试 **62/62**，app 测试 **147/147**，typecheck/build 通过。
- 版本升到 `0.2.3`。DSH 需要重启或重新加载插件才能加载新版本；心跳应为 `PluginLoaded 0.2.3`。
- 兼容性：`0.2.3` 依赖 Uta 支持 `replace`；旧 Uta 会忽略该字段并按追加处理，因此插件与 Uta 需要一起更新。

补充 `0.2.4` / `0.2.5`：长回复在桌宠端只发送**一两句完成状态**，上限约 80 字；首句已经含“完成/成功/已/修复…”等状态时只留首句。Markdown 表格与代码块不进入气泡，完整内容保留在宿主；没有可读正文时只说“完成啦。”。插件测试 **63/63**。DSH 重启后心跳应为 `PluginLoaded 0.2.5`。

---

## 13. 2026-10-18 [STATE-01: 桌宠状态随宿主思考变化]

- DSH 的 `reasoning-delta` 现在会进入一个只存在内存里的推理缓冲区（最多 1200 字符），
  只用于本地 `inferReasoningIntent` 关键词分类，不进入气泡、TTS 或日志。
- 意图变化或距上次至少 2.5 秒时，发送 `agent_narrate { intent, reasoning: true }`；
  Uta 渲染层按 reasoning 模式切换 hold 预设，最多每 20 秒补一句极短状态。
- 关键：reasoning 正文不会出现在任何 runtime 指令中，UI 只收到枚举意图。
- 实测：reasoning 文本含“测试”时切到「测试·跑一下看看」并说“我来做个测试。”；
  约 2.5 秒后切换为 looking，预设变为「思考·托腮找线索」，20 秒内不重复说话。
- 版本升到 `0.2.6`；DSH 重启或重载后心跳应为 `PluginLoaded 0.2.6`。

---

## 14. 2026-10-29 [DSH-ADAPT: 适配 DSH 0.2.1-rc.3 / host protocol 4]

适配对象：本机 DSH `0.2.1-rc.3`（Electron 44.7.0，Node 24.21.0，`hostProtocolVersion: 4`），
插件版本 `0.5.3 → 0.5.4`。

### 14.1 契约审计结果：seam 全部存活

逐条对照 asar 内 `dsh@0.2.1-rc.3` 源码，插件依赖的挂载点全部未变：

| 挂载点 | rc.3 形态 | 插件用法 |
|---|---|---|
| `approval/request` | waterfall，req = `{ agent, toolName, callId?, reason?, signal? }`，默认 `unavailable`，OUTCOMES 含 `allowed-once` | 兼容 |
| `user-questions/request` | waterfall，req = `{ questions, agent?, signal? }` | 兼容 |
| `tools/execute` | waterfall，`mutableExec` 原地可变，carrier = `scopeTarget(this, exec.agent)` | 兼容 |
| `tools/result` / `agent/status` / `agent/error` | observer | 兼容 |
| `agent/request` | waterfall `(event, next)` | 兼容 |
| `agent/assistant-stream` | observer，`payload.agent.session` 可取 | 兼容 |
| `session/event` | observer，回调参数就是 `(session, event)` | 兼容 |
| `todo_write` 工具 + `todo/write` 事件 | 工具名 `todo_write`，`exec.agent.session.append("todo/write", { todos })` | 兼容 |
| `commands.register` | `normalizeDefinition`：name 过 `COMMAND_NAME` 正则、description 必须非空、handler 必须函数 | 兼容 |
| `skills.register` | `validateRuntimeSkill`：`SKILL_NAME` + 非空 description + `validateInvocation` | 兼容 |
| `Agent.followup(UserMessage)` | `dsh-agent` 存在（原生桥用） | 兼容 |
| `cordis.patch.yml` 形态 | `dsh.bundle.patch` 仍是 YAML 数组，元素 `{ insert: [...] }`，无 `id` 时 push 到根 | 兼容，patch schema 未变 |

### 14.2 修掉的真断点：会话工作目录全部落到 `process.cwd()`

三个取值点原本都写的是不存在的属性，**静默**退到 `process.cwd()` —— Electron 下等于
`%USERPROFILE%\.dsh\profiles\desktop`，而不是项目工作区：

1. `reportHostSession()` 直接写死 `cwd: process.cwd()`；
2. `tools/execute` 用 `exec?.session?.cwd` —— 而 rc.3 的 exec 对象只有
   `token / callId / rootCallId / name / signal / agent / arguments`，**没有 `session`**；
3. `session/event` 用 `session?.cwd` —— 而 `dsh-session` 的 `Session` 只有 `get id()`，
   工作目录在 `session.header.cwd`。

修法：新增 `sessionCwdOf(session)`，顺序取 `session.header.cwd → session.cwd →
session.directory → session.agent.session.header.cwd`；三处统一走它。

这一处直接决定 Uta 的「每日待办 / 待办核对」能不能认对项目：`todo_snapshot` 的 `cwd`
以前永远是 profile 目录。

### 14.3 修掉的链路断点：headless adopt 校验

DSH rc.3 的 `dsh-headless` 对 `--session-id` 采用 **adopt 语义**，`assertAdoptable()` 要求：

- 会话不得带 agent preset（否则报 `runs under agent preset "..."`）；
- `header.cwd === process.cwd()`（否则报 `was recorded in "..." not "..."`）；
- 不得是 subagent / fork 会话、不得在本进程 live。

Uta 的 `runInvocation()` 之前 `spawn()` **不传 cwd**，子进程继承 Uta 自己的启动目录，
所以只要 DSH 会话的工作区不是 Uta 的启动目录，桌宠直发就必然被拒。

修法（`app/src/main/host-bridge.ts`）：

- `HostInvocation` 增加可选 `cwd`；harness 分支传 `cwd: session.cwd`（来自
  `harness-session.json`，现在写的是真实会话工作区）；
- `spawn()` 透传 `cwd`；
- 错误映射新增三类可读提示：agent preset、工作目录不一致、子代理/仍在运行。

### 14.4 协议 v2 补齐

- `hello` 的 `capabilities` 从 5 项补到 7 项，与 Uta 的 `RUNTIME_CAPABILITIES` 对齐：
  新增 `sessionBinding`、`receipts`（少报会让桌宠误判宿主不支持绑定/回执而退回复制模式）。
- 信封 meta 补 `hostInstanceId`（`dsh-<pid>-<6字节hex>`，每次插件加载一个新实例）、
  `eventId`（uuid）、`seq`（实例内单调递增）、`ts`（ISO8601），供 Uta 做重复投递判定与乱序检测。
- `sdkVersion` / 心跳版本号同步到 `0.5.4`。

### 14.5 环境事实修正（重要）

- **`patchReload: "live"` 是无效字段，不要相信它。** 在整份 `app.asar` 里搜索 `patchReload`
  **0 命中**（`desktop-runtime.json` 只提供 `hostProtocolVersion`，`dsh-app-boot` 只认
  `dsh.bundle.patch`），desktop profile 的 `package.json` 里那行只是遗留键。
  实测：改完 `src/index.mjs` 后，运行中的 DSH 心跳仍是旧版本 `PluginLoaded 0.5.3`，
  `harness-session.json` 也继续被旧代码写入 —— **改插件源码必须重启 DSH 才生效**。
  旧文档「改完必须重启」的结论仍然成立，本文件 14.5 早前那版「已支持热重载」是错的。
- rc.3 的 `dsh plugin` 子命令**转发给 pnpm**，不再自带安装实现；`dsh <name>` ≡ `dsh --profile <name>`。
- `@deepseek-ai/dsh-desktop-host/lib/cli.js` 仍然存在，Uta 记录的 `DEFAULT_HARNESS_CLI` 路径有效。
- 插件不声明 `peerDependencies`：`@deepseek-ai/*` 都是 asar 内置包，声明会让 pnpm 去 registry
  解析并安装失败；兼容基线改记在 `package.json` 的 `dsh.compat` 里，仅作记录、不参与解析。
- **`hooksDir` 跟着 endpoint 文件走**：`resolveRuntimePaths()` 里
  `runtimeDir = UTA_RUNTIME_DIR || dirname(endpointFile) || userData`，所以运行时是
  `%APPDATA%\uta\hooks`，而测试里写 endpoint 到临时目录时 hooks 也在临时目录 ——
  写测试别按 APPDATA 找 `harness-session.json`。

### 14.6 运行期证据（不是读源码推断）

用最小 Cordis 假上下文直接驱动插件（探针脚本不进仓库），实测：

- `agent/assistant-stream` 传 `agent.session.header.cwd = <tmp>/proj-alpha` 后，
  `harness-session.json` 写入 `cwd: <tmp>/proj-alpha`，**不再是进程 cwd**；
- `session/event` 的 `todo/write` 与 `tools/execute` 的 `todo_write` 两条路径发出的
  `todo_snapshot.cwd` 都是同一个会话工作区；
- v2 信封 `hostInstanceId` 一次加载内恒定、`eventId` 唯一、`seq` 单调递增、`ts` 可解析，
  `hello.capabilities` 为 7 项全集；
- 回归测试已入库：`plugin/tests/deepseek-harness-plugin.test.cjs` 末尾两条
  `[DSH-ADAPT: ...]`；`npm run test:plugin` **114/114 通过**，`npm run typecheck:node` 通过。

### 14.7 待验证（需要重启 DSH 之后才能看）

> 版本号已被 §15 提升到 `0.5.5`，验收时以 `PluginLoaded 0.5.5` 为准；下面几条未验证项本身仍然有效。

- 桌宠侧心跳 `PluginLoaded 0.5.4` + `hello` 回 `capabilities` 7 项；
- `harness-session.json` 的 `cwd` 变成真实工作区（不再是 `.dsh/profiles/desktop`）；
- 桌宠直发消息能进 DSH（`cwd` 一致时 adopt 通过）；
- 带 agent preset 的会话直发时，提示文案是「该会话用了 agent 预设」而不是原始 stderr。

## 15. 2026-10-31 [P1: DSH 指定会话失效时消息误投其他会话] + [P2: DSH 原生桥回执中断后自动回退命令行可能重复投递]

来源：`docs/REVIEW-2026-10-31.md`（基线 `7638349`）两个投递问题。修复后插件版本 `0.5.4 → 0.5.5`：
原生桥的答复码（`session-not-found` / `session-mismatch`）和请求体的 `messageId` 是行为契约变化，
升一个修订号，重启 DSH 后看 `PluginLoaded 0.5.5` 就能确认新代码生效。

### 15.1 [P1: 指定会话失效时消息误投其他会话] —— 两层都错，两层都堵

**插件侧（`src/index.mjs` 原生桥 `/message`）**：旧代码

```js
let agent = requestedSession ? agents.get(requestedSession) : undefined
if (!agent && activeSessionId) agent = agents.get(activeSessionId)   // ← 改投活动会话
if (!agent) { const roots = agents.roots(); agent = roots[roots.length - 1] }  // ← 再改投最后一个 root
```

请求 `session-A-missing`、宿主里只有 `session-B` 时，消息被塞进 B 的 `followup()`，然后回
`200 { ok: true, accepted: true, sessionId: 'session-B' }`。用户的输入会静默落进另一个项目的会话。

现在：

- **有显式 `sessionId` 就只精确查一次**，查不到直接
  `409 { ok: false, error: 'session-not-found', requestedSession }`，**不碰**活动会话和 root；
- 查到了还要复核 `agent.session.id === requestedSession`，不一致回
  `409 { ok: false, error: 'session-mismatch', requestedSession, sessionId }`；
- **只有调用方完全没给 `sessionId`** 时，才允许「活动会话 → 最后一个 root」兜底（这是桌宠不指定目标时的正常路径，
  行为保留）。

**主进程侧（`app/src/main/host-bridge.ts`）**：旧代码只认 `ok && accepted`，然后把请求的 ID 覆盖回结果：

```js
if (native) return native.ok ? { ...native, sessionId: session.sessionId } : native
```

现在先校验回执里的**实际接收会话**：`parsed.sessionId` 为空或不等于目标 → `ok: false, code: 'no-session'`，
提示「宿主回报的接收会话是「X」，与目标「Y」不一致，这条消息没有算作发送成功」。
`session-not-found` / `session-mismatch` 也各自映射成明确文案，并且**都不再回退 CLI**。

### 15.2 [P2: 回执中断后自动回退命令行可能重复投递] —— 把「失败」拆成三态

旧代码 `req.on('timeout')` / `req.on('error')` 一律 `finish(null)`，调用方看到 `null` 就换 headless CLI。
一次用户操作于是可能「原生桥 1 次 + CLI 1 次」，而第一次其实已经送达。

现在 `sendNativeHarnessMessage()` 返回三态，语义写在类型注释里：

| 结论 | 触发条件 | 调用方行为 |
|---|---|---|
| `unavailable` | 桥信息缺失/失效、HTTP 401/404、`ECONNREFUSED`/`EHOSTUNREACH`/`ENETUNREACH`/`ENOTFOUND`/`EADDRNOTAVAIL`/`EACCES`、请求还没刷出去就报错 | 确认没送到，**允许**回退 CLI |
| `unknown` | 5 秒超时、发出后 `ECONNRESET`/`EPIPE` 等 | **禁止**回退，直接报「消息可能已经送到宿主，为避免重复投递，这次没有自动改用命令行重发」 |
| `result` | 宿主给了明确 HTTP 答复 | 原样作为结果，含 P1 的会话一致性校验 |

另外原生桥请求体新增 `messageId`（`crypto.randomUUID()`），插件原样回传，用于把一次投递的回执和日志对上号。
这不是跨通道去重（CLI 通道看不到它），只是关联标识 —— 别把它当幂等保证。

### 15.3 回归测试（都验证过「在旧代码上会失败」）

- `plugin/tests/deepseek-harness-plugin.test.cjs` 末尾三条（`npm run test:plugin` 114 → **117**）：
  - `[DSH-P1: 指定会话失效不得改投] 目标不存在时拒绝，且不送给活动会话` —— 先 `emit('session/event')`
    把活动会话设成 `session-B`，再请求 `session-A-missing`，断言 409 + `session-B` 一条都没收到；
  - `[DSH-P1: 精确命中] 目标存在时只送给目标，回执回传 messageId`；
  - `[DSH-P1: 未指定目标] 只有调用方不给 sessionId 时才允许按活动会话兜底`（这条在旧代码上本来就通过，
    守的是「别把正常兜底一起堵掉」）。
- `app/tests/host-bridge.test.cjs` 末尾四条：
  - `[P1: DSH 回执会话与目标不一致时不得报成功]`
  - `[P1: DSH 目标会话不存在时不改投且直接失败]`
  - `[P2: 宿主收下请求后断线不得自动改走命令行]`
  - `[P2: 连接被拒仍允许回退命令行]`
- 三条 P1/P2 断言在 `git stash` 掉源码后确实失败，一条「连接被拒仍回退」在新旧代码上都过。
- 另用审查方自己的探针脚本回放（`.tmp/review-20261031/host-boundary-probes.cjs`）：它在
  「B 应收到 1 条」处得到 0 条而失败，即旧 bug 已不复现；修复后的期望版本在
  `.tmp/review-fix-20261031/probe-fixed.cjs`，三场景结果写进 `results.json`。

### 15.4 现场与注意

- 全量：插件 **117/117**；应用 **1130 项（1124 通过 / 6 跳过 / 0 失败）**；`npm run typecheck` Node+Web 通过。
- 6 项跳过与上一轮一致（5 项缺 `.uta-task/model-input` 的真实 DS fixture、1 项 symlink 权限）。
- **改的是源码，运行中的 DSH 仍是旧代码**（同 §14.5：没有热重载），要重启 DSH 才生效。
- 主进程侧改动对 `hostId !== 'harness'` 的其他宿主无影响（Claude/Codex/ZCode/OpenCode 走原 CLI 分支）。
