'use strict'
// Behavior tests for the pure semantic channel mixer. No source-string matching,
// no model/Core access and no renderer wiring.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')
const fixtures = require('./fixtures/performance-mixer-core-v1.cjs')

function loadTs(relativePath, extraRequire = {}) {
  const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(extraRequire, id)) return extraRequire[id]
      throw new Error(`unexpected require: ${id}`)
    },
  })
  return mod.exports
}

const contracts = loadTs('../src/shared/performance-mixer-contracts.ts')
const mixerModule = loadTs('../src/renderer/services/performance/mixer/index.ts', {
  '../../../../shared/performance-mixer-contracts': contracts,
})
const {
  createPerformanceMixer,
  MIXER_FRAME_GAP_REASON,
  MIXER_MAX_DT_MS,
  MIXER_SEMANTIC_CHANNELS,
} = mixerModule
const { SEMANTIC_CHANNEL_ANCHORS } = contracts

const plain = (value) => JSON.parse(JSON.stringify(value))

function mixer() {
  return createPerformanceMixer()
}

function update(overrides = {}) {
  return fixtures.tick(overrides)
}

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message ?? `expected ${actual} to be close to ${expected}`,
  )
}

function diagnostic(result, channel, phase = 'pre-physics') {
  const found = result.snapshot.channels.find((entry) => entry.channel === channel && entry.phase === phase)
  assert.ok(found, `missing ${phase} diagnostic for ${channel}`)
  return found
}

function hasReason(result, fragment) {
  return result.snapshot.degradedReasons.some((reason) => reason.includes(fragment))
}

function assertAllOutputsFiniteInRange(result) {
  for (const phase of ['prePhysics', 'postPhysics']) {
    for (const [channel, value] of Object.entries(result[phase])) {
      assert.ok(fixtures.CHANNELS.includes(channel), `unexpected output channel ${channel}`)
      assert.ok(Number.isFinite(value), `${phase}.${channel} is not finite`)
      const anchor = SEMANTIC_CHANNEL_ANCHORS[channel]
      assert.ok(
        value >= anchor.min && value <= anchor.max,
        `${phase}.${channel}=${value} outside [${anchor.min},${anchor.max}]`,
      )
    }
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

test('frozen channel order is derived from the shared anchors', () => {
  assert.deepEqual(Array.from(MIXER_SEMANTIC_CHANNELS), fixtures.CHANNELS)
  assert.equal(MIXER_MAX_DT_MS, 50)
})

test('replace, add and multiply follow the bounded formulas per channel', () => {
  const result = mixer().step(update({
    base: { headX: 0.2, headY: 0.2, headZ: 0.4 },
    contributions: [
      fixtures.contribution({ contributionId: 'replace', ownerId: 'replace', values: { headX: 0.8 }, strength: 0.5 }),
      fixtures.contribution({ contributionId: 'add', ownerId: 'add', values: { headY: 0.5 }, mode: 'add', strength: 0.5 }),
      fixtures.contribution({ contributionId: 'multiply', ownerId: 'multiply', values: { headZ: 1.5 }, mode: 'multiply', strength: 0.5 }),
    ],
  }))
  close(result.prePhysics.headX, 0.5)
  close(result.prePhysics.headY, 0.45)
  close(result.prePhysics.headZ, 0.5)
  assertAllOutputsFiniteInRange(result)
})

test('add and multiply inputs are limited and final anchors still clamp', () => {
  const result = mixer().step(update({
    base: { headX: 0.5, headY: 0.9 },
    contributions: [
      fixtures.contribution({ contributionId: 'mul', ownerId: 'mul', values: { headX: 3 }, mode: 'multiply', strength: 0.5 }),
      fixtures.contribution({ contributionId: 'add', ownerId: 'add', values: { headY: 1 }, mode: 'add', strength: 1 }),
    ],
  }))
  close(result.prePhysics.headX, 0.75)
  assert.equal(result.prePhysics.headY, 1)
  const headX = diagnostic(result, 'headX')
  assert.equal(headX.clamped, true)
  close(headX.target, 0.75)
  const headY = diagnostic(result, 'headY')
  assert.equal(headY.clamped, true)
  close(headY.target, 1.9)
  assert.equal(result.snapshot.clampCount, 2)
  assertAllOutputsFiniteInRange(result)
})

test('replace values outside a channel anchor are rejected instead of clamped', () => {
  const result = mixer().step(update({
    base: { headX: 0.1 },
    contributions: [fixtures.contribution({ contributionId: 'bad-replace', values: { headX: 1.5 } })],
  }))
  assert.equal(result.prePhysics.headX, 0.1)
  assert.deepEqual(plain(result.snapshot.rejectedContributionIds), ['bad-replace'])
  assert.ok(hasReason(result, 'replace-out-of-range:headX'))
  assert.equal(result.snapshot.clampCount, 0)
})

test('masks are per channel and priority orders each channel independently', () => {
  const result = mixer().step(update({
    base: { headX: 0, headY: 0 },
    contributions: [
      fixtures.contribution({ contributionId: 'low', ownerId: 'a', values: { headX: 0.1, headY: 0.1 } }),
      fixtures.contribution({
        contributionId: 'high',
        ownerId: 'b',
        values: { headX: 0.9 },
        priorityByChannel: { headX: 10 },
      }),
    ],
  }))
  close(result.prePhysics.headX, 0.9)
  close(result.prePhysics.headY, 0.1)
  assert.deepEqual(Array.from(diagnostic(result, 'headX').contributionIds), ['low', 'high'])
  assert.deepEqual(Array.from(diagnostic(result, 'headX').ownerIds), ['a', 'b'])
  assert.deepEqual(Array.from(diagnostic(result, 'headY').contributionIds), ['low'])
  assert.deepEqual(Array.from(diagnostic(result, 'headY').ownerIds), ['a'])
})

test('stable ties use accepted time, owner and contribution id ordering', () => {
  const sameTick = mixer().step(update({
    base: { headX: 0 },
    contributions: [
      fixtures.contribution({ contributionId: 'z', ownerId: 'a', values: { headX: 0.2 } }),
      fixtures.contribution({ contributionId: 'a', ownerId: 'b', values: { headX: 0.8 } }),
    ],
  }))
  close(sameTick.prePhysics.headX, 0.8)

  const timeOrdered = mixer()
  timeOrdered.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({ contributionId: 'z-old', ownerId: 'owner-z', values: { headX: 0.8 } })],
  }))
  const later = timeOrdered.step(update({
    sampledAtMonotonicMs: 50,
    base: { headX: 0 },
    contributions: [fixtures.contribution({ contributionId: 'a-new', ownerId: 'owner-a', values: { headX: 0.2 } })],
  }))
  close(later.prePhysics.headX, 0.2)
  assert.deepEqual(Array.from(diagnostic(later, 'headX').contributionIds), ['z-old', 'a-new'])

  const idOrdered = mixer().step(update({
    base: { headY: 0 },
    contributions: [
      fixtures.contribution({ contributionId: 'a', ownerId: 'same', values: { headY: 0.3 } }),
      fixtures.contribution({ contributionId: 'z', ownerId: 'same', values: { headY: 0.7 } }),
    ],
  }))
  close(idOrdered.prePhysics.headY, 0.7)
})

