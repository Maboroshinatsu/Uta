export interface MotionChannel {
  id: string
  label: string
  min: number
  max: number
  default: number
}

export interface MotionWrites { parameters: string[]; parts: string[] }
export interface MotionControl extends MotionWrites { id: string; baseId: string; label: string; category: string; held?: boolean }
export interface NativeMotion { group: string; index: number }
export interface MotionClip extends NativeMotion { label?: string; durationMs: number; writes?: MotionWrites }

export interface MotionOwner { hostId: string; sessionId: string }
export type MotionFinishMode = 'revert' | 'hold' | 'loop'
export type MotionPlaybackResult = 'completed' | 'interrupted' | 'failed'
export type MotionRequest = MotionOwner & (
  | { operation: 'capabilities' }
  | { operation: 'validate'; revision: string; plan: unknown }
  | { operation: 'compile_preset'; revision: string; plan: unknown; slotId: string; finishMode?: MotionFinishMode }
  | { operation: 'play'; revision: string; plan: unknown; jobId: string }
  | { operation: 'status'; jobId: string }
  | { operation: 'stop'; jobId: string }
)
export type MotionResult = { ok: true; [key: string]: unknown } | { ok: false; error: string }
export interface MotionDispatch { id: string; deadline: number; request: MotionRequest }

export const MAX_CHOREOGRAPHY_DURATION_MS = 12000
const MAX_DURATION = MAX_CHOREOGRAPHY_DURATION_MS
const MAX_TRACKS = 12
const MAX_KEYS = 24
const MAX_STEPS = 60
const MIN_INTERVAL = 40

function object(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
}

export function parseMotionRequest(raw: unknown): MotionRequest | undefined {
  const value = object(raw)
  if (!value || typeof value.hostId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(value.hostId)) return
  const sessionId = value.sessionId ?? ''
  if (typeof sessionId !== 'string' || sessionId.length > 200 || /[\u0000-\u001f\u007f]/.test(sessionId)) return
  const owner = { hostId: value.hostId, sessionId }
  const operation = value.operation
  if (operation === 'capabilities') return { ...owner, operation }
  const jobId = value.jobId
  const validJob = typeof jobId === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(jobId)
  if ((operation === 'status' || operation === 'stop') && validJob) return { ...owner, operation, jobId }
  const revision = value.revision
  if (typeof revision !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(revision) || !object(value.plan)) return
  if (operation === 'validate') return { ...owner, operation, revision, plan: value.plan }
  if (operation === 'compile_preset') {
    const { slotId, finishMode } = value
    if (typeof slotId !== 'string' || !slotId || slotId.length > 120 || /[\u0000-\u001f\u007f]/.test(slotId) ||
      (finishMode !== undefined && finishMode !== 'revert' && finishMode !== 'hold' && finishMode !== 'loop')) return
    return { ...owner, operation, revision, plan: value.plan, slotId, finishMode }
  }
  if (operation === 'play' && validJob) return { ...owner, operation, revision, plan: value.plan, jobId }
}

interface Key { atMs: number; value: number }
interface Step { durationMs: number; holdMs: number; controls: string[]; parameters: Record<string, number> }

