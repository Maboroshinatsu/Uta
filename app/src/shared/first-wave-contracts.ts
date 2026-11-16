/** First desktop handoff contract. No renderer, storage, filesystem or network imports. */
export const FIRST_WAVE_CONTRACT_VERSION = 'uta-desktop-wave-1' as const

export type SemanticChannel =
  | 'headX' | 'headY' | 'headZ' | 'bodyX' | 'bodyY' | 'bodyZ'
  | 'gazeX' | 'gazeY' | 'eyeOpenLeft' | 'eyeOpenRight'
  | 'mouthOpen' | 'mouthForm' | 'browLeft' | 'browRight' | 'breath'

export interface InspectedParameter {
  id: string
  min: number
  max: number
  defaultValue: number
  label?: string
  physicsOutput: boolean
}

export interface NativeExpressionDefinition {
  name: string
  parameters: Array<{ id: string; value: number; blend: 'Add' | 'Multiply' | 'Overwrite' }>
}

export interface NativeMotionTargetSummary {
  curveCount: number
  targetIds: string[]
}

export interface NativeMotionDefinition {
  group: string
  index: number
  /** Compatibility projection for existing profile consumers. */
  parameterIds: string[]
  /** Present on newly inspected resources. Null means the motion file did not declare the fact. */
  durationMs?: number | null
  loop?: boolean | null
  /** Cubism target namespaces stay separate because these IDs are not interchangeable. */
  curveTargets?: {
    Parameter: NativeMotionTargetSummary
    Model: NativeMotionTargetSummary
    PartOpacity: NativeMotionTargetSummary
  }
}

/** Caller supplies content identity; the pure builder neither reads nor hashes model assets. */
export interface ModelInspectionInput {
  schemaVersion: 1
  modelSignature: string
  parameters: InspectedParameter[]
  expressions: NativeExpressionDefinition[]
  motions: NativeMotionDefinition[]
  overrides: Array<{
    channel: SemanticChannel
    parameterId: string
    direction: 'normal' | 'reversed'
    confirmed: boolean
  }>
}

export interface SemanticMapping {
  channel: SemanticChannel
  parameterId: string
  direction: 'normal' | 'reversed'
  source: 'standard-id' | 'label-guess' | 'manual'
  confidence: number
  confirmed: boolean
}

export interface ChannelCapability {
  channel: SemanticChannel
  status: 'available' | 'needs-calibration' | 'unsupported'
  parameterIds: string[]
  reason: 'mapped' | 'unconfirmed' | 'missing-parameter' | 'physics-output' | 'ambiguous'
}

export interface ModelCapabilityProfile {
  schemaVersion: 1
  modelSignature: string
  parameters: InspectedParameter[]
  mappings: SemanticMapping[]
  capabilities: ChannelCapability[]
  expressions: NativeExpressionDefinition[]
  motions: ModelInspectionInput['motions']
  warnings: Array<{ code: 'unknown-expression-parameter' | 'unknown-motion-parameter'; resource: string; parameterId: string }>
}

export type ProfileBuildResult =
  | { ok: true; profile: ModelCapabilityProfile }
  | { ok: false; issues: Array<{
    code: 'invalid-schema' | 'invalid-signature' | 'invalid-parameter' | 'duplicate-parameter'
      | 'invalid-resource' | 'invalid-override' | 'unknown-override-target'
    path: string
    message: string
  }> }

export type PerformanceIntent = {
  version: 1
  intentId: string
  source: 'user' | 'host' | 'speech' | 'workshop' | 'system'
  sessionId: string | null
  bindingGeneration: number
  modelEpoch: number
  issuedAtUnixMs: number
  ttlMs: number
  intensity: number
  seed: number
} & (
  | { kind: 'state'; payload: { state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'awaiting-approval' | 'recovering' } }
  | { kind: 'emotion'; payload: { valence: number; arousal: number; dominance: number } }
  | { kind: 'gesture'; payload: { gesture: 'nod' | 'tilt' | 'look-aside' } }
  | { kind: 'native-animation'; payload: { resourceKind: 'motion' | 'expression'; resourceId: string } }
  | { kind: 'cancel'; payload: { targetIntentId: string } }
)

/** Diagnostic sample only. Null audio offset means unavailable, never zero latency. */
export interface PerformanceSnapshot {
  version: 1
  modelEpoch: number
  bindingGeneration: number
  sampledAtMonotonicMs: number
  state: Extract<PerformanceIntent, { kind: 'state' }>['payload']['state']
  activeIntentIds: string[]
  channels: Array<{
    channel: SemanticChannel
    ownerId: string | null
    phase: 'pre-physics' | 'post-physics'
    current: number
    target: number
  }>
  clampCount: number
  queueLength: number
  audioOffsetMs: number | null
  degradedReasons: string[]
}

/** UI-only mock view. No credentials, device execution or production persistence contract. */
export interface VoicePreviewFixture {
  version: 1
  providerId: string
  providerLabel: string
  endpoint: string
  model: string
  secretState: 'missing' | 'configured-demo'
  volume: number
  enabled: boolean
  simulatedOutcome: 'success' | 'failure'
}
