import os from 'node:os'
import { createIntent } from '../fixtures/capability-profiles.mjs'
import { createUtaSoullinkSession } from './driver.mjs'

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function quantile(sorted, fraction) {
  if (sorted.length === 0) return Number.NaN
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

export function summarizeDurations(durationsMs) {
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    samples: sorted.length,
    meanMs: round(total / sorted.length),
    medianMs: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    p99Ms: round(quantile(sorted, 0.99)),
    maxMs: round(sorted[sorted.length - 1]),
  }
}

class LinearBaseline {
  constructor(whitelist, neutralParams) {
    this.entries = [...whitelist.entries()].map(([id, parameter], index) => ({
      id,
      min: parameter.min,
      max: parameter.max,
      neutral: neutralParams[id] ?? parameter.defaultValue,
      span: parameter.max - parameter.min,
      index,
    }))
    this.current = Object.fromEntries(this.entries.map((entry) => [entry.id, entry.neutral]))
    this.time = 0
    this.factorSpeed = 14
  }

  reset() {
    this.current = Object.fromEntries(this.entries.map((entry) => [entry.id, entry.neutral]))
    this.time = 0
  }

  update(deltaSeconds) {
    const factor = 1 - Math.exp(-this.factorSpeed * Math.max(0, deltaSeconds))
    for (const entry of this.entries) {
      const target = Math.min(
        entry.max,
        Math.max(entry.min, entry.neutral + Math.sin(this.time * 0.7 + entry.index * 1.3) * entry.span * 0.25),
      )
      this.current[entry.id] += (target - this.current[entry.id]) * factor
    }
    this.time += deltaSeconds
    return this.current
  }

  snapshot() {
    return { ...this.current }
  }
}

function measureEngine(api, capabilityProfile, options) {
  const session = createUtaSoullinkSession(api, capabilityProfile, {
    seed: options.seed,
    releaseSeconds: 0.18,
    emotionPersonality: options.emotionPersonality,
  })
  try {
    session.trigger(createIntent('happy', 0.85), 0)
    let time = 0
    const dt = 1 / 60
    for (let frame = 0; frame < options.warmupFrames; frame += 1) {
      session.update(time, dt)
      time += dt
    }

    const durations = []
    const batchMedians = []
    const heapBefore = process.memoryUsage()
    for (let batch = 0; batch < options.batches; batch += 1) {
      session.trigger(createIntent('happy', 0.85), time)
      const batchDurations = []
      for (let frame = 0; frame < options.framesPerBatch; frame += 1) {
        const startedAt = process.hrtime.bigint()
        session.update(time, dt)
        const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e6
        durations.push(elapsed)
        batchDurations.push(elapsed)
        time += dt
      }
      batchDurations.sort((a, b) => a - b)
      batchMedians.push(round(quantile(batchDurations, 0.5)))
    }
    const heapAfter = process.memoryUsage()

    let paramCount = 0
    let bytes = 0
    let frames = 0
    for (let frame = 0; frame < 300; frame += 1) {
      const result = session.update(time, dt)
      paramCount += Object.keys(result.params).length
      bytes += Buffer.byteLength(JSON.stringify(result.params))
      frames += 1
      time += dt
    }
    const diagnostics = session.getDiagnostics()
    return {
      timing: summarizeDurations(durations),
      batchMedians,
      output: {
        averageParameterCount: round(paramCount / frames, 2),
        averageJsonBytes: round(bytes / frames, 2),
        whitelistSize: session.bridge.whitelist.size,
        counters: diagnostics.counters,
      },
      heapDeltaApproxBytes: {
        rss: heapAfter.rss - heapBefore.rss,
        heapUsed: heapAfter.heapUsed - heapBefore.heapUsed,
        note: 'Approximate only; JIT, GC and logging affect this delta. Not an allocation guarantee.',
      },
    }
  } finally {
    session.dispose()
  }
}

function measureBaseline(whitelist, neutralParams, options) {
  const baseline = new LinearBaseline(whitelist, neutralParams)
  const dt = 1 / 60
  for (let frame = 0; frame < options.warmupFrames; frame += 1) baseline.update(dt)
  const durations = []
  const batchMedians = []
  for (let batch = 0; batch < options.batches; batch += 1) {
    baseline.reset()
    const batchDurations = []
    for (let frame = 0; frame < options.framesPerBatch; frame += 1) {
      const startedAt = process.hrtime.bigint()
      baseline.update(dt)
      const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e6
      durations.push(elapsed)
      batchDurations.push(elapsed)
    }
    batchDurations.sort((a, b) => a - b)
    batchMedians.push(round(quantile(batchDurations, 0.5)))
  }
  let paramCount = 0
  let bytes = 0
  for (let frame = 0; frame < 300; frame += 1) {
    const params = baseline.update(dt)
    paramCount += Object.keys(params).length
    bytes += Buffer.byteLength(JSON.stringify(params))
  }
  return {
    timing: summarizeDurations(durations),
    batchMedians,
    output: {
      averageParameterCount: round(paramCount / 300, 2),
      averageJsonBytes: round(bytes / 300, 2),
      whitelistSize: whitelist.size,
    },
  }
}

export function runCpuBaseline(api, capabilityProfile, options = {}) {
  const settings = {
    warmupFrames: options.warmupFrames ?? 1000,
    batches: options.batches ?? 5,
    framesPerBatch: options.framesPerBatch ?? 2000,
    seed: options.seed ?? 20261029,
    emotionPersonality: options.emotionPersonality ?? {
      emotionHoldSeconds: 1,
      decayRate: 0.32,
      targetApproachRate: 2.2,
      ambientDriftStrength: 0,
    },
  }
  const engine = measureEngine(api, capabilityProfile, settings)
  const baselineSession = createUtaSoullinkSession(api, capabilityProfile, { seed: settings.seed })
  let whitelist
  let neutralParams
  try {
    whitelist = baselineSession.bridge.whitelist
    neutralParams = baselineSession.bridge.diagnostics.neutralParams
  } finally {
    baselineSession.dispose()
  }
  const baseline = measureBaseline(whitelist, neutralParams, settings)
  return {
    method: {
      warmupFrames: settings.warmupFrames,
      batches: settings.batches,
      framesPerBatch: settings.framesPerBatch,
      totalTimedFrames: settings.batches * settings.framesPerBatch,
      dtSeconds: 1 / 60,
      clock: 'process.hrtime.bigint around a single session.update call',
      baseline: 'Uta-owned minimal linear exponential smoothing over the same whitelist count; not a full director',
      caveat: 'Single-process local measurement without CPU pinning or GC control. Report only, not a performance guarantee.',
    },
    engine,
    baseline,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCores: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
  }
}
