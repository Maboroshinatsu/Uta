import { PUBLIC_SETTINGS_DEFAULTS, type SettingsKey, type SettingsValue, type LegacySettingsSource } from '../../shared/settings-contracts'

export const PREFERENCE_LABELS: Record<SettingsKey, string> = {
  chatDisplayName: '消息显示名称',
  themeMode: '主题模式', accentColor: '主题强调色', hoverFadeEnabled: '悬停淡出', gazeFollowEnabled: '视线跟随',
  idleActionsEnabled: '待机动作', orbAction: '悬浮球动作', ttsEnabled: '语音播报', ttsProvider: '语音来源',
  ttsRate: '语速', ttsVolume: '音量', ttsSpeakNarration: '朗读动作解说', ttsSpeakReplies: '朗读回复摘要',
}
export const LEGACY_SOURCE_LABELS: Record<string, string> = {
  'legacy.origin.biophilic-v1': '当前页面旧设置', 'legacy.origin.ui': '当前页面更早设置',
}
export function valid(key: SettingsKey, value: unknown): value is SettingsValue {
  if (key === 'chatDisplayName') return typeof value === 'string' && value.length <= 40 && !/[\u0000-\u001f\u007f]/.test(value)
  if (key === 'accentColor') return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)
  if (key === 'themeMode') return value === 'light' || value === 'dark'
  if (key === 'orbAction') return ['model_picker', 'toggle_display_mode', 'color_picker', 'toggle_theme'].includes(String(value))
  if (key === 'ttsProvider') return value === 'system' || value === 'http' || value === 'cloud'
  if (key === 'ttsRate') return typeof value === 'number' && Number.isFinite(value) && value >= .5 && value <= 2
  if (key === 'ttsVolume') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  return typeof value === 'boolean'
}
/** Read only known public fields. Raw UI blobs, endpoints, keys, paths and presets never cross IPC. */
export function collectLegacyPreferences(storage: Pick<Storage, 'getItem'>): { sources: LegacySettingsSource[]; notes: string[] } {
  const sources: LegacySettingsSource[] = [], notes: string[] = []
  for (const [storageKey, sourceId] of [['deskpet/ui-state-biophilic-v1', 'legacy.origin.biophilic-v1'], ['deskpet/ui-state', 'legacy.origin.ui']]) {
    const label = LEGACY_SOURCE_LABELS[sourceId]
    try {
      const text = storage.getItem(storageKey)
      if (!text) continue
      if (text.length > 256 * 1024) throw new Error('too-large')
      const data = JSON.parse(text)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid')
      const values: LegacySettingsSource['values'] = {}
      let ignored = 0
      for (const key of Object.keys(PUBLIC_SETTINGS_DEFAULTS) as SettingsKey[]) {
        // The pet no longer renders the orb, so importing its action would be a no-op.
        if (key === 'orbAction' || !Object.hasOwn(data, key)) continue
        if (valid(key, data[key])) (values as Record<string, unknown>)[key] = data[key]
        else ignored++
      }
      if (ignored) notes.push(`${label}有 ${ignored} 项格式不符，未加入导入。`)
      if (Object.keys(values).length) sources.push({ sourceId, values })
      else notes.push(`${label}没有可导入的公开偏好。`)
    } catch { notes.push(`${label}无法读取，原记录保持不变。`) }
  }
  return { sources, notes }
}
export function displayPreference(key: SettingsKey, value: SettingsValue): string {
  if (typeof value === 'boolean') return value ? '开启' : '关闭'
  if (key === 'ttsVolume' && typeof value === 'number') return `${Math.round(value * 100)}%`
  if (key === 'ttsRate') return `${value} 倍`
  const labels: Record<string, string> = { light: '浅色', dark: '深色', http: '本地服务', cloud: '云端服务', system: '旧系统语音',
    model_picker: '选择模型', toggle_display_mode: '切换展示方式', color_picker: '选择颜色', toggle_theme: '切换主题' }
  return labels[String(value)] ?? String(value)
}
