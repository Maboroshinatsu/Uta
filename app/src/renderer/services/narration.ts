/**
 * 桌宠状态解说目录。
 *
 * 宿主只上报“在做什么”的意图，台词、情绪、预设和气泡时长都在这里维护。
 * 这样文案只有一份，宿主插件不需要复制中文，也不会把用户提示词带进桌宠。
 */

export type NarrationIntent =
  | 'session_start'
  | 'thinking'
  | 'looking'
  | 'searching'
  | 'reading'
  | 'defining'
  | 'editing'
  | 'testing'
  | 'running'
  | 'researching'
  | 'waiting'
  | 'found'
  | 'progress'
  | 'success'
  | 'error'
  | 'retry'

export interface NarrationReaction {
  /** 随机台词池 */
  phrases: string[]
  /** 优先触发的预设分组；模型没有时由渲染层回退到 emotion */
  preset?: string
  /** 预设不可用时的基础情绪 */
  emotion?: string
  /** 状态胶囊上显示的短标签（可选） */
  label?: string
  /** 状态气泡停留时长 */
  bubbleTtlMs: number
  /** 供 TTS 选择语气（可选） */
  ttsStyle?: string
}

export const NARRATION_LIBRARY: Record<NarrationIntent, NarrationReaction> = {
  session_start: {
    phrases: ['我在呢，随时可以开工。', '回来啦，今天想做什么？', '准备好啦，交给我吧。'],
    emotion: 'happy',
    bubbleTtlMs: 3600,
    ttsStyle: 'cheerful',
  },
  thinking: {
    phrases: ['让我想想。', '我先理一下思路。', '嗯……让我想想怎么做。'],
    preset: '思考',
    emotion: 'thinking',
    label: '思考中...',
    bubbleTtlMs: 4200,
    ttsStyle: 'thinking',
  },
  looking: {
    phrases: ['让我来看看问题在哪。', '我先看看这里的代码。', '我瞅一眼这是怎么回事。'],
    preset: '思考',
    emotion: 'thinking',
    label: '看看问题在哪...',
    bubbleTtlMs: 4800,
    ttsStyle: 'thinking',
  },
  searching: {
    phrases: ['我找找相关的地方。', '先搜一下关键词。', '我把相关代码翻出来看看。'],
    preset: '好奇',
    emotion: 'curious',
    label: '查找相关代码...',
    bubbleTtlMs: 4800,
    ttsStyle: 'curious',
  },
  reading: {
    phrases: ['我先读一下这段。', '让我看看这个文件。', '这段我仔细读读。'],
    preset: '思考',
    emotion: 'thinking',
    label: '阅读代码...',
    bubbleTtlMs: 4800,
    ttsStyle: 'thinking',
  },
  defining: {
    phrases: ['我定义一下这个参数。', '我先把这里的定义理清楚。', '这个参数我来定一下。'],
    preset: '专注',
    emotion: 'thinking',
    label: '定义参数...',
    bubbleTtlMs: 4600,
    ttsStyle: 'focused',
  },
  editing: {
    phrases: ['我来改一下这里。', '这段我调整一下。', '我定义一下这个参数。', '好，我动手改。'],
    preset: '专注',
    emotion: 'thinking',
    label: '修改代码...',
    bubbleTtlMs: 4600,
    ttsStyle: 'focused',
  },
  testing: {
    phrases: ['我来做个测试。', '跑一下看看结果。', '我验证一下这次改动。'],
    preset: '测试',
    emotion: 'thinking',
    label: '运行测试...',
    bubbleTtlMs: 4800,
    ttsStyle: 'focused',
  },
  running: {
    phrases: ['我来执行一下。', '我先跑一遍。', '交给我，我来运行。'],
    preset: '专注',
    emotion: 'thinking',
    label: '执行命令...',
    bubbleTtlMs: 4200,
    ttsStyle: 'focused',
  },
  researching: {
    phrases: ['我去查一下资料。', '我确认一下这个接口的用法。', '我先查清楚再动手。'],
    preset: '好奇',
    emotion: 'curious',
    label: '查阅资料...',
    bubbleTtlMs: 4800,
    ttsStyle: 'curious',
  },
  waiting: {
    phrases: ['这一步需要你确认一下。', '我在这儿等你点一下。', '这个操作要你点头才行。'],
    preset: '等待',
    emotion: 'neutral',
    label: '等待确认...',
    bubbleTtlMs: 6000,
    ttsStyle: 'gentle',
  },
  found: {
    phrases: ['找到线索了。', '找到问题了！', '有发现，我继续看看。', '嗯，问题应该在这里。'],
    preset: '好奇',
    emotion: 'surprise',
    label: '找到线索...',
    bubbleTtlMs: 4600,
    ttsStyle: 'cheerful',
  },
  progress: {
    phrases: ['有进展了。', '我继续往下做。', '嗯，这样应该可行。'],
    preset: '专注',
    emotion: 'thinking',
    label: '继续处理...',
    bubbleTtlMs: 3800,
    ttsStyle: 'focused',
  },
  success: {
    phrases: ['搞定啦，来看看结果吧。', '完成了，结果已经出来啦。', '做完啦，请验收。'],
    preset: '开心',
    emotion: 'happy',
    label: '回复完成',
    bubbleTtlMs: 5200,
    ttsStyle: 'cheerful',
  },
  error: {
    phrases: ['这里好像有点问题，我再看看。', '咦，这里报错了，我排查一下。', '遇到点小问题，我换个思路。'],
    preset: '惊讶',
    emotion: 'surprise',
    label: '遇到问题，排查中...',
    bubbleTtlMs: 5600,
    ttsStyle: 'concerned',
  },
  retry: {
    phrases: ['没关系，我再试一次。', '我换个方式再来。', '刚才不算，我重新试。'],
    preset: '专注',
    emotion: 'thinking',
    label: '重试中...',
    bubbleTtlMs: 4200,
    ttsStyle: 'focused',
  },
}

export interface PickNarrationOptions {
  random?: () => number
  lastPhrase?: string
}

/** 从意图目录里挑一句台词，尽量避开上一句，返回完整反应 */
export function pickNarration(
  intent: NarrationIntent,
  options: PickNarrationOptions = {},
): (NarrationReaction & { intent: NarrationIntent; phrase: string }) | null {
  const reaction = NARRATION_LIBRARY[intent]
  if (!reaction || reaction.phrases.length === 0) return null
  const random = options.random ?? Math.random
  const pool =
    options.lastPhrase && reaction.phrases.length > 1
      ? reaction.phrases.filter((phrase) => phrase !== options.lastPhrase)
      : reaction.phrases
  const candidates = pool.length > 0 ? pool : reaction.phrases
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
  return { ...reaction, intent, phrase: candidates[index] }
}
