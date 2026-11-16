const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('[P2：播放其他预设会改变已保持的裙装档位] applyControlActionToList 与 usePresetController 保持多档位部件当前档位', () => {
  // 1. usePresetController 附带准确的当前档位
  const controller = read('src/renderer/composables/usePresetController.ts')
  assert.match(controller, /c\.stages && c\.stages\.length > 0 \? `\$\{c\.id\}:\$\{c\.currentStageIndex \?\? 0\}` : c\.id/)

  // 2. emotion-adapter 中 effectiveAction === 'on' 语义为维持开启当前档位，不再 cycling
  const emotion = read('src/renderer/services/live2d/emotion-adapter.ts')
  assert.match(emotion, /const targetIdx = target\.active \? curIdx : \(curIdx === defIdx \? \(defIdx \+ 1\) % stageCount : curIdx\)/)
  assert.doesNotMatch(emotion, /} else if \(effectiveAction === 'on'\) \{\s*const nextIdx = \(curIdx \+ 1\) % stageCount/)
})

test('[P2：TTS 自动风格关闭后不能稳定保留] VOICE_SERVICE_KEYS 包含 ttsAutoStyleFromHost，loadUiState 支持布尔，pet-bridge 监听变更', () => {
  const deskpet = read('src/renderer/stores/deskpet.ts')
  assert.match(deskpet, /'ttsAutoStyleFromHost'/)
  assert.match(deskpet, /typeof service\[key\] === 'boolean'/)

  const bridge = read('src/renderer/settings-window/pet-bridge.ts')
  assert.match(bridge, /store\.ttsAutoStyleFromHost/)
})

test('[P2：解除宿主绑定后仍读到旧宿主] active.ts 与 DeskpetStage.vue 正确更新 standalone 动态偏好并阻断旧快照回退', () => {
  const active = read('src/renderer/services/adapters/active.ts')
  assert.match(active, /if \(dynamicBoundHost === 'standalone' \|\| dynamicBoundHost === 'fake'\) return 'standalone'/)
  assert.match(active, /if \(pref === 'standalone'\) return 'standalone'/)
  assert.match(active, /dynamicBoundHost = 'standalone'/)
  assert.doesNotMatch(active, /dynamicBoundHost = pref === 'standalone' \? null : pref/)

  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /setBoundHostPreference\('standalone'\)/)
  assert.match(stage, /switchActiveHost\('fake'\)/)
})

test('[P2：导出 motion3 时静默丢失分镜原生动作] motion-exporter 与 SettingsPanel 明确拒绝含原生动作分镜导出', () => {
  const { exportPresetStepsToMotion3 } = require('./support/settings-loader.cjs')()('renderer/services/live2d/motion-exporter')
  assert.throws(() => exportPresetStepsToMotion3([
    { durationMs: 100, holdMs: 0, controls: [], parameters: {}, motion: { group: 'NativeStep', index: 0 } },
  ], { fps: 30 }, { sliders: [], controls: [], capabilities: null }), /NativeStep.*混流/)
})
