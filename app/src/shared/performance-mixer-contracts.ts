import type { ModelCapabilityProfile, PerformanceIntent, PerformanceSnapshot, SemanticChannel } from './first-wave-contracts'

/** Incremental, engine-independent contract for semantic channel arbitration. */
export const PERFORMANCE_MIXER_CONTRACT_VERSION = 'uta-performance-mixer-v1' as const

/** Values here are normalized semantic signals. They are not Cubism parameter values. */
export type SemanticChannelValues = Partial<Record<SemanticChannel, number>>

export type PerformanceContributionMode = 'replace' | 'add' | 'multiply'
export type PerformanceContributionPhase = 'pre-physics' | 'post-physics'
export type PerformanceReleaseReason = 'cancelled' | 'expired' | 'owner-ended' | 'model-changed' | 'binding-changed' | 'shutdown'

/**
 * A contribution is a bounded lease owned by one source generation. The runtime
 * records acceptance time from its injected monotonic clock; callers never send
 * wall-clock timestamps as mixer time.
 */
export interface PerformanceContribution {
  version: 1
  contributionId: string
  ownerId: string
  generation: number
  modelEpoch: number
  bindingGeneration: number
  intentId: string
  mode: PerformanceContributionMode
  phase: PerformanceContributionPhase
  /** Omitted channels are outside this contribution's mask. */
  values: SemanticChannelValues
  /** Per-channel ordering; omitted values mean 0. Higher values apply later. */
  priorityByChannel?: Partial<Record<SemanticChannel, number>>
  /** Contribution-wide multiplier in [0, 1], before channel composition. */
  strength: number
  fadeInMs: number
  fadeOutMs: number
  /** Null means no automatic expiry. The clock starts when accepted locally. */
  ttlMs: number | null
}

/** Release only succeeds for the currently registered owner generation. */
export interface PerformanceOwnerRelease {
  ownerId: string
  generation: number
  modelEpoch: number
  bindingGeneration: number
  reason: PerformanceReleaseReason
  fadeOutMs?: number
}

export interface PerformanceMixerTick {
  version: 1
  /** One injected monotonic sample shared by every channel in this tick. */
  sampledAtMonotonicMs: number
  modelEpoch: number
  bindingGeneration: number
  /** Current semantic baseline, usually neutral anchors or a sampled native value. */
  base: SemanticChannelValues
  contributions: readonly PerformanceContribution[]
  /** Existing event/profile contracts remain the input vocabulary and capability source. */
  intents: readonly PerformanceIntent[]
  profile: ModelCapabilityProfile
  releases: readonly PerformanceOwnerRelease[]
}

export interface PerformanceMixerChannelDiagnostic {
  channel: SemanticChannel
  phase: PerformanceContributionPhase
  base: number
  current: number
  target: number
  ownerIds: string[]
  contributionIds: string[]
  clamped: boolean
}

/** Mixer diagnostics are renderer-local; the existing public snapshot stays frozen. */
export interface PerformanceMixerSnapshot {
  version: 1
  sampledAtMonotonicMs: number
  modelEpoch: number
  bindingGeneration: number
  channels: PerformanceMixerChannelDiagnostic[]
  clampCount: number
  rejectedContributionIds: string[]
  degradedReasons: string[]
  /** Optional projection into the existing public diagnostic vocabulary. */
  performanceSnapshot?: PerformanceSnapshot
}

export interface PerformanceMixerResult {
  /** Values to apply before the SDK physics/pose update. */
  prePhysics: SemanticChannelValues
  /** Values to apply after the SDK physics/pose update. */
  postPhysics: SemanticChannelValues
  snapshot: PerformanceMixerSnapshot
}

/** The canonical semantic anchors and final clamp bounds for every frozen channel. */
export const SEMANTIC_CHANNEL_ANCHORS: Readonly<Record<SemanticChannel, { min: number; max: number; neutral: number }>> = Object.freeze({
  headX: { min: -1, max: 1, neutral: 0 },
  headY: { min: -1, max: 1, neutral: 0 },
  headZ: { min: -1, max: 1, neutral: 0 },
  bodyX: { min: -1, max: 1, neutral: 0 },
  bodyY: { min: -1, max: 1, neutral: 0 },
  bodyZ: { min: -1, max: 1, neutral: 0 },
  gazeX: { min: -1, max: 1, neutral: 0 },
  gazeY: { min: -1, max: 1, neutral: 0 },
  eyeOpenLeft: { min: 0, max: 1, neutral: 1 },
  eyeOpenRight: { min: 0, max: 1, neutral: 1 },
  mouthOpen: { min: 0, max: 1, neutral: 0 },
  mouthForm: { min: -1, max: 1, neutral: 0 },
  browLeft: { min: -1, max: 1, neutral: 0 },
  browRight: { min: -1, max: 1, neutral: 0 },
  breath: { min: 0, max: 1, neutral: 0 },
})
