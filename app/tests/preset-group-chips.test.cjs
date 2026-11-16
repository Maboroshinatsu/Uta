'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./support/settings-loader.cjs')()
const { derivePresetGroupOptions, PRESET_EMOTION_GROUPS } = load('renderer/services/live2d/emotion-adapter')

// 转译加载器返回的数组来自另一个 realm，直接 .map 会沿用它的构造器，
// 导致 deepStrictEqual 因原型不同而失败；先展开成本 realm 数组再归一化。
const plain = (list) => [...list].map((item) => ({ group: item.group, emotion: item.emotion }))

const dafishPack = [
  { id: 'dafish-neutral', label: '日常·呼吸', group: '日常', emotion: 'neutral' },
  { id: 'dafish-happy', label: '开心·身体主导', group: '开心', emotion: 'happy' },
  { id: 'dafish-curious', label: '好奇·大歪头', group: '好奇', emotion: 'curious' },
  { id: 'dafish-surprised', label: '惊讶·后仰', group: '惊讶', emotion: 'surprise' },
  { id: 'dafish-sad', label: '难过·垂头', group: '难过', emotion: 'sad' },
  { id: 'dafish-angry', label: '生气·前倾', group: '生气', emotion: 'angry' },
  { id: 'dafish-shy', label: '害羞·遮脸', group: '害羞', emotion: 'shy' },
  { id: 'dafish-thinking', label: '思考·托腮', group: '思考', emotion: 'thinking' },
  { id: 'dafish-well-actually', label: '趣味表演·说教', group: '趣味表演', emotion: 'thinking' },
]

test('group chips come from the presets actually loaded for this model', () => {
  assert.deepEqual(
    [...derivePresetGroupOptions(dafishPack)].map((option) => option.group),
    ['日常', '开心', '好奇', '惊讶', '难过', '生气', '害羞', '思考', '趣味表演'],
    '大肥鱼的短分组必须原样出现，不能被旧静态表里的长名字覆盖',
  )
  assert.deepEqual(
    plain(derivePresetGroupOptions(dafishPack).filter((option) => option.group === '惊讶')),
    [{ group: '惊讶', emotion: 'surprise' }],
  )
})

test('a group appears once and keeps the emotion of its first preset', () => {
  const presets = [
    { id: 'a', label: '开心·元气', group: '开心', emotion: 'happy' },
    { id: 'b', label: '开心·歪头', group: '开心', emotion: 'curious' },
  ]
  assert.deepEqual(plain(derivePresetGroupOptions(presets)), [{ group: '开心', emotion: 'happy' }])
})

test('presets without an explicit group still resolve through the shared rule', () => {
  assert.deepEqual(
    plain(derivePresetGroupOptions([{ id: 'shy-peek', label: '害羞·偷看', emotion: 'shy' }])),
    [{ group: '害羞', emotion: 'shy' }],
  )
})

test('an empty preset list falls back to the static table instead of an empty workshop', () => {
  assert.deepEqual(plain(derivePresetGroupOptions([])), plain(PRESET_EMOTION_GROUPS))
  assert.deepEqual(plain(derivePresetGroupOptions(undefined)), plain(PRESET_EMOTION_GROUPS))
})
