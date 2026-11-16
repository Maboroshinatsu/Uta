import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  APP_ROOT,
  MODEL_INPUT,
  UTA_ADAPTER_BUNDLE,
} from '../scripts/lib/paths.mjs'

export async function loadRealCapabilityProfile() {
  if (!fs.existsSync(MODEL_INPUT)) {
    return { available: false, reason: 'task-local .uta-task/model-input is missing' }
  }
  if (!fs.existsSync(UTA_ADAPTER_BUNDLE)) {
    return { available: false, reason: 'Uta adapter bundle is missing; run build-engine.mjs first' }
  }
  const require = createRequire(import.meta.url)
  const fixture = require(path.join(APP_ROOT, 'tests', 'support', 'model-inspection-fixture.cjs'))
  if (!fixture.fixtureAvailable()) {
    return { available: false, reason: 'real DS fixture is not available' }
  }
  const adapter = await import(pathToFileURL(UTA_ADAPTER_BUNDLE).href)
  const loaded = await fixture.loadRealFixture()
  let result
  try {
    const inspection = adapter.inspectCoreModel(loaded.liveView, loaded.request)
    if (!inspection.ok) {
      return { available: false, reason: 'merged Core inspection rejected the sample', issues: inspection.issues }
    }
    const built = adapter.buildModelCapabilityProfile(inspection.input)
    if (!built.ok) {
      return { available: false, reason: 'merged profile builder rejected the inspection input', issues: built.issues }
    }
    result = {
      available: true,
      capabilityProfile: built.profile,
      manifest: loaded.manifest,
      integrity: loaded.integrity,
      counts: loaded.counts,
      coreReport: loaded.coreReport,
      lipSyncGroup: loaded.lipSyncGroup,
      noticeHash: loaded.notice.hash,
      parameterCount: inspection.input.parameters.length,
      expressionCount: inspection.input.expressions.length,
      motionCount: inspection.input.motions.length,
    }
  } finally {
    loaded.release()
  }
  result.coreReleased = loaded.isReleased()
  if (!result.coreReleased) throw new Error('real Core model was not released')
  return result
}

export function summarizeCapabilityProfile(profile) {
  return {
    modelSignature: profile.modelSignature,
    parameterCount: profile.parameters.length,
    expressionCount: profile.expressions.length,
    motionCount: profile.motions.length,
    warningCount: profile.warnings.length,
    availableChannels: profile.capabilities.filter((entry) => entry.status === 'available').map((entry) => entry.channel),
    needsCalibration: profile.capabilities.filter((entry) => entry.status !== 'available').map((entry) => ({
      channel: entry.channel,
      status: entry.status,
      reason: entry.reason,
      parameterIds: entry.parameterIds,
    })),
    mouthForm: (() => {
      const parameter = profile.parameters.find((entry) => entry.id === 'ParamMouthForm')
      return parameter === undefined
        ? null
        : { min: parameter.min, max: parameter.max, defaultValue: parameter.defaultValue }
    })(),
    mouthOpen: (() => {
      const parameter = profile.parameters.find((entry) => entry.id === 'ParamMouthOpenY')
      return parameter === undefined
        ? null
        : { min: parameter.min, max: parameter.max, defaultValue: parameter.defaultValue }
    })(),
  }
}
