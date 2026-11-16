import { isAmbientPerformanceState, type AmbientPerformanceState } from './model-performance-contracts'
import { CALIBRATION_CHANNELS, type CalibrationChannel } from './model-calibration-contracts'

/** Whitelisted commands the settings window may send to the desktop pet renderer. */
export type PetSettingsCommand =
  | { type: 'snapshot' }
  | { type: 'inspect-performance' }
  | { type: 'preview-head'; mode: 'legacy' | 'mixer' }
  | { type: 'preview-calibration'; signature: string; channel: CalibrationChannel; parameterId: string; direction: 'normal' | 'reversed' }
  | { type: 'preview-eyes' }
  | { type: 'preview-mouth' }
  | { type: 'preview-ambient'; state: AmbientPerformanceState }
  | { type: 'switch-model'; url: string }
  | { type: 'preview-step'; step: unknown; gaze: boolean }
  | { type: 'trigger-preset'; preset: string | Record<string, unknown>; mode?: string }
  | { type: 'control-action'; control: string; action: string }
  | { type: 'sync-sliders'; transitionMs: number; sliders?: unknown[]; controls?: unknown[] }
  | { type: 'set-edit-lock'; locked: boolean }
  | { type: 'set-hold-preset'; presetId: string }
  | { type: 'set-emotion'; emotion: string }
  | { type: 'release-workshop' }
  | { type: 'reload-settings' }
  | { type: 'host-state' }
  | { type: 'switch-host'; preference: string }
  | { type: 'reconnect-host' }

export interface PetSettingsCommandResult {
  ok: boolean
  data?: unknown
  error?: string
}

export interface PetSettingsModelContext {
  modelUrl: string
  modelGeneration: number
  petEpoch: number
}

export interface PetSettingsDispatch {
  id: string
  session: number
  command: PetSettingsCommand
  model?: PetSettingsModelContext
}

const COMMAND_TYPES = new Set([
  'snapshot',
  'inspect-performance',
  'preview-head',
  'preview-calibration',
  'preview-eyes',
  'preview-mouth',
  'preview-ambient',
  'switch-model',
  'preview-step',
  'trigger-preset',
  'control-action',
  'sync-sliders',
  'set-edit-lock',
  'set-hold-preset',
  'set-emotion',
  'release-workshop',
  'reload-settings',
  'host-state',
  'switch-host',
  'reconnect-host',
])

const MAX_URL_LENGTH = 4096

export function normalizePetSettingsCommand(raw: unknown): PetSettingsCommand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const type = value.type
  if (typeof type !== 'string' || !COMMAND_TYPES.has(type)) return null

  switch (type) {
    case 'snapshot':
    case 'inspect-performance':
    case 'preview-eyes':
    case 'preview-mouth':
    case 'release-workshop':
    case 'reload-settings':
    case 'host-state':
    case 'reconnect-host':
      return { type }
    case 'preview-head':
      return value.mode === 'legacy' || value.mode === 'mixer' ? { type, mode: value.mode } : null
    case 'preview-calibration':
      return typeof value.signature === 'string' && /^uta-live2d-assets-v1:[a-f0-9]{64}$/.test(value.signature) &&
        typeof value.channel === 'string' && (CALIBRATION_CHANNELS as readonly string[]).includes(value.channel) &&
        typeof value.parameterId === 'string' && value.parameterId.length > 0 && value.parameterId.length <= 200 &&
        (value.direction === 'normal' || value.direction === 'reversed')
        ? { type, signature: value.signature, channel: value.channel as CalibrationChannel, parameterId: value.parameterId, direction: value.direction } : null
    case 'preview-ambient':
      return isAmbientPerformanceState(value.state) ? { type, state: value.state } : null
    case 'switch-model':
      return typeof value.url === 'string' && value.url.length > 0 && value.url.length <= MAX_URL_LENGTH
        ? { type, url: value.url }
        : null
    case 'preview-step':
      if (!value.step || typeof value.step !== 'object' || Array.isArray(value.step)) return null
      if (typeof value.gaze !== 'boolean') return null
      return { type, step: value.step, gaze: value.gaze }
    case 'trigger-preset': {
      const mode = typeof value.mode === 'string' && value.mode.length > 0 ? value.mode : undefined
      if (typeof value.preset === 'string' && value.preset.length > 0) {
        return { type, preset: value.preset, mode }
      }
      if (value.preset && typeof value.preset === 'object' && !Array.isArray(value.preset)) {
        return { type, preset: value.preset as Record<string, unknown>, mode }
      }
      return null
    }
    case 'control-action':
      if (typeof value.control !== 'string' || value.control.length === 0) return null
      if (typeof value.action !== 'string' || value.action.length === 0) return null
      return { type, control: value.control, action: value.action }
    case 'sync-sliders': {
      if (typeof value.transitionMs !== 'number' || !Number.isFinite(value.transitionMs)) return null
      if (value.sliders !== undefined && !Array.isArray(value.sliders)) return null
      if (value.controls !== undefined && !Array.isArray(value.controls)) return null
      return {
        type,
        transitionMs: Math.max(0, Math.min(5000, value.transitionMs)),
        sliders: value.sliders as unknown[] | undefined,
        controls: value.controls as unknown[] | undefined,
      }
    }
    case 'set-edit-lock':
      return typeof value.locked === 'boolean' ? { type, locked: value.locked } : null
    case 'set-emotion':
      return typeof value.emotion === 'string' && value.emotion.length > 0 && value.emotion.length <= 100
        ? { type, emotion: value.emotion } : null
    case 'set-hold-preset':
      return typeof value.presetId === 'string' && value.presetId.length <= 200
        ? { type, presetId: value.presetId }
        : null
    case 'switch-host':
      return typeof value.preference === 'string' &&
        /^[A-Za-z0-9._:-]{1,120}$/.test(value.preference)
        ? { type, preference: value.preference }
        : null
    default:
      return null
  }
}
