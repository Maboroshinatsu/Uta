import { computed, reactive } from 'vue'

/**
 * Settings-window registry for edits that save outside the preference draft:
 * service keys and the preset workshop. The close guard uses it to offer a
 * save instead of losing typed input or an unsaved sequence.
 */
export type UnsavedDraftKind = 'secret' | 'workshop'

export interface UnsavedDraft {
  label: string
  kind: UnsavedDraftKind
  isDirty: () => boolean
  save: () => Promise<boolean>
}

const entries = reactive(new Map<string, UnsavedDraft>())

export function registerUnsavedDraft(id: string, entry: UnsavedDraft): () => void {
  entries.set(id, entry)
  return () => { entries.delete(id) }
}

export const unsavedDraftLabels = computed(() =>
  [...entries.values()].filter(entry => entry.isDirty()).map(entry => entry.label),
)

export const hasUnsavedDraft = computed(() => unsavedDraftLabels.value.length > 0)

export const hasUnsavedSecretDraft = computed(() =>
  [...entries.values()].some(entry => entry.kind === 'secret' && entry.isDirty()),
)

export const hasUnsavedWorkshopDraft = computed(() =>
  [...entries.values()].some(entry => entry.kind === 'workshop' && entry.isDirty()),
)

export async function saveUnsavedDrafts(kind?: UnsavedDraftKind): Promise<{ ok: boolean; failed: string[] }> {
  const failed: string[] = []
  for (const entry of entries.values()) {
    if (kind && entry.kind !== kind) continue
    if (!entry.isDirty()) continue
    try {
      if (!(await entry.save())) failed.push(entry.label)
    } catch {
      failed.push(entry.label)
    }
  }
  return { ok: failed.length === 0, failed }
}
