import type { ModelCapabilities } from './loader'
import type { EmotionMotionTarget, ModelEmotionAdapter, ModelStatePreset, PresetKeyframeStep, ResolvedModelControl, ResolvedModelSlider } from './emotion-adapter'
import { alignDefaultPresetSlots } from './natural-presets'

const CHANNELS = {
  headX: [['AngleX'], ['FaceAngleX']], headY: [['AngleY'], ['FaceAngleY']], headZ: [['AngleZ'], ['FaceAngleZ']],
  bodyX: [['BodyAngleX'], []], bodyY: [['BodyAngleY'], []], bodyZ: [['BodyAngleZ'], []],
  eyeX: [['EyeBallX'], ['EyeRightX', 'EyeLeftX']], eyeY: [['EyeBallY'], ['EyeRightY', 'EyeLeftY']],
  eyeL: [['EyeLOpen'], ['EyeOpenLeft']], eyeR: [['EyeROpen'], ['EyeOpenRight']],
  eyeSmile: [['EyeSmile', 'EyeLSmile', 'EyeRSmile'], []],
  brow: [['BrowLY', 'BrowRY', 'BrowInnerUp'], ['BrowLeftY', 'BrowRightY', 'Brows']],
  smile: [['MouthForm', 'MouthSmile', 'MouthSmileL', 'MouthSmileR'], ['MouthSmile']],
  mouth: [['MouthOpenY'], ['MouthOpen', 'JawOpen']],
  cheek: [['Cheek'], []],
} as const

type Channel = keyof typeof CHANNELS
type Pose = Partial<Record<Channel, number>>
type Frame = [label: string, durationMs: number, holdMs: number, pose: Pose]
interface Recipe {
  id: string
  emotion: string
  description: string
  names: RegExp
  frames: Frame[]
  fallback: [peak: number, accent: number]
}

const RECIPES: Recipe[] = [
  { id: 'happy', emotion: 'happy', description: '抬头展颜，轻轻点一下头', names: /^(开心|高兴|笑|微笑|笑脸|happy|smile|cheer)$/i,
    frames: [['抬头展颜', 380, 220, { headY: .17, headZ: -.12, bodyY: .10, smile: .55, eyeSmile: .42, brow: .18 }],
      ['笑意舒展', 340, 300, { headY: .07, headZ: .13, smile: .38, eyeSmile: .30 }]], fallback: [.25, .09] },
  { id: 'curious', emotion: 'curious', description: '侧头打量，视线移向一侧', names: /^(好奇|问号|curious|wonder)$/i,
    frames: [['侧头打量', 530, 260, { headX: .18, headY: .10, headZ: .27, bodyZ: .13, eyeX: .22, brow: .18 }],
      ['定睛看看', 420, 280, { headX: .10, headY: .05, headZ: .19, eyeX: .08, smile: .10 }]], fallback: [.14, .27] },
  { id: 'surprised', emotion: 'surprise', description: '快速抬头睁眼，再慢慢平复', names: /^(惊讶|吃惊|感叹号|surprise|surprised|shocked)$/i,
    frames: [['忽然一惊', 220, 220, { headY: .23, headZ: -.10, bodyY: -.12, eyeL: .65, eyeR: .65, brow: .45, mouth: .48 }],
      ['渐渐平复', 490, 160, { headY: .06, eyeL: .16, eyeR: .16, mouth: .14 }]], fallback: [.44, .12] },
  { id: 'sad', emotion: 'sad', description: '缓慢低头垂眼，停一会儿再抬起', names: /^(委屈|难过|悲伤|哭|哭泣|sad|cry|tears)$/i,
    frames: [['垂眼低头', 680, 350, { headX: -.07, headY: -.21, headZ: -.10, bodyY: -.13, eyeY: -.23, eyeL: -.32, eyeR: -.32, smile: -.36 }],
      ['情绪缓下来', 570, 420, { headY: -.13, eyeY: -.10, eyeL: -.19, eyeR: -.19, smile: -.24 }]], fallback: [-.24, -.15] },
  { id: 'angry', emotion: 'angry', description: '迅速偏头压眉，再回看', names: /^(生气|愤怒|怒|angry|anger|mad)$/i,
    frames: [['偏头压眉', 300, 230, { headX: -.27, headY: -.09, headZ: -.14, bodyX: -.14, eyeX: -.17, brow: -.40, smile: -.30 }],
      ['回眼直视', 360, 320, { headX: .06, headY: -.04, eyeX: .10, brow: -.31, smile: -.24 }]], fallback: [-.35, .10] },
  { id: 'shy', emotion: 'shy', description: '垂眸偏头，再抬眼偷看', names: /^(害羞|脸红|红晕|羞涩|shy|blush|embarrassed)$/i,
    frames: [['垂眸偏头', 470, 300, { headX: .13, headY: -.16, headZ: .19, bodyZ: .09, eyeX: .20, eyeY: -.25, eyeL: -.21, eyeR: -.21, cheek: .55 }],
      ['抬眼偷看', 390, 280, { headY: -.06, headZ: .12, eyeY: .14, smile: .21, cheek: .38 }]], fallback: [-.19, .05] },
  { id: 'thinking', emotion: 'thinking', description: '微微歪头，抬眼寻找线索', names: /^(思考|沉思|托腮|thinking|think|ponder)$/i,
    frames: [['抬眼思索', 530, 440, { headX: -.12, headY: .13, headZ: .15, eyeX: -.25, eyeY: .28, brow: .16 }],
      ['换个方向打量', 480, 420, { headX: .10, headY: .08, headZ: .07, eyeX: .20, eyeY: .16, eyeL: -.13, eyeR: -.13 }]], fallback: [.13, -.10] },
]

