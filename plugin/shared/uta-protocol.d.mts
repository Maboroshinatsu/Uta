export const PROTOCOL_VERSION: '2.0'
export const PROTOCOL_VERSIONS: readonly string[]
export const MAX_BODY_BYTES: number
export const RUNTIME_CAPABILITIES: readonly string[]

export interface RuntimeEventMeta {
  /** Assigned by the runtime after it validates a model-dependent command. */
  modelRevision?: string
  hostId: string
  hostInstanceId?: string
  sessionId?: string
  turnId?: string
  eventId?: string
  seq?: number
  ts?: string
  legacy?: boolean
}

export interface RuntimeEnvelope {
  protocolVersion: string
  meta: RuntimeEventMeta
  command: Record<string, unknown>
}

export type NormalizedRuntimeEnvelope =
  | { ok: true; legacy: boolean; envelope: RuntimeEnvelope }
  | { ok: false; error: string }

export function wrapCommand(
  command: Record<string, unknown>,
  meta?: Partial<RuntimeEventMeta>,
): RuntimeEnvelope

export function normalizeRuntimeEnvelope(body: unknown): NormalizedRuntimeEnvelope
