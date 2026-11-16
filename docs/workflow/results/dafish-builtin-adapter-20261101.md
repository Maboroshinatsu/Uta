# 内置适配目录与大肥鱼签名绑定

日期：2026-11-01
状态：已完成
代码提交：`b392071`

## 交付结论

- 新增程序内置适配目录：静态 adapter 随程序发布，按模型签名匹配，不再依赖模型目录里一定存在 `deskpet-adapter.json`。
- 加载顺序固定为：模型本地 adapter → 签名匹配的内置 adapter → 自动草稿/空适配。本地手动修改永远优先；签名不匹配绝不应用内置适配。
- 大肥鱼已验证的 adapter 已作为第一条内置适配，绑定恢复后的模型签名 `uta-live2d-assets-v1:b72fb6bc0c74e119b0f11db582d90e6736bc3471226b10085e48c4dbb0583fe8`。
- 能力事实新增来源：`source.adapter` 为 `deskpet-adapter`（本地）、`builtin-adapter`（内置）或 `runtime-defaults`（无适配）。

## 真实回退验证

- 在隔离 profile `dafish-reimport-20261101` 中临时移走本地 `deskpet-adapter.json`，保留完整模型。
- 启动真实 Electron 后，导入模型自动使用内置适配：
  - `adapterSource: builtin-adapter`
  - 23 个表情、8 个动作
  - 21 个控件、9 个情绪
  - `hiddenDrawables: ["ArtMesh246","ArtMesh682"]`
  - 没有缺失动作/表情/参数诊断
  - 截图无鼻子黑块
- 验证后已恢复隔离 profile 的本地 adapter；日用 profile 的本地 adapter 也未被改动。
- 证据：`D:/Frankenstein/Uta-Workspace/operations/dafish-builtin-adapter-20261101/`

## 边界

- 内置适配只负责静态绑定；它不能替模型补回缺失的 `.moc3`、贴图、动作或表情。模型资源仍需完整导入。
- 模型签名变化时内置适配不会强行套用，会回退到本地/草稿；这避免把旧映射应用到新模型。
- 8 个标准动作语义仍未映射，`happy/surprise/curious` 仍有口型争用 warning；这些属于接下来的表演映射，不是内置加载失败。
- DS/Hiyori 的 adapter 仍随各自模型资源发布；本目录先只收大肥鱼，后续可迁移其他已验证适配。

## 验证

- `npm test`：1177 项；1171 通过、6 跳过、0 失败。
- `npm run typecheck`：Node/Web 均通过。
- `npm run build`：通过。
- `win-unpacked` 已用 `b392071` 重建，包含 DS/Hiyori、内置适配和新代码；用户快捷方式已保留，未生成新 ZIP。
