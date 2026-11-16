/** Desktop wave 2: bounded public preferences. No paths, secrets or renderer dependencies. */
export const SETTINGS_SCHEMA_VERSION = 1 as const
export interface PublicSettings {
  /** Empty uses each message's host name, independently of the Live2D model. */
  chatDisplayName: string
  themeMode: 'light' | 'dark'
  accentColor: string
  hoverFadeEnabled: boolean
  gazeFollowEnabled: boolean
  idleActionsEnabled: boolean
  orbAction: 'model_picker' | 'toggle_display_mode' | 'color_picker' | 'toggle_theme'
  ttsEnabled: boolean
  ttsProvider: 'system' | 'http' | 'cloud'
  ttsRate: number
  /** Stored 0..1; UI percentages convert at the presentation boundary. */
  ttsVolume: number
  ttsSpeakNarration: boolean
  ttsSpeakReplies: boolean
}
export type SettingsKey = keyof PublicSettings
export type SettingsValue = PublicSettings[SettingsKey]
export const PUBLIC_SETTINGS_DEFAULTS: Readonly<PublicSettings> = Object.freeze({
  chatDisplayName: '',
  themeMode: 'light', accentColor: '#3d6a8e', hoverFadeEnabled: false,
  gazeFollowEnabled: true, idleActionsEnabled: true, orbAction: 'model_picker',
  ttsEnabled: false, ttsProvider: 'cloud', ttsRate: 1, ttsVolume: 0.8,
  ttsSpeakNarration: false, ttsSpeakReplies: true,
})
export interface LegacySettingsSource {
  /** Opaque caller-provided provenance label, never a filesystem path. */
  sourceId: string
  values: Partial<PublicSettings>
}
export interface SettingsConflict {
  key: SettingsKey
  sourceId: string
  sourceDigest: string
  current: SettingsValue
  incoming: SettingsValue
}
export interface SettingsDocument {
  schemaVersion: 1
  revision: number
  values: PublicSettings
  /** Defaults are unclaimed; patch/import claims a key even when equal to its default. */
  claimedKeys: SettingsKey[]
  imports: Array<{ sourceId: string; digest: string }>
  conflicts: SettingsConflict[]
}
export type SettingsState =
  | { status: 'ready'; document: SettingsDocument }
  | { status: 'blocked'; reason: 'corrupt' | 'future-schema' | 'io-error'; backupAvailable: boolean }
export type SettingsErrorCode = 'invalid-request' | 'revision-conflict' | 'store-blocked'
  | 'limit-reached' | 'io-error' | 'closed'
export type SettingsWriteResult =
  | { ok: true; changed: boolean; document: SettingsDocument }
  | { ok: false; code: SettingsErrorCode; currentRevision: number | null }
export interface SettingsPatchRequest { expectedRevision: number; changes: Partial<PublicSettings> }
export interface SettingsImportRequest {
  expectedRevision: number
  sources: LegacySettingsSource[]
  /** Explicit reviewed choices, applied in the same atomic transaction as provenance. */
  selections?: Partial<Record<SettingsKey, string>>
}
/** Main-process service only. Constructor accepts the already-resolved profile directory. */
export interface SettingsService {
  /** Seal a reviewed migration only after this revision exists on disk. */
  ensurePersisted?(expectedRevision: number): Promise<SettingsWriteResult>
  retryRead?(): Promise<boolean>
  previewRecovery?(): Promise<import('./settings-recovery-contracts').SettingsRecoveryPreview>
  restoreBackup?(token: string): Promise<import('./settings-recovery-contracts').SettingsRecoveryResult>
  read(): Promise<SettingsState>
  patch(request: SettingsPatchRequest): Promise<SettingsWriteResult>
  importLegacy(request: SettingsImportRequest): Promise<SettingsWriteResult>
  subscribe(listener: (document: SettingsDocument) => void): () => void
  close(): Promise<void>
}
/** Reserved for later Codex wiring; importing a channel string does not register IPC. */
export const SETTINGS_CHANNELS = Object.freeze({
  read: 'uta:settings:read', patch: 'uta:settings:patch',
  importLegacy: 'uta:settings:import-legacy', changed: 'uta:settings:changed',
})
