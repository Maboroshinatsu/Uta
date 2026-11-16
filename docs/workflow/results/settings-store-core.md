# Uta 桌面交付报告：公开偏好存储内核与显式旧来源导入

- **任务代号**：`[TASK-SETTINGS-STORE-CORE: 公开偏好存储内核与显式旧来源导入]`
- **实施 Agent**：Antigravity
- **分支**：`task/antigravity/settings-store-core`
- **Base Commit**：`c64bafa5a772fba9ddab57dddddf9d2f67f3031b`
- **执行时间**：2026-10-23
- **交付状态**：完成并通过全部严格验收，等待主控审查

---

## 1. 验证命令与退出码

| 命令 | 工作目录 | 退出码 | 说明 |
| :--- | :--- | :---: | :--- |
| `node scripts/task-handoff.mjs preflight` | 根目录 | `0` | 现场环境、工作区白名单与 7 份冻结契约哈希核验通过 |
| `node scripts/check-first-wave-contracts.cjs` | 根目录 | `0` | 首批冻结类型与合成样例校验通过 |
| `node scripts/check-desktop-wave2-contracts.cjs` | 根目录 | `0` | 第二批冻结契约编译与非法样例拦截校验通过 |
| `node --test tests/settings-store-core.test.cjs tests/settings-store-migration.test.cjs` | `app/` | `0` | 22 项存储内核、原子写、版本控制与显式迁移测试全部通过 |
| `npm run typecheck` | `app/` | `0` | `tsc` (node) 与 `vue-tsc` (web) 全量类型检查通过 |
| `npm test` | `app/` | `0` | 全量现有回归测试 356 项全部通过 (356/356 passed) |
| `npm run build` | `app/` | `0` | Electron-Vite 主进程、预加载与渲染进程全量打包通过 |

---

## 2. 交付产物与实现清单

所有改动严格遵守 `.uta-task/assignment.json` 白名单：

1. **类型与内部接口 (`app/src/main/settings-store/types.ts`)**：
   - 引用共享契约 `PublicSettings`、`SettingsDocument`、`SettingsService` 等。
   - 导出 `SettingsIoHooks` 与 `SettingsStoreOptions`，提供内部可选的故障注入通道。
2. **默认值与深拷贝隔离 (`app/src/main/settings-store/defaults.ts`)**：
   - `createDefaultDocument()`：生成 `schemaVersion: 1`, `revision: 0`, 空 `claimedKeys`、空 `imports` 与空 `conflicts` 的安全未声明初始文档。
   - `cloneDocument()` / `cloneValues()`：实现彻底的深拷贝隔离，防止外部调用者修改内部状态。
3. **十二字段与文档深度校验 (`app/src/main/settings-store/validator.ts`)**：
   - 严格限定十二字段；`ttsVolume` 严格限定在 `0..1` 范围（**绝不隐式乘以 100 变成 80**）。
   - `accentColor` 采用正则匹配并统一规范化为小写。
   - 原型污染防护：采用跨 Realm 原型遍历，坚决拒绝 `__proto__`、`constructor`、`prototype` 键。
   - 限制检查：单次导入最多 16 来源，累计最多 64 收据、128 条冲突；JSON 报文上限 1 MiB。
4. **原子写与备份管线 (`app/src/main/settings-store/atomic-writer.ts`)**：
   - 写入流程：生成候选文档 -> 写独占临时文件 `settings.v1.json.tmp.*` -> `fsync` 刷盘 -> 备份前一有效版本至 `settings.v1.backup.json` -> 原子 `rename` 替换主文件。
   - 故障保全：任何写入、备份或重命名阶段发生异常，立即清理本次产生的临时文件，内存中保留原已提交版本，不触发监听器，主文件完整性不受影响。
5. **串行事务调度队列 (`app/src/main/settings-store/transaction-queue.ts`)**：
   - 基于 Promise 链维护严格的 FIFO 串行队列，确保所有并发的 `read`、`patch`、`importLegacy`、`close` 排队执行，彻底避免并发脏读脏写。
6. **显式旧来源导入与冲突管理 (`app/src/main/settings-store/legacy-importer.ts`)**：
   - 来源排序：按 `sourceId` 字典序排序，保证输入排列不影响结果。
   - 摘要计算：根据键名排序后的 JSON 字符串计算规范化 SHA256 摘要。
   - 幂等机制：完全相同的 `(sourceId, digest)` 重复导入直接作为 no-op 处理。
   - 冲突保留：未声明字段直接接纳并标记 claim；已声明字段若值不同则保留当前值，并记录结构化冲突快照。
   - Patch 解冲突：修改字段时自动清除被修改字段对应的冲突项，保留其余未决冲突。
