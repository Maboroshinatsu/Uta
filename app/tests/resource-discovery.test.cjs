const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./support/settings-loader.cjs')()
const { resolveModelControlsAndBase, resolveModelSliders } = load('renderer/services/live2d/emotion-adapter')
const { expressionResourceIndex } = load('renderer/services/live2d/resource-metadata')
const plain = value => JSON.parse(JSON.stringify(value))
const parameter = (id, extra = {}) => ({ id, min: -1, max: 1, default: 0, ...extra })
const adapter = (extra = {}) => ({ baseParameters: {}, hiddenParts: [], emotions: {}, animations: {}, controls: {}, ...extra })
const caps = parameters => ({ parameters, expressions: [], parts: [], motionGroups: {} })
const expression = (name, parameters) => ({ name, file: name + '.exp3.json', parameters })
const disk = (expressions, extra = {}) => ({ expressions, cdiParameters: {}, cdiParts: {}, physicsOutputIds: [], vtubeHotkeys: {}, ...extra })

test('nested same-name expressions retain file identity and only unambiguous aliases resolve', () => {
  const face = { ...expression('red', [{ id: 'Face', value: 1 }]), file: 'face/red.exp3.json', registeredName: 'Blush' }
  const costume = { ...expression('red', [{ id: 'Costume', value: 1 }]), file: 'costume/red.exp3.json' }
  const index = expressionResourceIndex([face, costume])
  assert.equal(index.get('red'), undefined)
  assert.equal(index.get('red.exp3.json'), undefined)
  assert.equal(index.get('face/red.exp3.json').parameters[0].id, 'Face')
  const a = adapter({ controls: { face: { expression: 'Blush' }, costume: { expression: './COSTUME\\red.exp3.json' } } })
  const result = resolveModelControlsAndBase(a, caps([parameter('Face'), parameter('Costume')]), disk([face, costume]))
  assert.equal(result.controls.length, 2)
  assert.deepEqual(plain(result.controls.map(c => c.parameters)), [{ Face: 1 }, { Costume: 1 }])
  const auto = resolveModelControlsAndBase(adapter(), caps([parameter('Face'), parameter('Costume')]), disk([face, costume], {
    vtubeHotkeys: { 'FACE\\RED.exp3.json': '脸红' },
  }))
  assert.equal(auto.controls.length, 2)
  assert.equal(auto.controls[0].label, '脸红')
})

test('negative-only switches use their real maximum as the alternate target', () => {
  const result = resolveModelControlsAndBase(adapter(), caps([parameter('Switch', { min: -2, max: -1, default: -2, name: '配件开关' })]), disk([]))
  assert.equal(result.controls[0].parameters.Switch, -1)
})

test('expression operations sharing parameters survive; only equivalent operations are deduplicated', () => {
  const model = caps([parameter('Brow')])
  const assets = disk([expression('left', [{ id: 'Brow', value: -1 }]), expression('right', [{ id: 'Brow', value: 1 }]),
    expression('right-copy', [{ id: 'Brow', value: 1 }])], { vtubeHotkeys: { 'left.exp3.json': 'Brow', 'right.exp3.json': 'Brow' } })
  const result = resolveModelControlsAndBase(adapter(), model, assets)
  assert.deepEqual(Array.from(result.controls, c => c.parameters.Brow).sort(), [-1, 1])
  assert.equal(new Set(result.controls.map(c => c.id)).size, 2, '同名热键不能吞掉不同操作')
  const explicit = resolveModelControlsAndBase(adapter({ controls: { brow: { parameters: { Brow: 1 } } } }), model, assets)
  assert.deepEqual(Array.from(explicit.controls, c => c.parameters.Brow).sort(), [-1, 1])
})

test('separate controls do not erase a combined native expression', () => {
  const result = resolveModelControlsAndBase(adapter({ controls: { a: { parameters: { A: 1 } }, b: { parameters: { B: 1 } } } }),
    caps([parameter('A'), parameter('B')]), disk([expression('both', [{ id: 'A', value: 1 }, { id: 'B', value: 1 }])]))
  assert.equal(result.controls.length, 3)
  assert.deepEqual(plain(result.controls.find(c => c.id === 'both').parameters), { A: 1, B: 1 })
})

test('staged adapter operations deduplicate equivalent expressions without claiming every value on that channel', () => {
  const result = resolveModelControlsAndBase(adapter({ controls: { stages: { stages: [
    { label: '默认', parameters: { A: 0 } }, { label: '开', parameters: { A: 1 } },
  ] } } }), caps([parameter('A')]), disk([
    expression('same', [{ id: 'A', value: 1 }]), expression('other-direction', [{ id: 'A', value: -1 }]),
  ]))
  assert.equal(result.controls.length, 2)
  assert.equal(result.controls.find(c => c.id === 'other-direction').parameters.A, -1)
})

test('unknown expression IDs and pure no-ops never reserve slider channels', () => {
  const model = caps([parameter('Real', { name: '可调输入' })])
  const result = resolveModelControlsAndBase(adapter(), model, disk([expression('phantom', [{ id: 'Ghost', value: 1 }]),
    expression('noop', [{ id: 'Real', value: 0, blend: 'Add' }])]))
  assert.equal(result.controls.length, 0)
  assert.deepEqual(Array.from(resolveModelSliders(model, result.controls), slider => slider.id), ['Real'])
})

