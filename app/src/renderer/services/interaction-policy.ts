export interface InteractionGate {
  enabled: boolean
  modelLoaded: boolean
  busy: boolean
  overlayOpen: boolean
  now: number
  lastInteractionAt: number
}

/** Explicit user interaction must not interrupt an active task, and is rate limited. */
export function canRespondToInteraction(gate: InteractionGate): boolean {
  return gate.enabled && gate.modelLoaded && !gate.busy && !gate.overlayOpen &&
    gate.now - gate.lastInteractionAt >= 3000
}
