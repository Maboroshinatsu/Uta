import type {
  PublicSettings,
  SettingsKey,
  SettingsValue,
  SettingsDocument,
  SettingsConflict,
  SettingsState,
  SettingsWriteResult,
  SettingsPatchRequest,
  SettingsImportRequest,
  SettingsService,
  SettingsErrorCode,
  LegacySettingsSource
} from '../../shared/settings-contracts'

export type {
  PublicSettings,
  SettingsKey,
  SettingsValue,
  SettingsDocument,
  SettingsConflict,
  SettingsState,
  SettingsWriteResult,
  SettingsPatchRequest,
  SettingsImportRequest,
  SettingsService,
  SettingsErrorCode,
  LegacySettingsSource
}

export interface SettingsIoHooks {
  readFile(filePath: string, encoding: 'utf8'): Promise<string>
  writeFile(filePath: string, data: string, encoding: 'utf8'): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  unlink(filePath: string): Promise<void>
  stat(filePath: string): Promise<{ size: number; isFile(): boolean; isSymbolicLink?(): boolean }>
}

export interface SettingsStoreOptions {
  /** An accepted migration must never turn lost files into first-launch defaults. */
  requireExisting?: boolean
  recoveryIo?: Partial<import('./recovery').RecoveryIo>
  io?: Partial<SettingsIoHooks>
}
