export interface EnvironmentLabel { label: string; identifier: string | null }
export function describeEnvironment(raw: unknown): EnvironmentLabel {
  const info = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const profile = typeof info?.profile === 'string' ? info.profile.trim() : ''
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(profile)) return { label: '环境未确认', identifier: null }
  const kind = profile === 'stable' && info?.isStable === true ? '日常数据' : info?.packaged === true ? '独立实例' : info?.packaged === false ? '开发实例' : '数据实例'
  return { label: `${kind} · ${profile}`, identifier: profile }
}
export async function loadEnvironmentLabel(api?: { getEnvironmentInfo?: () => Promise<unknown> }): Promise<EnvironmentLabel> {
  try { return describeEnvironment(await api?.getEnvironmentInfo?.()) }
  catch { return { label: '环境未确认', identifier: null } }
}
