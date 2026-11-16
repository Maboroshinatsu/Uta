export type SettingsDomainId =
  | 'character'
  | 'connections'
  | 'todo'
  | 'voice'
  | 'desktop'
  | 'appearance'
  | 'about'

export interface SettingsDomainDefinition {
  id: SettingsDomainId
  label: string
  icon: 'character' | 'connections' | 'todo' | 'voice' | 'desktop' | 'appearance' | 'about'
  title: string
  subtitle: string
}

/** Single source of truth for the settings destinations and their page copy. */
export const SETTINGS_DOMAINS: ReadonlyArray<SettingsDomainDefinition> = Object.freeze([
  {
    id: 'character',
    label: '模型与动作',
    icon: 'character',
    title: '模型与动作',
    subtitle: '当前模型、日常状态与常用动作。预览由桌面上的同一个模型执行。',
  },
  {
    id: 'connections',
    label: '连接与会话',
    icon: 'connections',
    title: '连接与会话',
    subtitle: '查看当前绑定的宿主、连接状态与发消息目标会话。',
  },
  {
    id: 'todo',
    label: '待办',
    icon: 'todo',
    title: '待办',
    subtitle: '设置日常待办到点时的声音、动作和气泡。',
  },
  {
    id: 'voice',
    label: '语音',
    icon: 'voice',
    title: '语音',
    subtitle: '决定 Uta 是否开口、使用哪套声音，以及是否听取语音输入。',
  },
  {
    id: 'desktop',
    label: '桌面与交互',
    icon: 'desktop',
    title: '桌面与交互',
    subtitle: '控制角色在桌面上的视线、待机、悬停与窗口行为。',
  },
  {
    id: 'appearance',
    label: '外观与性能',
    icon: 'appearance',
    title: '外观与性能',
    subtitle: '调整设置中心的主题、强调色、渲染上限与空闲降帧。',
  },
  {
    id: 'about',
    label: '关于与诊断',
    icon: 'about',
    title: '关于与诊断',
    subtitle: '确认版本与运行环境，查看数据位置、旧偏好导入与诊断信息。',
  },
])

export const DEFAULT_SETTINGS_DOMAIN: SettingsDomainId = 'character'

export function isSettingsDomain(value: string | null | undefined): value is SettingsDomainId {
  return !!value && SETTINGS_DOMAINS.some(domain => domain.id === value)
}

export function resolveSettingsDomain(value: string | null | undefined): SettingsDomainId {
  return isSettingsDomain(value) ? value : DEFAULT_SETTINGS_DOMAIN
}

export function settingsDomainDefinition(id: SettingsDomainId): SettingsDomainDefinition {
  return SETTINGS_DOMAINS.find(domain => domain.id === id) ?? SETTINGS_DOMAINS[0]
}
