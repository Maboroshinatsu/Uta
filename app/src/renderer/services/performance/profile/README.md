# Model capability profile（首批纯模块）

`buildModelCapabilityProfile(input: ModelInspectionInput): ProfileBuildResult`

把已读取的合成模型快照（参数、原生表情、motion 目录、用户 override）转换成经过校验的能力、语义映射与降级说明。模块不加载 Live2D、不读磁盘、不计算资产哈希、不访问网络、不持久化，也不包含 PIXI/Vue 依赖。

## 调用约束

- 类型唯一来源：`app/src/shared/first-wave-contracts.ts`。
- 调用方负责把 loader `ParameterInfo.default` 转成 `defaultValue`，并提供真正的内容签名；路径不能冒充签名。
- 输入是完整快照；未知字段、坏结构、坏数值不会被过滤成“成功”。
- 纯同步函数：不修改输入，相同输入结果确定，不含时间或随机值。

## 校验策略

所有格式错误以 `{ ok: false, issues }` 返回，不向调用方 throw。可一次收集多项问题，路径形如 `parameters[0].min`。

| 区域 | 规则 |
| --- | --- |
| 根 | 必须是对象；`schemaVersion` 必须为 `1`；未知字段拒绝 |
| 签名 | 非空字符串（只校验 `trim()` 后非空，不改写原值） |
| 参数 | `id` 非空且唯一；`min/max/defaultValue` 有限且 `min ≤ default ≤ max`；`physicsOutput` 布尔；未知字段拒绝 |
| 表达式 | `name` 非空且唯一；参数 `id` 非空、`value` 有限、`blend ∈ {Add, Multiply, Overwrite}`；结构未知字段拒绝 |
| Motion | `group` 非空；`index` 非负整数；`group#index` 唯一；`parameterIds` 为非空字符串数组；未知字段拒绝 |
| Override | `channel` 必须属于 15 个语义通道；`direction ∈ {normal, reversed}`；`confirmed` 布尔；同一通道只能有一个；目标参数必须存在（否则 `unknown-override-target`）；未知字段拒绝 |

字符串身份（参数 id、表达式名、motion group）保留原值，不做 trim 后的改写。

## 映射优先级与能力状态

每个通道按以下顺序解析，能力列表始终按 `SEMANTIC_CHANNEL_ORDER` 输出全部 15 项：

1. **已确认 override** → `source: 'manual'`
2. **标准参数 ID** → `source: 'standard-id'`；仅在参数存在、范围有效（`min < max`）且不是物理输出时 `available`
3. **唯一明确的标签别名** → `source: 'label-guess'`，`confirmed: false`，confidence `0.5`，永远 `needs-calibration`
4. **未确认 override（兜底）** → `source: 'manual'`，`confirmed: false`，`needs-calibration / unconfirmed`
5. 无来源 → `unsupported / missing-parameter`

未确认 override 不抢占可用的标准映射；只有没有任何其他来源时才作为降级映射出现。此解释需主控审查确认。

降级规则：

| 情况 | 结果 |
| --- | --- |
| 物理输出参数（标准或 override） | `needs-calibration / physics-output`，不自动映射（override 仍保留 manual 映射） |
| 零范围参数（`min === max`） | `needs-calibration / ambiguous`，不能作为连续控制 |
| 单个标签候选 | 映射但 `needs-calibration / ambiguous` |
| 多个候选或标签跨通道 | 不猜，`needs-calibration / ambiguous`，列出候选参数 ID |
| 未确认 override 且无其他来源 | `needs-calibration / unconfirmed` |

标准候选表见 `STANDARD_PARAMETER_IDS`。标签别名是刻意保守的精确匹配（中英少量词），不做子串、模糊或方向推断。

## 原生资源

表达式与 motion 按输入原样保留（Add/Multiply/Overwrite 与数值、group/index/parameterIds），不创造参数。引用未知参数只产生 warning：

- `unknown-expression-parameter`，`resource` 为表达式名
- `unknown-motion-parameter`，`resource` 为 `group#index`

warning 按表达式在前、motion 在后的输入顺序输出，并按 `(code, resource, parameterId)` 去重。

## 不做的事

- 不修改 loader、emotion-adapter、Stage、store、共享契约或 package 依赖。
- 不从参数名推导 Core 中真实存在的通道；没有映射就输出 `unsupported`。
- 不实现性能导演、快照采样、UI 接线或设置持久化。
