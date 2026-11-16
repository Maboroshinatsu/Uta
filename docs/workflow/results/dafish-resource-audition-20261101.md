# 大肥鱼原生资源试听与黑块回归修复

日期：2026-11-01
状态：进行中（资源可试听，脸部语义验收未完成）
基线：`ce9033e`
代码提交：`0881805`、`8eee8f0`

## 交付结论

- 新增只读试听入口：`deskpetListExpressions()`、`deskpetPreviewExpression(name)`、`deskpetClearExpression()`。它只应用模型已注册的原生表情，不改 adapter、不写预设。
- 在隔离 profile 中逐个试听 23 个表情、播放 8 个原生动作，抓取 50 帧并生成表情、动作、脸部三张联系表。
- 发现并修复一次真实回归：重导生成的新 adapter 是空草稿，丢了鼻子蒙版的 `hiddenDrawables`，黑块重新出现。现在导入器在替换重导且源包没有 adapter 时，会保留目标目录已有的 adapter；源包自带 adapter 时仍以源包为准。
- 真实替换重导已验证：23 个表情、8 个动作恢复，已有 adapter 的 `hiddenDrawables`、8 个常驻参数、21 个控件、9 个情绪全部保留；近景确认鼻子黑块消失。

## 试听结果

### 表情（23 项）

- 全身体型、服装和道具类变化可见：`体型1`、`体型2`、`尾巴开关`、`脱鞋`、`胸口衣服`、`裙长切换`、`钢盆`、`黑框眼镜`、`默认体型`。
- `脸红` 在近景中可见，脸颊会变红。
- `兔牙`、`圈圈眼`、`屑`、`流冷汗`、`流泪`、`爱心眼`、`黑脸`、`＞＜`、`单片眼镜` 的脸部细节在现有全景/近景机位下仍不够清楚。它们已经能应用、没有报错，但**不能据此宣称视觉语义已验收**。
- 23 个 exp3 全部注册；`裙子切换`、`屑屑眼` 是文件 stem 与 VTube 热键名不同产生的别名，对应已注册的 `裙长切换`、`屑`，不是丢失资源。

### 原生动作（8 组）

- `IDLE`、`抚胸手打开/关闭`、`狗尾巴草打开/关闭`、`竖手指打开/关闭`、`脱捕` 都能从真实动作入口启动。
- 联系表能看到手部、道具和待机姿态的差异；`脱捕` 时长 13.15 秒，其余动作约 1.0–1.25 秒，`IDLE` 约 5.98 秒。
- 8 个动作的 `Meta.Loop` 都是 true；接入表演计划时必须显式声明结束策略，不能只依赖动作层释放。

## 黑块回归

- 原因：新导入器为源模型生成了一份只含 idle/focus/口型的草稿 adapter；仓库草稿里的 `hiddenDrawables: ["ArtMesh246","ArtMesh682"]` 没有被带进新模型，鼻子蒙版网格重新可见。
- 修复：先给隔离模型装回已知 adapter；同时修改导入器，在替换重导且源包没有 `deskpet-adapter.json` 时，把目标目录已有 adapter 复制到新包。源包显式提供 adapter 时仍以源包为准。
- 验证：真实替换重导后，adapter 仍包含两个隐藏网格、8 个 base 参数、21 个控件、9 个情绪；近景 `face-closeup.png` 与 `face-closeup-blush.png` 均无黑块。

## 证据

- 表情联系表：`D:/Frankenstein/Uta-Workspace/operations/dafish-resource-audition-20261101/expressions-sheet.png`
- 动作联系表：`D:/Frankenstein/Uta-Workspace/operations/dafish-resource-audition-20261101/motions-sheet.png`
- 脸部联系表：`D:/Frankenstein/Uta-Workspace/operations/dafish-resource-audition-20261101/faces-sheet.png`（机位仍偏高，只作参考，不作为脸部验收）
- 黑块修复近景：`D:/Frankenstein/Uta-Workspace/operations/dafish-nose-fix-20261101/`
- 证据与隔离 profile 均在仓库外；本文件完成时日用 `%APPDATA%/uta` 未写。后续按用户明确选择已将完整模型同步到日常 profile，见 [日常同步](dafish-daily-sync-20261101.md)。

## 验证

- `npm test`：1174 项；1168 通过、6 跳过、0 失败。
- `npm run typecheck`：Node/Web 均通过。
- `npm run build`：通过。
- 真实 Electron：新导入模型加载、23 表情/8 动作、IDLE 启动、adapter 保留、鼻子近景无黑块。

## 下一步

1. 用正确的脸部特写机位重拍 9 个未看清的脸部表情，再决定哪些可以进入语义映射。
2. 把已看清的体型/服装/道具表情接到控件，把 8 个动作按实际语义接入映射；未验收的脸部表情继续标记为待复核。
3. 完成后再进入统一解析影子对照；不要直接把“文件已恢复”当成“表演已可用”。