const normalizedId = (id: string) => id.toLowerCase().replace(/_/g, '').replace(/^param/, '')

function resolveChannels(sliders: ResolvedModelSlider[], caps: ModelCapabilities | null, physics: ReadonlySet<string>) {
  const writable = sliders.filter(slider => slider.max > slider.min && !physics.has(slider.id))
  const bindings = caps?.vtubeFocusBindings ?? []
  const focus = caps?.focusMapping
  const mapped: Partial<Record<Channel, string | null>> = {
    headX: focus?.headXParam, headY: focus?.headYParam, headZ: focus?.headZParam,
    bodyX: focus?.bodyXParam, bodyY: focus?.bodyYParam, bodyZ: focus?.bodyZParam,
    eyeX: focus?.eyeXParam, eyeY: focus?.eyeYParam,
  }
  const bodyIds = new Set([mapped.bodyX, mapped.bodyY, mapped.bodyZ])
  return Object.entries(CHANNELS).map(([role, [aliases, inputs]]) => {
    const channel = role as Channel
    const matches = bindings.filter(binding => (inputs as readonly string[]).includes(binding.input))
    const named = writable.filter(slider => (aliases as readonly string[]).some(alias => normalizedId(alias) === normalizedId(slider.id)))
    const focused = writable.find(slider => slider.id === mapped[channel])
    const declared = writable.filter(slider => matches.some(binding => binding.output === slider.id) &&
      !(channel.startsWith('head') && (bodyIds.has(slider.id) || /^(bodyangle|position)/.test(normalizedId(slider.id)))))
    const boundNames = named.filter(slider => declared.includes(slider))
    const slidersForRole = focused && (!declared.length || declared.includes(focused)) ? [focused]
      : boundNames.length ? boundNames : declared.length === 1 ? declared : named
    return { channel, inputs: slidersForRole.map(slider => {
      const binding = matches.find(item => item.output === slider.id)
      const reversed = binding?.lower !== undefined && binding.upper !== undefined && binding.lower > binding.upper
      const axis = channel.at(-1) as 'X' | 'Y' | 'Z'
      const signedBody = channel.startsWith('body') && focused === slider && (focus?.bodyAxisGain?.[axis] ?? 0) < 0
      return { slider, sign: reversed || signedBody ? -1 : 1 }
    }) }
  })
}

