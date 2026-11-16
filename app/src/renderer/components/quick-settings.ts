export type QuickModelKind = 'live2d' | 'image-set'

export interface QuickModelOption {
  name: string
  displayName?: string
  url: string
  kind: QuickModelKind
}

/**
 * 可读名相同时回退到原始路径：两个同名变体不能只靠名字区分。
 * 返回 url → 列表标签。
 */
export function quickModelLabels(options: readonly QuickModelOption[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const option of options) {
    const label = option.displayName || option.name
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const labels = new Map<string, string>()
  for (const option of options) {
    const label = option.displayName || option.name
    labels.set(option.url, (counts.get(label) ?? 0) > 1 ? option.name : label)
  }
  return labels
}

export function quickModelsForKind(
  options: readonly QuickModelOption[],
  kind: QuickModelKind,
): QuickModelOption[] {
  return options.filter((option) => option.kind === kind)
}

export function quickModelDisplayName(
  currentUrl: string,
  options: readonly QuickModelOption[],
): string {
  const matched = options.find((option) => option.url === currentUrl)
  if (matched) {
    const siblings = quickModelsForKind(options, matched.kind)
    return quickModelLabels(siblings).get(matched.url) || matched.name
  }
  const tail = currentUrl.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const raw = tail.replace(/(\.model3\.json|\.model3|\.json)$/i, '').trim()
  return decodeModelTail(raw) || (currentUrl ? '当前角色' : '正在读取角色…')
}

function decodeModelTail(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function quickDisplayMode(
  currentUrl: string,
  options: readonly QuickModelOption[],
  fallback: QuickModelKind = 'live2d',
): QuickModelKind {
  return options.find((option) => option.url === currentUrl)?.kind ?? fallback
}
