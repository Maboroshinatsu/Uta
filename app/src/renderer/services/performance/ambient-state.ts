import type { AmbientPerformanceState } from '../../../shared/model-performance-contracts'

export interface AmbientStateInput {
  idleActionsEnabled: boolean
  focusActive: boolean
  reducedMotion: boolean
  documentVisible: boolean
  modelLoaded: boolean
  hasModel: boolean
  presetEditingLocked: boolean
  presetPreviewActive: boolean
  holdPresetPinned: boolean
  approvalPending: boolean
  ttsSpeaking: boolean
  isSpeaking: boolean
  agentWorkingState: AgentWorkingState
}

/** Real host-driven state for the continuous layer. Explicit editing/preview always wins. */
export function selectAmbientPerformanceState(input: AmbientStateInput): AmbientPerformanceState | null {
  if (input.reducedMotion || !input.documentVisible) return null
  if (!input.modelLoaded || !input.hasModel) return null
  if (input.presetEditingLocked || input.presetPreviewActive || input.holdPresetPinned) return null
  if (input.approvalPending) return 'waiting'
  if (input.ttsSpeaking || input.isSpeaking || input.agentWorkingState === 'streaming') return 'speaking'
  if (input.agentWorkingState === 'tool_running') return 'working'
  if (input.agentWorkingState === 'thinking') return 'thinking'
  if (input.agentWorkingState === 'error') return 'error'
  if (input.agentWorkingState === 'completed') return 'completed'
  return input.focusActive || !input.idleActionsEnabled ? null : 'idle'
}
