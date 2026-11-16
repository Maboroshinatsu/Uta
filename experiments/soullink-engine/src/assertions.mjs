export class ExperimentAssertionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ExperimentAssertionError'
  }
}

export function ensure(condition, message) {
  if (!condition) throw new ExperimentAssertionError(message)
}

export function assertFiniteParameters(params, label = 'params') {
  for (const [id, value] of Object.entries(params)) {
    ensure(typeof value === 'number' && Number.isFinite(value), `${label}.${id} is not finite: ${String(value)}`)
  }
}

export function assertWhitelist(params, whitelist, label = 'params') {
  for (const id of Object.keys(params)) {
    ensure(whitelist.has(id), `${label} contains a parameter outside the Uta whitelist: ${id}`)
  }
}

export function assertNoPhysics(params, whitelist, label = 'params') {
  for (const id of Object.keys(params)) {
    const entry = whitelist.get(id)
    ensure(entry !== undefined, `${label} contains an unknown parameter: ${id}`)
    ensure(entry.physicsOutput !== true, `${label} writes a physics-output parameter: ${id}`)
  }
}

export function assertWithinRanges(params, whitelist, label = 'params') {
  for (const [id, value] of Object.entries(params)) {
    const entry = whitelist.get(id)
    ensure(entry !== undefined, `${label} contains an unknown parameter: ${id}`)
    ensure(value >= entry.min && value <= entry.max, `${label}.${id}=${value} is outside [${entry.min}, ${entry.max}]`)
  }
}

export function assertNear(value, expected, tolerance, label) {
  ensure(Math.abs(value - expected) <= tolerance, `${label}: expected ${expected} +/- ${tolerance}, got ${value}`)
}

export function summarizeSeries(samples) {
  const summary = { frames: samples.length, parameters: {} }
  for (const sample of samples) {
    for (const [id, value] of Object.entries(sample.params ?? {})) {
      const entry = summary.parameters[id] ?? { min: value, max: value, first: value, last: value, sum: 0, count: 0 }
      entry.min = Math.min(entry.min, value)
      entry.max = Math.max(entry.max, value)
      entry.last = value
      entry.sum += value
      entry.count += 1
      summary.parameters[id] = entry
    }
  }
  for (const entry of Object.values(summary.parameters)) {
    entry.mean = entry.count === 0 ? null : entry.sum / entry.count
    delete entry.sum
  }
  return summary
}
