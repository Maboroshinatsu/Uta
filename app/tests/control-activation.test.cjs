'use strict'
// [B02: 预设步骤不再清空它从未声明过的控件] 所依赖的原语语义。
// applyControlActionToList 此前零覆盖，而修复后的控件层完全吊在 'off' 的精准性上。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const SRC = path.join(__dirname, '../src/renderer/services/live2d/emotion-adapter.ts')
const code = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const adapterModule = { exports: {} }
vm.runInNewContext(
  code,
  { module: adapterModule, exports: adapterModule.exports, require: id => id === './resource-metadata'
    ? require('./support/settings-loader.cjs')()('renderer/services/live2d/resource-metadata') : {} },
  { filename: SRC },
)
const { applyControlActionToList, inferControlCategory, resolveModelSliders, getAnimationTarget } = adapterModule.exports

function control(id, label, category, parameters, active = false) {
  return {
    id,
    label,
    category,
    parameters,
    hiddenParts: [],
    defaultActive: false,
    active,
    source: 'adapter',
  }
}

const activeIds = (list) => list.filter((c) => c.active).map((c) => c.id)

test('控件分类优先看 ID，避免被参数标签里的服装名带偏', () => {
  assert.equal(
    inferControlCategory('Open Arms', 'Open Arms (School Uniform / arms hiddenR / arms hiddenL)'),
    'pose_prop',
    'Open Arms 是姿势，不能因为参数里带 School Uniform 就变成常驻服装',
  )
  assert.equal(inferControlCategory('School Uniform', 'School Uniform'), 'outfit')
  assert.equal(inferControlCategory('Blush', 'Blush'), 'face_effect')
  assert.equal(
    inferControlCategory('蛋包饭', '蛋包饭 (点菜板 / 蛋包饭)'),
    'pose_prop',
    '餐桌道具不能被“包”误判成常驻服装',
  )
})

test('滑块不复读控件已接管的参数，并跳过纯分隔参数', () => {
  const caps = {
    parameters: [
      { id: 'axe', min: 0, max: 1, default: 0, name: 'axe' },
      { id: 'xf22', min: 0, max: 1, default: 0, name: '--------School Uniform---------' },
      { id: 'j1', min: 0, max: 1, default: 0, name: '出1' },
      { id: 'ParamMouthForm', min: -1, max: 1, default: 0, name: '嘴角弧度' },
      { id: 'ParamAngleX', min: -30, max: 30, default: 0, name: '头部左右' },
    ],
  }
  const controls = [control('axe', 'axe', 'pose_prop', { axe: 1 })]

  const sliders = resolveModelSliders(caps, controls, {}, ['j1', 'ParamAngleX'])

  assert.deepEqual(
    Array.from(sliders, (s) => s.id).sort(),
    ['ParamAngleX', 'ParamMouthForm'],
    '控件参数、分隔参数与动作内部通道不应再出现在滑块里；标准动作参数仍保留',
  )
})

test("'off' 只关掉点名的控件，用户手动开启的其他控件一律不受影响", () => {
  const controls = [
    control('hat', '帽子', 'outfit', { ParamHatOn: 1 }, true),
    control('glasses', '眼镜', 'outfit', { ParamGlassesOn: 1 }, true),
    control('mic', '麦克风', 'pose_prop', { ParamMicOn: 1 }, true),
  ]

  const res = applyControlActionToList(controls, ['hat'], 'off', null)

  assert.equal(res.changed, true)
  assert.deepEqual(activeIds(controls), ['glasses', 'mic'], '关帽子不该顺带摘掉眼镜和手里的麦克风')
})

test("'off' 传空清单时什么都不改（预设步骤没声明控件就不会造成破坏）", () => {
  const controls = [
    control('hat', '帽子', 'outfit', { ParamHatOn: 1 }, true),
    control('wings', '翅膀', 'face_effect', { ParamWingsOn: 1 }, true),
  ]

  const res = applyControlActionToList(controls, [], 'off', null)

  assert.equal(res.changed, false)
  assert.deepEqual(activeIds(controls), ['hat', 'wings'])
})

test("'on' 仍会解决互斥：换装关掉冲突的那一件，但不清空无关控件", () => {
  const controls = [
    control('outfit_a', '外套A', 'outfit', { ParamOutfit: 1 }, true),
    control('outfit_b', '外套B', 'outfit', { ParamOutfit: 2 }, false),
    control('hat', '帽子', 'outfit', { ParamHatOn: 1 }, true),
    control('blush', '脸红', 'face_effect', { ParamBlushOn: 1 }, true),
  ]

  applyControlActionToList(controls, ['outfit_b'], 'on', null)

  assert.deepEqual(activeIds(controls), ['outfit_b', 'hat', 'blush'], '换装只该关掉被冲突的外套A')
})

