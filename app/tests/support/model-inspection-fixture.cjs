'use strict'
// Node-only test support for the real DS Core/resource sample.
// Renderer code must never import this file.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')

const TASK_ROOT = path.resolve(__dirname, '../../..')
const MODEL_ROOT = path.join(TASK_ROOT, '.uta-task', 'model-input')
const CORE_FILE = path.join(TASK_ROOT, 'app', 'src', 'renderer', 'public', 'live2dcubismcore.min.js')
const MANIFEST_FILE = path.join(MODEL_ROOT, 'baseline-manifest.json')
const REPORT_FILE = path.join(MODEL_ROOT, 'core-inspection.json')
const MAX_METADATA_BYTES = 8 * 1024 * 1024
const READY_TIMEOUT_MS = 5000
const RETRY_MS = 25

class FixtureUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FixtureUnavailableError'
  }
}

class FixtureIntegrityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FixtureIntegrityError'
  }
}

function fixtureAvailable() {
  return fs.existsSync(MANIFEST_FILE) && fs.existsSync(REPORT_FILE) && fs.existsSync(CORE_FILE)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeRelative(relative) {
  if (typeof relative !== 'string' || relative.trim() === '') {
    throw new FixtureIntegrityError('resource path must be a non-empty string')
  }
  const normalized = relative.replaceAll('\\', '/')
  if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new FixtureIntegrityError(`resource path escapes the sample root: ${relative}`)
  }
  return normalized
}

function resolveWithin(relative) {
  const normalized = normalizeRelative(relative)
  const absolute = path.resolve(MODEL_ROOT, normalized)
  let real
  try {
    real = fs.realpathSync(absolute)
  } catch {
    throw new FixtureIntegrityError(`missing resource: ${normalized}`)
  }
  const root = fs.realpathSync(MODEL_ROOT)
  const containing = path.relative(root, real)
  if (containing.startsWith('..') || path.isAbsolute(containing)) {
    throw new FixtureIntegrityError(`resource escapes the sample root: ${normalized}`)
  }
  if (!fs.statSync(real).isFile()) throw new FixtureIntegrityError(`resource is not a file: ${normalized}`)
  return real
}

function readFileWithin(relative, maxBytes = Number.POSITIVE_INFINITY) {
  const absolute = resolveWithin(relative)
  const stat = fs.statSync(absolute)
  if (Number.isFinite(maxBytes) && stat.size > maxBytes) {
    throw new FixtureIntegrityError(`resource exceeds ${maxBytes} bytes: ${relative}`)
  }
  return fs.readFileSync(absolute)
}

function readJsonWithin(relative) {
  const data = readFileWithin(relative, MAX_METADATA_BYTES)
  let json
  try {
    json = JSON.parse(data.toString('utf8'))
  } catch {
    throw new FixtureIntegrityError(`invalid JSON: ${relative}`)
  }
  return { json, bytes: data.length, sha256: sha256(data) }
}

function verifyManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) {
    throw new FixtureIntegrityError('baseline manifest schema is not 1')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new FixtureIntegrityError('baseline manifest has no files')
  }

  const filesByPath = new Map()
  let totalBytes = 0
  for (const entry of manifest.files) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.size !== 'number' || typeof entry.sha256 !== 'string') {
      throw new FixtureIntegrityError('baseline manifest has a malformed file entry')
    }
    const normalized = normalizeRelative(entry.path)
    if (filesByPath.has(normalized)) throw new FixtureIntegrityError(`duplicate manifest entry: ${normalized}`)
    const data = readFileWithin(normalized)
    if (data.length !== entry.size) throw new FixtureIntegrityError(`size mismatch: ${normalized}`)
    const digest = sha256(data)
    if (digest !== entry.sha256) throw new FixtureIntegrityError(`sha256 mismatch: ${normalized}`)
    filesByPath.set(normalized, { size: entry.size, sha256: digest })
    totalBytes += data.length
  }
  if (totalBytes !== manifest.totalBytes) {
    throw new FixtureIntegrityError('manifest totalBytes does not match the sample bytes')
  }
  const signature = sha256(JSON.stringify(
    manifest.files
      .filter((entry) => entry.path !== 'MODEL-NOTICE.txt')
      .map((entry) => [entry.path, entry.sha256]),
  ))
  if (signature !== manifest.contentSignature) {
    throw new FixtureIntegrityError('manifest contentSignature does not match the sample')
  }

  if (typeof manifest.model !== 'string' || !filesByPath.has(manifest.model)) {
    throw new FixtureIntegrityError('manifest model entry is missing')
  }
  const { json: model3 } = readJsonWithin(manifest.model)
  if (!isRecord(model3) || !isRecord(model3.FileReferences)) {
    throw new FixtureIntegrityError('model3 FileReferences is missing')
  }
  const refs = model3.FileReferences
  const declared = new Set()
  const addRef = (relative) => {
    const normalized = normalizeRelative(relative)
    declared.add(normalized)
  }
  addRef(manifest.model)
  addRef(refs.Moc)
  if (!Array.isArray(refs.Textures)) throw new FixtureIntegrityError('model3 Textures is missing')
  refs.Textures.forEach(addRef)
  addRef(refs.Physics)
  addRef(refs.DisplayInfo)
  addRef('MODEL-NOTICE.txt')

  const motionFiles = []
  if (refs.Motions !== undefined) {
    if (!isRecord(refs.Motions)) throw new FixtureIntegrityError('model3 Motions is not an object')
    for (const [group, entries] of Object.entries(refs.Motions)) {
      if (!Array.isArray(entries)) throw new FixtureIntegrityError(`motion group ${group} is not an array`)
      entries.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.File !== 'string') {
          throw new FixtureIntegrityError(`motion ${group}[${index}] has no file`)
        }
        addRef(entry.File)
        motionFiles.push({ group, index, file: entry.File })
      })
    }
  }
  if (!Array.isArray(refs.Expressions)) throw new FixtureIntegrityError('model3 Expressions is missing')
  refs.Expressions.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.Name !== 'string' || typeof entry.File !== 'string') {
      throw new FixtureIntegrityError(`expression ${index} has no name/file`)
    }
    addRef(entry.File)
  })

  const missingRefs = [...declared].filter((relative) => !filesByPath.has(relative))
  if (missingRefs.length > 0) throw new FixtureIntegrityError(`manifest misses references: ${missingRefs.join(', ')}`)
  const extraManifestFiles = [...filesByPath.keys()].filter((relative) => !declared.has(relative))
  if (extraManifestFiles.length > 0) throw new FixtureIntegrityError(`manifest has extra files: ${extraManifestFiles.join(', ')}`)

  const declaredExpressions = refs.Expressions.length
  const declaredMotionCount = motionFiles.length
  const declaredMotionGroups = refs.Motions === undefined ? 0 : Object.keys(refs.Motions).length
  if (manifest.declaredExpressions !== declaredExpressions
    || manifest.declaredMotionCount !== declaredMotionCount
    || manifest.declaredMotionGroups !== declaredMotionGroups) {
    throw new FixtureIntegrityError('manifest declared expression/motion counts do not match model3')
  }

  const noticeBytes = readFileWithin('MODEL-NOTICE.txt')
  return {
    manifest,
    model3,
    refs,
    motionFiles,
    filesByPath,
    totalBytes,
    signature,
    declaredExpressions,
    declaredMotionCount,
    declaredMotionGroups,
    notice: { text: noticeBytes.toString('utf8'), hash: sha256(noticeBytes), bytes: noticeBytes.length },
    integrity: {
      files: manifest.files.length,
      totalBytes,
      signature,
      signatureOk: signature === manifest.contentSignature,
      missingRefs,
      extraManifestFiles,
    },
  }
}

