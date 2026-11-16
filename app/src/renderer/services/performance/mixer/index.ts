/**
 * Pure semantic channel mixer for the frozen `uta-performance-mixer-v1` contract.
 *
 * The kernel owns contribution leases, per-channel arbitration and a monotonic
 * lifecycle clock. It never reads model assets, Cubism, PIXI, files or wall
 * clocks and never renders. Outputs are dimensionless semantic values; mapping
 * them to real parameter units remains a Profile adapter concern.
 */
import type { SemanticChannel } from '../../../../shared/first-wave-contracts'
import type {
  PerformanceContributionMode,
  PerformanceContributionPhase,
  PerformanceMixerChannelDiagnostic,
  PerformanceMixerResult,
  PerformanceMixerSnapshot,
  PerformanceMixerTick,
  PerformanceReleaseReason,
  SemanticChannelValues,
} from '../../../../shared/performance-mixer-contracts'
import { SEMANTIC_CHANNEL_ANCHORS } from '../../../../shared/performance-mixer-contracts'

export const MIXER_MAX_DT_MS = 50
export const MIXER_MAX_FADE_MS = 5000
export const MIXER_MAX_TTL_MS = 60000
export const MIXER_ADD_VALUE_MIN = -2
export const MIXER_ADD_VALUE_MAX = 2
export const MIXER_MULTIPLY_VALUE_MIN = 0
export const MIXER_MULTIPLY_VALUE_MAX = 2
export const MIXER_FRAME_GAP_REASON = 'frame-gap-clamped'

/** Frozen channel order, derived from the shared anchor table. */
export const MIXER_SEMANTIC_CHANNELS: readonly SemanticChannel[] = Object.freeze(
  Object.keys(SEMANTIC_CHANNEL_ANCHORS) as SemanticChannel[],
)

const CHANNEL_SET: ReadonlySet<string> = new Set(MIXER_SEMANTIC_CHANNELS)
const MODES: readonly PerformanceContributionMode[] = ['replace', 'add', 'multiply']
const PHASES: readonly PerformanceContributionPhase[] = ['pre-physics', 'post-physics']
const RELEASE_REASONS: readonly PerformanceReleaseReason[] = [
  'cancelled', 'expired', 'owner-ended', 'model-changed', 'binding-changed', 'shutdown',
]

type Anchor = { min: number; max: number; neutral: number }

interface NormalizedContribution {
  contributionId: string
  ownerId: string
  generation: number
  modelEpoch: number
  bindingGeneration: number
  intentId: string
  mode: PerformanceContributionMode
  phase: PerformanceContributionPhase
  values: Partial<Record<SemanticChannel, number>>
  priorityByChannel: Partial<Record<SemanticChannel, number>>
  strength: number
  fadeInMs: number
  fadeOutMs: number
  ttlMs: number | null
}

interface Lease {
  contribution: NormalizedContribution
  acceptedAtMs: number
  releasing: boolean
  releaseStartedAtMs: number
  releaseFadeOutMs: number
}

interface ChannelCapabilityState {
  available: boolean
  status: string
  reason: string
}

interface BaseChannelState {
  value: number
  clamped: boolean
}

interface NormalizedRelease {
  ownerId: string
  generation: number
  modelEpoch: number
  bindingGeneration: number
  reason: PerformanceReleaseReason
  fadeOutMs: number | null
}

interface Candidate {
  contribution: NormalizedContribution
  index: number
}

interface ComposedPhase {
  values: SemanticChannelValues
  diagnostics: PerformanceMixerChannelDiagnostic[]
  clampedCount: number
}

export interface PerformanceMixer {
  /** Applies one shared monotonic tick and returns both physics phases. */
  step(tick: PerformanceMixerTick): PerformanceMixerResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

function isNonEmptyIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isChannel(value: string): value is SemanticChannel {
  return CHANNEL_SET.has(value)
}

function isMode(value: unknown): value is PerformanceContributionMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

function isPhase(value: unknown): value is PerformanceContributionPhase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value)
}

