import type { PresetKeyframeStep } from './emotion-adapter'
import type { PairedGesture, GestureSnippetBase } from './gesture-pairing'
import { buildPairedGestureSteps } from './gesture-pairing'

export type SemanticActionKind =
  | 'look'
  | 'nod'
  | 'shake_head'
  | 'tilt'
  | 'smile'
  | 'blink'
  | 'gasp'
  | 'gesture'
  | 'expression'
  | 'reset'

export interface SemanticAction {
  kind: SemanticActionKind
  label?: string
  direction?: 'left' | 'right' | 'up' | 'down' | 'center'
  count?: number
  strength?: number
  durationMs?: number
  holdMs?: number
  name?: string
  side?: 'both' | 'left' | 'right'
  accents?: Record<string, number>
  parameters?: Record<string, number>
  controls?: string[]
}

export interface DirectorPlan {
  version: 1
  intent?: string
  summary?: string
  actions: SemanticAction[]
}

export interface ModelCapabilityContext {
  parameters?: ReadonlyArray<{
    id: string
    min: number
    max: number
    default: number
    name?: string
  }>
  modelEmotions?: readonly string[]
  modelControls?: ReadonlyArray<{ id: string; label: string }>
}

/**
 * 离线本地自然语言动作解析器：
 * 将用户输入的自然语言描述解析为结构化动作序列 (SemanticAction[])。
 * 纯本地运行、零网络延迟、稳定可靠。
 */
