'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadPresetControllerModule(store) {
  const currentStore = store
  const tsSource = fs.readFileSync(
    path.join(__dirname, '../src/renderer/composables/usePresetController.ts'),
    'utf8',
  )
  const code = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  const motionSource = fs.readFileSync(
    path.join(__dirname, '../src/renderer/composables/useMotionPriority.ts'),
    'utf8',
  )
  const motionCode = ts.transpileModule(motionSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  const mockMotion = { exports: {} }
  vm.runInNewContext(motionCode, { module: mockMotion, exports: mockMotion.exports, require: () => ({}) })

  const mockModule = { exports: {} }
  const context = {
    module: mockModule,
    exports: mockModule.exports,
    require: (id) => {
      if (id.endsWith('/native-motion')) return require('./support/settings-loader.cjs')()('shared/native-motion')
      if (id.includes('stores/deskpet') || id.includes('deskpet')) return { useDeskpetStore: () => currentStore }
      if (id.includes('useMotionPriority')) return mockMotion.exports
      if (id.includes('preset-sequence')) {
        return {
          resolvePresetStepTiming: (s) => ({ transitionMs: s?.durationMs ?? 600, holdMs: s?.holdMs ?? 0, delayMs: (s?.durationMs ?? 600) + (s?.holdMs ?? 0) }),
          resolvePresetFinishAction: (m) => m,
          resolvePresetRevertDelayMs: () => 0,

          REVERT_TRANSITION_MS: 320,
          RETURN_GAZE_MS: 320,
        }
      }
      if (id.includes('loader')) {
        return {
          setControlLayer: () => {},
          applyParameters: () => {},
          clearExpression: () => {},
          resetTransientParametersToHome: () => {},
          setFocusWeight: () => {},
          setSequenceGazeOverride: () => {},
          getModelParameterBlendMode: (_model, id) => require('./support/settings-loader.cjs')()('renderer/services/live2d/focus-mapping').parameterBlendMode(id),
          setPresetMotionOwnership: () => {},
          releaseParameterIds: () => {},
        }
      }
      if (id.includes('emotion-adapter')) {
        return {
          applyControlActionToList: (list, ids, action) => {
            const idSet = new Set(ids)
            for (const item of list) {
              if (idSet.has(item.id)) item.active = action === 'on'
            }
            return { changed: true, activated: [], deactivated: [] }
          },
          computeControlLayerState: () => ({ parameters: {}, hiddenParts: [], shownParts: [] }),
          findModelStatePreset: () => null,
          getPresetDefaultFinishMode: (p) => p.finishMode ?? 'revert',
          isPersistentControlCategory: (cat) => cat === 'outfit' || cat === 'hair',
          normalizePresetSteps: (p) => p.steps ?? [{ label: 'step0', durationMs: 200, holdMs: 0, controls: [], parameters: {} }],
          resolvePresetGroup: (p) => p.group ?? '',
          resolvePresetMotion: (p) => p.motion && typeof p.motion === 'object' ? p.motion : null,
        }
      }
      if (id.includes('dafish-happy-performance')) {
        return {
          getDafishHappyOwnedParameters: () => new Set(['PositionZ', 'LeanInput']),
        }
      }
      return {}
    },
    setTimeout: (fn, ms) => {
      // Return dummy timer id
      return 1
    },
    clearTimeout: () => {},
    window: {
      setTimeout: (fn, ms) => 1,
      clearTimeout: () => {},
    },
    console: { info: () => {}, debug: () => {} },
  }

  vm.runInNewContext(code, context)
  return {
    usePresetController: mockModule.exports.usePresetController,
    MotionLayer: mockMotion.exports.MotionLayer,
  }
}

test('closing a workshop preview stops its motion and leaves subsequent playback alone', () => {
  let playing = true
  const store = { live2dModel: {}, modelSliders: [], modelControls: [], presetPreviewActive: true,
    endPresetPreview() { store.presetPreviewActive = false } }
  const { usePresetController } = loadPresetControllerModule(store)
  const controller = usePresetController({ stopMotion: () => { playing = false } })
  controller.stopPresetPreview()
  assert.equal(store.presetPreviewActive, false)
  assert.equal(playing, false)
  playing = true
  controller.stopPresetPreview()
  assert.equal(playing, true)
})