function readResources(verified) {
  const { refs } = verified
  const cdi = readJsonWithin(refs.DisplayInfo).json
  const physics = readJsonWithin(refs.Physics).json

  const expressions = refs.Expressions.map((entry, index) => ({
    name: entry.Name,
    json: readJsonWithin(entry.File).json,
  }))
  const motions = verified.motionFiles.map((entry) => ({
    group: entry.group,
    index: entry.index,
    json: readJsonWithin(entry.file).json,
  }))

  if (!isRecord(cdi) || !Array.isArray(cdi.Parameters)) {
    throw new FixtureIntegrityError('cdi Parameters is missing')
  }
  const labels = new Map()
  const cdiIds = new Set()
  for (const [index, parameter] of cdi.Parameters.entries()) {
    if (!isRecord(parameter) || typeof parameter.Id !== 'string' || typeof parameter.Name !== 'string') {
      throw new FixtureIntegrityError(`cdi parameter ${index} is malformed`)
    }
    if (!parameter.Id.trim()) throw new FixtureIntegrityError(`cdi parameter ${index} has an empty id`)
    if (cdiIds.has(parameter.Id)) throw new FixtureIntegrityError(`cdi parameter ${parameter.Id} is duplicated`)
    cdiIds.add(parameter.Id)
    if (parameter.Name.trim() !== '') labels.set(parameter.Id, parameter.Name)
  }

  if (!isRecord(physics) || !Array.isArray(physics.PhysicsSettings)) {
    throw new FixtureIntegrityError('physics PhysicsSettings is missing')
  }
  const physicsParameterIds = new Set()
  const destinationShapes = { object: 0, array: 0 }
  let destinationCount = 0
  for (const setting of physics.PhysicsSettings) {
    if (!isRecord(setting) || !Array.isArray(setting.Output)) {
      throw new FixtureIntegrityError('physics setting/Output is malformed')
    }
    for (const output of setting.Output) {
      if (!isRecord(output) || output.Destination === null || typeof output.Destination !== 'object') {
        throw new FixtureIntegrityError('physics Destination is malformed')
      }
      const destinations = Array.isArray(output.Destination) ? output.Destination : [output.Destination]
      destinationShapes[Array.isArray(output.Destination) ? 'array' : 'object'] += 1
      destinations.forEach((destination) => {
        if (!isRecord(destination) || typeof destination.Target !== 'string' || typeof destination.Id !== 'string') {
          throw new FixtureIntegrityError('physics destination entry is malformed')
        }
        destinationCount += 1
        if (destination.Target === 'Parameter') physicsParameterIds.add(destination.Id)
      })
    }
  }

  const expectedExpressions = []
  const blendCounts = { Add: 0, Multiply: 0, Overwrite: 0 }
  for (const expression of expressions) {
    if (!isRecord(expression.json) || !Array.isArray(expression.json.Parameters)) {
      throw new FixtureIntegrityError(`expression ${expression.name} has no Parameters`)
    }
    const parameters = expression.json.Parameters.map((parameter, index) => {
      if (!isRecord(parameter) || typeof parameter.Id !== 'string' || typeof parameter.Value !== 'number'
        || !Number.isFinite(parameter.Value) || typeof parameter.Blend !== 'string'
        || !Object.prototype.hasOwnProperty.call(blendCounts, parameter.Blend)) {
        throw new FixtureIntegrityError(`expression ${expression.name} parameter ${index} is malformed`)
      }
      blendCounts[parameter.Blend] += 1
      return { id: parameter.Id, value: parameter.Value, blend: parameter.Blend }
    })
    expectedExpressions.push({ name: expression.name, parameters })
  }

  const expectedMotions = []
  const curveTargetCounts = {}
  for (const motion of motions) {
    if (!isRecord(motion.json) || !Array.isArray(motion.json.Curves)) {
      throw new FixtureIntegrityError(`motion ${motion.group}#${motion.index} has no Curves`)
    }
    const curveTargets = {
      Parameter: { curveCount: 0, targetIds: [] },
      Model: { curveCount: 0, targetIds: [] },
      PartOpacity: { curveCount: 0, targetIds: [] },
    }
    const seen = { Parameter: new Set(), Model: new Set(), PartOpacity: new Set() }
    for (const [index, curve] of motion.json.Curves.entries()) {
      if (!isRecord(curve) || typeof curve.Target !== 'string' || typeof curve.Id !== 'string' || !curve.Id.trim()) {
        throw new FixtureIntegrityError(`motion ${motion.group}#${motion.index} curve ${index} is malformed`)
      }
      curveTargetCounts[curve.Target] = (curveTargetCounts[curve.Target] || 0) + 1
      if (Object.prototype.hasOwnProperty.call(curveTargets, curve.Target)) {
        curveTargets[curve.Target].curveCount += 1
        if (!seen[curve.Target].has(curve.Id)) {
          seen[curve.Target].add(curve.Id)
          curveTargets[curve.Target].targetIds.push(curve.Id)
        }
      }
    }
    const meta = isRecord(motion.json.Meta) ? motion.json.Meta : {}
    expectedMotions.push({
      group: motion.group,
      index: motion.index,
      parameterIds: [...curveTargets.Parameter.targetIds],
      durationMs: typeof meta.Duration === 'number' && Number.isFinite(meta.Duration)
        ? Math.round(meta.Duration * 1000)
        : null,
      loop: typeof meta.Loop === 'boolean' ? meta.Loop : null,
      curveTargets,
    })
  }

  return {
    metadata: { cdi, physics, expressions, motions },
    expected: {
      expressions: expectedExpressions,
      motions: expectedMotions,
      labels,
      physicsParameterIds,
      blendCounts,
      curveTargetCounts,
    },
    counts: {
      cdiParameters: cdi.Parameters.length,
      expressionFiles: expressions.length,
      motionFiles: motions.length,
      motionGroups: verified.declaredMotionGroups,
      physicsSettings: physics.PhysicsSettings.length,
      physicsDestinations: destinationCount,
      destinationShapes,
    },
  }
}