test('pre and post phases are independent and post continues the pre result', () => {
  const result = mixer().step(update({
    base: { headX: 0, headY: 0.2, headZ: 0.4 },
    contributions: [
      fixtures.contribution({
        contributionId: 'pre',
        ownerId: 'pre',
        phase: 'pre-physics',
        values: { headX: 0.6, headY: 0.3 },
      }),
      fixtures.contribution({
        contributionId: 'post',
        ownerId: 'post',
        phase: 'post-physics',
        mode: 'add',
        values: { headX: 0.2, headZ: 0.1 },
      }),
    ],
  }))
  close(result.prePhysics.headX, 0.6)
  close(result.postPhysics.headX, 0.8)
  close(result.prePhysics.headY, 0.3)
  close(result.postPhysics.headY, 0.3)
  close(result.prePhysics.headZ, 0.4)
  close(result.postPhysics.headZ, 0.5)
  const post = diagnostic(result, 'headX', 'post-physics')
  close(post.base, 0.6)
  close(post.target, 0.8)
  close(post.current, 0.8)
  assert.deepEqual(Array.from(post.ownerIds), ['post'])
  assertAllOutputsFiniteInRange(result)
})

test('capability degradation blocks unavailable channels without rejecting valid masks', () => {
  const result = mixer().step(update({
    profile: fixtures.degradedProfile,
    base: { headX: 0.1, mouthForm: 0.5, mouthOpen: 0.6, eyeOpenLeft: 0.7, breath: 0.4 },
    contributions: [fixtures.contribution({
      values: { headX: 0.9, mouthForm: 0.5, mouthOpen: 0.8, eyeOpenLeft: 0.2, breath: 0.3 },
    })],
  }))
  close(result.prePhysics.headX, 0.9)
  for (const channel of ['mouthForm', 'mouthOpen', 'eyeOpenLeft', 'eyeOpenRight', 'breath']) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.prePhysics, channel), false)
    assert.equal(Object.prototype.hasOwnProperty.call(result.postPhysics, channel), false)
  }
  assert.deepEqual(plain(result.snapshot.rejectedContributionIds), [])
  for (const fragment of [
    'channel-unavailable:mouthForm:needs-calibration:unconfirmed',
    'channel-unavailable:mouthOpen:unsupported:missing-parameter',
    'channel-unavailable:eyeOpenLeft:needs-calibration:physics-output',
    'channel-unavailable:eyeOpenRight:available:physics-output',
    'channel-unavailable:breath:unsupported:missing-capability',
  ]) {
    assert.ok(hasReason(result, fragment), `missing degradation reason ${fragment}`)
  }
})

