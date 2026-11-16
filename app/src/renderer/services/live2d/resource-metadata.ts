import type { ParameterInfo, ModelExpressionAssetInfo } from './loader'

/** 署名不是可操作功能名称；保留资源 ID 作为稳定、可查证的回退。 */
export function isAttributionLabel(text: string): boolean {
  return /唯一发布渠道|发布者.*账号|哔哩哔哩.*账号|账号.*UID|立绘[:：]|建模[:：]/i.test(text)
}

export function resourceLabel(fallback: string, ...candidates: Array<string | undefined>): string {
  return candidates.map(text => text?.trim()).find(text => text && !isAttributionLabel(text)) || fallback
}

/** 将原生表达式转换为以模型默认状态为基准的控件目标；Add 0 / Multiply 1 不占用通道。 */
export function expressionControlParameters(
  expression: Pick<ModelExpressionAssetInfo, 'parameters'>,
  parameters: ReadonlyMap<string, ParameterInfo>,
): Record<string, number> {
  const result: Record<string, number> = Object.create(null)
  for (const entry of expression.parameters) {
    const parameter = parameters.get(entry.id)
    if (!parameter || !Number.isFinite(entry.value)) continue
    const blend = (entry.blend ?? 'Add').toLowerCase()
    if ((blend === 'add' && entry.value === 0) || (blend === 'multiply' && entry.value === 1)) continue
    const from = result[entry.id] ?? parameter.default
    const target = blend === 'overwrite' ? entry.value : blend === 'multiply' ? from * entry.value : from + entry.value
    result[entry.id] = Math.max(parameter.min, Math.min(parameter.max, target))
  }
  return result
}

/** 参数相同而目标不同是不同操作；多个单参数操作也不能替代一个组合操作。 */
export function controlOperationKey(parameters: Record<string, number>, hidden: readonly string[] = [], shown: readonly string[] = []): string {
  return JSON.stringify([Object.keys(parameters).sort().map(id => [id, parameters[id]]), [...new Set(hidden)].sort(), [...new Set(shown)].sort()])
}

/** 名称相同不等于资源相同；保留先有 ID，再以文件/参数/部件标识回退。 */
export function uniqueResourceId(preferred: string, fallback: string, seen: ReadonlySet<string>): string {
  if (!seen.has(preferred.toLowerCase())) return preferred
  let id = fallback, suffix = 2
  while (seen.has(id.toLowerCase())) id = `${fallback}#${suffix++}`
  return id
}

export function expressionResourceIndex(expressions: readonly ModelExpressionAssetInfo[]): Map<string, ModelExpressionAssetInfo> {
  const key = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase()
  const result = new Map<string, ModelExpressionAssetInfo>()
  const aliases = new Map<string, Set<ModelExpressionAssetInfo>>()
  for (const expression of expressions) {
    result.set(key(expression.file), expression)
    for (const name of [expression.name, expression.registeredName, expression.file.replace(/^.*[\\/]/, '')]) {
      if (!name) continue
      const entries = aliases.get(key(name)) ?? new Set<ModelExpressionAssetInfo>()
      entries.add(expression); aliases.set(key(name), entries)
    }
  }
  for (const [name, entries] of aliases) if (!result.has(name) && entries.size === 1) result.set(name, [...entries][0])
  return result
}

export function resourceHotkey(file: string, hotkeys: Readonly<Record<string, string>>): string {
  const key = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase()
  return Object.entries(hotkeys).find(([path]) => key(path) === key(file))?.[1] ?? ''
}
