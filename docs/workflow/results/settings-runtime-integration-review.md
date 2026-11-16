# CLI第三批：开发profile设置接入主控审查

日期：2026-10-23。结论：**Codex补正后接受源码集成**，实现提交 `404be6d4cbc902ff91dd30fb11767982b0fc3bda`。只启用隔离开发profile的十二个公开字段；日常stable仍legacy。真实旧来源迁移、独立设置窗口、新Live2D产品运行时均不在本批交付内。

## 收取与审查现场

Antigravity会话 `93db8778-3e7f-4f2b-b594-ae3d0098eb89` 的首轮退出0但命令权限被拒绝，没有实现，不算交付。`latest-attempt.json`指向attempt-2；第二轮只读写/编辑文件，未执行命令和提交，12:39:39Z结束。没有重派、绕过权限或修改全局allow规则。任务包装器记录旧桌宠插件已恢复；接手检查对应历史PID无现存进程，未停止任何其他进程。

14份原始文件由主控冻结收取；source仍为未提交候选，base `aba335d914fac58cc2c35fa0e7fc40e139fa51f3`。来源与sha256在仓库外 `operations/cli-wave3-monitor/antigravity-capture.json`，收取后再次核对14文件未变。Worker原目录未改；本文及主控测试优先于其原始result/progress中的设计保证和历史状态。

主控工作区 `D:/Frankenstein/Uta-Workspace/tasks/codex-cli-wave3-review`，分支 `task/codex/cli-wave3-review`，原base `b8c87c262e98f2d36878bff2561f46112298c9a1`；设置收取基于已集成Soullink试验的 `acc115114001a5f48688ba8fbd11d04b81ebc4e9`。依赖、本地构建/TEMP、测试临时目录独立，没有共享node_modules或启动日常实例。

## 发现与修正

- **IPC发送者与导航边界**：原实现允许缺失senderFrame/mainFrame。现在要求活着的已登记webContents及严格主框架身份；主入口与广播目标还必须处于实际配置的renderer页面，导航至其他页面失效。只暴露mode/read/patch/changed，不注册importLegacy或任意路径接口。canonical初始化失败返回blocked，不伪装成legacy。
- **退出等待落盘**：原before-quit只发起异步dispose而未阻止退出。现在preventDefault并等待初始化与store.close，重复退出共用等待过程，完成后只恢复一次quit；重复dispose也等待同一关闭Promise。stable不调用新store工厂，连目录创建都放在开发工厂内。
- **启动和重试生命周期**：只有真正无preload的浏览器可browser-mock；Electron缺接口、未知mode、订阅/读取失败均阻止挂载。先订阅后读，取最高revision；旧init失败不能拆掉新连接，旧patch/队列不能写入新连接。bootstrap忽略过期初始化，成功只挂载一次，错误屏不展示异常路径或拼入异常HTML。
- **并发与冲突**：编辑调用保留初始revision，队列只跟随本客户端成功写入的版本前进。其他窗口插入版本会产生冲突、刷新已提交快照，绝不自动重试覆盖。输入/缓存/每个订阅者的快照独立，自身广播和回执不重复通知，失败不污染后续队列。
- **Pinia逐字段保存**：原实现每次提交全十二字段，远端赋值还可能覆盖排队输入。现在同步记录实际编辑字段及各字段版本，保留明确未保存草稿；远端只更新没有本地草稿的字段，旧回执不清新编辑。导出`settingsUnsavedChanges`、`settingsSaveError`与真正响应式的`settingsRevision`；作用域结束退订并忽略旧回执。开发localStorage只保留未迁移字段，stable完整保留原逻辑。
- **悬停淡化旧入口**：追到DeskpetStage模型启动后的getUiState/onSetHoverFade会覆盖新权威值。主控将这两处经store的legacy适用函数处理；开发托盘/快捷键统一读写同一个canonical store，旧window-state不再镜像该字段，stable仍走原入口。这是主控为契约完整性补充的范围，未要求Worker越过原assignment改文件。

## 实际验证

初次执行Worker三份测试为15通过/2失败：测试未真正把ipcMain替身注入TS模块；同时补正跨VM对象断言与遗漏await。全量第一次另暴露旧model-migration测试加载器缺少新main依赖，补上隔离替身后其7项真实文件系统用例恢复。没有通过删除测试或跳过来消除失败。

最终注册新增31项（原交付17项、主控14项），应用由490增至**521/521，0失败、0skip**。主控补测实际执行SettingsClient、preload、IPC handler、真实临时SettingsService、Pinia和renderer bootstrap模块；Electron传输/窗口与DOM由替身提供，存储和Vue/Pinia为真实实现。涵盖两个独立客户端共用一个临时profile、广播、过期版本拒绝、磁盘重开、独立profile、故障/乱序/退订、跨连接旧响应、无回写、本地草稿保留、托盘权威及退出前落盘。

在验收区实际执行：

```powershell
# 仓库根目录
node scripts/check-first-wave-contracts.cjs
node scripts/check-desktop-wave2-contracts.cjs
# app目录
npm test
npm run typecheck
# 仅本命令使用任务内TEMP/TMP，未修改全局环境
$reviewTemp = Join-Path (Get-Location) 'node_modules/.uta-review-tmp'
New-Item -ItemType Directory -Force -Path $reviewTemp | Out-Null
$env:TEMP = $reviewTemp
$env:TMP = $reviewTemp
npm run build
```

上述契约检查、node/web类型检查与产品构建退出0。Worker报告列出的两个`.mjs`契约命令不存在，实际为上面的`.cjs`。构建沿用已有Cubism静态script不能bundle的提示，构建成功；没有生成/发布ZIP。原始日志在 `D:/Frankenstein/Uta-Workspace/operations/cli-wave3-monitor/antigravity-full-tests.log` 与 `antigravity-build.log`。代码提交后补测实际preload链路与stable悬停回归也通过。

## 接受边界与交接

**未进行真实Electron双窗口、硬件渲染或物理屏幕验收**，不能据此声称真实设置窗口、模型画面或跨平台宿主已通过。保存失败已有错误和未保存草稿ref，正式可见提示/重试交互留给后续设置UI任务；本轮开发修改可继续编辑再保存。blocked的损坏/未来版本文件不自动修复，store工厂创建失败需重启进程再试，不自动回退或改写文件。

既有四份主目录脏文档与原始hash一致。正式AppData/DS模型未访问写入；stable登记与日常ZIP仍是0.1.1、源码dcf1b3f，不代表本次源码接线已进入日常exe。两项CLI第三批均已完成源码验收，监听在整批收尾后停用，原工作区/运行日志保留审计，无新增常驻端口。下一批未armed，不继续自动派单或发布。