test('invalid or missing profiles degrade every channel', () => {
  const result = mixer().step(update({
    profile: null,
    base: { headX: 0.5 },
    contributions: [fixtures.contribution({ values: { headX: 0.5 } })],
  }))
  assert.deepEqual(plain(result.prePhysics), {})
  assert.deepEqual(plain(result.postPhysics), {})
  assert.deepEqual(plain(result.snapshot.channels), [])
  assert.ok(hasReason(result, 'profile:invalid'))
})

test('mouthOpen and mouthForm stay independent and intents do not zero them', () => {
  const withIntents = mixer().step(update({
    base: { mouthOpen: 0.7, mouthForm: -0.3 },
    intents: [fixtures.stateIntent('speaking'), fixtures.emotionIntent()],
  }))
  close(withIntents.prePhysics.mouthOpen, 0.7)
  close(withIntents.prePhysics.mouthForm, -0.3)

  const formOnly = mixer().step(update({
    base: { mouthOpen: 0.7, mouthForm: -0.3 },
    contributions: [fixtures.contribution({ contributionId: 'form', ownerId: 'form', values: { mouthForm: 0.8 } })],
  }))
  close(formOnly.prePhysics.mouthForm, 0.8)
  close(formOnly.prePhysics.mouthOpen, 0.7)

  const openOnly = mixer().step(update({
    base: { mouthOpen: 0.7, mouthForm: -0.3 },
    contributions: [fixtures.contribution({
      contributionId: 'open',
      ownerId: 'voice',
      mode: 'add',
      values: { mouthOpen: -0.2 },
    })],
  }))
  close(openOnly.prePhysics.mouthOpen, 0.5)
  close(openOnly.prePhysics.mouthForm, -0.3)
})

test('eyelid and blink combine through same-channel modes', () => {
  const result = mixer().step(update({
    base: { eyeOpenLeft: 1, eyeOpenRight: 1 },
    contributions: [
      fixtures.contribution({
        contributionId: 'blink',
        ownerId: 'blink',
        mode: 'add',
        values: { eyeOpenLeft: -0.4 },
        priorityByChannel: { eyeOpenLeft: 0 },
      }),
      fixtures.contribution({
        contributionId: 'lid',
        ownerId: 'expression',
        mode: 'multiply',
        values: { eyeOpenLeft: 0.5 },
        priorityByChannel: { eyeOpenLeft: 10 },
      }),
    ],
  }))
  close(result.prePhysics.eyeOpenLeft, 0.3)
  close(result.prePhysics.eyeOpenRight, 1)
  assert.deepEqual(Array.from(diagnostic(result, 'eyeOpenLeft').contributionIds), ['blink', 'lid'])
})

test('a closed-eye expression is not reopened by a blink add', () => {
  const result = mixer().step(update({
    base: { eyeOpenLeft: 1 },
    contributions: [
      fixtures.contribution({
        contributionId: 'blink',
        ownerId: 'blink',
        mode: 'add',
        values: { eyeOpenLeft: 0.5 },
        priorityByChannel: { eyeOpenLeft: 0 },
      }),
      fixtures.contribution({
        contributionId: 'closed',
        ownerId: 'expression',
        mode: 'replace',
        values: { eyeOpenLeft: 0 },
        priorityByChannel: { eyeOpenLeft: 10 },
      }),
    ],
  }))
  assert.equal(result.prePhysics.eyeOpenLeft, 0)
  assert.deepEqual(Array.from(diagnostic(result, 'eyeOpenLeft').contributionIds), ['blink', 'closed'])
})

