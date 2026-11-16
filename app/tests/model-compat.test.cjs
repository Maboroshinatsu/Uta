'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')

test('parameter-driven emotions fade instead of hard-cutting', () => {
  const expressions = read('src/renderer/composables/useExpressionState.ts')
  assert.match(expressions, /EMOTION_PARAM_TRANSITION_MS = 180/)
  assert.match(expressions, /applyParameters\(model, target\.parameters, \{ transitionMs: EMOTION_PARAM_TRANSITION_MS \}\)/)
  assert.match(expressions, /applyParameters\(model, \{\}, \{ transitionMs: EMOTION_PARAM_TRANSITION_MS \}\)/)
})

test('models without usable blink parameters are reported honestly', () => {
  const animation = read('src/renderer/composables/useLive2DAnimation.ts')
  assert.match(animation, /getParameterIds\?\.\(\)\.length === 0/)
  assert.match(animation, /no usable EyeBlink group/)
})

test('a static portrait keeps its emotion while the pet is speaking', () => {
  const stage = read('src/renderer/components/StaticStage.vue')
  assert.match(stage, /if \(store\.isSpeaking\) \{[\s\S]{0,120}setTimeout\(revertWhenIdle, 400\)[\s\S]{0,80}return/)
  assert.match(stage, /store\.currentEmotion = m\.default/)
})

test('a missing selected model tells the user instead of silently switching', () => {
  const discovery = read('src/renderer/services/live2d/model-discovery.ts')
  assert.match(discovery, /consumeModelFallbackNotice/)
  assert.match(discovery, /原来的角色「/)
  assert.match(discovery, /fallbackNotice = /)

  const lifecycle = read('src/renderer/composables/useStageModelLifecycle.ts')
  assert.match(lifecycle, /modelNotice\.value = consumeModelFallbackNotice\(\)/)

  const stage = read('src/renderer/components/DeskpetStage.vue')
  assert.match(stage, /watch\(modelNotice, \(notice\) => \{/)
})

test('an unreadable Live2D settings file gets a plain-language error', () => {
  const lifecycle = read('src/renderer/composables/useStageModelLifecycle.ts')
  assert.match(lifecycle, /unknown settings format/i)
  assert.match(lifecycle, /角色文件不是有效的 Live2D 模型。/)
})
