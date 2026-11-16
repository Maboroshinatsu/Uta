/** 桌宠可见气泡的类型与准入策略；消息记录面板不受这里限制。 */
export type BubbleType = 'text' | 'emoji' | 'status' | 'choice'

export const MAX_BUBBLES = 2

export function bubblePriority(type: BubbleType): number {
  if (type === 'choice') return 3
  if (type === 'status') return 1
  return 2
}

/** 按正文长度估算停留时间，多行内容额外留出换行阅读的停顿。 */
export function estimateBubbleTtl(text: string, minMs = 5000, maxMs = 16_000): number {
  const raw = String(text || '')
  const chars = Array.from(raw.replace(/\s+/g, '')).length
  const lines = raw.split('\n').filter((line) => line.trim()).length
  const linePause = Math.max(0, lines - 1) * 220
  return Math.max(minMs, Math.min(maxMs, 1600 + chars * 90 + linePause))
}

export interface BubbleSlot {
  id: string
  type: BubbleType
}

export interface BubbleAdmission {
  admit: boolean
  removeIds: string[]
}

/**
 * 新气泡到达时决定谁让位。
 * choice 最高，text/emoji 次之，status 最低；同类按到达顺序淘汰最旧的。
 * status 在已有更高优先级气泡时直接丢弃，不排队。
 */
export function planBubbleAdmission(
  current: readonly BubbleSlot[],
  incoming: BubbleSlot,
  max = MAX_BUBBLES,
): BubbleAdmission {
  const incomingPriority = bubblePriority(incoming.type)
  const removeIds = new Set<string>()

  if (incoming.type === 'status') {
    if (current.some((bubble) => bubblePriority(bubble.type) > incomingPriority)) {
      return { admit: false, removeIds: [] }
    }
    for (const bubble of current) {
      if (bubble.type === 'status') removeIds.add(bubble.id)
    }
  } else if (incoming.type === 'choice') {
    for (const bubble of current) {
      if (bubble.type === 'choice' || bubble.type === 'status') removeIds.add(bubble.id)
    }
  } else {
    for (const bubble of current) {
      if (bubble.type === 'status') removeIds.add(bubble.id)
    }
  }

  const kept = current.filter((bubble) => !removeIds.has(bubble.id))
  while (kept.length >= max) {
    let lowest = 0
    for (let i = 1; i < kept.length; i += 1) {
      if (bubblePriority(kept[i].type) < bubblePriority(kept[lowest].type)) lowest = i
    }
    removeIds.add(kept[lowest].id)
    kept.splice(lowest, 1)
  }

  return { admit: true, removeIds: [...removeIds] }
}