export function compileMotionChoreography(
  raw: unknown, channels: readonly MotionChannel[], controls: readonly MotionControl[] = [], clips: readonly MotionClip[] = [],
): { ok: true; title: string; durationMs: number; steps: Step[]; motion?: NativeMotion } | { ok: false; error: string } {
  const plan = object(raw)
  const invalid = (error: string) => ({ ok: false as const, error })
  if (!plan || plan.version !== 1 || !Array.isArray(plan.tracks) || plan.tracks.length > MAX_TRACKS) {
    return invalid(`Use a version 1 timeline with at most ${MAX_TRACKS} parameter tracks.`)
  }
  const native = object(plan.nativeMotion)
  const clip = native ? clips.find(item => item.group === native.group && item.index === native.index) : undefined
  if (plan.nativeMotion !== undefined && !clip) return invalid('native-motion-unavailable: use a clip from capabilities')
  if (clip && clip.durationMs > MAX_DURATION) return invalid('native-motion-too-long: this clip is available in the model action library but exceeds the 12 second choreography limit')
  const tracks = new Map<string, Key[]>()
  const timestamps = new Set<number>([0])
  let hasChange = false
  for (const rawTrack of plan.tracks) {
    const track = object(rawTrack)
    const id = track?.parameterId
    const channel = channels.find(p => p.id === id)
    if (!channel) return invalid('Track references an unavailable parameter. Refresh capabilities and use an exposed input ID.')
    if (tracks.has(channel.id)) return invalid(`Only one track can own ${channel.id}. Merge its keyframes.`)
    if (!Array.isArray(track?.keyframes) || track.keyframes.length < 1 || track.keyframes.length > MAX_KEYS) {
      return invalid(`Each track must have 1–${MAX_KEYS} keyframes.`)
    }
    const keys: Key[] = [{ atMs: 0, value: channel.default }]
    let previousTime = -1
    for (const rawKey of track.keyframes) {
      const key = object(rawKey)
      const atMs = key?.atMs, value = key?.value
      if (typeof atMs !== 'number' || !Number.isInteger(atMs) || atMs < 0 || atMs > MAX_DURATION ||
          typeof value !== 'number' || !Number.isFinite(value) || value < channel.min || value > channel.max) {
        return invalid(`Invalid time or value for ${channel.id}. Use milliseconds and the current model’s parameter range.`)
      }
      if (atMs <= previousTime || (atMs === 0 && value !== channel.default)) {
        return invalid('Keyframe times must increase and time zero is the model default.')
      }
      previousTime = atMs
      if (atMs === 0) continue
      keys.push({ atMs, value })
      timestamps.add(atMs)
      hasChange ||= value !== channel.default
    }
    tracks.set(channel.id, keys)
  }
  const controlFrames = new Map<number, string[]>()
  const usedControls = new Set<MotionControl>()
  if (plan.controlKeyframes !== undefined && (!Array.isArray(plan.controlKeyframes) || plan.controlKeyframes.length > MAX_KEYS)) {
    return invalid(`Use at most ${MAX_KEYS} control keyframes.`)
  }
  let previousControlTime = -1
  for (const rawFrame of (plan.controlKeyframes as unknown[] | undefined) ?? []) {
    const frame = object(rawFrame)
    const time = frame?.atMs
    if (typeof time !== 'number' || !Number.isInteger(time) || time <= previousControlTime || time > MAX_DURATION ||
      !Array.isArray(frame?.controls) || frame.controls.length > MAX_TRACKS) return invalid('Invalid control keyframe.')
    const selected = new Set<string>()
    const selectedParameters = new Set<string>()
    const selectedParts = new Set<string>()
    for (const id of frame.controls) {
      const control = controls.find(item => item.id === id)
      if (!control || selected.has(control.baseId)) return invalid('control-unavailable-or-duplicate: use IDs from capabilities')
      if (control.parameters.some(parameter => tracks.has(parameter))) return invalid('control-track-conflict: remove the overlapping parameter track')
      if (control.parameters.some(id => selectedParameters.has(id)) || control.parts.some(id => selectedParts.has(id))) {
        return invalid('control-conflict: choose controls that do not write the same parameter or part')
      }
      selected.add(control.baseId)
      for (const id of control.parameters) selectedParameters.add(id)
      for (const id of control.parts) selectedParts.add(id)
      usedControls.add(control)
    }
    controlFrames.set(time, [...frame.controls])
    timestamps.add(time)
    previousControlTime = time
  }
  if (!hasChange && !clip && !usedControls.size) return invalid('The timeline needs a changed pose, a control, or a native motion.')
  if (clip && (tracks.size || usedControls.size)) {
    const writes = clip.writes
    if (!writes) return invalid('native-motion-ownership-unknown: use this clip by itself')
    if (writes.parameters.some(id => tracks.has(id)) || [...usedControls].some(control =>
      control.parameters.some(id => writes.parameters.includes(id)) || control.parts.some(id => writes.parts.includes(id)),
    )) return invalid('native-motion-conflict: use non-overlapping controls and tracks')
  }
  const minimumDuration = Math.max(clip?.durationMs ?? 0, ...timestamps)
  const durationMs = plan.durationMs ?? minimumDuration
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs < Math.max(MIN_INTERVAL, minimumDuration) ||
    durationMs > MAX_DURATION || previousControlTime >= durationMs) return invalid('Set durationMs after the last control keyframe and within 12 seconds.')
  timestamps.add(durationMs)
  const times = [...timestamps].sort((a, b) => a - b)
  if (times.length > MAX_STEPS + 1 || times.slice(1).some((time, i) => time - times[i] < MIN_INTERVAL)) {
    return invalid(`Use at most ${MAX_STEPS} shared beats, at least ${MIN_INTERVAL} ms apart.`)
  }
  const sample = (keys: Key[], atMs: number) => {
    const nextIndex = keys.findIndex(key => key.atMs >= atMs)
    if (nextIndex < 0) return keys[keys.length - 1].value
    const before = keys[nextIndex - 1], next = keys[nextIndex]
    return before.value + (next.value - before.value) * ((atMs - before.atMs) / (next.atMs - before.atMs))
  }
  let activeControls: string[] = []
  const steps = times.slice(1).flatMap((time, i) => {
    activeControls = controlFrames.get(times[i]) ?? activeControls
    const duration = time - times[i]
    const count = Math.ceil(duration / 5000)
    return Array.from({ length: count }, (_, index): Step => {
      const end = times[i] + Math.round(duration * (index + 1) / count)
      const start = times[i] + Math.round(duration * index / count)
      return { durationMs: end - start, holdMs: 0, controls: activeControls,
        parameters: Object.fromEntries([...tracks].map(([id, keys]) => [id, sample(keys, end)])) }
    })
  })
  const title = typeof plan.title === 'string' ? plan.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : ''
  return { ok: true, title: title || clip?.label || clip?.group || '会话动作', durationMs, steps,
    ...(clip ? { motion: { group: clip.group, index: clip.index } } : {}) }
}