function readCoreReport() {
  const report = readJsonWithin('core-inspection.json').json
  if (!isRecord(report) || !Array.isArray(report.parameters)) {
    throw new FixtureIntegrityError('core-inspection.json is malformed')
  }
  return report
}

async function loadCore(mocRelative) {
  const source = fs.readFileSync(CORE_FILE, 'utf8')
  const logs = []
  const consoleProxy = {
    log() {},
    info() {},
    warn() {},
    error(...args) {
      logs.push(args.map((value) => String(value)).join(' '))
    },
  }
  const scope = {
    console: consoleProxy,
    Buffer,
    setTimeout,
    clearTimeout,
    process,
    require,
    __dirname: path.dirname(CORE_FILE),
    __filename: CORE_FILE,
    module: { exports: {} },
    exports: {},
  }
  try {
    vm.runInNewContext(source, scope, { filename: CORE_FILE, timeout: 10000 })
  } catch (error) {
    throw new FixtureIntegrityError(`Core library failed to load: ${error.message}`)
  }

  const core = scope.Live2DCubismCore
  const mocBytes = readFileWithin(mocRelative)
  const mocBuffer = mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength)

  let moc = null
  let mocAttempts = 0
  let lastMocError = ''
  const mocStart = Date.now()
  while (Date.now() - mocStart < READY_TIMEOUT_MS && moc === null) {
    mocAttempts += 1
    try {
      moc = core && core.Moc && typeof core.Moc.fromArrayBuffer === 'function'
        ? core.Moc.fromArrayBuffer(mocBuffer)
        : null
      if (!moc) lastMocError = 'Moc API not ready'
    } catch (error) {
      lastMocError = error.message
    }
    if (!moc) await sleep(RETRY_MS)
  }
  const mocMs = Date.now() - mocStart
  if (!moc) {
    throw new FixtureIntegrityError(`real Core MOC not ready within ${READY_TIMEOUT_MS}ms: ${lastMocError}`)
  }

  let model = null
  let modelAttempts = 0
  let lastModelError = ''
  const modelStart = Date.now()
  while (Date.now() - modelStart < READY_TIMEOUT_MS && model === null) {
    modelAttempts += 1
    try {
      model = core && core.Model && typeof core.Model.fromMoc === 'function'
        ? core.Model.fromMoc(moc)
        : null
      if (!model) lastModelError = 'Model API not ready'
    } catch (error) {
      lastModelError = error.message
    }
    if (!model) await sleep(RETRY_MS)
  }
  const modelMs = Date.now() - modelStart
  if (!model) {
    try { moc._release?.() } catch {}
    throw new FixtureIntegrityError(`real Core model not ready within ${READY_TIMEOUT_MS}ms: ${lastModelError}`)
  }

  let released = false
  const release = () => {
    if (released) return
    released = true
    try { model.release?.() } catch {}
    try { moc._release?.() } catch {}
  }

  try {
    const parameters = model.parameters
    const count = parameters.count
    const liveView = {
      parameters: {
        count,
        ids: parameters.ids,
        minimumValues: parameters.minimumValues,
        maximumValues: parameters.maximumValues,
        defaultValues: parameters.defaultValues,
      },
    }
    const parametersSnapshot = Array.from({ length: count }, (_, index) => ({
      id: parameters.ids[index],
      min: parameters.minimumValues[index],
      max: parameters.maximumValues[index],
      defaultValue: parameters.defaultValues[index],
    }))
    let version = null
    try { version = core.Version.csmGetVersion() } catch {}
    return {
      liveView,
      parameters: parametersSnapshot,
      parts: model.parts.count,
      drawables: model.drawables.count,
      version,
      readiness: { mocAttempts, mocMs, modelAttempts, modelMs, readyTimeoutMs: READY_TIMEOUT_MS, retryMs: RETRY_MS },
      logs,
      release,
      isReleased: () => released,
    }
  } catch (error) {
    release()
    throw error
  }
}

