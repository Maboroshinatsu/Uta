import { compileMotionChoreography, MAX_CHOREOGRAPHY_DURATION_MS, type MotionChannel, type MotionClip, type MotionControl, type MotionFinishMode, type MotionPlaybackResult, type MotionRequest, type MotionResult } from '../../shared/motion-choreography'
import type { ModelStatePreset } from './live2d/emotion-adapter'
import { buildPresetExport } from './preset-transfer'

interface Job {
  jobId: string
  hostId: string
  sessionId: string
  title: string
  durationMs: number
  status: 'starting' | 'playing' | MotionPlaybackResult
}

interface Options {
  getHost: () => string
  getModel: () => { name: string; revision: string; parameters: MotionChannel[]; controls?: MotionControl[]; nativeMotions?: MotionClip[]; url?: string; signature?: string; presetSlots?: PresetSlot[] } | null
  isEditing: () => boolean
  play: (preset: ModelStatePreset, onEnd: (status: MotionPlaybackResult) => void, onStarted: () => void) => boolean
  stop: (id: string) => boolean
}

export interface PresetSlot {
  id: string
  label: string
  group: string
  emotion: string
  finishMode: MotionFinishMode
}

export function createMotionChoreography(options: Options): (request: MotionRequest) => MotionResult {
  const jobs = new Map<string, Job>()
  const error = (message: string) => ({ ok: false as const, error: message })
  const receipt = ({ jobId, status, title, durationMs }: Job): MotionResult => ({ ok: true, jobId, status, title, durationMs,
    ...(status === 'failed' ? { reason: 'native-motion-playback-failed' } : {}) })
  const presetId = (id: string) => `host-motion-${id}`
  return request => {
    if (request.hostId !== options.getHost()) return error('host-not-bound')
    const job = 'jobId' in request ? jobs.get(request.jobId) : undefined
    if (job && (job.hostId !== request.hostId || job.sessionId !== request.sessionId)) return error('motion-job-not-found')
    if (request.operation === 'status' || request.operation === 'stop') {
      if (!job) return error('motion-job-not-found')
      if (request.operation === 'stop' && (job.status === 'starting' || job.status === 'playing') &&
        !options.stop(presetId(job.jobId))) return error('motion-no-longer-active')
      return receipt(job)
    }
    const model = options.getModel()
    if (!model) return error('A ready Live2D model is required.')
    if (request.operation === 'capabilities') {
      return { ok: true, name: model.name, revision: model.revision, parameters: model.parameters,
        controls: model.controls ?? [], nativeMotions: model.nativeMotions ?? [], presetSlots: model.presetSlots, timelineVersion: 1,
        limits: { maxDurationMs: MAX_CHOREOGRAPHY_DURATION_MS } }
    }
    if (model.revision !== request.revision) return error('model-changed: read motion capabilities again')
    if (job) return receipt(job)
    const compiled = compileMotionChoreography(request.plan, model.parameters, model.controls, model.nativeMotions)
    if (!compiled.ok) return compiled
    if (request.operation === 'validate') {
      return { ok: true, status: 'validated', title: compiled.title, durationMs: compiled.durationMs,
        steps: compiled.steps.length, parameters: Object.keys(compiled.steps[0].parameters),
        controls: [...new Set(compiled.steps.flatMap(step => step.controls))], motion: compiled.motion }
    }
    if (request.operation === 'compile_preset') {
      const slot = model.presetSlots?.find(entry => entry.id === request.slotId)
      if (!slot || !model.url) return error('default-preset-slot-unavailable: use a slot from capabilities')
      const finishMode = request.finishMode ?? slot.finishMode
      if (compiled.motion && finishMode !== 'revert') return error('native-motion-requires-revert: compile this clip as a one-shot')
      const lastStep = compiled.steps.at(-1)!
      const { parameters, controls } = lastStep
      if (finishMode === 'loop' && (compiled.steps.length < 2 ||
        controls.length > 0 ||
        model.parameters.some(p => p.id in parameters && Math.abs(parameters[p.id] - p.default) > 1e-6))) {
        return error('loop-must-return-to-default: end each track at its model default')
      }
      const preset: ModelStatePreset = {
        ...slot, label: compiled.title, description: '', finishMode, steps: compiled.steps,
        controls, parameters, motion: compiled.motion ?? 'none', revertHoldMs: 0,
      }
      const modelKey = model.url.replace(/[?#].*$/, '')
      return { ok: true, status: 'compiled', durationMs: compiled.durationMs,
        draft: JSON.parse(buildPresetExport(modelKey, model.url, [preset], undefined, model.signature)) }
    }
    if (options.isEditing()) return error('workshop-busy')
    const next: Job = { jobId: request.jobId, hostId: request.hostId, sessionId: request.sessionId,
      title: compiled.title, durationMs: compiled.durationMs, status: compiled.motion ? 'starting' : 'playing' }
    if (!options.play({ id: presetId(next.jobId), label: compiled.title, description: '', emotion: 'neutral',
      group: '会话动作', steps: compiled.steps, controls: [], motion: compiled.motion ?? 'none', finishMode: 'revert', revertHoldMs: 0 },
    status => { next.status = status }, () => { if (next.status === 'starting') next.status = 'playing' })) return error('motion-playback-rejected')
    jobs.set(next.jobId, next)
    if (jobs.size > 32) jobs.delete(jobs.keys().next().value!)
    return receipt(next)
  }
}
