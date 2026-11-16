/** WCAG contrast helpers shared by the settings center and the legacy panel. */
export function normalizeHex(hex: string): string | null {
  const trimmed = hex.trim()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null
}

export function hexChannels(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex) ?? '#000000'
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ]
}

export function relativeLuminance(hex: string): number {
  const linear = hexChannels(hex).map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLum = relativeLuminance(foreground)
  const backgroundLum = relativeLuminance(background)
  const lighter = Math.max(foregroundLum, backgroundLum)
  const darker = Math.min(foregroundLum, backgroundLum)
  return (lighter + 0.05) / (darker + 0.05)
}

export function shadeHex(hex: string, factor: number): string {
  return `#${hexChannels(hex)
    .map(channel => Math.max(0, Math.min(255, Math.round(channel * factor))))
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Pick text that stays readable on an accent fill. Pure black is only used
 * when the branded dark ink cannot reach 4.5:1 in the mid-luminance band.
 */
export function readableInk(background: string): string {
  const backgroundLum = relativeLuminance(background)
  const whiteContrast = 1.05 / (backgroundLum + 0.05)
  const darkInk = '#0d1a20'
  const darkContrast = (backgroundLum + 0.05) / (relativeLuminance(darkInk) + 0.05)
  if (Math.max(whiteContrast, darkContrast) >= 4.5) {
    return whiteContrast >= darkContrast ? '#ffffff' : darkInk
  }
  const blackContrast = (backgroundLum + 0.05) / 0.05
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff'
}

/** Dark ink needs a lighter hover fill; white ink needs a darker one. */
export function accentHoverBackground(accent: string, ink = readableInk(accent)): string {
  return shadeHex(accent, ink === '#ffffff' ? 0.82 : 1.08)
}