test("'on' 命中标签（label）同样生效，且互斥按参数冲突判定", () => {
  const controls = [
    control('outfit_a', '外套A', 'outfit', { ParamOutfit: 1 }, true),
    control('outfit_b', '外套B', 'outfit', { ParamOutfit: 2 }, false),
  ]

  const res = applyControlActionToList(controls, ['外套B'], 'on', null)

  assert.equal(res.matched?.id, 'outfit_b')
  assert.deepEqual(activeIds(controls), ['outfit_b'])
})

test("'reset_transient' 只回退非持久控件，服饰发型保留", () => {
  const controls = [
    control('hat', '帽子', 'outfit', { ParamHatOn: 1 }, true),
    control('twintail', '双马尾', 'hair', { ParamHair: 1 }, true),
    control('wings', '翅膀', 'face_effect', { ParamWings: 1 }, true),
  ]

  applyControlActionToList(controls, [], 'reset_transient', null)

  assert.deepEqual(activeIds(controls), ['hat', 'twintail'], '瞬态层回退不该摘掉用户的服饰与发型')
})

test('用户保持的瞬态部件不受待机/换装清理影响', () => {
  const controls = [
    control('spoon', '勺子', 'pose_prop', { ParamSpoon: 1 }, true),
    control('wings', '翅膀', 'face_effect', { ParamWings: 1 }, true),
    control('hat', '帽子', 'outfit', { ParamHatOn: 1 }, true),
  ]
  controls[0].held = true

  applyControlActionToList(controls, [], 'reset_transient', null)
  assert.deepEqual(activeIds(controls), ['spoon', 'hat'], '保持的手部道具不能被待机清理摘掉')

  applyControlActionToList(controls, [], 'set', null)
  assert.deepEqual(activeIds(controls), ['spoon', 'hat'], '换装批量设置同样保留保持部件')
})

test('保持标记随手动关闭、完整 reset 与互斥换装一起释放', () => {
  const controls = [
    control('spoon', '勺子', 'pose_prop', { ParamSpoon: 1 }, true),
    control('outfit_a', '外套A', 'outfit', { ParamOutfit: 1 }, true),
    control('outfit_b', '外套B', 'outfit', { ParamOutfit: 2 }, false),
    control('hat', '帽子', 'outfit', { ParamHatOn: 1 }, true),
  ]
  controls[0].held = true
  controls[1].held = true
  controls[3].held = true

  applyControlActionToList(controls, ['spoon'], 'off', null)
  assert.equal(controls[0].active, false)
  assert.equal(controls[0].held, false, '手动关闭必须同时取消保持')

  applyControlActionToList(controls, ['outfit_b'], 'on', null)
  assert.equal(controls[1].active, false)
  assert.equal(controls[1].held, false, '被互斥换装关掉的外套也要释放保持')

  applyControlActionToList(controls, [], 'reset', null)
  assert.equal(controls[3].active, false)
  assert.equal(controls[3].held, false, '完整 reset 仍应清空全部保持')
})


test('多阶段控件支持循环切换（大 -> 中 -> 小 -> 大）', () => {
  const multiStageCtrl = {
    id: '大小变',
    label: '大小变',
    category: 'toggle',
    stages: [
      { label: '大', parameters: { Clothes2: 0 } },
      { label: '中', parameters: { Clothes2: 0.4 } },
      { label: '小', parameters: { Clothes2: 1 } },
    ],
    defaultStageIndex: 0,
    currentStageIndex: 0,
    parameters: { Clothes2: 0 },
    hiddenParts: [],
    defaultActive: false,
    active: false,
    source: 'adapter',
  }
  const controls = [multiStageCtrl]

  // 第一次 toggle：从 大(0) 推进到 中(1)
  applyControlActionToList(controls, ['大小变'], 'toggle', null)
  assert.equal(multiStageCtrl.currentStageIndex, 1)
  assert.equal(multiStageCtrl.active, true)
  assert.equal(multiStageCtrl.parameters.Clothes2, 0.4)

  // 第二次 toggle：从 中(1) 推进到 小(2)
  applyControlActionToList(controls, ['大小变'], 'toggle', null)
  assert.equal(multiStageCtrl.currentStageIndex, 2)
  assert.equal(multiStageCtrl.active, true)
  assert.equal(multiStageCtrl.parameters.Clothes2, 1)

  // 第三次 toggle：回到默认阶段 大(0)，active 变为 false
  applyControlActionToList(controls, ['大小变'], 'toggle', null)
  assert.equal(multiStageCtrl.currentStageIndex, 0)
  assert.equal(multiStageCtrl.active, false)
  assert.equal(multiStageCtrl.parameters.Clothes2, 0)
})