function compareCoreToReport(parameters, parts, drawables, version, report) {
  const mismatches = []
  if (parameters.length !== report.parameters.length) {
    mismatches.push({ field: 'count', actual: parameters.length, expected: report.parameters.length })
  }
  for (let index = 0; index < Math.min(parameters.length, report.parameters.length); index += 1) {
    for (const key of ['id', 'min', 'max', 'defaultValue']) {
      if (parameters[index][key] !== report.parameters[index][key]) {
        mismatches.push({ index, field: key, actual: parameters[index][key], expected: report.parameters[index][key] })
      }
    }
  }
  return {
    count: parameters.length,
    reportCount: report.parameters.length,
    parts,
    reportParts: report.partsCount,
    drawables,
    reportDrawables: report.drawableCount,
    version,
    reportVersion: report.coreVersion,
    mismatches,
    matches: mismatches.length === 0
      && parts === report.partsCount
      && drawables === report.drawableCount
      && version === report.coreVersion,
  }
}

async function loadRealFixture() {
  if (!fixtureAvailable()) {
    throw new FixtureUnavailableError('task-local .uta-task/model-input is not available')
  }
  const verified = verifyManifest()
  const resources = readResources(verified)
  const report = readCoreReport()
  const core = await loadCore(verified.refs.Moc)
  let coreReport
  try {
    coreReport = compareCoreToReport(core.parameters, core.parts, core.drawables, core.version, report)
  } catch (error) {
    core.release()
    throw error
  }

  const lipSyncGroup = Array.isArray(verified.model3.Groups)
    ? verified.model3.Groups.find((group) => isRecord(group) && group.Name === 'LipSync')?.Ids ?? null
    : null

  return {
    request: {
      modelSignature: verified.manifest.contentSignature,
      metadata: resources.metadata,
      overrides: [],
    },
    liveView: core.liveView,
    expected: {
      ...resources.expected,
      parameters: report.parameters,
    },
    counts: resources.counts,
    coreReport,
    readiness: core.readiness,
    coreLogs: core.logs,
    manifest: {
      model: verified.manifest.model,
      contentSignature: verified.manifest.contentSignature,
      totalBytes: verified.manifest.totalBytes,
      license: verified.manifest.license,
      licenseUrl: verified.manifest.licenseUrl,
      declaredExpressions: verified.manifest.declaredExpressions,
      declaredMotionGroups: verified.manifest.declaredMotionGroups,
      declaredMotionCount: verified.manifest.declaredMotionCount,
      lipSyncGroup: verified.manifest.lipSyncGroup,
    },
    lipSyncGroup,
    notice: verified.notice,
    integrity: verified.integrity,
    release: core.release,
    isReleased: core.isReleased,
  }
}

module.exports = {
  fixtureAvailable,
  loadRealFixture,
  FixtureUnavailableError,
  FixtureIntegrityError,
  MAX_METADATA_BYTES,
  READY_TIMEOUT_MS,
}