function localMotion(recipe: Recipe, caps: ModelCapabilities | null, adapter: ModelEmotionAdapter | null): EmotionMotionTarget | undefined {
  const groups = caps?.motionGroups ?? {}
  const mapped = adapter?.emotions[recipe.id]?.motion ?? adapter?.emotions[recipe.emotion]?.motion
  if (mapped && (groups[mapped.group] ?? 0) > (mapped.index ?? 0)) return mapped
  const group = Object.keys(groups).find(name => groups[name] > 0 && recipe.names.test(name.trim()))
  if (group) return { group, index: 0 }
}

export function buildGenericStatePresets(
  controls: ResolvedModelControl[], sliders: ResolvedModelSlider[], caps: ModelCapabilities | null, adapter: ModelEmotionAdapter | null,
): ModelStatePreset[] {
  const physics = new Set(caps?.parameters.filter(parameter => parameter.isPhysicsOutput).map(parameter => parameter.id))
  const channels = resolveChannels(sliders, caps, physics)
  const defaults = controls.filter(control => control.defaultActive).map(control => control.id)
  const poseValues = (pose: Pose, allowOpposite = false) => {
    const parameters: Record<string, number> = {}
    for (const { channel, inputs } of channels) {
      const ratio = pose[channel]
      if (!ratio) continue
      for (const { slider, sign } of inputs) {
        let offset = ratio * sign
        const { defaultValue, min, max, id } = slider
        if (allowOpposite && (offset > 0 ? max === defaultValue : min === defaultValue)) offset *= -.65
        const room = offset > 0 ? max - defaultValue : defaultValue - min
        if (Math.abs(offset * room) > 1e-5 && !Object.hasOwn(parameters, id)) parameters[id] = defaultValue + offset * room
      }
    }
    return parameters
  }
  const neutral: ModelStatePreset = {
    id: 'neutral', label: '日常待机', emotion: 'neutral', description: '恢复默认外观和日常跟随',
    controls: defaults, steps: [{ durationMs: 500, holdMs: 0, controls: defaults, parameters: {} }], finishMode: 'hold', custom: true,
  }
  const presets = RECIPES.map((recipe): ModelStatePreset => {
    const expression = adapter?.emotions[recipe.id]?.expression
    const effect = controls.find(control => control.category === 'face_effect' && !control.defaultActive && !control.stages?.length &&
      (control.id === expression || recipe.names.test(control.id.trim()) || recipe.names.test(control.label.trim())) &&
      !Object.keys(control.parameters).some(id => physics.has(id)))
    const activeControls = effect ? [...defaults, effect.id] : defaults
    const steps: PresetKeyframeStep[] = recipe.frames.map(([label, durationMs, holdMs, pose]) =>
      ({ label, durationMs, holdMs, controls: activeControls, parameters: poseValues(pose) }))
    let motion: EmotionMotionTarget | undefined
    let description = recipe.description
    let unavailable = false
    if (!steps.some(step => Object.keys(step.parameters).length) && !effect) {
      motion = localMotion(recipe, caps, adapter)
      if (motion) {
        const durationMs = caps?.motionDetails?.[`${motion.group}#${motion.index ?? 0}`]?.durationMs ?? 1400
        steps.splice(0, steps.length, {
          label: '播放模型动作', durationMs: Math.min(durationMs, 5000), holdMs: Math.max(0, durationMs - 5000), controls: [], parameters: {},
        })
        description = `播放模型自带动作「${motion.group}」`
      } else {
        const channel = channels.find(item => item.inputs.length)?.channel
        if (channel) steps.forEach((step, index) => { step.parameters = poseValues({ [channel]: recipe.fallback[index] }, true) })
        unavailable = !steps.some(step => Object.keys(step.parameters).length)
        if (unavailable) description = '当前模型缺少此状态可用的动作资源或参数'
      }
    }
    const last = steps[steps.length - 1]
    return {
      id: recipe.id, label: recipe.id, emotion: recipe.emotion, description,
      controls: last.controls, parameters: last.parameters, steps, motion: motion ?? 'none',
      finishMode: 'revert', revertHoldMs: 0, custom: true, ...(unavailable ? { unavailable: true } : {}),
    }
  })
  return alignDefaultPresetSlots([neutral, ...presets])
}
