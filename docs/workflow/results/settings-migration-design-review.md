# 设置专项审计与主控设计决定

日期：2026-10-22。Qoder 使用 DeepSeek-Flash/max/1M 完成只读源码调查；尚未执行设置迁移。原报告/真实会话保存在仓库外 operations/qoder-connect/project-audit-events.jsonl、project-audit-report.txt。

## 已核对的重点

Codex 已直接核对 deskpet store 的 persistPresetsMap/ensureModelPresetsSeeded 和 main/index 的 saveModelPresetsToDisk：先写 localStorage，再异步写模型旁 deskpet-presets.json；没有检查返回 false，文件非原子写；重新加载只要磁盘预设非空便优先覆盖本地桶。这是确定的数据冲突机制，实际丢失仍取决于写失败/损坏/旧文件等条件。

Electron 打包使用 asar；包内默认模型不可作为可写用户设置目录。除重启丢预设外，开发 profile 共享用户模型路径也可能写同一旁车文件，现有 userData 隔离不能自动隔离它。此项列为下一阶段的首要数据正确性问题，不把本轮状态修复当作已解决它。

其他审计发现：host/model/presets/adapter 设置按 origin 分散；模块导入阶段就读取宿主；normalizeHostPreference 可能在插件暂不可用时改写偏好；hoverFade 同时有 store 与主进程来源。后两项需随统一设置进行针对性复现/修复，不能随意搬动真实用户存储。

## 主控已定的实施约束

1. 继续采用 Electron 主进程的每 profile 独立 canonical settings 文件；只用现有环境解析结果决定目录，不新增另一套 APPDATA/profile 规则。
2. 第一小批只实现纯存储与夹具测试，之后冻结 IPC、再改 bootstrap/host/model，最后迁预设。shared main/preload/env.d.ts 由 Codex 串行审查接线，不和 UI/会话修复同时修改。
3. schemaVersion、revision、字段白名单、体积限制、临时文件/原子替换、失败保留旧值、损坏文件保全与备份恢复必须有行为测试；未知更高 schema 不降级覆盖。
4. 现有 canonical 值不被 legacy 覆盖。导入幂等并记录来源；同 origin 多次读取不重复制造冲突。其他 origin 的不同值必须保存为可供审查的冲突，不按时间或谁后启动静默择新。真实稳定数据迁移前先备份，开发 profile 只使用自己的夹具/旧值。
5. 模型旁车预设只作为一次性旧来源/随模型默认值读取，**不再自动写入共享模型目录作镜像**。显式导入/导出另行设计，不能以兼容旧路径为由破坏 profile 隔离。原文件不删除。
6. 宿主不可用时保留明确偏好并显示未连接；不得悄悄连另一宿主或将偏好持久改成 standalone。外部插件设置可能带端点/凭据，须在冻结宿主迁移前明确其存储策略，不能迁偏好后默用另一套连接配置。
7. 不把任意模型路径、任意设置键写入能力暴露给 renderer；复用现有模型 URL/预设验证，并限制发送源。密钥继续由已有安全存储负责，不塞进普通 settings JSON。

下一阶段任务仍为 tasks/settings-store-migration.md。Qoder 当前转做独立的工坊编辑锁修复；设置迁移工作区保留干净，不在同一任务分支混入该修复。
