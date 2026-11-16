/**
 * Cross-window hint: the settings window owns the workshop draft, while the
 * pet window's quick panel can trigger a model switch. A localStorage flag lets
 * the quick panel refuse that switch instead of silently discarding the draft.
 */
const KEY = 'uta:workshop-draft-dirty'
const MAX_AGE_MS = 120_000

export function setWorkshopDraftSignal(dirty: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify({ dirty, at: Date.now() }))
  } catch {
    /* storage can be unavailable; the close guard still protects the draft */
  }
}

export function isWorkshopDraftDirtyElsewhere(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null') as { dirty?: unknown; at?: unknown } | null
    return parsed?.dirty === true &&
      typeof parsed.at === 'number' &&
      Date.now() - parsed.at < MAX_AGE_MS
  } catch {
    return false
  }
}