test('a newer generation replaces the owner and stale input cannot affect it', () => {
  const session = mixer()
  const first = session.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'head',
      ownerId: 'owner',
      generation: 1,
      values: { headX: 0.2 },
    })],
  }))
  close(first.prePhysics.headX, 0.2)

  const second = session.step(update({
    sampledAtMonotonicMs: 50,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'head',
      ownerId: 'owner',
      generation: 2,
      values: { headX: 0.8 },
    })],
  }))
  close(second.prePhysics.headX, 0.8)

  const stale = session.step(update({
    sampledAtMonotonicMs: 100,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'head',
      ownerId: 'owner',
      generation: 1,
      values: { headX: 0.1 },
    })],
    releases: [fixtures.release({ ownerId: 'owner', generation: 1 })],
  }))
  close(stale.prePhysics.headX, 0.8)
  assert.deepEqual(plain(stale.snapshot.rejectedContributionIds), ['head'])
  assert.ok(hasReason(stale, 'stale-generation'))

  const released = session.step(update({
    sampledAtMonotonicMs: 150,
    base: { headX: 0 },
    releases: [fixtures.release({ ownerId: 'owner', generation: 2, fadeOutMs: 0 })],
  }))
  assert.equal(released.prePhysics.headX, 0)

  const dead = session.step(update({
    sampledAtMonotonicMs: 200,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'head',
      ownerId: 'owner',
      generation: 2,
      values: { headX: 0.8 },
    })],
  }))
  assert.equal(dead.prePhysics.headX, 0)
  assert.deepEqual(plain(dead.snapshot.rejectedContributionIds), ['head'])
  assert.ok(hasReason(dead, 'dead-lease'))

  const renewed = session.step(update({
    sampledAtMonotonicMs: 250,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'head',
      ownerId: 'owner',
      generation: 3,
      values: { headX: 0.5 },
    })],
  }))
  close(renewed.prePhysics.headX, 0.5)
})

test('a new generation wins inside one tick regardless of input order', () => {
  const oldContribution = fixtures.contribution({
    contributionId: 'old',
    ownerId: 'owner',
    generation: 1,
    values: { headX: 0.1 },
  })
  const newContribution = fixtures.contribution({
    contributionId: 'new',
    ownerId: 'owner',
    generation: 2,
    values: { headX: 0.9 },
  })
  const forward = mixer().step(update({ base: { headX: 0 }, contributions: [oldContribution, newContribution] }))
  const reverse = mixer().step(update({ base: { headX: 0 }, contributions: [newContribution, oldContribution] }))
  close(forward.prePhysics.headX, 0.9)
  close(reverse.prePhysics.headX, 0.9)
  assert.deepEqual(plain(forward.snapshot.rejectedContributionIds), ['old'])
  assert.deepEqual(plain(reverse.snapshot.rejectedContributionIds), ['old'])
})

test('model epoch and binding generation changes clear leases and reject late input', () => {
  const session = mixer()
  session.step(update({
    sampledAtMonotonicMs: 0,
    modelEpoch: 1,
    bindingGeneration: 1,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'head',
      ownerId: 'owner',
      generation: 1,
      modelEpoch: 1,
      bindingGeneration: 1,
      values: { headX: 0.6 },
    })],
  }))

  const epochChanged = session.step(update({
    sampledAtMonotonicMs: 50,
    modelEpoch: 2,
    bindingGeneration: 1,
    base: { headX: 0 },
  }))
  assert.equal(epochChanged.prePhysics.headX, 0)
  assert.ok(hasReason(epochChanged, 'lifecycle:model-epoch-changed'))

  const lateEpoch = session.step(update({
    sampledAtMonotonicMs: 100,
    modelEpoch: 2,
    bindingGeneration: 1,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'late',
      ownerId: 'owner',
      generation: 1,
      modelEpoch: 1,
      bindingGeneration: 1,
      values: { headX: 0.4 },
    })],
  }))
  assert.equal(lateEpoch.prePhysics.headX, 0)
  assert.deepEqual(plain(lateEpoch.snapshot.rejectedContributionIds), ['late'])
  assert.ok(hasReason(lateEpoch, 'stale-model-epoch'))

  const bindingChanged = session.step(update({
    sampledAtMonotonicMs: 150,
    modelEpoch: 2,
    bindingGeneration: 2,
    base: { headX: 0 },
  }))
  assert.ok(hasReason(bindingChanged, 'lifecycle:binding-generation-changed'))

  const lateBinding = session.step(update({
    sampledAtMonotonicMs: 200,
    modelEpoch: 2,
    bindingGeneration: 2,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'late-bind',
      ownerId: 'owner',
      generation: 1,
      modelEpoch: 2,
      bindingGeneration: 1,
      values: { headX: 0.4 },
    })],
  }))
  assert.equal(lateBinding.prePhysics.headX, 0)
  assert.ok(hasReason(lateBinding, 'stale-binding-generation'))

  const fresh = session.step(update({
    sampledAtMonotonicMs: 250,
    modelEpoch: 2,
    bindingGeneration: 2,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'fresh',
      ownerId: 'owner',
      generation: 1,
      modelEpoch: 2,
      bindingGeneration: 2,
      values: { headX: 0.3 },
    })],
  }))
  close(fresh.prePhysics.headX, 0.3)
})