test('[BUG-ANIMATION-RESET-HITCH] 启动带动作预设时不硬调用 stopMotion 归零模型瞬态参数', () => {
  const calls = { stopMotionHardReset: 0, releaseMotionLayer: 0, playMotion: [] }
  const store = {
    presetEditingLocked: false,
    endPresetPreview: () => {},
    activeRunningPresetId: 'neutral',
    activeHoldPresetId: 'neutral',
    modelControls: [],
    modelSliders: [
      { id: 'PositionZ', value: 0, defaultValue: 0 },
      { id: 'LeanInput', value: 0, defaultValue: 0 },
    ],
    statePresets: [],
    emotionAdapter: null,
    modelCapabilities: { motionGroups: { '好奇·大肥鱼灵动探身': 1 } },
    currentEmotion: 'neutral',
    live2dModel: {},
  }
  const { usePresetController } = loadPresetControllerModule(store)

  const controller = usePresetController({
    isLive2dAvailable: () => true,
    getBaseHiddenParts: () => new Set(),
    playMotionWithPriority: (group, layer, index, options) => {
      calls.playMotion.push({ group, layer, index, options })
      return true
    },
    stopMotion: (opts) => {
      if (opts?.resetTransientParams !== false) {
        calls.stopMotionHardReset += 1
      }
    },
    releaseMotionLayer: () => {
      calls.releaseMotionLayer += 1
    },
    reportControlsAndPresetsToHost: () => {},
    notifyIdleInteraction: () => {},
  })

  const preset = {
    id: 'dafish_curious',
    label: '好奇',
    motion: { group: '好奇·大肥鱼灵动探身', index: 0 },
    steps: [
      { label: '探身', durationMs: 200, holdMs: 1200, controls: [], parameters: { LeanInput: -22, PositionZ: 12 } },
      { label: '起伏', durationMs: 1400, holdMs: 0, controls: [], parameters: { LeanInput: -23, PositionZ: 11 } },
    ],
    finishMode: 'revert',
  }

  const ok = controller.handlePresetTrigger(preset)
  assert.equal(ok, true)
  // 关键验证：新预设启动时不得触发瞬态硬归零抽搐（resetTransientParams 必须为 false）
  assert.equal(calls.stopMotionHardReset, 0)
  assert.equal(calls.playMotion.length, 1)
  assert.equal(calls.playMotion[0].group, '好奇·大肥鱼灵动探身')
  // 关键验证：时长自适应传递，覆盖整个预设时长（200 + 1200 + 1400 = 2800 -> 3300ms > 0）
  assert.equal(calls.playMotion[0].options.durationMs, 3300)
  // 关键验证：因为 explicitMotion 存在，runStep 仅由动作驱动，不将 LeanInput/PositionZ 写入 modelSliders
  assert.equal(store.modelSliders[0].value, 0, 'PositionZ 保持默认不被分镜参数覆盖')
  assert.equal(store.modelSliders[1].value, 0, 'LeanInput 保持默认不被分镜参数覆盖')
})

test('[BUG-SLIDER-RESIDUAL-POLLUTION] 打断或回退预设时滑块与临时部件彻底复位并立即同步', () => {
  const store = {
    presetEditingLocked: false,
    endPresetPreview: () => {},
    activeRunningPresetId: 'well_actually',
    activeHoldPresetId: 'neutral',
    modelControls: [
      { id: '黑框眼镜', category: 'pose_prop', active: false, parameters: { key11: 1 } },
      { id: '竖食指', category: 'pose_prop', active: false, parameters: { Movement3: 1 } },
    ],
    modelSliders: [
      { id: 'Movement3', value: 0, defaultValue: 0 },
      { id: 'Param40', value: 0, defaultValue: 0 },
    ],
    statePresets: [{ id: 'neutral', label: '日常待机', steps: [{ durationMs: 200, holdMs: 0, controls: [], parameters: {} }] }],
    emotionAdapter: null,
    modelCapabilities: null,
    currentEmotion: 'neutral',
    live2dModel: {},
  }
  const { usePresetController } = loadPresetControllerModule(store)

  const controller = usePresetController({
    isLive2dAvailable: () => true,
    getBaseHiddenParts: () => new Set(),
    playMotionWithPriority: () => true,
    stopMotion: () => {},
    reportControlsAndPresetsToHost: () => {},
    notifyIdleInteraction: () => {},
  })

  // 模拟一个非 explicitMotion 预设（如工坊自定义静态分镜）激活了黑框眼镜并修改了滑块
  const customPreset = {
    id: 'custom_well',
    label: '自定义预设',
    motion: 'none',
    steps: [
      { label: '架子', durationMs: 200, holdMs: 1200, controls: ['黑框眼镜', '竖食指'], parameters: { Movement3: 1, Param40: 1 } },
    ],
    finishMode: 'revert',
  }

  controller.handlePresetTrigger(customPreset)
  assert.equal(store.modelControls[0].active, true, '黑框眼镜被激活')
  assert.equal(store.modelSliders[0].value, 1, 'Movement3 滑块被修改为 1')
  assert.equal(store.modelSliders[1].value, 1, 'Param40 滑块被修改为 1')

  // 打断该序列
  controller.cancelPresetSequence(true)
  assert.equal(store.modelControls[0].active, false, '黑框眼镜被打断关闭')
  assert.equal(store.modelSliders[0].value, 0, 'Movement3 滑块被打断彻底复原为 defaultValue 0')
  assert.equal(store.modelSliders[1].value, 0, 'Param40 滑块被打断彻底复原为 defaultValue 0')
})