export function parseNaturalActionPrompt(
  prompt: string,
  context?: ModelCapabilityContext | null,
  pairedGestures?: PairedGesture[] | null,
): DirectorPlan {
  const cleanPrompt = (prompt || '').trim()
  if (!cleanPrompt) {
    return { version: 1, intent: '', summary: '空指令', actions: [] }
  }

  // 按时序连接词和标点分割分镜小节
  const segments = cleanPrompt
    .split(/(?:[，。；、\n\r]+|(?=先)|(?=再)|(?=然后)|(?=随后)|(?=接着)|(?=最后)|(?=紧接着))/g)
    .map((s) => s.trim())
    .filter(Boolean)

  const actions: SemanticAction[] = []

  for (const seg of segments) {
    // 1. 视线与头部朝向 (Look) - 支持单一朝向与复合游移动作
    if (/左右移开|左右看|眼神游移|四处张望|躲闪视线|移开视线|避开对视|飘忽/.test(seg)) {
      actions.push({ kind: 'look', direction: 'left', strength: 0.85, durationMs: 420, holdMs: 200, label: '视线偏左避开' })
      actions.push({ kind: 'blink', count: 1, label: '心虚眨眼' })
      actions.push({ kind: 'look', direction: 'right', strength: 0.75, durationMs: 400, holdMs: 180, label: '眼神游移向右' })
      actions.push({ kind: 'look', direction: 'center', strength: 0.4, durationMs: 460, holdMs: 300, label: '悄悄看回前下方' })
    } else if (/看左|向左|侧目|往左|朝左/.test(seg)) {
      actions.push({ kind: 'look', direction: 'left', label: '看向左侧' })
    } else if (/看右|向右|往右|朝右/.test(seg)) {
      actions.push({ kind: 'look', direction: 'right', label: '看向右侧' })
    } else if (/看上|向上|抬头|往上|朝上/.test(seg)) {
      actions.push({ kind: 'look', direction: 'up', label: '抬头看上方' })
    } else if (/看下|向下|低头|往下|朝下/.test(seg)) {
      actions.push({ kind: 'look', direction: 'down', label: '低头看下方' })
    } else if (/看你|看我|正视|回正|前看|看前|看镜头|看回/.test(seg)) {
      actions.push({ kind: 'look', direction: 'center', label: '看向正前方' })
    }

    // 2. 成对手势 (Gesture)
    if (/抚胸|致意|手放胸口|举手/.test(seg)) {
      actions.push({ kind: 'gesture', name: 'hand_on_chest', label: '抚胸致意' })
    } else if (/竖手指|竖食指|食指|指出|指点/.test(seg)) {
      actions.push({ kind: 'gesture', name: 'point', label: '竖起食指' })
    } else if (/狗尾巴草|狗尾草|拿草/.test(seg)) {
      actions.push({ kind: 'gesture', name: 'grass', label: '拿起狗尾草' })
    } else if (pairedGestures && pairedGestures.length > 0) {
      for (const g of pairedGestures) {
        if (seg.includes(g.name) || seg.includes(g.label)) {
          actions.push({ kind: 'gesture', name: g.id, label: g.label })
          break
        }
      }
    }

    // 3. 微笑 (Smile)
    if (/微笑|笑|开心|喜悦/.test(seg)) {
      actions.push({ kind: 'smile', label: '自然微笑' })
    }

    // 4. 点头 (Nod)
    if (/点头/.test(seg)) {
      const count = /两下|两次|2次|2下/.test(seg) ? 2 : 1
      const strength = /轻|微/.test(seg) ? 0.6 : /大|深|重/.test(seg) ? 1.0 : 0.85
      actions.push({ kind: 'nod', count, strength, label: `点头${count > 1 ? count + '次' : ''}` })
    }

    // 5. 摇头 (Shake Head)
    if (/摇头|不肯|拒绝/.test(seg)) {
      const count = /两下|两次|2次|2下/.test(seg) ? 2 : 1
      const strength = /轻|微/.test(seg) ? 0.6 : 0.85
      actions.push({ kind: 'shake_head', count, strength, label: `摇头${count > 1 ? count + '次' : ''}` })
    }

    // 6. 歪头 (Tilt)
    if (/歪头|侧头|倾头/.test(seg)) {
      const direction = /左/.test(seg) ? 'left' : 'right'
      actions.push({ kind: 'tilt', direction, label: `向${direction === 'left' ? '左' : '右'}歪头` })
    }

    // 7. 眨眼 (Blink)
    if (/眨眼|闭眼|单眼|眨/.test(seg) && !/白眼/.test(seg)) {
      const count = /两下|两次|2次|2下/.test(seg) ? 2 : 1
      const side = /左眼/.test(seg) ? 'left' : /右眼/.test(seg) ? 'right' : 'both'
      actions.push({ kind: 'blink', count, side, label: `眨眼${count > 1 ? '两次' : ''}` })
    }

    // 8. 惊讶 (Gasp)
    if (/惊讶|吃惊|愣住|张嘴|瞪眼/.test(seg)) {
      actions.push({ kind: 'gasp', label: '轻微惊讶' })
    }

        // 9. 中文常见情绪别名与模型情绪表情匹配 (Expression)
    const EMOTION_ALIAS_RULES = [
      { pattern: /尴尬|难堪|难为情|冷汗|冒汗|抓狂|心虚/, emotion: 'embarrassed', label: '尴尬流汗' },
      { pattern: /害羞|脸红|不好意思|害臊|羞涩/, emotion: 'shy', label: '害羞脸红' },
      { pattern: /难过|伤心|委屈|悲伤|落泪|哭泣/, emotion: 'sad', label: '难过沮丧' },
      { pattern: /生气|恼怒|发火|愤怒|气愤|撅嘴/, emotion: 'angry', label: '生气' },
      { pattern: /思考|沉思|想一想|琢磨|思索/, emotion: 'thinking', label: '思考沉思' },
      { pattern: /困惑|疑惑|纳闷|不解|问号/, emotion: 'confused', label: '困惑纳闷' },
      { pattern: /开心|高兴|兴奋|喜悦/, emotion: 'happy', label: '开心喜悦' },
    ]

    let matchedEmotion = false
    for (const rule of EMOTION_ALIAS_RULES) {
      if (rule.pattern.test(seg)) {
        actions.push({ kind: 'expression', name: rule.emotion, label: rule.label })
        matchedEmotion = true
        break
      }
    }

    if (!matchedEmotion && context?.modelEmotions) {
      for (const emo of context.modelEmotions) {
        if (emo !== 'neutral' && seg.includes(emo)) {
          actions.push({ kind: 'expression', name: emo, label: emo })
          break
        }
      }
    }
  }

  // 如果未能细分识别出任何行为，则回退为自然微笑与正视
  if (actions.length === 0) {
    if (/笑/.test(cleanPrompt)) {
      actions.push({ kind: 'smile', label: '微笑' })
    } else {
      actions.push({ kind: 'look', direction: 'center', label: '看向你' })
      actions.push({ kind: 'smile', label: '自然微笑' })
    }
  }

  return {
    version: 1,
    intent: cleanPrompt,
    summary: actions.map((a) => a.label || a.kind).join(' → '),
    actions,
  }
}

/**
 * 动作编译器：将结构化动作指令 (DirectorPlan) 编译为工坊时间线关键帧序列 (PresetKeyframeStep[])。
 */