function isReleaseReason(value: unknown): value is PerformanceReleaseReason {
  return typeof value === 'string' && (RELEASE_REASONS as readonly string[]).includes(value)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function smoothstep(progress: number): number {
  const p = clamp01(progress)
  return p * p * (3 - 2 * p)
}

function finiteWithinAnchor(value: number, anchor: Anchor): number {
  if (Number.isNaN(value)) return anchor.neutral
  if (value === Number.POSITIVE_INFINITY) return anchor.max
  if (value === Number.NEGATIVE_INFINITY) return anchor.min
  return clamp(value, anchor.min, anchor.max)
}

class ReasonCollector {
  private readonly seen = new Set<string>()
  readonly values: string[] = []

  add(reason: string): void {
    if (this.seen.has(reason)) return
    this.seen.add(reason)
    this.values.push(reason)
  }
}

function anchorFor(channel: SemanticChannel): Anchor {
  return SEMANTIC_CHANNEL_ANCHORS[channel]
}

function leaseKey(contribution: NormalizedContribution): string {
  return JSON.stringify([contribution.ownerId, contribution.generation, contribution.contributionId])
}

function deadLeaseKey(contribution: NormalizedContribution): string {
  return JSON.stringify([contribution.generation, contribution.contributionId])
}

function normalizeContribution(raw: unknown): { value?: NormalizedContribution; reason?: string } {
  if (!isRecord(raw)) return { reason: 'not-an-object' }
  if (raw.version !== 1) return { reason: 'invalid-version' }
  if (!isNonEmptyIdentity(raw.contributionId)) return { reason: 'invalid-contribution-id' }
  if (!isNonEmptyIdentity(raw.ownerId)) return { reason: 'invalid-owner-id' }
  if (!isNonNegativeSafeInteger(raw.generation)) return { reason: 'invalid-generation' }
  if (!isNonNegativeSafeInteger(raw.modelEpoch)) return { reason: 'invalid-model-epoch' }
  if (!isNonNegativeSafeInteger(raw.bindingGeneration)) return { reason: 'invalid-binding-generation' }
  if (!isNonEmptyIdentity(raw.intentId)) return { reason: 'invalid-intent-id' }
  if (!isMode(raw.mode)) return { reason: 'invalid-mode' }
  if (!isPhase(raw.phase)) return { reason: 'invalid-phase' }
  if (!isFiniteNumber(raw.strength) || raw.strength < 0 || raw.strength > 1) return { reason: 'invalid-strength' }
  if (!isBoundedInteger(raw.fadeInMs, 0, MIXER_MAX_FADE_MS)) return { reason: 'invalid-fade-in' }
  if (!isBoundedInteger(raw.fadeOutMs, 0, MIXER_MAX_FADE_MS)) return { reason: 'invalid-fade-out' }
  if (raw.ttlMs !== null && !isBoundedInteger(raw.ttlMs, 1, MIXER_MAX_TTL_MS)) return { reason: 'invalid-ttl' }
  if (!isRecord(raw.values)) return { reason: 'invalid-values' }

  const values: Partial<Record<SemanticChannel, number>> = {}
  for (const key of Object.keys(raw.values)) {
    if (!isChannel(key)) return { reason: `unknown-channel:${key}` }
    const value = raw.values[key]
    if (!isFiniteNumber(value)) return { reason: `non-finite-value:${key}` }
    const anchor = anchorFor(key)
    if (raw.mode === 'replace' && (value < anchor.min || value > anchor.max)) {
      return { reason: `replace-out-of-range:${key}` }
    }
    values[key] = value
  }

  const priorityByChannel: Partial<Record<SemanticChannel, number>> = {}
  if (raw.priorityByChannel !== undefined) {
    if (!isRecord(raw.priorityByChannel)) return { reason: 'invalid-priority' }
    for (const key of Object.keys(raw.priorityByChannel)) {
      if (!isChannel(key)) return { reason: `invalid-priority-channel:${key}` }
      const priority = raw.priorityByChannel[key]
      if (!isFiniteNumber(priority)) return { reason: `invalid-priority:${key}` }
      priorityByChannel[key] = priority
    }
  }

  return {
    value: {
      contributionId: raw.contributionId,
      ownerId: raw.ownerId,
      generation: raw.generation,
      modelEpoch: raw.modelEpoch,
      bindingGeneration: raw.bindingGeneration,
      intentId: raw.intentId,
      mode: raw.mode,
      phase: raw.phase,
      values,
      priorityByChannel,
      strength: raw.strength,
      fadeInMs: raw.fadeInMs,
      fadeOutMs: raw.fadeOutMs,
      ttlMs: raw.ttlMs,
    },
  }
}

function normalizeRelease(raw: unknown): { value?: NormalizedRelease; reason?: string } {
  if (!isRecord(raw)) return { reason: 'not-an-object' }
  if (!isNonEmptyIdentity(raw.ownerId)) return { reason: 'invalid-owner-id' }
  if (!isNonNegativeSafeInteger(raw.generation)) return { reason: 'invalid-generation' }
  if (!isNonNegativeSafeInteger(raw.modelEpoch)) return { reason: 'invalid-model-epoch' }
  if (!isNonNegativeSafeInteger(raw.bindingGeneration)) return { reason: 'invalid-binding-generation' }
  if (!isReleaseReason(raw.reason)) return { reason: 'invalid-reason' }
  if (raw.fadeOutMs !== undefined && !isBoundedInteger(raw.fadeOutMs, 0, MIXER_MAX_FADE_MS)) {
    return { reason: 'invalid-fade-out' }
  }
  return {
    value: {
      ownerId: raw.ownerId,
      generation: raw.generation,
      modelEpoch: raw.modelEpoch,
      bindingGeneration: raw.bindingGeneration,
      reason: raw.reason,
      fadeOutMs: raw.fadeOutMs === undefined ? null : raw.fadeOutMs,
    },
  }
}

function resolveCapabilities(
  profile: unknown,
  reasons: ReasonCollector,
): Map<SemanticChannel, ChannelCapabilityState> {
  const resolved = new Map<SemanticChannel, ChannelCapabilityState>()
  const declared = new Map<SemanticChannel, ChannelCapabilityState>()

  if (!isRecord(profile) || profile.schemaVersion !== 1 || !Array.isArray(profile.capabilities)) {
    reasons.add('profile:invalid')
    for (const channel of MIXER_SEMANTIC_CHANNELS) {
      const state: ChannelCapabilityState = { available: false, status: 'unsupported', reason: 'invalid-profile' }
      resolved.set(channel, state)
      reasons.add(`channel-unavailable:${channel}:${state.status}:${state.reason}`)
    }
    return resolved
  }

  for (const raw of profile.capabilities) {
    if (!isRecord(raw)) {
      reasons.add('profile:invalid-capability-entry')
      continue
    }
    if (typeof raw.channel !== 'string' || !isChannel(raw.channel)) {
      reasons.add('profile:unknown-capability-channel')
      continue
    }
    const channel = raw.channel
    if (declared.has(channel)) {
      reasons.add(`profile:duplicate-capability:${channel}`)
      continue
    }
    const status = raw.status
    const reason = raw.reason
    if (
      (status !== 'available' && status !== 'needs-calibration' && status !== 'unsupported')
      || typeof reason !== 'string'
    ) {
      const state: ChannelCapabilityState = { available: false, status: 'unsupported', reason: 'invalid-capability' }
      declared.set(channel, state)
      reasons.add(`profile:invalid-capability:${channel}`)
      continue
    }
    declared.set(channel, { available: status === 'available' && reason === 'mapped', status, reason })
  }

  for (const channel of MIXER_SEMANTIC_CHANNELS) {
    const state = declared.get(channel)
      ?? { available: false, status: 'unsupported', reason: 'missing-capability' }
    resolved.set(channel, state)
    if (!state.available) reasons.add(`channel-unavailable:${channel}:${state.status}:${state.reason}`)
  }
  return resolved
}

function resolveBase(
  base: unknown,
  capabilities: ReadonlyMap<SemanticChannel, ChannelCapabilityState>,
  reasons: ReasonCollector,
): Map<SemanticChannel, BaseChannelState> {
  const resolved = new Map<SemanticChannel, BaseChannelState>()
  const record = isRecord(base) ? base : null
  if (record === null) reasons.add('base:invalid')

  if (record !== null) {
    for (const key of Object.keys(record)) {
      if (!isChannel(key)) reasons.add(`base:unknown-channel:${key}`)
    }
  }

  for (const channel of MIXER_SEMANTIC_CHANNELS) {
    if (!capabilities.get(channel)?.available) continue
    const anchor = anchorFor(channel)
    if (record === null || !Object.prototype.hasOwnProperty.call(record, channel)) {
      resolved.set(channel, { value: anchor.neutral, clamped: false })
      continue
    }
    const raw = record[channel]
    if (!isFiniteNumber(raw)) {
      reasons.add(`base:invalid-value:${channel}`)
      resolved.set(channel, { value: anchor.neutral, clamped: false })
      continue
    }
    const value = clamp(raw, anchor.min, anchor.max)
    resolved.set(channel, { value, clamped: value !== raw })
  }
  return resolved
}

function compareLeasesForChannel(a: Lease, b: Lease, channel: SemanticChannel): number {
  const priorityA = a.contribution.priorityByChannel[channel] ?? 0
  const priorityB = b.contribution.priorityByChannel[channel] ?? 0
  if (priorityA !== priorityB) return priorityA - priorityB
  if (a.acceptedAtMs !== b.acceptedAtMs) return a.acceptedAtMs - b.acceptedAtMs
  const ownerOrder = compareStrings(a.contribution.ownerId, b.contribution.ownerId)
  if (ownerOrder !== 0) return ownerOrder
  if (a.contribution.generation !== b.contribution.generation) {
    return a.contribution.generation - b.contribution.generation
  }
  return compareStrings(a.contribution.contributionId, b.contribution.contributionId)
}

function envelopeAt(lease: Lease, nowMs: number): number {
  let weight = lease.contribution.strength
  if (lease.contribution.fadeInMs > 0) {
    weight *= smoothstep((nowMs - lease.acceptedAtMs) / lease.contribution.fadeInMs)
  }
  if (lease.releasing) {
    if (lease.releaseFadeOutMs <= 0) return 0
    weight *= 1 - smoothstep((nowMs - lease.releaseStartedAtMs) / lease.releaseFadeOutMs)
  }
  return clamp01(weight)
}

function composePhase(
  phase: PerformanceContributionPhase,
  base: ReadonlyMap<SemanticChannel, BaseChannelState>,
  capabilities: ReadonlyMap<SemanticChannel, ChannelCapabilityState>,
  leases: readonly Lease[],
  nowMs: number,
): ComposedPhase {
  const values: SemanticChannelValues = {}
  const diagnostics: PerformanceMixerChannelDiagnostic[] = []
  let clampedCount = 0

  for (const channel of MIXER_SEMANTIC_CHANNELS) {
    if (!capabilities.get(channel)?.available) continue
    const anchor = anchorFor(channel)
    const baseState = base.get(channel) ?? { value: anchor.neutral, clamped: false }
    const applicable: Lease[] = []
    for (const lease of leases) {
      if (lease.contribution.phase !== phase) continue
      if (!Object.prototype.hasOwnProperty.call(lease.contribution.values, channel)) continue
      applicable.push(lease)
    }
    applicable.sort((a, b) => compareLeasesForChannel(a, b, channel))

    let current = baseState.value
    let clamped = baseState.clamped
    const ownerIds: string[] = []
    const seenOwners = new Set<string>()
    const contributionIds: string[] = []

    for (const lease of applicable) {
      const value = lease.contribution.values[channel] as number
      const weight = envelopeAt(lease, nowMs)
      if (lease.contribution.mode === 'replace') {
        current = current + (value - current) * weight
      } else if (lease.contribution.mode === 'add') {
        const delta = clamp(value, MIXER_ADD_VALUE_MIN, MIXER_ADD_VALUE_MAX)
        if (delta !== value) clamped = true
        current = current + delta * weight
      } else {
        const multiplier = clamp(value, MIXER_MULTIPLY_VALUE_MIN, MIXER_MULTIPLY_VALUE_MAX)
        if (multiplier !== value) clamped = true
        current = current * (1 + (multiplier - 1) * weight)
      }
      if (!Number.isFinite(current)) {
        current = finiteWithinAnchor(current, anchor)
        clamped = true
      }
      if (!seenOwners.has(lease.contribution.ownerId)) {
        seenOwners.add(lease.contribution.ownerId)
        ownerIds.push(lease.contribution.ownerId)
      }
      contributionIds.push(lease.contribution.contributionId)
    }

    const target = current
    const output = finiteWithinAnchor(target, anchor)
    if (output !== target) clamped = true
    if (clamped) clampedCount += 1
    values[channel] = output
    diagnostics.push({
      channel,
      phase,
      base: baseState.value,
      current: output,
      target,
      ownerIds,
      contributionIds,
      clamped,
    })
  }

  return { values, diagnostics, clampedCount }
}

export function createPerformanceMixer(): PerformanceMixer {
  let identity: { modelEpoch: number; bindingGeneration: number } | null = null
  let lastRawSampleMs: number | null = null
  let stateNowMs = 0
  const leases = new Map<string, Lease>()
  const latestGenerationByOwner = new Map<string, number>()
  const deadLeases = new Map<string, Set<string>>()

  function rememberDeadLease(lease: Lease): void {
    const owner = lease.contribution.ownerId
    let dead = deadLeases.get(owner)
    if (dead === undefined) {
      dead = new Set<string>()
      deadLeases.set(owner, dead)
    }
    dead.add(deadLeaseKey(lease.contribution))
  }

  function purgeOwner(ownerId: string): void {
    for (const [key, lease] of leases) {
      if (lease.contribution.ownerId === ownerId) leases.delete(key)
    }
    deadLeases.delete(ownerId)
  }

  function step(tick: PerformanceMixerTick): PerformanceMixerResult {
    if (!isRecord(tick)) throw new TypeError('Performance mixer tick must be an object')
    if (tick.version !== 1) throw new TypeError('Unsupported performance mixer tick version')

    const reasons = new ReasonCollector()
    const rejectedContributionIds: string[] = []
    const reasonForRejected = (raw: unknown, index: number, reason: string): void => {
      let label = `#${index}`
      if (isRecord(raw) && isNonEmptyIdentity(raw.contributionId)) label = raw.contributionId
      if (!rejectedContributionIds.includes(label)) rejectedContributionIds.push(label)
      reasons.add(`rejected-contribution:${label}:${reason}`)
    }

    const rawSample = isFiniteNumber(tick.sampledAtMonotonicMs) ? tick.sampledAtMonotonicMs : null
    const epochValid = isNonNegativeSafeInteger(tick.modelEpoch)
    const bindingValid = isNonNegativeSafeInteger(tick.bindingGeneration)
    const identityValid = epochValid && bindingValid
    const tickEpoch = epochValid ? tick.modelEpoch : (identity?.modelEpoch ?? 0)
    const tickBinding = bindingValid ? tick.bindingGeneration : (identity?.bindingGeneration ?? 0)

    if (!epochValid) reasons.add('tick:invalid-model-epoch')
    if (!bindingValid) reasons.add('tick:invalid-binding-generation')

    let clockWasReset = false
    if (identityValid) {
      if (identity === null) {
        identity = { modelEpoch: tickEpoch, bindingGeneration: tickBinding }
      } else if (identity.modelEpoch !== tickEpoch || identity.bindingGeneration !== tickBinding) {
        if (identity.modelEpoch !== tickEpoch) reasons.add('lifecycle:model-epoch-changed')
        if (identity.bindingGeneration !== tickBinding) reasons.add('lifecycle:binding-generation-changed')
        identity = { modelEpoch: tickEpoch, bindingGeneration: tickBinding }
        leases.clear()
        latestGenerationByOwner.clear()
        deadLeases.clear()
        lastRawSampleMs = null
        stateNowMs = 0
        clockWasReset = true
      }
    }

    let sampleForSnapshot = stateNowMs
    if (rawSample === null) {
      reasons.add('tick:invalid-sample')
    } else {
      sampleForSnapshot = rawSample
      if (clockWasReset) {
        lastRawSampleMs = rawSample
        stateNowMs = rawSample
      } else if (lastRawSampleMs === null) {
        lastRawSampleMs = rawSample
        stateNowMs = rawSample
      } else {
        const deltaMs = rawSample - lastRawSampleMs
        if (deltaMs > 0) {
          stateNowMs += Math.min(deltaMs, MIXER_MAX_DT_MS)
          lastRawSampleMs = rawSample
          if (deltaMs > MIXER_MAX_DT_MS) reasons.add(MIXER_FRAME_GAP_REASON)
        }
      }
    }

    if (!Array.isArray(tick.intents)) reasons.add('tick:invalid-intents')

    const capabilities = resolveCapabilities(tick.profile, reasons)
    const base = resolveBase(tick.base, capabilities, reasons)

    const rawContributions: readonly unknown[] = Array.isArray(tick.contributions) ? tick.contributions : []
    if (!Array.isArray(tick.contributions)) reasons.add('tick:invalid-contributions')

    const candidates: Candidate[] = []
    for (let index = 0; index < rawContributions.length; index += 1) {
      const raw = rawContributions[index]
      const normalized = normalizeContribution(raw)
      if (normalized.value === undefined) {
        reasonForRejected(raw, index, normalized.reason ?? 'invalid-contribution')
        continue
      }
      const contribution = normalized.value
      if (!identityValid) {
        reasonForRejected(raw, index, 'invalid-tick-identity')
        continue
      }
      if (contribution.modelEpoch !== tickEpoch) {
        reasonForRejected(raw, index, 'stale-model-epoch')
        continue
      }
      if (contribution.bindingGeneration !== tickBinding) {
        reasonForRejected(raw, index, 'stale-binding-generation')
        continue
      }
      candidates.push({ contribution, index })
    }

    const keyCounts = new Map<string, number>()
    for (const candidate of candidates) {
      const key = leaseKey(candidate.contribution)
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
    }
    const uniqueCandidates = candidates.filter((candidate) => {
      if ((keyCounts.get(leaseKey(candidate.contribution)) ?? 0) > 1) {
        reasonForRejected(candidate.contribution, candidate.index, 'duplicate-contribution-key')
        return false
      }
      return true
    })

    const byOwner = new Map<string, NormalizedContribution[]>()
    for (const candidate of uniqueCandidates) {
      const group = byOwner.get(candidate.contribution.ownerId)
      if (group === undefined) byOwner.set(candidate.contribution.ownerId, [candidate.contribution])
      else group.push(candidate.contribution)
    }

    const accepted: NormalizedContribution[] = []
    for (const [ownerId, group] of byOwner) {
      let maxGeneration = group[0].generation
      for (const contribution of group) maxGeneration = Math.max(maxGeneration, contribution.generation)
      const latestGeneration = latestGenerationByOwner.get(ownerId)
      if (latestGeneration !== undefined && maxGeneration < latestGeneration) {
        for (const contribution of group) {
          reasonForRejected(contribution, -1, 'stale-generation')
        }
        continue
      }
      if (latestGeneration === undefined || maxGeneration > latestGeneration) {
        purgeOwner(ownerId)
        latestGenerationByOwner.set(ownerId, maxGeneration)
      }
      for (const contribution of group) {
        if (contribution.generation !== maxGeneration) {
          reasonForRejected(contribution, -1, 'stale-generation')
          continue
        }
        accepted.push(contribution)
      }
    }

    accepted.sort((a, b) => {
      const ownerOrder = compareStrings(a.ownerId, b.ownerId)
      if (ownerOrder !== 0) return ownerOrder
      if (a.generation !== b.generation) return a.generation - b.generation
      return compareStrings(a.contributionId, b.contributionId)
    })

    for (const contribution of accepted) {
      const dead = deadLeases.get(contribution.ownerId)
      if (dead?.has(deadLeaseKey(contribution))) {
        reasonForRejected(contribution, -1, 'dead-lease')
        continue
      }
      const key = leaseKey(contribution)
      const existing = leases.get(key)
      if (existing !== undefined) {
        if (existing.releasing) {
          reasonForRejected(contribution, -1, 'released-lease')
          continue
        }
        existing.contribution = contribution
        continue
      }
      leases.set(key, {
        contribution,
        acceptedAtMs: stateNowMs,
        releasing: false,
        releaseStartedAtMs: 0,
        releaseFadeOutMs: 0,
      })
    }

    const rawReleases: readonly unknown[] = Array.isArray(tick.releases) ? tick.releases : []
    if (!Array.isArray(tick.releases)) reasons.add('tick:invalid-releases')
    const normalizedReleases: NormalizedRelease[] = []
    for (let index = 0; index < rawReleases.length; index += 1) {
      const normalized = normalizeRelease(rawReleases[index])
      if (normalized.value === undefined) {
        reasons.add(`invalid-release:#${index}:${normalized.reason ?? 'invalid-release'}`)
        continue
      }
      normalizedReleases.push(normalized.value)
    }
    normalizedReleases.sort((a, b) => {
      const ownerOrder = compareStrings(a.ownerId, b.ownerId)
      if (ownerOrder !== 0) return ownerOrder
      if (a.generation !== b.generation) return a.generation - b.generation
      const reasonOrder = compareStrings(a.reason, b.reason)
      if (reasonOrder !== 0) return reasonOrder
      return (a.fadeOutMs ?? -1) - (b.fadeOutMs ?? -1)
    })

    for (const release of normalizedReleases) {
      if (!identityValid) {
        reasons.add('tick:ignored-release:invalid-tick-identity')
        continue
      }
      if (release.modelEpoch !== tickEpoch || release.bindingGeneration !== tickBinding) continue
      for (const lease of leases.values()) {
        const contribution = lease.contribution
        if (contribution.ownerId !== release.ownerId || contribution.generation !== release.generation) continue
        if (contribution.modelEpoch !== release.modelEpoch) continue
        if (contribution.bindingGeneration !== release.bindingGeneration) continue
        if (lease.releasing) continue
        lease.releasing = true
        lease.releaseStartedAtMs = stateNowMs
        lease.releaseFadeOutMs = release.fadeOutMs ?? contribution.fadeOutMs
      }
    }

    for (const lease of leases.values()) {
      if (lease.releasing) continue
      const ttlMs = lease.contribution.ttlMs
      if (ttlMs === null) continue
      if (stateNowMs - lease.acceptedAtMs < ttlMs) continue
      lease.releasing = true
      lease.releaseStartedAtMs = lease.acceptedAtMs + ttlMs
      lease.releaseFadeOutMs = lease.contribution.fadeOutMs
    }

    for (const [key, lease] of leases) {
      if (!lease.releasing) continue
      if (stateNowMs - lease.releaseStartedAtMs < lease.releaseFadeOutMs) continue
      leases.delete(key)
      rememberDeadLease(lease)
    }

    const leaseList = Array.from(leases.values())
    const prePhysics = composePhase('pre-physics', base, capabilities, leaseList, stateNowMs)

    const postBase = new Map<SemanticChannel, BaseChannelState>()
    for (const channel of MIXER_SEMANTIC_CHANNELS) {
      const value = prePhysics.values[channel]
      if (value === undefined) continue
      postBase.set(channel, { value, clamped: false })
    }
    const postPhysics = composePhase('post-physics', postBase, capabilities, leaseList, stateNowMs)

    const snapshot: PerformanceMixerSnapshot = {
      version: 1,
      sampledAtMonotonicMs: sampleForSnapshot,
      modelEpoch: tickEpoch,
      bindingGeneration: tickBinding,
      channels: [...prePhysics.diagnostics, ...postPhysics.diagnostics],
      clampCount: prePhysics.clampedCount + postPhysics.clampedCount,
      rejectedContributionIds,
      degradedReasons: reasons.values,
    }

    return {
      prePhysics: prePhysics.values,
      postPhysics: postPhysics.values,
      snapshot,
    }
  }

  return { step }
}