test('[BUG-ANIMATION-PARAM-DECOUPLING] 带动作预设在步骤中过滤动作位姿参数但完整保留未占用的表情参数', () => {
  const store = {
    presetEditingLocked: false,
    endPresetPreview: () => {},
    activeRunningPresetId: 'neutral',
    activeHoldPresetId: 'neutral',
    modelControls: [],
    modelSliders: [
      { id: 'PositionZ', value: 0, defaultValue: 0 },
      { id: 'ParamEyeLOpen', value: 0, defaultValue: 0 },
    ],
    statePresets: [],
    emotionAdapter: null,
    modelCapabilities: { motionGroups: { '表情动作': 1 } },
    currentEmotion: 'neutral',
    live2dModel: {},
  }
  const { usePresetController } = loadPresetControllerModule(store)

  const controller = usePresetController({
    isLive2dAvailable: () => true,
    getBaseHiddenParts: () => new Set(),
    playMotionWithPriority: () => true,
    stopMotion: () => {},
    reportControlsAndPresetsToHost: () => {},
    notifyIdleInteraction: () => {},
  })

  const preset = {
    id: 'test_preset',
    label: '测试',
    motion: { group: '表情动作', index: 0 },
    steps: [
      {
        label: '眨眼与位移',
        durationMs: 200,
        holdMs: 0,
        controls: [],
        // PositionZ 被动作占用，ParamEyeLOpen 未被占用
        parameters: { PositionZ: 15, ParamEyeLOpen: 0.8 },
      },
    ],
    finishMode: 'revert',
  }

  controller.handlePresetTrigger(preset)
  // PositionZ 被动作轨道接管，不应写入滑块
  assert.equal(store.modelSliders[0].value, 0, 'PositionZ 保持默认不被分镜参数覆盖')
  // ParamEyeLOpen 未被动作轨道占用，应该正常写入滑块生效
  assert.equal(store.modelSliders[1].value, 0.8, 'ParamEyeLOpen 正常生效写入滑块')
  store.modelSliders[0].value = 0
  controller.handlePresetTrigger({ ...preset, preview: true })
  assert.equal(store.modelSliders[0].value, 0, '整段工坊预览与保存后播放遵循同一轨道归属')
  assert.equal(store.modelSliders[1].value, 0.8)
})

test('[BUG-ANIMATION-LAYER-RELEASE] 预设打断时显式调用 releaseMotionLayer 释放动作层', () => {
  let released = false
  const store = {
    presetEditingLocked: false,
    endPresetPreview: () => {},
    activeRunningPresetId: 'neutral',
    activeHoldPresetId: 'neutral',
    modelControls: [],
    modelSliders: [],
    statePresets: [],
    emotionAdapter: null,
    modelCapabilities: { motionGroups: { '动作': 1 } },
    currentEmotion: 'neutral',
    live2dModel: {},
  }
  const { usePresetController } = loadPresetControllerModule(store)

  const controller = usePresetController({
    isLive2dAvailable: () => true,
    getBaseHiddenParts: () => new Set(),
    playMotionWithPriority: () => true,
    stopMotion: () => {},
    releaseMotionLayer: () => { released = true },
    reportControlsAndPresetsToHost: () => {},
    notifyIdleInteraction: () => {},
  })

  controller.cancelPresetSequence(true)
  assert.equal(released, true, '打断时成功调用 releaseMotionLayer')
})