test('多阶段控件支持按名称/索引冒号查询直达指定阶段', () => {
  const multiStageCtrl = {
    id: '大小变',
    label: '大小变',
    category: 'toggle',
    stages: [
      { label: '大', parameters: { Clothes2: 0 } },
      { label: '中', parameters: { Clothes2: 0.4 } },
      { label: '小', parameters: { Clothes2: 1 } },
    ],
    defaultStageIndex: 0,
    currentStageIndex: 0,
    parameters: { Clothes2: 0 },
    hiddenParts: [],
    defaultActive: false,
    active: false,
    source: 'adapter',
  }
  const controls = [multiStageCtrl]

  // 直达阶段 '小'
  applyControlActionToList(controls, ['大小变:小'], 'set', null)
  assert.equal(multiStageCtrl.currentStageIndex, 2)
  assert.equal(multiStageCtrl.active, true)
  assert.equal(multiStageCtrl.parameters.Clothes2, 1)

  // 直达阶段 '中'
  applyControlActionToList(controls, ['大小变:中'], 'set', null)
  assert.equal(multiStageCtrl.currentStageIndex, 1)
  assert.equal(multiStageCtrl.active, true)
  assert.equal(multiStageCtrl.parameters.Clothes2, 0.4)

  // 传 'off' 重置回默认阶段
  applyControlActionToList(controls, ['大小变'], 'off', null)
  assert.equal(multiStageCtrl.currentStageIndex, 0)
  assert.equal(multiStageCtrl.active, false)
  assert.equal(multiStageCtrl.parameters.Clothes2, 0)
})

test('VTS focus 姿态参数被映射为标准姿态滑块，并正确过滤分隔符与无用内部触发键', () => {
  const caps = {
    parameters: [
      { id: 'AngleX', min: -30, max: 30, default: 0, name: 'AngleX' },
      { id: 'AngleY', min: -30, max: 30, default: 0, name: 'AngleY' },
      { id: 'PositionX', min: -10, max: 10, default: 0, name: 'PositionX' },
      { id: 'Divider4', min: 0, max: 1, default: 0, name: '■■■■■■■■右眼■■■■■■' },
      { id: 'Anikey1', min: 0, max: 1, default: 0, name: 'Anikey1' },
      { id: 'Clothes2', min: 0, max: 1, default: 0, name: '大小变' },
    ],
  }
  const focus = {
    headXParam: 'AngleX',
    headYParam: 'AngleY',
    bodyXParam: 'PositionX',
  }
  const controls = [
    {
      id: '大小变',
      label: '大小变',
      category: 'toggle',
      stages: [
        { label: '大', parameters: { Clothes2: 0 } },
        { label: '小', parameters: { Clothes2: 1 } },
      ],
      parameters: { Clothes2: 0 },
      hiddenParts: [],
      defaultActive: false,
      active: false,
      source: 'adapter',
    },
  ]

  const sliders = resolveModelSliders(caps, controls, {}, [], focus)
  const sliderIds = sliders.map((s) => s.id)

  assert.ok(sliderIds.includes('AngleX'), 'VTS AngleX 应被包含在滑块中')
  assert.ok(sliderIds.includes('AngleY'), 'VTS AngleY 应被包含在滑块中')
  assert.ok(sliderIds.includes('PositionX'), 'VTS PositionX 应被包含在滑块中')
  assert.ok(!sliderIds.includes('Divider4'), 'Divider4 分隔符参数必须被过滤')
  assert.ok(!sliderIds.includes('Clothes2'), '已由 stages 控件接管的 Clothes2 不应重复暴露为滑块')

  const angleXSlider = sliders.find((s) => s.id === 'AngleX')
  assert.equal(angleXSlider.label, '头部左右 (X)')
  assert.equal(angleXSlider.group, 'pose')
})


