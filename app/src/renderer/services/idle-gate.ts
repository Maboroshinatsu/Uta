export interface IdleActionGate {
  idleActionsEnabled: boolean
  reducedMotion: boolean
  documentVisible: boolean
  agentWorkingState: string
  speaking: boolean
  thinking: boolean
  approvals: number
  editingLocked: boolean
  previewActive: boolean
  presetRunning: boolean
  uiBlocked: boolean
}

/** Shared daily-idle decision for Live2D and static portrait rendering. */
export function canRunIdleActions(gate: IdleActionGate): boolean {
  return gate.idleActionsEnabled &&
    !gate.reducedMotion &&
    gate.documentVisible &&
    gate.agentWorkingState === 'idle' &&
    !gate.speaking &&
    !gate.thinking &&
    gate.approvals === 0 &&
    !gate.editingLocked &&
    !gate.previewActive &&
    !gate.presetRunning &&
    !gate.uiBlocked
}