export function compileDirectorPlan(
  plan: DirectorPlan,
  context: ModelCapabilityContext | null | undefined,
  pairedGestures: PairedGesture[] | null | undefined,
  base: GestureSnippetBase,
): PresetKeyframeStep[] {
  const steps: PresetKeyframeStep[] = []
  const paramMap = new Map<string, { min: number; max: number; default: number }>()
  for (const p of context?.parameters ?? []) {
    paramMap.set(p.id, p)
  }

  const clamp = (id: string, value: number): number => {
    const meta = paramMap.get(id)
    if (!meta) return value
    return Math.min(meta.max, Math.max(meta.min, value))
  }

  const currentVal = (id: string, fallback = 0): number => {
    const v = base.parameters[id]
    if (typeof v === 'number' && Number.isFinite(v)) return clamp(id, v)
    const meta = paramMap.get(id)
    return meta ? meta.default : fallback
  }

  const resolveParamKey = (...candidates: string[]): string | undefined => {
    for (const c of candidates) {
      if (paramMap.has(c)) return c
    }
    return undefined
  }

  // 动态探针：标准 Live2D (如 Hiyori) 使用 ParamAngle*，VTS 常用 Angle*；无参数表时默认使用 Angle*
  const pAngleY = resolveParamKey('ParamAngleY', 'AngleY') ?? (paramMap.size > 0 ? undefined : 'AngleY')
  const pAngleX = resolveParamKey('ParamAngleX', 'AngleX') ?? (paramMap.size > 0 ? undefined : 'AngleX')
  const pAngleZ = resolveParamKey('ParamAngleZ', 'AngleZ') ?? (paramMap.size > 0 ? undefined : 'AngleZ')
  const pEyeBallX = resolveParamKey('ParamEyeBallX', 'EyeBallX') ?? (paramMap.size > 0 ? undefined : 'ParamEyeBallX')
  const pEyeBallY = resolveParamKey('ParamEyeBallY', 'EyeBallY') ?? (paramMap.size > 0 ? undefined : 'ParamEyeBallY')

  let runningParams = { ...base.parameters }
  const runningControls = [...base.controls]

  const actions = Array.isArray(plan?.actions)
    ? (plan.actions.filter((a) => a && typeof a === 'object' && typeof (a as any).kind === 'string') as SemanticAction[])
    : []

  for (const action of actions) {
    switch (action.kind) {
      case 'look': {
        const dir = action.direction ?? 'center'
        const strength = action.strength ?? 0.8
        const xSign = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
        const ySign = dir === 'up' ? 1 : dir === 'down' ? -1 : 0

        const eyeX = pEyeBallX ? clamp(pEyeBallX, xSign * 0.75 * strength) : 0
        const angleX = pAngleX ? clamp(pAngleX, xSign * 18 * strength) : 0
        const posX = clamp('PositionX', xSign * 2.5 * strength)
        const eyeY = pEyeBallY ? clamp(pEyeBallY, ySign * 0.6 * strength) : 0
        const angleY = pAngleY ? clamp(pAngleY, ySign * 12 * strength) : 0

        runningParams = {
          ...runningParams,
          ...(pEyeBallX ? { [pEyeBallX]: eyeX } : {}),
          ...(pAngleX ? { [pAngleX]: angleX } : {}),
          ...(paramMap.has('PositionX') ? { PositionX: posX } : {}),
          ...(pEyeBallY ? { [pEyeBallY]: eyeY } : {}),
          ...(pAngleY ? { [pAngleY]: angleY } : {}),
        }

        steps.push({
          label: action.label || `视线·${dir}`,
          durationMs: action.durationMs ?? 420,
          holdMs: action.holdMs ?? 200,
          controls: [...runningControls],
          parameters: { ...runningParams },
        })
        break
      }

      case 'nod': {
        const count = Math.max(1, Math.min(3, action.count ?? 1))
        const strength = action.strength ?? 0.85
        const targetAngleY = pAngleY || 'AngleY'
        const baseAngleY = currentVal(targetAngleY, 0)

        for (let i = 0; i < count; i += 1) {
          // 点头·低
          steps.push({
            label: `点头·低${count > 1 ? ` (${i + 1}/${count})` : ''}`,
            durationMs: 240,
            holdMs: 80,
            controls: [...runningControls],
            parameters: {
              ...runningParams,
              [targetAngleY]: clamp(targetAngleY, baseAngleY - 14 * strength),
            },
          })
          // 点头·回
          steps.push({
            label: `点头·回${count > 1 ? ` (${i + 1}/${count})` : ''}`,
            durationMs: 260,
            holdMs: 60,
            controls: [...runningControls],
            parameters: {
              ...runningParams,
              [targetAngleY]: baseAngleY,
            },
          })
        }
        break
      }

      case 'shake_head': {
        const count = Math.max(1, Math.min(3, action.count ?? 1))
        const strength = action.strength ?? 0.85
        const targetAngleX = pAngleX || 'AngleX'
        const baseAngleX = currentVal(targetAngleX, 0)

        for (let i = 0; i < count; i += 1) {
          // 摇头·左
          steps.push({
            label: `摇头·侧${count > 1 ? ` (${i + 1}/${count})` : ''}`,
            durationMs: 250,
            holdMs: 60,
            controls: [...runningControls],
            parameters: {
              ...runningParams,
              [targetAngleX]: clamp(targetAngleX, baseAngleX - 16 * strength),
            },
          })
          // 摇头·右
          steps.push({
            label: `摇头·反侧${count > 1 ? ` (${i + 1}/${count})` : ''}`,
            durationMs: 280,
            holdMs: 60,
            controls: [...runningControls],
            parameters: {
              ...runningParams,
              [targetAngleX]: clamp(targetAngleX, baseAngleX + 16 * strength),
            },
          })
        }
        // 回正
        steps.push({
          label: '摇头·回正',
          durationMs: 240,
          holdMs: 60,
          controls: [...runningControls],
          parameters: {
            ...runningParams,
            [targetAngleX]: baseAngleX,
          },
        })
        break
      }

      case 'tilt': {
        const dir = action.direction === 'left' ? -1 : 1
        const strength = action.strength ?? 0.8
        const targetAngleZ = pAngleZ || 'AngleZ'
        const baseAngleZ = currentVal(targetAngleZ, 0)
        const tiltAngleZ = clamp(targetAngleZ, baseAngleZ + dir * 14 * strength)

        runningParams = {
          ...runningParams,
          [targetAngleZ]: tiltAngleZ,
        }

        steps.push({
          label: action.label || '歪头',
          durationMs: action.durationMs ?? 380,
          holdMs: action.holdMs ?? 260,
          controls: [...runningControls],
          parameters: { ...runningParams },
        })
        break
      }

      case 'smile': {
        const strength = action.strength ?? 0.85
        const smileParams: Record<string, number> = {}

        if (paramMap.has('ParamMouthForm')) smileParams.ParamMouthForm = clamp('ParamMouthForm', 0.8 * strength)
        if (paramMap.has('EyeSmile')) smileParams.EyeSmile = clamp('EyeSmile', 0.7 * strength)
        if (paramMap.has('MouthSmile_L')) smileParams.MouthSmile_L = clamp('MouthSmile_L', 0.6 * strength)
        if (paramMap.has('MouthSmile_R')) smileParams.MouthSmile_R = clamp('MouthSmile_R', 0.6 * strength)
        if (paramMap.has('ParamEyeLOpen')) smileParams.ParamEyeLOpen = clamp('ParamEyeLOpen', 0.9)
        if (paramMap.has('ParamEyeROpen')) smileParams.ParamEyeROpen = clamp('ParamEyeROpen', 0.9)

        runningParams = { ...runningParams, ...smileParams }

        steps.push({
          label: action.label || '自然微笑',
          durationMs: action.durationMs ?? 440,
          holdMs: action.holdMs ?? 400,
          controls: [...runningControls],
          parameters: { ...runningParams },
        })
        break
      }

      case 'blink': {
        const count = Math.max(1, Math.min(2, action.count ?? 1))
        const origL = currentVal('ParamEyeLOpen', 1)
        const origR = currentVal('ParamEyeROpen', 1)
        const leftTarget = action.side === 'right' ? origL : 0
        const rightTarget = action.side === 'left' ? origR : 0

        for (let i = 0; i < count; i += 1) {
          steps.push({
            label: `眨眼·闭${count > 1 ? ` (${i + 1}/${count})` : ''}`,
            durationMs: 120,
            holdMs: 50,
            controls: [...runningControls],
            parameters: {
              ...runningParams,
              ...(paramMap.has('ParamEyeLOpen') ? { ParamEyeLOpen: leftTarget } : {}),
              ...(paramMap.has('ParamEyeROpen') ? { ParamEyeROpen: rightTarget } : {}),
            },
          })
          steps.push({
            label: `眨眼·睁${count > 1 ? ` (${i + 1}/${count})` : ''}`,
            durationMs: 160,
            holdMs: 60,
            controls: [...runningControls],
            parameters: {
              ...runningParams,
              ...(paramMap.has('ParamEyeLOpen') ? { ParamEyeLOpen: origL } : {}),
              ...(paramMap.has('ParamEyeROpen') ? { ParamEyeROpen: origR } : {}),
            },
          })
        }
        break
      }

      case 'gasp': {
        const strength = action.strength ?? 0.8
        const gaspParams: Record<string, number> = {}
        if (paramMap.has('ParamEyeLOpen')) gaspParams.ParamEyeLOpen = clamp('ParamEyeLOpen', 1.25 * strength)
        if (paramMap.has('ParamEyeROpen')) gaspParams.ParamEyeROpen = clamp('ParamEyeROpen', 1.25 * strength)
        if (paramMap.has('ParamMouthOpenY')) gaspParams.ParamMouthOpenY = clamp('ParamMouthOpenY', 0.8 * strength)

        steps.push({
          label: action.label || '惊讶',
          durationMs: 180,
          holdMs: 320,
          controls: [...runningControls],
          parameters: { ...runningParams, ...gaspParams },
        })
        break
      }

      case 'gesture': {
        const targetId = action.name || ''
        const found = pairedGestures?.find((g) => g.id === targetId || g.name === targetId)
        if (found) {
          const gestureSteps = buildPairedGestureSteps(
            found,
            { controls: runningControls, parameters: runningParams },
            {
              holdDurationMs: action.durationMs ?? 1400,
              jointOverrides: action.accents,
              stepLabelPrefix: found.name,
            },
          )
          steps.push(...gestureSteps)
        }
        break
      }

      case 'expression': {
        const emoName = action.name || ''
        if (emoName) {
          const controlSet = new Set(runningControls)
          const availableControls = (context?.modelControls || []).map((c) => c.id || c.label)

          // 渐进式控件激活（根据当前模型实际拥有的控件按需激活，绝不强行塞入不存在的控件）
          const activateIfAvailable = (ctrlName: string) => {
            if (availableControls.includes(ctrlName)) controlSet.add(ctrlName)
          }

          const emoParams: Record<string, number> = {}

          if (emoName === 'embarrassed' || emoName === '尴尬' || emoName === '冷汗') {
            activateIfAvailable('流冷汗')
            activateIfAvailable('脸红')
            if (paramMap.has('ParamMouthForm')) emoParams.ParamMouthForm = clamp('ParamMouthForm', -0.3)
            if (pAngleY) emoParams[pAngleY] = clamp(pAngleY, -4)
            if (paramMap.has('key13')) emoParams.key13 = 1
            if (paramMap.has('key7')) emoParams.key7 = 1
          } else if (emoName === 'shy' || emoName === '害羞' || emoName === '脸红') {
            activateIfAvailable('脸红')
            if (paramMap.has('ParamMouthForm')) emoParams.ParamMouthForm = clamp('ParamMouthForm', 0.2)
            if (pAngleY) emoParams[pAngleY] = clamp(pAngleY, -3)
            if (pAngleZ) emoParams[pAngleZ] = clamp(pAngleZ, 4)
            if (paramMap.has('key7')) emoParams.key7 = 1
          } else if (emoName === 'sad' || emoName === '难过' || emoName === '哭') {
            activateIfAvailable('落泪')
            if (paramMap.has('ParamMouthForm')) emoParams.ParamMouthForm = clamp('ParamMouthForm', -0.6)
            if (pAngleY) emoParams[pAngleY] = clamp(pAngleY, -6)
            if (paramMap.has('key2')) emoParams.key2 = 1
          } else if (emoName === 'thinking' || emoName === '思考' || emoName === '沉思') {
            activateIfAvailable('加载')
            if (pAngleY) emoParams[pAngleY] = clamp(pAngleY, 8)
            if (pEyeBallY) emoParams[pEyeBallY] = clamp(pEyeBallY, 0.5)
            if (paramMap.has('key8')) emoParams.key8 = 1
          } else if (emoName === 'confused' || emoName === '困惑') {
            if (pAngleZ) emoParams[pAngleZ] = clamp(pAngleZ, 8)
            if (pEyeBallY) emoParams[pEyeBallY] = clamp(pEyeBallY, 0.3)
          }

          if (action.parameters) {
            for (const [k, v] of Object.entries(action.parameters)) {
              if (typeof v === 'number' && Number.isFinite(v)) {
                if (paramMap.has(k)) emoParams[k] = clamp(k, v)
                else emoParams[k] = v
              }
            }
          }
          if (Array.isArray(action.controls)) {
            for (const c of action.controls) {
              if (availableControls.includes(c)) controlSet.add(c)
            }
          }

          runningParams = { ...runningParams, ...emoParams }
          runningControls.length = 0
          runningControls.push(...controlSet)

          steps.push({
            label: action.label || `表情·${emoName}`,
            durationMs: action.durationMs ?? 400,
            holdMs: action.holdMs ?? 500,
            controls: [...runningControls],
            parameters: { ...runningParams },
          })
        }
        break
      }

      default:
        break
    }
  }

  // 兜底保障：至少产出一帧
  if (steps.length === 0) {
    steps.push({
      label: '动作分镜',
      durationMs: 600,
      holdMs: 0,
      controls: [...base.controls],
      parameters: { ...base.parameters },
    })
  }

  return steps
}