test('VTS 参数标准：自动抑制官方死参数、识别 VTS 专有五官并过滤物理输出与特效通道', () => {
  const caps = {
    parameters: [
      // 官方标准死参数与真实 VTS 参数并存
      { id: 'ParamAngleX', min: -30, max: 30, default: 0, name: 'AngleX' },
      { id: 'ParamAngleY', min: -30, max: 30, default: 0, name: 'AngleY' },
      { id: 'ParamBodyAngleX', min: -10, max: 10, default: 0, name: 'BodyAngleX' },
      { id: 'AngleX', min: -30, max: 30, default: 0, name: 'OX' },
      { id: 'AngleY', min: -30, max: 30, default: 0, name: 'OY' },
      { id: 'PositionX', min: -30, max: 30, default: 0, name: 'OPX' },
      // VTS 专有五官面捕
      { id: 'EyeSmile', min: 0, max: 1, default: 0, name: '微笑' },
      { id: 'CheeckPuff', min: 0, max: 1, default: 0, name: '鼓脸' },
      { id: 'TongueOut', min: 0, max: 1, default: 0, name: '吐舌' },
      { id: 'JawOpen', min: 0, max: 1, default: 0, name: '下巴张开' },
      { id: 'Mouthpucker', min: 0, max: 1, default: 0, name: '嘟嘴' },
      // 物理输出参数（应被完全过滤）
      { id: 'HairFrontWave1', min: -1, max: 1, default: 0, name: '前发物理1' },
      { id: 'ChestWiggle', min: -1, max: 1, default: 0, name: '胸部物理' },
      // 内部特效与语音通道（应被完全过滤）
      { id: 'Colorflicker5', min: 0, max: 1, default: 0, name: '1号闪烁' },
      { id: 'LittleFlower1', min: 0, max: 1, default: 0, name: '小花飘动1' },
      { id: 'ParamSilence', min: 0, max: 1, default: 0, name: '静音' },
      { id: 'ParamA', min: 0, max: 1, default: 0, name: 'A口型' },
    ],
  }
  const physicsOutputs = ['HairFrontWave1', 'ChestWiggle']
  const vtsParams = [
    { input: 'FaceAngleX', output: 'AngleX' },
    { input: 'FaceAngleY', output: 'AngleY' },
    { input: 'FaceAngleX', output: 'PositionX' },
    { input: 'MouthSmile', output: 'EyeSmile' },
  ]

  const sliders = resolveModelSliders(caps, [], {}, [], undefined, vtsParams, physicsOutputs)
  const sliderMap = new Map(sliders.map((s) => [s.id, s]))

  // 1. 真实 VTS 参数应存在且获得优雅的中文标签与分组
  assert.ok(sliderMap.has('AngleX'), 'AngleX 必须存在')
  assert.equal(sliderMap.get('AngleX').label, '头部左右 (X)')
  assert.equal(sliderMap.get('AngleX').group, 'pose')

  assert.ok(sliderMap.has('PositionX'), 'PositionX 必须存在')
  assert.equal(sliderMap.get('PositionX').label, '身体左右 (X)')
  assert.equal(sliderMap.get('PositionX').group, 'pose')

  assert.ok(sliderMap.has('EyeSmile'), 'EyeSmile 必须存在')
  assert.equal(sliderMap.get('EyeSmile').label, '笑眼')
  assert.equal(sliderMap.get('EyeSmile').group, 'face')

  assert.ok(sliderMap.has('CheeckPuff'), 'CheeckPuff 必须存在')
  assert.equal(sliderMap.get('CheeckPuff').label, '脸颊鼓起')
  assert.equal(sliderMap.get('CheeckPuff').group, 'face')

  assert.ok(sliderMap.has('TongueOut'), 'TongueOut 必须存在')
  assert.equal(sliderMap.get('TongueOut').label, '吐舌')
  assert.equal(sliderMap.get('TongueOut').group, 'face')

  assert.ok(sliderMap.has('JawOpen'), 'JawOpen 必须存在')
  assert.equal(sliderMap.get('JawOpen').label, '下巴张开')

  assert.ok(sliderMap.has('Mouthpucker'), 'Mouthpucker 必须存在')
  assert.equal(sliderMap.get('Mouthpucker').label, '嘟嘴')

  // 2. 官方被替代的死参数必须被彻底抑制
  assert.ok(!sliderMap.has('ParamAngleX'), 'ParamAngleX 在有 AngleX 时必须被抑制')
  assert.ok(!sliderMap.has('ParamAngleY'), 'ParamAngleY 在有 AngleY 时必须被抑制')
  assert.ok(!sliderMap.has('ParamBodyAngleX'), 'ParamBodyAngleX 在有 PositionX 时必须被抑制')

  // 3. 物理输出参数必须被彻底过滤
  assert.ok(!sliderMap.has('HairFrontWave1'), '物理输出 HairFrontWave1 必须被过滤')
  assert.ok(!sliderMap.has('ChestWiggle'), '物理输出 ChestWiggle 必须被过滤')

  // 4. 特效通道与语音通道必须被彻底过滤
  assert.ok(!sliderMap.has('Colorflicker5'), '特效闪烁必须被过滤')
  assert.ok(!sliderMap.has('LittleFlower1'), '粒子小花必须被过滤')
  assert.ok(!sliderMap.has('ParamSilence'), '语音静音键必须被过滤')
  assert.ok(!sliderMap.has('ParamA'), '语音口型通道必须被过滤')
})

