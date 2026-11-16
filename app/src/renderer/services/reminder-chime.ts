/**
 * 待办提醒的轻提示音：纯 Web Audio API 合成，无需外部音频资源。
 * 用户没有开提示音时不会调用；音频上下文不可用时静默跳过。
 */
let context: AudioContext | null = null

export type ReminderSoundType = 'chime' | 'drop' | 'knock' | 'ding'

export const REMINDER_SOUND_OPTIONS: Array<{ id: ReminderSoundType; label: string; desc: string }> = [
  { id: 'chime', label: '经典风铃', desc: '双音清亮正弦和弦，柔和轻盈' },
  { id: 'drop', label: '清脆水滴', desc: '高频下潜滑音，灵动俏皮' },
  { id: 'knock', label: '木质敲击', desc: '温暖三角波微脉冲，低调自然' },
  { id: 'ding', label: '清脆单音', desc: '单音高泛音钟鸣，利落清晰' },
]

export function playReminderChime(soundType: ReminderSoundType | string = 'chime'): void {
  try {
    const Ctor = window.AudioContext
    if (!Ctor) return
    context ??= new Ctor()
    const ctx = context
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const start = ctx.currentTime + 0.01

    if (soundType === 'drop') {
      // 水滴声：高频快速下落
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1600, start)
      osc.frequency.exponentialRampToValueAtTime(450, start + 0.15)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.25)
      return
    }

    if (soundType === 'knock') {
      // 敲击声：三角波低频短脉冲
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(320, start)
      osc.frequency.exponentialRampToValueAtTime(140, start + 0.08)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.14)
      return
    }

    if (soundType === 'ding') {
      // 单音叮：1046.5Hz (C6)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1046.5, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.065, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.4)
      return
    }

    // 默认 chime（双音风铃）
    const notes: Array<{ frequency: number; offset: number }> = [
      { frequency: 880, offset: 0 },
      { frequency: 1174.7, offset: 0.14 },
    ]
    for (const note of notes) {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = note.frequency
      const at = start + note.offset
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.055, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.32)
    }
  } catch {
    /* 没有音频设备或被系统策略拦截时静默 */
  }
}
