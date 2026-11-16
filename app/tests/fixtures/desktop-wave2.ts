import type { CoreModelView, CoreInspectionRequest } from '../../src/shared/model-inspection-contracts'
import { PUBLIC_SETTINGS_DEFAULTS, type SettingsDocument, type SettingsPatchRequest } from '../../src/shared/settings-contracts'
export const initialSettings: SettingsDocument = {
  schemaVersion: 1, revision: 0, values: { ...PUBLIC_SETTINGS_DEFAULTS },
  claimedKeys: [], imports: [], conflicts: [],
}
/** Synthetic boundary case based on observed ranges; contains no copied model asset. */
export const asymmetricMouth: CoreModelView = { parameters: {
  count: 2, ids: ['ParamMouthForm', 'ParamMouthOpenY'],
  minimumValues: new Float32Array([-2, 0]), maximumValues: new Float32Array([1, 1]),
  defaultValues: new Float32Array([-0.5, 0]),
} }
export const inspection: CoreInspectionRequest = {
  modelSignature: 'synthetic-asymmetric-mouth', overrides: [],
  metadata: { cdi: null, physics: null, expressions: [], motions: [] },
}
export const validPatch: SettingsPatchRequest = { expectedRevision: 0, changes: { ttsVolume: 0.8 } }
// @ts-expect-error Secrets cannot enter public settings.
export const secretPatch: SettingsPatchRequest = { expectedRevision: 0, changes: { apiKey: 'fixture-only' } }
// @ts-expect-error No renderer-provided storage path.
export const pathPatch: SettingsPatchRequest = { expectedRevision: 0, changes: {}, directory: 'untrusted' }
// @ts-expect-error Provider IDs are bounded.
export const unknownProvider: SettingsPatchRequest = { expectedRevision: 0, changes: { ttsProvider: 'unknown' } }