/**
 * 校验并解析外部 LLM 生成的 JSON Plan
 */
export function parseDirectorPlanJson(rawJson: string): DirectorPlan | null {
  try {
    let clean = (rawJson || '').trim()
    const mdMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (mdMatch) {
      clean = mdMatch[1].trim()
    }
    const parsed = JSON.parse(clean)
    if (!parsed || typeof parsed !== 'object') return null
    const plan = parsed.plan || parsed
    if (plan.version !== 1 || !Array.isArray(plan.actions)) return null
    return plan as DirectorPlan
  } catch {
    return null
  }
}

/**
 * 构建发送给宿主 Agent / LLM 的标准动作导演提示词。
 * 注入模型上下文、骨骼手势清单与强约束的 JSON Schema。
 */
export function buildHostDirectorPrompt(
  userInstruction: string,
  modelName: string,
  context?: ModelCapabilityContext | null,
  pairedGestures?: PairedGesture[] | null,
): string {
  const gesturesList = (pairedGestures ?? [])
    .map((g) => `- "${g.id}" (${g.label}): 进入动作 "${g.enter.group}", 退出动作 "${g.exit.group}"`)
    .join('\n')
  const emotionsList = (context?.modelEmotions ?? [])
    .filter((e) => e !== 'neutral')
    .slice(0, 15)
    .join(', ')

  return `你是一个 Live2D 动作编排导演。请为桌宠模型【${modelName || 'Live2D'}】编排一段动作分镜。
用户指令：${userInstruction.trim()}

【可用动作与手势】
1. 视线与头部：
   - look: direction 可选 "left" | "right" | "up" | "down" | "center"
   - nod: count 1..3, strength 0..1 (轻微到深点头)
   - shake_head: count 1..3, strength 0..1 (摇头)
   - tilt: direction "left" | "right", strength 0..1 (歪头)
2. 面部与表情：
   - smile: 自然微笑
   - blink: count 1..2, side "both" | "left" | "right" (眨眼)
   - gasp: 轻微惊讶张嘴
   - expression: name 可选 [${emotionsList || 'happy, shy, angry, sad'}]
3. 成对手势（包含起手进入、姿态保持与收手退出）：
${gesturesList || '（无特定手势）'}

【输出格式严格要求】
你必须且只能返回合法的 JSON 对象，不要输出任何多余的开场白或解释文字。格式如下：
{
  "version": 1,
  "summary": "简短动作剧情说明",
  "actions": [
    { "kind": "look", "direction": "left" },
    { "kind": "gesture", "name": "hand_on_chest", "durationMs": 1400 },
    { "kind": "smile" },
    { "kind": "nod", "count": 1 }
  ]
}`
}

/**
 * 健壮地从宿主回复（可能夹带自然语言交谈或 Markdown 代码块）中提取 JSON Plan
 */
export function extractJsonFromHostReply(rawText: string): DirectorPlan | null {
  if (!rawText || typeof rawText !== 'string') return null
  let text = rawText.trim()

  // 1. 尝试匹配代码块
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (mdMatch) {
    text = mdMatch[1].trim()
  } else {
    // 2. 尝试寻找第一个 { 到最后一个 }
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1)
    }
  }

  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const plan = parsed.plan || parsed
    if (plan.version !== 1 || !Array.isArray(plan.actions)) return null
    const validActions = plan.actions.filter(
      (a: unknown): a is SemanticAction =>
        Boolean(a && typeof a === 'object' && typeof (a as any).kind === 'string'),
    )
    if (validActions.length === 0) return null
    return {
      version: 1,
      ...(typeof plan.summary === 'string' ? { summary: plan.summary } : {}),
      actions: validActions,
    }
  } catch {
    return null
  }
}
