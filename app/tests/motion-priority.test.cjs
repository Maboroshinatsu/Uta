'use strict'
// DP-009: 动作层级与循环。使用替身模型与替身 loader，无 WebGL、无真实动作文件。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/composables/useMotionPriority.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const flush = () => new Promise((resolve) => setImmediate(resolve))

function harness() {
  const state = { playResult: true }
  const calls = { play: [], reset: 0 }
  const finishes = []
  const timers = []
  const requireMap = {
    '@/stores/deskpet': {},
    '@/services/live2d/loader': {
      playMotion: async (_model, name, idx) => {
        calls.play.push([name, idx])
        return state.playResult
      },
      onMotionFinish: (_model, handler) => {
        const entry = { handler, active: true }
        finishes.push(entry)
        return () => { entry.active = false }
      },
      resetTransientParametersToHome: () => { calls.reset += 1 },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (n) => requireMap[n],
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: () => {},
  })
  const store = { live2dModel: null }
  return {
    api: module.exports.useMotionPriority(store),
    layers: module.exports.MotionLayer,
    store, calls, finishes, timers, state,
  }
}

test('no model means nothing is played', () => {
  const h = harness()
  assert.equal(h.api.playMotionWithPriority('wave', h.layers.Reply), false)
  assert.equal(h.calls.play.length, 0)
})

test('a lower layer cannot interrupt a higher one', () => {
  const h = harness()
  h.store.live2dModel = {}
  assert.equal(h.api.playMotionWithPriority('wave', h.layers.Interaction), true)
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), false)
  assert.deepEqual(h.calls.play, [['wave', 0]])
})

test('loop: subscribes to motionFinish and replays when the motion ends', async () => {
  const h = harness()
  h.store.live2dModel = {}
  assert.equal(h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true }), true)
  await flush()
  assert.equal(h.api.isLooping(), true)
  assert.equal(h.finishes.length, 1)
  h.finishes[0].handler()
  await flush()
  assert.deepEqual(h.calls.play, [['dance', 0], ['dance', 0]])
})

test('an idle action ends a looping reply instead of leaving the pet frozen', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  assert.equal(h.api.isLooping(), true)

  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true)
  await flush()
  assert.equal(h.api.isLooping(), false)
  assert.deepEqual(h.calls.play, [['dance', 0], ['idle', 0]])

  h.finishes[0].handler()
  await flush()
  assert.deepEqual(h.calls.play, [['dance', 0], ['idle', 0]], 'the old loop must not restart')
})

test('scene motions clear their props on finish and when replaced', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('selfie', h.layers.Reply, 0)
  await flush()
  assert.equal(h.finishes.length, 1)
  h.finishes[0].handler()
  await flush()
  assert.equal(h.calls.reset, 1)

  h.api.playMotionWithPriority('ketchup', h.layers.Reply, 0)
  await flush()
  h.api.playMotionWithPriority('wave', h.layers.Interaction, 0)
  await flush()
  assert.equal(h.calls.reset, 2, 'replacing a scene must clean its props')
  assert.deepEqual(h.calls.play, [['selfie', 0], ['ketchup', 0], ['wave', 0]])
})

test('ordinary non-loop motions register a release handler but no scene cleanup', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('wave', h.layers.Reply, 0)
  await flush()
  assert.equal(h.finishes.length, 1, '普通动作必须订阅结束事件，否则层级只能等兜底定时器')
  assert.equal(h.calls.reset, 0, '普通动作结束时不得像场景动作那样清空道具参数')
})

test('a loop never arms the fallback timer and keeps its layer', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  assert.equal(h.timers.length, 0, '循环动作由结束事件续播，不应挂兜底释放定时器')
  for (const timer of h.timers) timer.fn()
  await flush()
  assert.equal(h.finishes.length, 1)
  h.finishes[0].handler()
  await flush()
  assert.deepEqual(h.calls.play, [['dance', 0], ['dance', 0]])
  assert.equal(h.api.isLooping(), true)
})

test('stopLoop halts an active loop', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  h.api.stopLoop()
  assert.equal(h.api.isLooping(), false)
  h.finishes[0].handler()
  await flush()
  assert.equal(h.calls.play.length, 1, '停止后不得再续播')
})

test('a new play takes over the loop ownership from the previous one', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  const first = h.finishes[0]
  h.api.playMotionWithPriority('wave', h.layers.Interaction)
  await flush()
  first.handler()
  await flush()
  assert.deepEqual(h.calls.play, [['dance', 0], ['wave', 0]], '旧循环不得续播')
})

test('a non-loop play never replays itself when the motion ends', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('wave', h.layers.Reply)
  await flush()
  assert.equal(h.finishes.length, 1)
  h.finishes[0].handler()
  await flush()
  assert.deepEqual(h.calls.play, [['wave', 0]], '普通动作结束后不得续播')
  assert.equal(h.api.isLooping(), false)
})

