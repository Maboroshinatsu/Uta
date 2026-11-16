import type { LegacySettingsSource, SettingsKey, SettingsValue, SettingsWriteResult, PublicSettings } from './settings-contracts'

export interface SettingsImportPreview {
  token: string
  revision: number
  rows: Array<{ key: SettingsKey; current: SettingsValue; claimed: boolean; options: Array<{ sourceId: string; value: SettingsValue }> }>
  processedSources: string[]
  existingConflictCount: number
  currentValues?: PublicSettings
}
export interface SettingsImportBridge {
  cancel(): Promise<boolean>
  preview(sources: LegacySettingsSource[]): Promise<{ ok: true; preview: SettingsImportPreview } | { ok: false; error: string }>
  apply(request: { token: string; selections: Partial<Record<SettingsKey, string>> }): Promise<(SettingsWriteResult & { restartRequired?: boolean }) | { ok: false; code: 'preview-expired'; currentRevision: null }>
}
