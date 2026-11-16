import type {
  PublicSettings,
  SettingsDocument,
  SettingsKey,
} from '../../../shared/settings-contracts'
import type { SettingsAuthorityMode } from '../../../shared/settings-integration-contracts'

export type SettingsClientMode = SettingsAuthorityMode | 'browser-mock'

export interface SettingsClientInitSuccess {
  ok: true
  mode: SettingsClientMode
  document?: SettingsDocument | null
}

export interface SettingsClientInitFailure {
  ok: false
  error: string
  reason?: string
}

export type SettingsClientInitResult = SettingsClientInitSuccess | SettingsClientInitFailure

export const PUBLIC_SETTINGS_KEYS: ReadonlyArray<SettingsKey> = Object.freeze([
  'chatDisplayName',
  'themeMode',
  'accentColor',
  'hoverFadeEnabled',
  'gazeFollowEnabled',
  'idleActionsEnabled',
  'orbAction',
  'ttsEnabled',
  'ttsProvider',
  'ttsRate',
  'ttsVolume',
  'ttsSpeakNarration',
  'ttsSpeakReplies',
])

export function isPublicSettingsKey(key: string): keyof PublicSettings | null {
  return PUBLIC_SETTINGS_KEYS.includes(key as SettingsKey) ? (key as SettingsKey) : null
}
