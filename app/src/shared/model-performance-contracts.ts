import type { CoreInspectionRequest } from './model-inspection-contracts'
import type { ChannelCapability, SemanticChannel } from './first-wave-contracts'

export type ModelPerformanceAssets = Omit<CoreInspectionRequest, 'overrides'> & {
  calibration?: import('./model-calibration-contracts').ModelCalibration[] | null
}
export type ModelPerformanceStage = 'before-motion' | 'after-motion' | 'saved-motion' | 'after-expression'
  | 'after-blink' | 'after-focus' | 'after-natural-and-uta' | 'after-physics' | 'after-pose'
  | 'before-core-update' | 'after-core-update' | 'restored-motion'
export interface ModelPerformanceTrace {
  mode: 'legacy' | 'mixer'
  parameterId: string
  frames: number
  observedStages: ModelPerformanceStage[]
  latestFrame: Array<{ stage: ModelPerformanceStage; value: number }>
}
export const AMBIENT_PERFORMANCE_STATES = ['idle', 'thinking', 'working', 'speaking', 'waiting', 'error', 'completed'] as const
export type AmbientPerformanceState = (typeof AMBIENT_PERFORMANCE_STATES)[number]

export function isAmbientPerformanceState(value: unknown): value is AmbientPerformanceState {
  return typeof value === 'string' && (AMBIENT_PERFORMANCE_STATES as readonly string[]).includes(value)
}

export interface AmbientChannelSample {
  parameterId: string
  native: number
  applied: number
}

export interface AmbientPerformanceView {
  /** Real state selected by the stage; null when micro-motion is off or paused. */
  state: AmbientPerformanceState | null
  /** Short settings demo, which temporarily overrides the real state. */
  demo: AmbientPerformanceState | null
  suspended: boolean
  /** Last applied semantic contributions: head add, eye multiply, mouth-form add. */
  head: number | null
  eye: number | null
  mouthForm: number | null
  accent: number | null
  speechLevel: number | null
  headSample: AmbientChannelSample | null
  eyeSamples: AmbientChannelSample[]
  mouthSample: AmbientChannelSample | null
}

export interface ModelPerformanceView {
  signature: string | null
  parameterCount: number
  expressionCount: number
  motionCount: number
  channels: ChannelCapability[]
  parameters: import('./first-wave-contracts').InspectedParameter[]
  mappings: import('./first-wave-contracts').SemanticMapping[]
  calibration: import('./model-calibration-contracts').ModelCalibration[] | null
  preview: 'legacy' | 'mixer' | null
  previewKind: 'head' | 'eyes' | 'mouth' | null
  headPreviewAvailable: boolean
  eyePreviewAvailable: boolean
  mouthPreviewAvailable: boolean
  ambientAvailable: boolean
  speechActive: boolean
  ambient: AmbientPerformanceView
  source: string
  sample: { channel: SemanticChannel; native: number; applied: number; rendered: number | null } | null
  trace: ModelPerformanceTrace | null
  eyeSamples: Array<{ parameterId: string; native: number; applied: number }>
  mouthSamples: Array<{ parameterId: string; native: number; applied: number }>
}
