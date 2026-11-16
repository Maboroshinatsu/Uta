import type { ModelCapabilityProfile } from '../../src/shared/first-wave-contracts'
import type { PerformanceContribution, PerformanceMixerTick } from '../../src/shared/performance-mixer-contracts'

const channels = ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ', 'gazeX', 'gazeY', 'eyeOpenLeft', 'eyeOpenRight', 'mouthOpen', 'mouthForm', 'browLeft', 'browRight', 'breath'] as const
export const mixerProfile: ModelCapabilityProfile = {
  schemaVersion: 1,
  modelSignature: 'synthetic:mixer-v1',
  parameters: [],
  mappings: [],
  capabilities: channels.map(channel => ({
    channel,
    status: channel === 'headX' || channel === 'mouthOpen' || channel === 'mouthForm' || channel === 'eyeOpenLeft' ? 'available' as const : 'unsupported' as const,
    parameterIds: [],
    reason: channel === 'headX' || channel === 'mouthOpen' || channel === 'mouthForm' || channel === 'eyeOpenLeft' ? 'mapped' as const : 'missing-parameter' as const,
  })),
  expressions: [],
  motions: [],
  warnings: [],
}

export const idleContribution: PerformanceContribution = {
  version: 1,
  contributionId: 'fixture:idle:head',
  ownerId: 'fixture:idle',
  generation: 1,
  modelEpoch: 1,
  bindingGeneration: 1,
  intentId: 'fixture:idle-intent',
  mode: 'replace',
  phase: 'pre-physics',
  values: { headX: 0.25, mouthForm: 0, mouthOpen: 0 },
  priorityByChannel: { headX: 10 },
  strength: 0.5,
  fadeInMs: 120,
  fadeOutMs: 180,
  ttlMs: 5000,
}

export const semanticTick: PerformanceMixerTick = {
  version: 1,
  sampledAtMonotonicMs: 100,
  modelEpoch: 1,
  bindingGeneration: 1,
  base: { headX: 0, eyeOpenLeft: 1, mouthOpen: 0, mouthForm: 0 },
  contributions: [idleContribution],
  intents: [],
  profile: mixerProfile,
  releases: [],
}

// @ts-expect-error Mixer modes are a closed enum.
export const invalidOperation: PerformanceContribution = { ...idleContribution, mode: 'blend' }
// @ts-expect-error Mixer inputs cannot write raw Cubism parameter IDs.
export const rawParameterOutput: PerformanceContribution = { ...idleContribution, values: { ParamAngleX: 12 } }
