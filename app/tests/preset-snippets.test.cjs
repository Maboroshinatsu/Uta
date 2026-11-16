'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const snippets = createLoader()('renderer/services/preset-snippets')
const plain = (value) => JSON.parse(JSON.stringify(value))

const PARAMETERS = [
  { id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 },
  { id: 'ParamEyeROpen', min: 0, max: 1, default: 1 },
  { id: 'ParamAngleY', min: -30, max: 30, default: 0 },
  { id: 'ParamAngleZ', min: -30, max: 30, default: 0 },
  { id: 'ParamMouthOpenY', min: 0, max: 1, default: 0 },
]
const BASE = { controls: ['hat'], parameters: { ParamAngleX: 4 } }

test('blink and gaze snippets create two real parameter keyframes', () => {
  const blink = snippets.buildQuickSnippet('blink', PARAMETERS, {
    controls: BASE.controls,
    parameters: { ...BASE.parameters, ParamEyeLOpen: 0.8, ParamEyeROpen: 0.7 },
  })
  assert.equal(blink.length, 2)
  assert.deepEqual(plain(blink.map((step) => step.label)), ['眨眼·闭', '眨眼·睁'])
  assert.equal(blink[0].parameters.ParamEyeLOpen, 0)
  assert.equal(blink[0].parameters.ParamEyeROpen, 0)
  assert.equal(blink[1].parameters.ParamEyeLOpen, 0.8)
  assert.equal(blink[1].parameters.ParamEyeROpen, 0.7)
  assert.equal(blink[0].parameters.ParamAngleX, 4, 'base parameters are preserved')
  assert.deepEqual(plain(blink[0].controls), ['hat'])

  const nod = snippets.buildQuickSnippet('nod', PARAMETERS, BASE)
  assert.equal(nod.length, 2)
  assert.notEqual(nod[0].parameters.ParamAngleY, nod[1].parameters.ParamAngleY)
  assert.equal(nod[1].parameters.ParamAngleY, 0)

  const tilt = snippets.buildQuickSnippet('tilt', PARAMETERS, BASE)
  assert.notEqual(tilt[0].parameters.ParamAngleZ, tilt[1].parameters.ParamAngleZ)

  const gasp = snippets.buildQuickSnippet('gasp', PARAMETERS, BASE)
  assert.equal(gasp.length, 2)
  assert.equal(gasp[0].parameters.ParamEyeLOpen, 1)
  assert.equal(gasp[0].parameters.ParamMouthOpenY, 0.75)
  assert.equal(gasp[1].parameters.ParamMouthOpenY, 0)
})

test('missing capability disables the snippet instead of copying a pose', () => {
  const noEyes = PARAMETERS.filter((parameter) => !parameter.id.startsWith('ParamEye'))
  assert.equal(snippets.canBuildQuickSnippet('blink', noEyes), false)
  assert.equal(snippets.buildQuickSnippet('blink', noEyes, BASE), null)
  assert.equal(snippets.canBuildQuickSnippet('nod', PARAMETERS), true)
  const noHead = PARAMETERS.filter((parameter) => parameter.id !== 'ParamAngleY')
  assert.equal(snippets.canBuildQuickSnippet('nod', noHead), false)
  const noMouth = PARAMETERS.filter((parameter) => parameter.id !== 'ParamMouthOpenY')
  assert.equal(snippets.canBuildQuickSnippet('gasp', noMouth), false)
  assert.equal(snippets.buildQuickSnippet('gasp', noMouth, BASE), null)
})

test('values stay inside the model parameter range', () => {
  const nearMin = PARAMETERS.map((parameter) =>
    parameter.id === 'ParamAngleY' ? { ...parameter, default: -30 } : parameter,
  )
  const nod = snippets.buildQuickSnippet('nod', nearMin, {
    controls: [],
    parameters: { ParamAngleY: -30 },
  })
  assert.equal(nod[0].parameters.ParamAngleY, -22, 'offset flips direction at the min bound')
})