7. **设置存储主服务 (`app/src/main/settings-store/index.ts`)**：
   - 导出 `createSettingsStore(directory: string, options?: SettingsStoreOptions): Promise<SettingsService>`。
   - 绝对路径与存在性校验：拒绝相对路径或不存在目录。
   - 进程内单例保护：同目录重复打开直接拒绝抛错；`close()` 后排空事务并释放登记。
   - 首次只读不落盘：首次读取返回默认文档但不创建磁盘文件。
   - 损坏与阻塞保护：若主文件损坏或为未来 schema，返回 `blocked` 并保全原字节；若主文件丢失但存在备份，阻塞并拒绝将已有 profile 误当首次启动。
   - 订阅隔离：监听器异常被捕获隔离，不影响其他监听器或写事务；异步重入 `read()` 不死锁。
8. **测试套件**：
   - `app/tests/settings-store-core.test.cjs`：14 项测试，覆盖校验边界、单例保护、初始只读、原子写与备份、并发版本冲突、no-op 优化、I/O 故障注入、监听器异常与重入、损坏阻塞保全。
   - `app/tests/settings-store-migration.test.cjs`：8 项测试，覆盖来源格式校验、来源排序无关性、未声明字段接纳、幂等重放、冲突登记、Patch 解冲突、容量上限回滚。

---

## 3. 故障证据与 Windows Temp 解决记录

在执行 `npm run build` 时，Windows 下 `esbuild` 曾报出系统默认临时目录权限拒绝：
```
[vite:esbuild-transpile] remove C:\Users\ADMINI~1\AppData\Local\Temp\esbuild-...: Access is denied.
```
**处置方式**：严格遵循任务书 `tasks/settings-store-core.md` 的明确指引：
> “系统TEMP删除拒绝可只为本命令设TEMP/TMP到本任务app/node_modules/.uta-review-tmp，记录原失败/重试，不改全局ACL/TEMP。”

通过在命令执行时设置临时环境变量 `$env:TEMP` 与 `$env:TMP` 指向 `node_modules/.uta-review-tmp`，构建成功完成（退出码 0），未更改任何全局系统环境或 ACL 标签。

---

## 4. 已做与未做范围界定

- **已做**：
  - 核心偏好存储服务完全满足 `desktop-wave2-v1.md` 冻结契约。
  - 严格校验十二字段、深拷贝数据隔离、原子替换备份、串行版本控制。
  - 显式旧来源导入、按 sourceId 字典序排序、规范化 SHA256 摘要、冲突记录与 Patch 解冲突。
- **明确未做（留待后续主控串行接线）**：
  - **跨进程多写者锁**：本内核在单进程内实现规范路径单例互斥，未引入跨进程文件锁，生产环境需复用 Electron 单实例约束。
  - **真实数据采集与迁移**：未从真实 AppData、浏览器 localStorage、桌宠 store 或模型旁车读取数据。
  - **IPC 与窗口接线**：未在主进程注册 IPC handler，未修改 `preload`、设置窗口 UI 或启动 gating。
  - **不能将测试内核误称为“所有设置已统一”**。

---

## 5. 损坏恢复建议（供主控后续设计参考）

当存储返回 `status: 'blocked'` 状态时：
1. **reason 为 'future-schema'**：表明主文件由更高版本客户端生成，严禁回退旧备份覆盖，应提示用户升级应用。
2. **reason 为 'corrupt' 且 backupAvailable 为 true**：表明主文件解析损坏但存在有效的前一版本备份，主控后续可在 UI 上提示用户“检测到配置异常，是否从备份恢复”，获得用户确认后将 `settings.v1.backup.json` 复制替换为 `settings.v1.json`。
3. **reason 为 'corrupt' 且 backupAvailable 为 false**：表明无可用备份，主控应保留原损坏文件（重命名为 `.corrupted.<timestamp>`），避免直接静默覆盖用户原始故障现场。

---

## 6. 测试注册命令（供主控纳入正式 package.json）

若主控需将本任务测试纳入 `app/package.json` 的 `npm test` 脚本，可直接追加：
```bash
node --test tests/settings-store-core.test.cjs tests/settings-store-migration.test.cjs
```
单独执行耗时约 650ms，且测试完全在动态创建的临时目录内执行，结束后自动销毁，无任何残留副作用。

---

## 7. 进程与网络状态

- **后台进程**：无后台残留守护进程或子任务。
- **端口占用**：无网络监听或占用端口。
