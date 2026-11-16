'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const adapterSrc = path.join(__dirname, '../src/renderer/services/live2d/emotion-adapter.ts')
const adapterCode = ts.transpileModule(fs.readFileSync(adapterSrc, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const adapterModule = { exports: {} }
vm.runInNewContext(
  adapterCode,
  { module: adapterModule, exports: adapterModule.exports, require: spec => spec.endsWith('/native-motion')
    ? require('./support/settings-loader.cjs')()('shared/native-motion') : {} },
  { filename: adapterSrc },
)

const exporterSrc = path.join(__dirname, '../src/renderer/services/live2d/motion-exporter.ts')
const exporterCode = ts.transpileModule(fs.readFileSync(exporterSrc, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const exporterModule = { exports: {} }
const customRequire = (spec) => {
  if (spec.endsWith('/native-motion')) return require('./support/settings-loader.cjs')()('shared/native-motion')
  if (spec === './emotion-adapter') return adapterModule.exports
  if (spec === './loader') return {}
  return require(spec)
}
vm.runInNewContext(
  exporterCode,
  { module: exporterModule, exports: exporterModule.exports, require: customRequire },
  { filename: exporterSrc },
)

const {
  formatMotionFilename,
  easeInOutCubic,
  roundTo,
  exportPresetStepsToMotion3,
} = exporterModule.exports

test('formatMotionFilename 规范化动作文件名', () => {
  assert.equal(formatMotionFilename('dafish-bow'), 'dafish-bow.motion3.json')
  assert.equal(formatMotionFilename('custom_action.json'), 'custom_action.motion3.json')
  assert.equal(formatMotionFilename('already_exported.motion3.json'), 'already_exported.motion3.json')
  assert.equal(formatMotionFilename('非法:字符*测试?'), '非法_字符_测试_.motion3.json')
  assert.equal(formatMotionFilename('   '), 'uta-motion.motion3.json')
})

test('easeInOutCubic 缓动曲线与边界钳制', () => {
  assert.equal(easeInOutCubic(0), 0)
  assert.equal(easeInOutCubic(1), 1)
  assert.equal(easeInOutCubic(0.5), 0.5)
  assert.equal(easeInOutCubic(0.25), 0.0625)
  assert.equal(easeInOutCubic(-0.5), 0)
  assert.equal(easeInOutCubic(1.5), 1)
})

test('exportPresetStepsToMotion3 导出单个步骤 + revert 收尾', () => {
  const steps = [
    {
      label: '点头微倾',
      durationMs: 400,
      holdMs: 200,
      controls: [],
      parameters: {
        AngleX: 12.0,
        EyeSmile: 0.8,
      },
    },
  ]

  const sliders = [
    { id: 'AngleX', label: '头部 X', defaultValue: 0, min: -30, max: 30, group: 'pose' },
    { id: 'EyeSmile', label: '微笑', defaultValue: 0, min: 0, max: 1, group: 'face' },
    { id: 'AngleY', label: '头部 Y', defaultValue: 0, min: -30, max: 30, group: 'pose' },
  ]

  const motion = exportPresetStepsToMotion3(
    steps,
    {
      fps: 30,
      finishMode: 'revert',
      revertHoldMs: 1000,
      revertTransitionMs: 500,
    },
    { sliders, controls: [], capabilities: null },
  )

  assert.equal(motion.Version, 3)
  assert.equal(motion.Meta.Fps, 30)
  assert.equal(motion.Meta.Loop, false)
  // 总时长: 0.4s (trans) + 0.2s (hold) + 1.0s (revertHold) + 0.5s (revertTrans) = 2.1s
  assert.equal(motion.Meta.Duration, 2.1)

  // 验证未发生变化的 AngleY 被自动剔除，只有 AngleX 和 EyeSmile 有曲线
  assert.equal(motion.Meta.CurveCount, 2)
  const angleXCurve = motion.Curves.find((c) => c.Id === 'AngleX')
  const eyeSmileCurve = motion.Curves.find((c) => c.Id === 'EyeSmile')
  assert.ok(angleXCurve, '应存在 AngleX 曲线')
  assert.ok(eyeSmileCurve, '应存在 EyeSmile 曲线')

  // Segments 格式验证：以 [0, 初始值] 开头，后续每项为 [0, 时间, 目标值]
  assert.equal(angleXCurve.Segments[0], 0)
  assert.equal(angleXCurve.Segments[1], 0) // 初始 resting 值

  // 检查 Meta 中段数和点数的一致性
  const expectedSegments = motion.Curves.reduce((acc, c) => acc + (c.Segments.length - 2) / 3, 0)
  assert.equal(motion.Meta.TotalSegmentCount, expectedSegments)
  assert.equal(motion.Meta.TotalPointCount, expectedSegments + motion.Curves.length)

  // 终态回待机验证：最后一个采样点的值必须平滑回到默认值 0
  const lastX = angleXCurve.Segments[angleXCurve.Segments.length - 1]
  assert.equal(lastX, 0)
})

test('循环导出从首帧开始且不重复烘焙首步入场过渡', () => {
  const motion = exportPresetStepsToMotion3([
    { durationMs: 600, holdMs: 200, controls: [], parameters: { AngleX: -8 } },
    { durationMs: 400, holdMs: 0, controls: [], parameters: { AngleX: 8 } },
  ], { finishMode: 'loop', fps: 30 }, { sliders: [{ id: 'AngleX', defaultValue: 0 }] })
  assert.equal(motion.Meta.Duration, .6, '仅保留首帧保持和后续运动')
  const curve = motion.Curves.find(c => c.Id === 'AngleX')
  assert.equal(curve.Segments[1], -8)
  assert.equal(curve.Segments.at(-1), 8, '末帧到首帧不额外烘焙回程动画')
  assert.equal(curve.Segments[4], -8, '首帧保持时间不被丢弃')
})

test('exportPresetStepsToMotion3 自动过滤物理输出参数与静态参数', () => {
  const steps = [
    {
      label: '物理测试',
      durationMs: 300,
      holdMs: 100,
      controls: [],
      parameters: {
        AngleX: 10,
        ParamHairFront: 1.0, // 物理输出参数
        ParamStatic: 0.0, // 保持默认值不变的参数
      },
    },
  ]

  const sliders = [
    { id: 'AngleX', label: '头部 X', defaultValue: 0, min: -30, max: 30, group: 'pose' },
    { id: 'ParamHairFront', label: '前发摆动', defaultValue: 0, min: -1, max: 1, group: 'extra' },
    { id: 'ParamStatic', label: '静态参数', defaultValue: 0, min: -1, max: 1, group: 'extra' },
  ]

  const motion = exportPresetStepsToMotion3(
    steps,
    {
      fps: 30,
      finishMode: 'hold',
      excludePhysicsOutputs: true,
      physicsOutputIds: ['ParamHairFront'],
    },
    { sliders, controls: [], capabilities: null },
  )

  // 物理输出与静态参数都应被排除，只保留 AngleX
  assert.equal(motion.Meta.CurveCount, 1)
  assert.equal(motion.Curves[0].Id, 'AngleX')
})

test('exportPresetStepsToMotion3 支持多段控件烘焙（大小变:中 / 小）', () => {
  const multiStageControl = {
    id: '大小变',
    label: '大小变',
    category: 'clothing',
    parameters: { Clothes2: 0.0 },
    stages: [
      { label: '大', parameters: { Clothes2: 0.0 } },
      { label: '中', parameters: { Clothes2: 0.4 } },
      { label: '小', parameters: { Clothes2: 1.0 } },
    ],
    defaultStageIndex: 0,
    currentStageIndex: 0,
    active: false,
    source: 'builtin',
    hiddenParts: [],
  }

  const steps = [
    {
      label: '切换中号',
      durationMs: 500,
      holdMs: 200,
      controls: ['大小变:中'],
      parameters: {},
    },
    {
      label: '切换小号',
      durationMs: 500,
      holdMs: 200,
      controls: ['大小变:小'],
      parameters: {},
    },
  ]

  const motion = exportPresetStepsToMotion3(
    steps,
    { fps: 30, finishMode: 'hold' },
    { sliders: [], controls: [multiStageControl], capabilities: { parameters: [{ id: 'Clothes2', default: 0.2 }] } },
  )

  assert.equal(motion.Meta.CurveCount, 1)
  const curve = motion.Curves[0]
  assert.equal(curve.Id, 'Clothes2')

  // 第 1 步过渡结束（0.5s）时值应到达 0.4
  // 第 2 步过渡结束（0.5 + 0.2 + 0.5 = 1.2s）时值应到达 1.0
  const segs = curve.Segments
  assert.equal(segs[1], 0.2, 'control-only parameters begin from the actual model default')
  let foundMid = false
  let foundEnd = false
  for (let i = 2; i < segs.length; i += 3) {
    const t = segs[i + 1]
    const v = segs[i + 2]
    if (Math.abs(t - 0.5) < 0.04 && Math.abs(v - 0.4) < 0.05) foundMid = true
    if (Math.abs(t - 1.2) < 0.04 && Math.abs(v - 1.0) < 0.05) foundEnd = true
  }
  assert.ok(foundMid, '第 1 步应烘焙出中段 0.4 附近的关键帧')
  assert.ok(foundEnd, '第 2 步应烘焙出小段 1.0 附近的关键帧')
})

test('exportPresetStepsToMotion3 支持循环动作与部件显隐 PartOpacity', () => {
  const partsControl = {
    id: '披风开关',
    label: '披风开关',
    category: 'clothing',
    parameters: {},
    active: false,
    source: 'builtin',
    hiddenParts: ['PartCape'],
  }

  const steps = [
    {
      label: '隐藏披风',
      durationMs: 300,
      holdMs: 100,
      controls: ['披风开关'],
      parameters: { AngleZ: 5 },
    },
  ]

  const sliders = [
    { id: 'AngleZ', label: '歪头', defaultValue: 0, min: -30, max: 30, group: 'pose' },
  ]

  const motion = exportPresetStepsToMotion3(
    steps,
    { fps: 30, finishMode: 'loop' },
    { sliders, controls: [partsControl], capabilities: null },
  )

  assert.equal(motion.Meta.Loop, true)
  const partCurve = motion.Curves.find((c) => c.Target === 'PartOpacity' && c.Id === 'PartCape')
  assert.ok(partCurve, '应生成 PartOpacity 曲线')
  // 最终透明度降至 0.0
  const lastOp = partCurve.Segments[partCurve.Segments.length - 1]
  assert.equal(lastOp, 0)
})

test('exportPresetStepsToMotion3 拒绝包含原生动作的分镜步骤', () => {
  const steps = [
    {
      durationMs: 400,
      holdMs: 200,
      parameters: { ParamAngleX: 10 },
      motion: { group: 'tap_body', index: 0 },
    },
  ]
  assert.throws(
    () => exportPresetStepsToMotion3(steps),
    /分镜步骤中包含绑定的原生动作（tap_body）/,
  )
  assert.throws(() => exportPresetStepsToMotion3([{ ...steps[0], motion: { group: '', index: 1 } }]), /未命名动作组/)
})

