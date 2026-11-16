# 大肥鱼重导与动作表情恢复验证

日期：2026-11-01
状态：已完成
基线：`5aa8a12`

## 交付结论

在隔离 profile 中用当前导入器重新导入源模型，恢复了大肥鱼的动作和表情资源，并在真实 Electron 实例中加载验证；本阶段未写入日用目录、日用设置和宿主配置。后续按用户明确选择已将完整模型同步到日常 profile，见 [日常同步](dafish-daily-sync-20261101.md)。

## 重导

- 源目录：`D:/STEAM/steamapps/common/VTube Studio/VTube Studio_Data/StreamingAssets/Live2DModels/DeepSeek`
- 隔离 profile：`C:/Users/Administrator/AppData/Roaming/uta-development/dafish-reimport-20261101`
- 方式：真实 `createModelImporter` 的 `stage → install`，不是手工拼文件。
- 候选摘要：`5 张贴图 · 0 个表情 · 0 个动作 · VTS 表情 23 · 动作 8`；无错误、无警告。
- 安装结果：`uta://models/imported-character-072c7e1cdc/大肥鱼.model3.json`。
- 安装目录包含 23 个 `.exp3.json`、8 个 `.motion3.json`、`.vtube.json` 和生成的 `deskpet-adapter.json`。

## 真实运行时验证

- 通过真实设置命令切换模型并等待 `modelLoaded`。
- 模型实际为 509 个参数、147 个部件、23 个已注册表情、8 个动作组。
- 动作组：`IDLE`、`抚胸手关闭`、`狗尾巴草关闭`、`狗尾巴草打开`、`竖手指打开`、`竖手指关闭`、`脱捕`、`抚胸手打开`。
- `IDLE` 已通过真实动作入口启动，返回成功。
- 能力事实中没有 `missing-motion-resource`、`missing-expression-resource` 或 `missing-parameter`。
- 23 个 exp3 全部安装并注册；`unregisteredExpressions` 中的 `裙子切换`、`屑屑眼` 是文件 stem 与 VTube 热键名不同产生的别名，对应已注册的 `裙长切换`、`屑`，不是丢失资源。
- 生成的 adapter 当前只绑定 `idleMotions: ["IDLE"]`、自定义 focus 和 `ParamMouthOpenY` 口型；`emotions`、`animations`、`controls` 仍为空。
- 因此模型资源已恢复，但 8 个标准动作语义仍显示未映射，情绪也不会自动使用这 23 个表情；这属于下一阶段“表演适配”，不是本次导入失败。

## 后续修正

- 新导入生成的 adapter 是空草稿，丢失了已知的鼻子蒙版修复，黑块重新出现；已应用仓库草稿 adapter 并在隔离实例中确认修复。
- 导入器已改为在替换重导且源包没有 `deskpet-adapter.json` 时保留目标目录已有 adapter；真实替换重导验证通过。
- 资源试听、联系表和黑块修复证据见 [资源试听与黑块回归修复](dafish-resource-audition-20261101.md)。

## 证据与现场

- 运行时事实、能力简表和摘要：`D:/Frankenstein/Uta-Workspace/operations/dafish-reimport-20261101`
- 隔离实例已退出；5173、9360、9361 只剩 TIME_WAIT，无监听进程。
- 本阶段日用 `%APPDATA%/uta` 的模型、设置和宿主配置未改；后续按用户明确选择完成日常同步并保留旧目录备份，见 [日常同步](dafish-daily-sync-20261101.md)。临时验证脚本已删除。
- 下一步：把恢复的 23 个表情和 8 个原生动作映射到 adapter/表演计划，先处理 `裙长切换`、`屑` 这类热键名与文件 stem 不同的条目，再进入统一解析影子对照。