test('smoothstep fade-in advances only with the bounded monotonic clock', () => {
  const session = mixer()
  const start = session.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'fade',
      ownerId: 'owner',
      values: { headX: 1 },
      fadeInMs: 100,
    })],
  }))
  assert.equal(start.prePhysics.headX, 0)
  assert.deepEqual(Array.from(diagnostic(start, 'headX').ownerIds), ['owner'])

  const half = session.step(update({ sampledAtMonotonicMs: 50, base: { headX: 0 } }))
  close(half.prePhysics.headX, 0.5)
  const full = session.step(update({ sampledAtMonotonicMs: 100, base: { headX: 0 } }))
  close(full.prePhysics.headX, 1)
  const repeated = session.step(update({ sampledAtMonotonicMs: 100, base: { headX: 0 } }))
  close(repeated.prePhysics.headX, 1)
})

test('ttl expiry starts fade-out and the tail is cleaned up', () => {
  const session = mixer()
  session.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'ttl',
      ownerId: 'owner',
      values: { headX: 1 },
      fadeOutMs: 200,
      ttlMs: 1000,
    })],
  }))
  let last
  for (let time = 50; time <= 1200; time += 50) {
    last = session.step(update({ sampledAtMonotonicMs: time, base: { headX: 0 } }))
    if (time === 950) close(last.prePhysics.headX, 1)
    if (time === 1000) close(last.prePhysics.headX, 1)
    if (time === 1100) close(last.prePhysics.headX, 0.5)
  }
  assert.equal(last.prePhysics.headX, 0)
  assert.deepEqual(Array.from(diagnostic(last, 'headX').ownerIds), [])
  assert.deepEqual(Array.from(diagnostic(last, 'headX').contributionIds), [])
})

test('explicit releases honor fade-out overrides and do not restart an active fade', () => {
  const session = mixer()
  session.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'release',
      ownerId: 'owner',
      values: { headX: 1 },
      fadeOutMs: 500,
    })],
  }))
  session.step(update({
    sampledAtMonotonicMs: 50,
    base: { headX: 0 },
    releases: [fixtures.release({ ownerId: 'owner', generation: 1, fadeOutMs: 100 })],
  }))
  const half = session.step(update({
    sampledAtMonotonicMs: 100,
    base: { headX: 0 },
    releases: [fixtures.release({ ownerId: 'owner', generation: 1, fadeOutMs: 1000 })],
  }))
  close(half.prePhysics.headX, 0.5)
  const gone = session.step(update({ sampledAtMonotonicMs: 150, base: { headX: 0 } }))
  assert.equal(gone.prePhysics.headX, 0)
})

test('a release without fade-out uses the contribution fade-out duration', () => {
  const session = mixer()
  session.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'default-fade',
      ownerId: 'owner',
      values: { headX: 1 },
      fadeOutMs: 100,
    })],
  }))
  session.step(update({
    sampledAtMonotonicMs: 50,
    base: { headX: 0 },
    releases: [fixtures.release({ ownerId: 'owner' })],
  }))
  const half = session.step(update({ sampledAtMonotonicMs: 100, base: { headX: 0 } }))
  close(half.prePhysics.headX, 0.5)
  const gone = session.step(update({ sampledAtMonotonicMs: 150, base: { headX: 0 } }))
  assert.equal(gone.prePhysics.headX, 0)
})

test('expired leases are tombstoned so stale same-generation input cannot revive them', () => {
  const session = mixer()
  const contribution = fixtures.contribution({
    contributionId: 'ttl',
    ownerId: 'ttl',
    values: { headX: 1 },
    fadeOutMs: 0,
    ttlMs: 100,
  })
  session.step(update({ sampledAtMonotonicMs: 0, base: { headX: 0 }, contributions: [contribution] }))
  session.step(update({ sampledAtMonotonicMs: 50, base: { headX: 0 } }))
  const expired = session.step(update({ sampledAtMonotonicMs: 100, base: { headX: 0 } }))
  assert.equal(expired.prePhysics.headX, 0)
  const revived = session.step(update({
    sampledAtMonotonicMs: 150,
    base: { headX: 0 },
    contributions: [contribution],
  }))
  assert.equal(revived.prePhysics.headX, 0)
  assert.ok(hasReason(revived, 'dead-lease'))
})

test('repeated and backwards monotonic samples do not advance state', () => {
  const session = mixer()
  session.step(update({
    sampledAtMonotonicMs: 100,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'clock',
      ownerId: 'owner',
      values: { headX: 1 },
      fadeInMs: 100,
    })],
  }))
  const repeated = session.step(update({ sampledAtMonotonicMs: 100, base: { headX: 0 } }))
  assert.equal(repeated.prePhysics.headX, 0)
  const backwards = session.step(update({ sampledAtMonotonicMs: 50, base: { headX: 0 } }))
  assert.equal(backwards.prePhysics.headX, 0)
  const forward = session.step(update({ sampledAtMonotonicMs: 150, base: { headX: 0 } }))
  close(forward.prePhysics.headX, 0.5)
})