test('unsupported motion releases the layer instead of blocking it', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.state.playResult = false
  h.api.playMotionWithPriority('missing', h.layers.Reply, 0, { loop: true })
  await flush()
  assert.equal(h.api.isLooping(), false)
  assert.equal(h.finishes.length, 0)
  // 层级已释放：低优先级动作仍可播放
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true)
})

test('reset stops the loop and clears the layer', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  h.api.reset()
  assert.equal(h.api.isLooping(), false)
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true)
})

test('switching the model stops the previous loop from replaying', async () => {
  const h = harness()
  const first = {}
  h.store.live2dModel = first
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  const handler = h.finishes[0].handler
  h.store.live2dModel = {}   // 换模型
  handler()
  await flush()
  assert.equal(h.calls.play.length, 1, '换模型后旧循环不得续播')
})

test('stopMotion halts active motion and allows lower layer to play', async () => {
  const h = harness()
  let stopped = 0
  h.store.live2dModel = {
    internalModel: { motionManager: { stopAllMotions: () => { stopped += 1 } } },
  }
  h.api.playMotionWithPriority('dance', h.layers.Reply, 0, { loop: true })
  await flush()
  assert.equal(h.api.isLooping(), true)

  h.api.stopMotion()
  assert.equal(h.api.isLooping(), false)
  assert.ok(stopped >= 1)
  assert.equal(h.calls.reset, 0, '默认软停：停止播放时钟不该把参数硬归零')

  h.api.stopMotion({ resetTransientParams: true })
  assert.equal(h.calls.reset, 1, '硬归零必须由调用方显式要求')

  // 层级已释放：待机动作可以正常播放
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true)
  await flush()
  assert.deepEqual(h.calls.play, [['dance', 0], ['idle', 0]])
})

test('stopMotion clears currentLayer even for non-looping motions', async () => {
  const h = harness()
  let stopped = 0
  h.store.live2dModel = {
    internalModel: { motionManager: { stopAllMotions: () => { stopped += 1 } } },
  }
  h.api.playMotionWithPriority('wave', h.layers.Reply, 0)
  await flush()
  // 未停止前低优先级 Idle 被挡
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), false)
  h.api.stopMotion()
  // 停止后低优先级 Idle 可播放
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true)
})

test('在途动作被取消时，正在播放的预设参数不再被它硬归零', async () => {
  const build = (presetSequenceActive) => {
    const h = harness()
    let stopped = 0
    h.store.live2dModel = {
      internalModel: { motionManager: { stopAllMotions: () => { stopped += 1 } } },
    }
    h.store.presetSequenceActive = presetSequenceActive
    h.api.playMotionWithPriority('dance', h.layers.Reply, 0)
    // 在 .then 之前取消：令牌过时、层级已释放，异步回调此时才落地
    h.api.stopMotion()
    return { h, stopped: () => stopped }
  }

  const withPreset = build(true)
  await flush()
  assert.equal(withPreset.h.calls.reset, 0, '预设正在播放时，废弃动作的回调不得越权归零')
  assert.ok(withPreset.stopped() >= 1, '但孤立动作仍要停掉，不能让它回魂')

  const withoutPreset = build(false)
  await flush()
  assert.ok(withoutPreset.h.calls.reset >= 1, '无人拥有参数时仍按原样清理场景残留')
})

test('an ordinary motion releases its layer as soon as the motion ends', async () => {
  const h = harness()
  h.store.live2dModel = {}
  h.api.playMotionWithPriority('wave', h.layers.Reply, 0)
  await flush()
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), false, '播放期间仍独占层级')
  h.finishes[0].handler()
  assert.equal(h.api.playMotionWithPriority('idle', h.layers.Idle), true, '动作结束即归还层级，不再等 8 秒兜底')
})

test('the fallback release timer honors the declared duration and never under five seconds', async () => {
  const plain = harness()
  plain.store.live2dModel = {}
  plain.api.playMotionWithPriority('wave', plain.layers.Reply, 0)
  await flush()
  assert.equal(plain.timers.length, 1)
  assert.equal(plain.timers[0].ms, 8000, '未声明时长时兜底 8 秒')

  const short = harness()
  short.store.live2dModel = {}
  short.api.playMotionWithPriority('wave', short.layers.Reply, 0, { durationMs: 1200 })
  await flush()
  assert.equal(short.timers.length, 1)
  assert.equal(short.timers[0].ms, 5000, '短动作的兜底不得低于 5 秒')

  const long = harness()
  long.store.live2dModel = {}
  long.api.playMotionWithPriority('wave', long.layers.Reply, 0, { durationMs: 9000 })
  await flush()
  assert.equal(long.timers.length, 1)
  assert.equal(long.timers[0].ms, 9000, '长动作按声明时长兜底')
})
