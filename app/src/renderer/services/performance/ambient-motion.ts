import type { AmbientPerformanceState } from '../../../shared/model-performance-contracts'

/**
 * 日常微动作的纯计算层：只产出语义偏移，不读模型、不写 Core。
 *
 * 目标是“像有人在后面呼吸和看东西”，而不是循环播放同一段关键帧：
 * - 多频段平滑噪声做缓慢重心与头部游移，没有固定周期；
 * - 视线目标按种子随机转移并停顿，头和眼之间保留跟随滞后；
 * - 点头/歪头是低频偶发事件，有冷却，不与语音重音叠加；
 * - 眨眼与呼吸完全留给模型原生系统，这里不产生眼睑开合曲线。
 */
export interface AmbientMotionFrame {
  state: AmbientPerformanceState
  /** 语义偏移（约 -1..1），叠加在原生姿态上。 */
  headX: number
  headY: number
  headZ: number
  bodyX: number
  bodyZ: number
  gazeX: number
  gazeY: number
  /** 眼睑乘数：1 保留原生开合，<1 为轻微眯眼。 */
  eyeOpen: number
  mouthForm: number
  browLeft: number
  browRight: number
  /** 当前头部重音的纵向分量，供诊断显示。 */
  accent: number
}

export interface AmbientMotionEngine {
  /** 同一个状态重复设置不会重置相位或计时。 */
  setState(state: AmbientPerformanceState, now: number): void
  /** 真实播放电平；只在说话状态下影响嘴形与稀疏重音。 */
  setSpeechLevel(level: number, now: number): void
  step(now: number): AmbientMotionFrame
  reset(): void
}

interface StateProfile {
  headX: number
  headY: number
  headZ: number
  gazeX: number
  gazeY: number
  eyeOpen: number
  mouthForm: number
  browLeft: number
  browRight: number
  /** 头部游移幅度（语义单位）。 */
  wander: number
  /** 视线微动幅度。 */
  gazeWander: number
  /** 是否允许偶发点头/歪头。 */
  accents: boolean
}

const PROFILES: Record<AmbientPerformanceState, StateProfile> = {
  idle: {
    headX: 0, headY: 0, headZ: 0,
    gazeX: 0, gazeY: 0.02,
    eyeOpen: 1, mouthForm: 0.12, browLeft: 0, browRight: 0,
    wander: 0.088, gazeWander: 0.045, accents: true,
  },
  thinking: {
    headX: 0.10, headY: -0.03, headZ: -0.05,
    gazeX: -0.06, gazeY: 0.22,
    eyeOpen: 0.90, mouthForm: -0.06, browLeft: -0.03, browRight: -0.03,
    wander: 0.048, gazeWander: 0.035, accents: true,
  },
  working: {
    headX: -0.08, headY: 0.01, headZ: 0.04,
    gazeX: 0.18, gazeY: -0.25,
    eyeOpen: 0.95, mouthForm: -0.02, browLeft: 0.02, browRight: 0.02,
    wander: 0.042, gazeWander: 0.03, accents: true,
  },
  speaking: {
    headX: 0.02, headY: 0, headZ: -0.01,
    gazeX: 0, gazeY: 0.05,
    eyeOpen: 1, mouthForm: 0.16, browLeft: 0.02, browRight: 0.02,
    wander: 0.045, gazeWander: 0.04, accents: false,
  },
  waiting: {
    headX: 0.05, headY: 0.02, headZ: 0.01,
    gazeX: 0.03, gazeY: 0.08,
    eyeOpen: 0.97, mouthForm: 0.02, browLeft: 0.01, browRight: 0.01,
    wander: 0.024, gazeWander: 0.025, accents: false,
  },
  error: {
    headX: -0.03, headY: -0.09, headZ: -0.03,
    gazeX: -0.07, gazeY: -0.18,
    eyeOpen: 0.88, mouthForm: -0.22, browLeft: -0.1, browRight: -0.1,
    wander: 0.025, gazeWander: 0.02, accents: false,
  },
  completed: {
    headX: 0.01, headY: 0.05, headZ: 0.04,
    gazeX: 0, gazeY: 0.12,
    eyeOpen: 1, mouthForm: 0.22, browLeft: 0.05, browRight: 0.05,
    wander: 0.045, gazeWander: 0.03, accents: true,
  },
}