test('a large frame gap advances at most 50ms and records a diagnostic', () => {
  const session = mixer()
  session.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'gap',
      ownerId: 'owner',
      values: { headX: 1 },
      fadeInMs: 100,
    })],
  }))
  const jumped = session.step(update({ sampledAtMonotonicMs: 100, base: { headX: 0 } }))
  close(jumped.prePhysics.headX, 0.5)
  assert.ok(hasReason(jumped, MIXER_FRAME_GAP_REASON))
  assert.equal(jumped.snapshot.sampledAtMonotonicMs, 100)
  const next = session.step(update({ sampledAtMonotonicMs: 150, base: { headX: 0 } }))
  close(next.prePhysics.headX, 1)
})

test('a non-finite sample holds the clock and keeps outputs finite', () => {
  const session = mixer()
  session.step(update({
    sampledAtMonotonicMs: 0,
    base: { headX: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'sample',
      ownerId: 'owner',
      values: { headX: 1 },
      fadeInMs: 100,
    })],
  }))
  const invalid = session.step(update({ sampledAtMonotonicMs: Number.NaN, base: { headX: 0 } }))
  assert.equal(invalid.prePhysics.headX, 0)
  assert.ok(hasReason(invalid, 'tick:invalid-sample'))
  assertAllOutputsFiniteInRange(invalid)
})

test('invalid tick identity rejects inputs and keeps base output', () => {
  const result = mixer().step(update({
    modelEpoch: Number.NaN,
    base: { headX: 0.2 },
    contributions: [fixtures.contribution({
      contributionId: 'identity',
      ownerId: 'identity',
      values: { headX: 0.9 },
    })],
    releases: [fixtures.release({ ownerId: 'identity' })],
  }))
  assert.equal(result.prePhysics.headX, 0.2)
  assert.deepEqual(plain(result.snapshot.rejectedContributionIds), ['identity'])
  assert.ok(hasReason(result, 'tick:invalid-model-epoch'))
  assert.ok(hasReason(result, 'rejected-contribution:identity:invalid-tick-identity'))
  assertAllOutputsFiniteInRange(result)
})

test('malformed contributions are rejected without polluting valid channels', () => {
  const result = mixer().step(update({
    base: { headX: 0.2, headY: 0.3, headZ: 0.4 },
    contributions: [
      fixtures.contribution({ contributionId: 'nan', ownerId: 'bad-1', values: { headX: Number.NaN } }),
      fixtures.contribution({ contributionId: 'inf', ownerId: 'bad-2', values: { headX: Number.POSITIVE_INFINITY } }),
      fixtures.contribution({ contributionId: 'mode', ownerId: 'bad-3', mode: 'blend', values: { headX: 0.5 } }),
      fixtures.contribution({ contributionId: 'phase', ownerId: 'bad-4', phase: 'during', values: { headX: 0.5 } }),
      fixtures.contribution({ contributionId: 'raw', ownerId: 'bad-5', values: { ParamAngleX: 0.5 } }),
      fixtures.contribution({ contributionId: 'range', ownerId: 'bad-6', values: { headX: 2 } }),
      fixtures.contribution({
        contributionId: 'priority',
        ownerId: 'bad-7',
        values: { headX: 0.5 },
        priorityByChannel: { headX: Number.NaN },
      }),
      fixtures.contribution({ contributionId: 'owner', ownerId: '   ', values: { headX: 0.5 } }),
      fixtures.contribution({ contributionId: 'strength', ownerId: 'bad-9', strength: 2, values: { headX: 0.5 } }),
      fixtures.contribution({ contributionId: 'ttl', ownerId: 'bad-10', ttlMs: 0, values: { headX: 0.5 } }),
      fixtures.contribution({ contributionId: 'fade', ownerId: 'bad-11', fadeInMs: -1, values: { headX: 0.5 } }),
      fixtures.contribution({ contributionId: 'valid', ownerId: 'good', mode: 'add', values: { headY: 0.2 } }),
    ],
  }))
  close(result.prePhysics.headX, 0.2)
  close(result.prePhysics.headY, 0.5)
  close(result.prePhysics.headZ, 0.4)
  const rejected = plain(result.snapshot.rejectedContributionIds)
  for (const id of ['nan', 'inf', 'mode', 'phase', 'raw', 'range', 'priority', 'owner', 'strength', 'ttl', 'fade']) {
    assert.ok(rejected.includes(id), `missing rejected id ${id}`)
  }
  assert.equal(rejected.includes('valid'), false)
  assertAllOutputsFiniteInRange(result)
})

