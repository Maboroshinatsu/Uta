import {
  PUBLIC_SETTINGS_DEFAULTS,
  type PublicSettings,
  type SettingsDocument
} from '../../shared/settings-contracts'

export function createDefaultDocument(): SettingsDocument {
  return {
    schemaVersion: 1,
    revision: 0,
    values: { ...PUBLIC_SETTINGS_DEFAULTS },
    claimedKeys: [],
    imports: [],
    conflicts: []
  }
}

export function cloneDocument(doc: SettingsDocument): SettingsDocument {
  return {
    schemaVersion: doc.schemaVersion,
    revision: doc.revision,
    values: { ...doc.values },
    claimedKeys: [...doc.claimedKeys],
    imports: doc.imports.map((item) => ({ ...item })),
    conflicts: doc.conflicts.map((conflict) => ({ ...conflict }))
  }
}

export function cloneValues(values: PublicSettings): PublicSettings {
  return { ...values }
}