/** 每个通道自己的阻尼时间，单位毫秒。 */
const TAU = {
  pose: 850,
  eye: 900,
  mouth: 420,
  brow: 700,
  gazeBase: 600,
  gazeSaccade: 100,
  headFollow: 460,
} as const

const NOD_ATTACK_MS = 220
const NOD_HOLD_MS = 150
const NOD_RELEASE_MS = 520
const NOD_TOTAL_MS = NOD_ATTACK_MS + NOD_HOLD_MS + NOD_RELEASE_MS
const SPEECH_ACCENT_MS = 720
const SPEECH_ACCENT_MIN_GAP_MS = 1500
const SPEECH_QUIET_MS = 420

const GAZE_PATTERNS: Record<AmbientPerformanceState, ReadonlyArray<readonly [number, number]>> = {
  idle: [[-0.05, 0.02], [0.06, 0.01], [0.02, 0.08], [-0.03, -0.02], [0, 0.02]],
  thinking: [[-0.08, 0.06], [-0.03, 0.12], [0.05, 0.08], [0, 0.04]],
  working: [[0.08, -0.09], [0.04, -0.05], [-0.04, -0.03], [0.02, -0.07]],
  speaking: [[0, 0.03], [0.04, 0.02], [-0.04, 0.04], [0, 0.05]],
  waiting: [[0.02, 0.06], [-0.03, 0.04], [0.04, 0.07]],
  error: [[-0.05, -0.06], [-0.02, -0.03], [0.02, -0.05]],
  completed: [[0, 0.05], [0.04, 0.06], [-0.03, 0.03]],
}

export function ambientSeedFromSignature(signature: string | null | undefined): number {
  let hash = 2166136261
  const text = typeof signature === 'string' ? signature : ''
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function damp(current: number, target: number, dtMs: number, tauMs: number): number {
  if (!(dtMs > 0)) return current
  const k = 1 - Math.exp(-dtMs / Math.max(1, tauMs))
  return current + (target - current) * k
}

function hashAt(seed: number, index: number): number {
  let value = Math.imul(index ^ seed, 0x27d4eb2d)
  value ^= value >>> 15
  value = Math.imul(value, 0x85ebca6b)
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2ae35)
  value ^= value >>> 16
  return (value >>> 0) / 0xffffffff
}

/** 一维平滑值噪声，返回 [-1, 1]。 */
function valueNoise(seed: number, x: number): number {
  const base = Math.floor(x)
  const fraction = x - base
  const eased = smoothstep(fraction)
  const a = hashAt(seed, base) * 2 - 1
  const b = hashAt(seed, base + 1) * 2 - 1
  return a + (b - a) * eased
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
}

interface AccentPulse {
  kind: 'nod' | 'speech'
  at: number
  ampX: number
  ampY: number
  ampZ: number
  duration: number
}

function accentEnvelope(pulse: AccentPulse, now: number): number {
  const elapsed = now - pulse.at
  if (!(elapsed >= 0) || elapsed >= pulse.duration) return 0
  if (pulse.kind === 'speech') {
    return 1 - smoothstep(elapsed / pulse.duration)
  }
  if (elapsed < NOD_ATTACK_MS) return smoothstep(elapsed / NOD_ATTACK_MS)
  if (elapsed < NOD_ATTACK_MS + NOD_HOLD_MS) return 1
  return 1 - smoothstep((elapsed - NOD_ATTACK_MS - NOD_HOLD_MS) / NOD_RELEASE_MS)
}