test('non-object contributions are rejected by index', () => {
  const result = mixer().step(update({
    base: { headX: 0.2 },
    contributions: [null, 'bad', fixtures.contribution({
      contributionId: 'ok',
      ownerId: 'ok',
      values: { headX: 0.6 },
    })],
  }))
  assert.deepEqual(plain(result.snapshot.rejectedContributionIds), ['#0', '#1'])
  close(result.prePhysics.headX, 0.6)
})

test('invalid base values fall back to neutral without affecting other channels', () => {
  const result = mixer().step(update({
    base: {
      headX: Number.NaN,
      headY: '0.4',
      headZ: 0.3,
      eyeOpenLeft: Number.POSITIVE_INFINITY,
      unknownChannel: 0.7,
    },
  }))
  assert.equal(result.prePhysics.headX, 0)
  assert.equal(result.prePhysics.headY, 0)
  close(result.prePhysics.headZ, 0.3)
  assert.equal(result.prePhysics.eyeOpenLeft, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(result.prePhysics, 'unknownChannel'), false)
  assert.ok(hasReason(result, 'base:invalid-value:headX'))
  assert.ok(hasReason(result, 'base:invalid-value:headY'))
  assert.ok(hasReason(result, 'base:invalid-value:eyeOpenLeft'))
  assert.ok(hasReason(result, 'base:unknown-channel:unknownChannel'))
  assertAllOutputsFiniteInRange(result)
})

test('missing base uses the frozen neutral anchors', () => {
  const result = mixer().step(update())
  assert.equal(result.prePhysics.headX, 0)
  assert.equal(result.prePhysics.eyeOpenLeft, 1)
  assert.equal(result.prePhysics.mouthOpen, 0)
  assert.equal(result.prePhysics.breath, 0)
  assert.equal(result.snapshot.channels.length, 30)
})

test('asymmetric DS structure summary stays in semantic units', () => {
  const result = mixer().step(update({
    profile: fixtures.dsSummaryProfile,
    base: { mouthForm: 0, mouthOpen: 0 },
    contributions: [
      fixtures.contribution({ contributionId: 'form', ownerId: 'form', values: { mouthForm: -0.75 } }),
      fixtures.contribution({ contributionId: 'open', ownerId: 'open', values: { mouthOpen: 0.4 } }),
    ],
  }))
  assert.equal(result.prePhysics.mouthForm, -0.75)
  assert.equal(result.prePhysics.mouthOpen, 0.4)
  assert.notEqual(result.prePhysics.mouthForm, -2)
  assert.notEqual(result.prePhysics.mouthForm, -0.5)
  assert.equal(Object.keys(result.prePhysics).includes('ParamMouthForm'), false)

  const badForm = mixer().step(update({
    profile: fixtures.dsSummaryProfile,
    base: { mouthForm: 0, mouthOpen: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'bad-form',
      ownerId: 'bad-form',
      values: { mouthForm: -2 },
    })],
  }))
  assert.equal(badForm.prePhysics.mouthForm, 0)
  assert.ok(hasReason(badForm, 'replace-out-of-range:mouthForm'))

  const badOpen = mixer().step(update({
    profile: fixtures.dsSummaryProfile,
    base: { mouthForm: 0, mouthOpen: 0 },
    contributions: [fixtures.contribution({
      contributionId: 'bad-open',
      ownerId: 'bad-open',
      values: { mouthOpen: -0.1 },
    })],
  }))
  assert.equal(badOpen.prePhysics.mouthOpen, 0)
  assert.ok(hasReason(badOpen, 'replace-out-of-range:mouthOpen'))
})

test('snapshot exposes per-channel phase diagnostics and clamp counts', () => {
  const result = mixer().step(update({
    base: { headX: 0.9, headY: 0.1 },
    contributions: [
      fixtures.contribution({ contributionId: 'pre-add', ownerId: 'pre', mode: 'add', values: { headX: 0.5 } }),
      fixtures.contribution({
        contributionId: 'post-mul',
        ownerId: 'post',
        phase: 'post-physics',
        mode: 'multiply',
        values: { headY: 2 },
      }),
    ],
  }))
  assert.equal(result.snapshot.version, 1)
  assert.equal(result.snapshot.sampledAtMonotonicMs, 0)
  assert.equal(result.snapshot.modelEpoch, 1)
  assert.equal(result.snapshot.bindingGeneration, 1)
  assert.equal(result.snapshot.channels.length, 30)
  const preHeadX = diagnostic(result, 'headX', 'pre-physics')
  close(preHeadX.base, 0.9)
  close(preHeadX.target, 1.4)
  close(preHeadX.current, 1)
  assert.equal(preHeadX.clamped, true)
  assert.deepEqual(Array.from(preHeadX.ownerIds), ['pre'])
  const postHeadY = diagnostic(result, 'headY', 'post-physics')
  close(postHeadY.base, 0.1)
  close(postHeadY.target, 0.2)
  close(postHeadY.current, 0.2)
  assert.deepEqual(Array.from(postHeadY.ownerIds), ['post'])
  assert.equal(result.snapshot.clampCount, 1)
})

