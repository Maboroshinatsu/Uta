import type { SettingsPatchRequest, SettingsState, SettingsWriteResult, SettingsDocument } from './settings-contracts'
export const SETTINGS_MODE_CHANNEL = 'uta:settings:mode' as const
/** Stable authority changes only on startup after an explicit persisted migration. */
export type SettingsAuthorityMode = 'legacy' | 'canonical-dev' | 'canonical-stable'
export interface PublicSettingsBridge {
  getMode(): Promise<SettingsAuthorityMode>
  /** null means deliberately disabled in legacy mode; failure must not become defaults. */
  read(): Promise<SettingsState | null>
  patch(request: SettingsPatchRequest): Promise<SettingsWriteResult>
  onChanged(listener: (document: SettingsDocument) => void): () => void
}
