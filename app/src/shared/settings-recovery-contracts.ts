export type SettingsRecoveryPreview =
  | { available: true; token: string; backupRevision: number; themeMode: 'light' | 'dark'; ttsEnabled: boolean }
  | { available: false; reason: 'not-needed' | 'future-schema' | 'no-backup' | 'unavailable' }
export type SettingsRecoveryResult =
  | { ok: true; retainedOriginal: boolean }
  | { ok: false; code: 'unauthorized' | 'unavailable' | 'preview-expired' | 'changed' | 'future-schema' }
export interface SettingsRecoveryBridge {
  retry(): Promise<boolean>
  preview(): Promise<SettingsRecoveryPreview>
  restore(token: string): Promise<SettingsRecoveryResult>
  onRecovered(listener: () => void): () => void
}
