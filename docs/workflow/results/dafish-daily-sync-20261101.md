# 大肥鱼完整模型同步到日常 profile

日期：2026-11-01
状态：已完成（用户明确选择“装回日常并备份”）
来源：隔离 profile `C:/Users/Administrator/AppData/Roaming/uta-development/dafish-reimport-20261101`
目标：日用 profile `C:/Users/Administrator/AppData/Roaming/uta/models/imported-character-072c7e1cdc`

## 安装方式

- 先优雅关闭正在运行的 `win-unpacked/Uta.exe`。
- 将旧日常目录整体移到 `C:/Users/Administrator/AppData/Roaming/uta/.model-import-backups/dafish-pre-sync-20261101`。
- 将隔离 profile 中已验证的完整模型、`Exp3/`、`Animation/`、`.vtube.json` 和 `deskpet-adapter.json` 复制回原路径。
- 复制后校验失败会自动还原旧目录；本次校验通过。

## 安装结果

- 日常模型：23 个表情、8 个动作组、509 个参数、147 个部件。
- adapter：`hiddenDrawables: ["ArtMesh246","ArtMesh682"]`、8 个常驻参数、21 个控件、9 个情绪、`idleMotions: ["IDLE"]`。
- 旧日常目录备份：5 个文件（`大肥鱼.4096`、`.cdi3.json`、`.moc3`、`.model3.json`、`.physics3.json`），可手动恢复。
- 日常 profile 的模型 URL 未变：`uta://models/imported-character-072c7e1cdc/大肥鱼.model3.json`。

## 真实运行验证

- 启动 `win-unpacked/Uta.exe`，用日用 profile 实际加载模型。
- 运行时事实：23 表情、8 动作，adapter 的隐藏网格、21 控件、9 情绪都存在；没有缺失动作/表情/参数诊断。
- 截图无鼻子黑块；`脸`部正常。截图：`D:/Frankenstein/Uta-Workspace/operations/dafish-daily-sync-20261101/pet.png`
- 验证完成后已退出该实例；用户可通过 win-unpacked 快捷方式正常启动。

## 仍存在的已知项

- `happy`、`surprise`、`curious` 写 `ParamMouthOpenY`，会报口型争用 warning；这是 adapter 数据，不是安装失败。
- 8 个标准动作语义仍未映射到 adapter 的 `animations`；原生动作资源已恢复，但 `wave` 等语义仍不可用。
- 9 个脸部表情的全景/近景验收仍未完成；不要把它们当成已确认语义。

## 边界

- 本次是按用户明确选择写入日用 profile 的模型目录；旧模型目录已完整备份。未修改宿主配置、TTS 或密钥；日常聊天数据由应用正常启动写入，不属于本次安装改动。
- `win-unpacked` 已在 `e0d0e9d` 代码上重建，包含 DS/Hiyori 分享模型和最新代码；后续内置适配提交 `b392071` 后再次重建，当前包含内置适配目录。