test('getAnimationTarget 支持显式动作、原生中文动作组与带索引语法', () => {
  const adapter = {
    animations: {
      wave: { motion: { group: 'Idle', index: 1 } },
      '挥手': { motion: { group: 'Wave', index: 0 } },
    },
  }
  const caps = {
    motionGroups: {
      '脱捕': 2,
      '狗尾巴草打开': 1,
      'Tap': 3,
    },
  }
  const target = (name) => {
    const res = getAnimationTarget(adapter, name, caps)
    return res ? JSON.parse(JSON.stringify(res)) : null
  }

  // 1. Adapter 显式映射
  assert.deepEqual(target('wave'), { motion: { group: 'Idle', index: 1 } })
  assert.deepEqual(target('挥手'), { motion: { group: 'Wave', index: 0 } })

  // 2. 原生中文动作组直连
  assert.deepEqual(target('脱捕'), { motion: { group: '脱捕', index: 0 } })
  assert.deepEqual(target('狗尾巴草打开'), { motion: { group: '狗尾巴草打开', index: 0 } })

  // 3. 语法 '动作#索引'
  assert.deepEqual(target('脱捕#1'), { motion: { group: '脱捕', index: 1 } })
  assert.deepEqual(target('Tap#2'), { motion: { group: 'Tap', index: 2 } })

  // 4. 不存在的动作组返回 null
  assert.equal(target('未定义动作'), null)
  assert.equal(target('脱捕#99'), null)

  // 5. 忽略大小写
  assert.deepEqual(target('WAVE'), { motion: { group: 'Idle', index: 1 } })
  assert.deepEqual(target('tap#1'), { motion: { group: 'Tap', index: 1 } })
})

test('黑框眼镜与道具类部件（pose_prop）在 reset_transient 与 off 时彻底关闭，不被误作常驻服装', () => {
  const controls = [
    control('glasses', '黑框眼镜', 'pose_prop', { key11: 1 }, true),
    control('teeth', '大牙', 'face_effect', { key9: 1 }, true),
    control('finger', '竖食指', 'pose_prop', { Movement3: 1 }, true),
    control('skirt', '长短裙', 'outfit', { key17: 1 }, true),
  ]

  // 1. 通过 off 单独关闭眼镜
  applyControlActionToList(controls, ['glasses'], 'off', null)
  assert.equal(controls.find((c) => c.id === 'glasses').active, false)
  assert.equal(controls.find((c) => c.id === 'skirt').active, true)

  // 重新激活眼镜测试 reset_transient
  controls.find((c) => c.id === 'glasses').active = true
  // 2. reset_transient 会关闭非持久类部件（黑框眼镜、大牙、竖食指），但保留用户的长短裙（outfit）
  applyControlActionToList(controls, [], 'reset_transient', null)
  assert.equal(controls.find((c) => c.id === 'glasses').active, false, '黑框眼镜应被 reset_transient 关闭')
  assert.equal(controls.find((c) => c.id === 'teeth').active, false, '大牙应被 reset_transient 关闭')
  assert.equal(controls.find((c) => c.id === 'finger').active, false, '竖食指应被 reset_transient 关闭')
  assert.equal(controls.find((c) => c.id === 'skirt').active, true, '用户的裙装应作为持久部件保留')
})


test('控件接管的姿态通道即使命中 focus 也不得再生成滑块', () => {
  const caps = {
    parameters: [
      { id: 'AngleX', min: -30, max: 30, default: 0, name: '头部左右', group: 'Pose' },
      { id: 'ParamAngleX', min: -30, max: 30, default: 0, name: '头部左右' },
      { id: 'ParamMouthForm', min: -1, max: 1, default: 0, name: '嘴角弧度' },
    ],
  }
  const focus = {
    headXParam: 'AngleX', headYParam: 'AngleY', headZParam: null,
    eyeXParam: 'ParamEyeBallX', eyeYParam: 'ParamEyeBallY',
    bodyXParam: null, bodyYParam: null, bodyZParam: null,
  }
  const controls = [control('pose', '姿势', 'pose_prop', { AngleX: 1, ParamAngleX: 1 })]
  const ids = Array.from(resolveModelSliders(caps, controls, {}, [], focus), (s) => s.id)
  assert.deepEqual(ids, ['ParamMouthForm'], '控件已接管的头部参数不能再以滑块出现')
})
