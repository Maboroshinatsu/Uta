export type SettingsLayoutMode = 'wide' | 'medium' | 'compact'

/** Keep the layout contract in one testable function; CSS mirrors the same breakpoints. */
export function resolveLayoutMode(width: number): SettingsLayoutMode {
  if (!Number.isFinite(width) || width <= 620) return 'compact'
  if (width <= 800) return 'medium'
  return 'wide'
}
