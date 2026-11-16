import dafish from './dafish.json'

/** An available asset signature is authoritative; legacy names are exact hints only. */
export const DAFISH_MODEL_SIGNATURE = 'uta-live2d-assets-v1:b72fb6bc0c74e119b0f11db582d90e6736bc3471226b10085e48c4dbb0583fe8'

export interface BuiltinAdapterEntry {
  signature: string
  name: string
  modelId?: string
  aliases?: readonly string[]
  adapter: unknown
}

const entries: readonly BuiltinAdapterEntry[] = [
  {
    signature: DAFISH_MODEL_SIGNATURE,
    name: '大肥鱼',
    modelId: 'imported-character-072c7e1cdc',
    aliases: ['大肥鱼', 'dafish', 'da-fish', 'deepseek娘', 'c_0120'],
    adapter: dafish,
  },
]

const bySignature = new Map(entries.map((entry) => [entry.signature, entry]))

export function findBuiltinAdapter(
  signature?: string | null,
  nameOrIdHint?: string | null,
): BuiltinAdapterEntry | null {
  if (signature) {
    return bySignature.get(signature) ?? null
  }
  if (nameOrIdHint && typeof nameOrIdHint === 'string') {
    const hint = nameOrIdHint.trim().toLowerCase()
    for (const entry of entries) {
      if (entry.name.toLowerCase() === hint) return entry
      if (entry.modelId && entry.modelId.toLowerCase() === hint) return entry
      if (entry.aliases) {
        for (const alias of entry.aliases) {
          const lower = alias.toLowerCase()
          if (hint === lower) return entry
        }
      }
    }
  }
  return null
}

export function listBuiltinAdapters(): readonly BuiltinAdapterEntry[] {
  return entries
}