export function createAmbientMotion(seed = 0x1a2b3c4d): AmbientMotionEngine {
  const random = createRandom(seed)
  const noiseSeed = seed ^ 0x9e3779b9

  let state: AmbientPerformanceState = 'idle'
  let stateSince = 0
  let lastAt = -1
  let started = false

  let poseX = PROFILES.idle.headX
  let poseY = PROFILES.idle.headY
  let poseZ = PROFILES.idle.headZ
  let eyeOpen = PROFILES.idle.eyeOpen
  let mouthForm = PROFILES.idle.mouthForm
  let browLeft = PROFILES.idle.browLeft
  let browRight = PROFILES.idle.browRight
  let gazeBaseX = PROFILES.idle.gazeX
  let gazeBaseY = PROFILES.idle.gazeY

  let gazeTargetX = 0
  let gazeTargetY = 0
  let gazeX = 0
  let gazeY = 0
  let headFollowX = 0
  let headFollowY = 0
  let nextGazeAt = 0

  let pulse: AccentPulse | null = null
  let nextAccentAt = 0

  let speechLevel = 0
  let previousSpeechLevel = 0
  let lastQuietAt = 0
  let lastSpeechAccentAt = -Infinity

  let cached: AmbientMotionFrame | null = null
  let cachedAt = -1

  function scheduleGaze(now: number): void {
    const patterns = GAZE_PATTERNS[state]
    const center = random() < 0.28
    const pattern = patterns[Math.floor(random() * patterns.length)] ?? [0, 0]
    gazeTargetX = center ? 0 : pattern[0]
    gazeTargetY = center ? 0 : pattern[1]
    nextGazeAt = now + 2400 + random() * 4200
  }

  function scheduleAccent(now: number): void {
    nextAccentAt = now + 5200 + random() * 9000
  }

  function setState(next: AmbientPerformanceState, now: number): void {
    const at = finite(now)
    if (next === state && started) return
    const previous = state
    state = next
    stateSince = at
    if (!started) {
      started = true
      lastAt = at
      nextGazeAt = at + 700 + random() * 900
      scheduleAccent(at)
      return
    }
    if (previous !== next) {
      // 状态切换只换目标，不重置当前姿态；阻尼会在几百毫秒内接上。
      nextGazeAt = Math.min(nextGazeAt, at + 900 + random() * 1400)
      scheduleAccent(at)
    }
  }

  function setSpeechLevel(level: number, now: number): void {
    const at = finite(now)
    const next = clamp(finite(level), 0, 1)
    if (next < 0.06) lastQuietAt = at
    if (
      next > 0.32 &&
      previousSpeechLevel <= 0.32 &&
      at - lastQuietAt > SPEECH_QUIET_MS &&
      at - lastSpeechAccentAt > SPEECH_ACCENT_MIN_GAP_MS &&
      (!pulse || pulse.kind !== 'nod' || at - pulse.at > NOD_TOTAL_MS * 0.6)
    ) {
      lastSpeechAccentAt = at
      pulse = {
        kind: 'speech',
        at,
        ampX: (random() < 0.5 ? -1 : 1) * 0.008,
        ampY: (random() < 0.5 ? -1 : 1) * 0.028,
        ampZ: (random() < 0.5 ? -1 : 1) * 0.016,
        duration: SPEECH_ACCENT_MS,
      }
    }
    previousSpeechLevel = next
    speechLevel = next
  }

  function step(now: number): AmbientMotionFrame {
    const at = finite(now)
    if (cached && cachedAt === at) return cached
    if (!started) setState('idle', at)
    let dt = lastAt < 0 ? 0 : at - lastAt
    if (!(dt >= 0)) dt = 0
    dt = Math.min(dt, 50)
    lastAt = at
    if (!(at >= stateSince)) stateSince = at

    const profile = PROFILES[state]
    const level = state === 'speaking' ? speechLevel : 0

    poseX = damp(poseX, profile.headX, dt, TAU.pose)
    poseY = damp(poseY, profile.headY, dt, TAU.pose)
    poseZ = damp(poseZ, profile.headZ, dt, TAU.pose)
    eyeOpen = damp(eyeOpen, profile.eyeOpen, dt, TAU.eye)
    mouthForm = damp(mouthForm, profile.mouthForm + level * 0.075, dt, TAU.mouth)
    browLeft = damp(browLeft, profile.browLeft + level * 0.02, dt, TAU.brow)
    browRight = damp(browRight, profile.browRight + level * 0.02, dt, TAU.brow)
    gazeBaseX = damp(gazeBaseX, profile.gazeX, dt, TAU.gazeBase)
    gazeBaseY = damp(gazeBaseY, profile.gazeY, dt, TAU.gazeBase)

    if (at >= nextGazeAt) scheduleGaze(at)
    gazeTargetX = clamp(gazeTargetX, -0.11, 0.11)
    gazeTargetY = clamp(gazeTargetY, -0.12, 0.12)
    gazeX = damp(gazeX, gazeTargetX, dt, TAU.gazeSaccade)
    gazeY = damp(gazeY, gazeTargetY, dt, TAU.gazeSaccade)
    headFollowX = damp(headFollowX, gazeX, dt, TAU.headFollow)
    headFollowY = damp(headFollowY, gazeY, dt, TAU.headFollow)

    if (!pulse && profile.accents && at >= nextAccentAt) {
      const side = random() < 0.5 ? -1 : 1
      pulse = {
        kind: 'nod',
        at,
        ampX: side * (0.012 + random() * 0.014),
        ampY: side * (0.035 + random() * 0.025),
        ampZ: side * (0.022 + random() * 0.02),
        duration: NOD_TOTAL_MS,
      }
      scheduleAccent(at)
    }
    let accentAmount = 0
    if (pulse) {
      accentAmount = accentEnvelope(pulse, at)
      if (accentAmount <= 0 && at - pulse.at >= pulse.duration) pulse = null
    }

    const slow = valueNoise(noiseSeed, at / 4200 + 0.37)
    const medium = valueNoise(noiseSeed ^ 0x51ed270b, at / 7300 + 1.71)
    const fast = valueNoise(noiseSeed ^ 0x2545f491, at / 11700 + 3.13)
    const wanderX = (slow * 0.6 + medium * 0.3 + fast * 0.1) * profile.wander
    const wanderY = (medium * 0.55 + slow * 0.25 + fast * 0.2) * profile.wander * 0.62
    const wanderZ = (fast * 0.5 + slow * 0.3 + medium * 0.2) * profile.wander * 0.48
    const gazeDriftX = valueNoise(noiseSeed ^ 0x68e31da4, at / 3700) * profile.gazeWander * 0.16
    const gazeDriftY = valueNoise(noiseSeed ^ 0xb5297a4d, at / 4300) * profile.gazeWander * 0.14

    const accentX = pulse ? pulse.ampX * accentAmount : 0
    const accentY = pulse ? pulse.ampY * accentAmount : 0
    const accentZ = pulse ? pulse.ampZ * accentAmount : 0

    const frame: AmbientMotionFrame = {
      state,
      headX: clamp(poseX + wanderX + headFollowX * 0.045 + accentX, -0.26, 0.26),
      headY: clamp(poseY + wanderY + headFollowY * 0.02 + accentY, -0.24, 0.24),
      headZ: clamp(poseZ + wanderZ + accentZ, -0.22, 0.22),
      bodyX: clamp((poseX + wanderX + headFollowX * 0.045) * 0.22, -0.12, 0.12),
      bodyZ: clamp((poseZ + wanderZ) * 0.32, -0.12, 0.12),
      gazeX: clamp(gazeBaseX + gazeX + gazeDriftX, -0.2, 0.2),
      gazeY: clamp(gazeBaseY + gazeY + gazeDriftY, -0.22, 0.22),
      eyeOpen: clamp(eyeOpen, 0.72, 1.08),
      mouthForm: clamp(mouthForm, -0.34, 0.36),
      browLeft: clamp(browLeft, -0.2, 0.2),
      browRight: clamp(browRight, -0.2, 0.2),
      accent: accentY,
    }
    cached = frame
    cachedAt = at
    return frame
  }

  function reset(): void {
    const profile = PROFILES.idle
    state = 'idle'
    stateSince = 0
    lastAt = -1
    started = false
    poseX = profile.headX
    poseY = profile.headY
    poseZ = profile.headZ
    eyeOpen = profile.eyeOpen
    mouthForm = profile.mouthForm
    browLeft = profile.browLeft
    browRight = profile.browRight
    gazeBaseX = profile.gazeX
    gazeBaseY = profile.gazeY
    gazeTargetX = 0
    gazeTargetY = 0
    gazeX = 0
    gazeY = 0
    headFollowX = 0
    headFollowY = 0
    nextGazeAt = 0
    pulse = null
    nextAccentAt = 0
    speechLevel = 0
    previousSpeechLevel = 0
    lastQuietAt = 0
    lastSpeechAccentAt = -Infinity
    cached = null
    cachedAt = -1
  }

  return { setState, setSpeechLevel, step, reset }
}