test('expression discovery applies native blend semantics and drops no-op writes and unknown IDs', () => {
  const result = resolveModelControlsAndBase(adapter(), caps([parameter('Add', { default: .25 }), parameter('Multiply', { default: 1 }), parameter('Reset', { default: .4 })]),
    disk([expression('combined', [{ id: 'Add', value: .5, blend: 'Add' }, { id: 'Multiply', value: .5, blend: 'Multiply' },
      { id: 'Reset', value: 0, blend: 'Overwrite' }, { id: 'Ghost', value: 1 }]), expression('noop', [{ id: 'Add', value: 0, blend: 'Add' }])]))
  assert.equal(result.controls.length, 1)
  assert.deepEqual(plain(result.controls[0].parameters), { Add: .75, Multiply: .5, Reset: 0 })
})

test('mixed watermark and face expressions preserve the face operation while watermark remains in the base', () => {
  const model = caps([parameter('Watermark', { min: 0, max: 30, name: '水印开关' }), parameter('Blush', { min: 0, name: '脸红' })])
  const result = resolveModelControlsAndBase(adapter(), model, disk([
    expression('red', [{ id: 'Watermark', value: 0, blend: 'Overwrite' }, { id: 'Blush', value: 1, blend: 'Add' }]),
    expression('remove-watermark', [{ id: 'Watermark', value: 30 }]),
  ]))
  assert.equal(result.baseParameters.Watermark, 30)
  assert.equal(result.controls.length, 1)
  assert.deepEqual(plain(result.controls[0].parameters), { Blush: 1 })
})

test('emotion routing does not remove authored expression controls and unregistered inlining shares blend rules', () => {
  const a = adapter({ emotions: { happy: { expression: 'smile' } } })
  const result = resolveModelControlsAndBase(a, caps([parameter('Smile', { default: .2 })]), disk([expression('smile', [{ id: 'Smile', value: .3, blend: 'Add' }])]))
  assert.equal(a.emotions.happy.parameters.Smile, .5)
  assert.equal(result.controls.length, 1)
})

test('confirmed slider inputs outrank noisy names and groups; actual outputs, base and controls stay excluded', () => {
  const model = caps([parameter('BodyInput', { name: '唯一发布渠道：账号', group: '表情物理' }), parameter('ParamBrowLForm', { group: '眉毛物理' }),
    parameter('VtsLive', { name: '发布者账号', group: '物理' }), parameter('Output', { isPhysicsOutput: true }), parameter('Base'), parameter('Owned')])
  const sliders = resolveModelSliders(model, [{ parameters: { Owned: 1 } }], { Base: 1 }, [],
    { bodyXParam: 'BodyInput' }, [{ input: 'Custom', output: 'VtsLive' }, { input: 'Custom', output: 'Output' }])
  assert.deepEqual(Array.from(sliders, s => s.id).sort(), ['BodyInput', 'ParamBrowLForm', 'VtsLive'].sort())
  assert.equal(sliders.find(s => s.id === 'BodyInput').label, '身体左右 (X)')
  assert.equal(sliders.find(s => s.id === 'VtsLive').label, 'VtsLive')
})

test('an explicitly named accessory switch is not discarded because its ID begins with a standard prefix', () => {
  const result = resolveModelControlsAndBase(adapter(), caps([parameter('ParamMouthAccessorySwitch', { min: 0, name: '口罩开关' })]), disk([]))
  assert.equal(result.controls.length, 1)
  assert.equal(result.controls[0].parameters.ParamMouthAccessorySwitch, 1)
})

test('equal display names do not erase independent parameter switches or pose alternatives', () => {
  const model = caps([parameter('First', { name: '配件开关' }), parameter('Second', { name: '配件开关' })])
  model.parts = [{ id: 'Main', name: '主姿态' }, { id: 'Left', name: '备用姿态' }, { id: 'Right', name: '备用姿态' }]
  const result = resolveModelControlsAndBase(adapter(), model, disk([], { poseGroups: [['Main', 'Left', 'Right']] }))
  assert.equal(result.controls.length, 4)
  assert.equal(new Set(result.controls.map(c => c.id)).size, 4)
  assert.ok(result.controls.some(c => c.parameters.Second === 1))
  assert.ok(result.controls.some(c => c.shownParts?.includes('Right')))
})

test('a part ID collision with an unrelated explicit control keeps both real operations', () => {
  const model = caps([parameter('A')]);model.parts = [{ id: 'Main' }, { id: 'Accessory' }]
  const result = resolveModelControlsAndBase(adapter({ controls: { Accessory: { parameters: { A: 1 } } } }), model,
    disk([], { poseGroups: [['Main', 'Accessory']] }))
  assert.equal(result.controls.length, 2)
  assert.ok(result.controls.some(c => c.shownParts?.includes('Accessory')))
})

test('a switch already at its maximum remains a usable slider instead of an ineffective on/off control', () => {
  const model = caps([parameter('Switch', { min: 0, max: 1, default: 1, name: '配件开关' })])
  const result = resolveModelControlsAndBase(adapter(), model, disk([]))
  assert.equal(result.controls.length, 0)
  const sliders = resolveModelSliders(model, result.controls)
  assert.equal(sliders.length, 1)
  assert.equal(sliders[0].defaultValue, 1)
  assert.equal(sliders[0].min, 0)
})