test('per-channel composition is independent of contribution input order', () => {
  const base = { headX: 0, headY: 0 }
  const first = fixtures.contribution({ contributionId: 'a', ownerId: 'a', values: { headX: 0.2, headY: 0.2 } })
  const second = fixtures.contribution({ contributionId: 'b', ownerId: 'b', values: { headX: 0.8, headY: 0.8 } })
  const forward = mixer().step(update({ base, contributions: [first, second] }))
  const reverse = mixer().step(update({ base, contributions: [second, first] }))
  assert.deepEqual(plain(forward.prePhysics), plain(reverse.prePhysics))
  assert.deepEqual(plain(forward.postPhysics), plain(reverse.postPhysics))
  assert.deepEqual(plain(forward.snapshot.channels), plain(reverse.snapshot.channels))
})

test('identical tick sequences replay deterministically across mixer instances', () => {
  const sequence = [
    {
      sampledAtMonotonicMs: 0,
      base: { headX: 0, mouthOpen: 0.2 },
      contributions: [
        fixtures.contribution({ contributionId: 'a', ownerId: 'a', values: { headX: 0.4 }, fadeInMs: 100 }),
        fixtures.contribution({ contributionId: 'b', ownerId: 'b', values: { mouthOpen: 0.1 }, mode: 'add' }),
      ],
    },
    {
      sampledAtMonotonicMs: 50,
      base: { headX: 0, mouthOpen: 0.2 },
      contributions: [
        fixtures.contribution({ contributionId: 'c', ownerId: 'b', generation: 2, values: { mouthOpen: 0.6 } }),
      ],
      releases: [fixtures.release({ ownerId: 'a' })],
    },
    {
      sampledAtMonotonicMs: 150,
      base: { headX: 0, mouthOpen: 0.2 },
    },
  ]
  const run = () => {
    const session = mixer()
    return sequence.map((overrides) => plain(session.step(update(overrides))))
  }
  assert.deepEqual(run(), run())
})

test('frozen inputs are accepted and outputs never share mutable state', () => {
  const input = update({
    base: { headX: 0.2 },
    contributions: [fixtures.contribution({
      contributionId: 'frozen',
      ownerId: 'frozen',
      values: { headX: 0.8 },
    })],
  })
  input.profile = structuredClone(input.profile)
  deepFreeze(input)
  const session = mixer()
  const first = session.step(input)
  close(first.prePhysics.headX, 0.8)
  first.prePhysics.headX = 999
  first.snapshot.degradedReasons.push('mutated')
  const second = session.step(update({ sampledAtMonotonicMs: 50, base: { headX: 0.2 } }))
  close(second.prePhysics.headX, 0.8)
  assert.deepEqual(plain(second.snapshot.degradedReasons), [])
})

test('accepted contributions clone values instead of retaining caller references', () => {
  const session = mixer()
  const raw = fixtures.contribution({ contributionId: 'clone', ownerId: 'clone', values: { headX: 0.2 } })
  session.step(update({ base: { headX: 0 }, contributions: [raw] }))
  raw.values.headX = 0.9
  const next = session.step(update({ sampledAtMonotonicMs: 50, base: { headX: 0 } }))
  close(next.prePhysics.headX, 0.2)
})

test('the frozen synthetic mixer fixture is accepted as-is', () => {
  const frozen = loadTs('./fixtures/performance-mixer-v1.ts')
  const result = mixer().step(frozen.semanticTick)
  assert.deepEqual(plain(result.snapshot.rejectedContributionIds), [])
  close(result.prePhysics.headX, 0)
  assert.equal(result.prePhysics.eyeOpenLeft, 1)
  close(result.prePhysics.mouthOpen, 0)
  close(result.prePhysics.mouthForm, 0)
  assert.equal(Object.prototype.hasOwnProperty.call(result.prePhysics, 'bodyX'), false)
  assertAllOutputsFiniteInRange(result)
})

test('unsupported tick envelopes throw instead of silently degrading', () => {
  assert.throws(() => mixer().step(null), { name: 'TypeError' })
  assert.throws(() => mixer().step({ ...fixtures.tick(), version: 2 }), { name: 'TypeError' })
})
