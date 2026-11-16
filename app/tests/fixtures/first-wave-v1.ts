import type { ModelInspectionInput, PerformanceIntent, PerformanceSnapshot, VoicePreviewFixture } from '../../src/shared/first-wave-contracts'

export const standardModel: ModelInspectionInput = {
  schemaVersion: 1, modelSignature: 'synthetic:standard-v1',
  parameters: [
    { id: 'ParamAngleX', min: -30, max: 30, defaultValue: 0, physicsOutput: false },
    { id: 'ParamEyeLOpen', min: 0, max: 1, defaultValue: 1, physicsOutput: false },
    { id: 'ParamEyeROpen', min: 0, max: 1, defaultValue: 1, physicsOutput: false },
    { id: 'ParamMouthOpenY', min: 0, max: 1, defaultValue: 0, physicsOutput: false },
  ],
  expressions: [{ name: 'smile', parameters: [{ id: 'ParamEyeLOpen', value: 0.8, blend: 'Multiply' }] }],
  motions: [{ group: 'Idle', index: 0, parameterIds: ['ParamAngleX'] }], overrides: [],
}

export const minimalModel: ModelInspectionInput = {
  schemaVersion: 1, modelSignature: 'synthetic:minimal-v1', parameters: [], expressions: [], motions: [], overrides: [],
}

export const privateModel: ModelInspectionInput = {
  schemaVersion: 1, modelSignature: 'synthetic:private-v1',
  parameters: [
    { id: 'FaceTurn', label: '头部左右', min: -10, max: 20, defaultValue: 3, physicsOutput: false },
    { id: 'HairOutput', min: -1, max: 1, defaultValue: 0, physicsOutput: true },
  ], expressions: [], motions: [],
  overrides: [{ channel: 'headX', parameterId: 'FaceTurn', direction: 'reversed', confirmed: true }],
}

export const thinking: PerformanceIntent = {
  version: 1, intentId: 'fixture:thinking', source: 'host', sessionId: 'fixture:session',
  bindingGeneration: 1, modelEpoch: 1, issuedAtUnixMs: 1000, ttlMs: 5000, intensity: 0.3, seed: 1,
  kind: 'state', payload: { state: 'thinking' },
}

export const idleSnapshot: PerformanceSnapshot = {
  version: 1, modelEpoch: 1, bindingGeneration: 1, sampledAtMonotonicMs: 0, state: 'idle',
  activeIntentIds: [], channels: [], clampCount: 0, queueLength: 0, audioOffsetMs: null, degradedReasons: [],
}

export const voicePreview: VoicePreviewFixture = {
  version: 1, providerId: 'demo-cloud', providerLabel: '示例云端服务',
  endpoint: 'https://example.invalid/tts', model: 'demo-voice', secretState: 'missing',
  volume: 65, enabled: false, simulatedOutcome: 'success',
}

// Contract compiler checks: unknown schema, raw remote parameters and invalid modes must stay rejected.
// @ts-expect-error Schema v2 is not compatible with this frozen first-wave contract.
export const futureModel: ModelInspectionInput = { ...minimalModel, schemaVersion: 2 }
// @ts-expect-error Raw parameter writes are not a public performance-intent kind.
export const rawIntent: PerformanceIntent = { ...thinking, kind: 'raw-parameters', payload: { ParamAngleX: 30 } }
// @ts-expect-error Secret values are not part of a UI preview fixture.
export const leakedSecret: VoicePreviewFixture = { ...voicePreview, apiKey: 'never-use-real-secrets' }
