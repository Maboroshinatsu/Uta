export const CALIBRATION_CHANNELS = ['headX', 'headY', 'headZ', 'gazeX', 'gazeY', 'browLeft', 'browRight', 'bodyX', 'bodyZ', 'mouthForm'] as const
export type CalibrationChannel = (typeof CALIBRATION_CHANNELS)[number]
export interface ModelCalibration {
  channel: CalibrationChannel
  parameterId: string
  direction: 'normal' | 'reversed'
  strength: number
}

export function isModelCalibrationEntries(value: unknown): value is ModelCalibration[] {
  if (!Array.isArray(value) || value.length > CALIBRATION_CHANNELS.length) return false
  const channels = new Set<string>(), parameters = new Set<string>()
  return value.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).some(key => !['channel', 'parameterId', 'direction', 'strength'].includes(key)) ||
      !(CALIBRATION_CHANNELS as readonly string[]).includes(item.channel) || typeof item.parameterId !== 'string' || !item.parameterId.trim() || item.parameterId.length > 200 ||
      (item.direction !== 'normal' && item.direction !== 'reversed') ||
      typeof item.strength !== 'number' || !Number.isFinite(item.strength) || item.strength < 0 || item.strength > 1 ||
      channels.has(item.channel) || parameters.has(item.parameterId)) return false
    channels.add(item.channel); parameters.add(item.parameterId)
    return true
  })
}
