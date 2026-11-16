/** 分组是资源标识，空字符串也是合法分组；不能通过真假值或 trim 判断是否绑定。 */
export function isNativeMotionBinding(raw: unknown): raw is { group: string; index?: number } {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as { group?: unknown; index?: unknown }
  return typeof value.group === 'string' && (value.index === undefined ||
    (typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0))
}
