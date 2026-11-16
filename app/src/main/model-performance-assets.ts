import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveContainedModelFile } from './model-path-safety'
import type { ModelPerformanceAssets } from '../shared/model-performance-contracts'

/** Read only manifest-declared assets, once per load. Never scan personal sidecars. */
export function readModelPerformanceAssets(modelFile: string): ModelPerformanceAssets | null {
  try {
    const root = dirname(modelFile)
    const files = new Map<string, Buffer>()
    let total = 0
    const read = (name: unknown, json = false): Buffer => {
      if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes(':')) throw new Error('invalid-reference')
      const key = name.replaceAll('\\', '/')
      if (key.split('/').includes('..')) throw new Error('invalid-reference')
      const cached = files.get(key)
      if (cached) return cached
      if (files.size >= 1024) throw new Error('too-many-assets')
      const target = resolveContainedModelFile([root], key)
      if (!target || (json && !target.toLowerCase().endsWith('.json'))) throw new Error('missing-asset')
      const size = statSync(target).size
      if (size > (json ? 8 : 32) * 1024 * 1024 || total + size > 128 * 1024 * 1024) throw new Error('asset-too-large')
      const bytes = readFileSync(target)
      total += bytes.length
      if (total > 128 * 1024 * 1024) throw new Error('asset-too-large')
      files.set(key, bytes)
      return bytes
    }
    const json = (name: unknown) => JSON.parse(read(name, true).toString('utf8'))
    const manifest = json(basename(modelFile))
    const refs = manifest.FileReferences
    if (!refs || typeof refs !== 'object' || typeof refs.Moc !== 'string') return null
    read(refs.Moc)
    if (!Array.isArray(refs.Textures)) return null
    for (const texture of refs.Textures) read(texture)
    const metadata: ModelPerformanceAssets['metadata'] = {
      cdi: refs.DisplayInfo ? json(refs.DisplayInfo) : null,
      physics: refs.Physics ? json(refs.Physics) : null,
      expressions: [], motions: [],
    }
    if (refs.Pose) json(refs.Pose)
    if (refs.Expressions !== undefined && !Array.isArray(refs.Expressions)) return null
    for (const entry of refs.Expressions ?? []) metadata.expressions.push({ name: entry.Name, json: json(entry.File) })
    if (refs.Motions !== undefined && (!refs.Motions || typeof refs.Motions !== 'object' || Array.isArray(refs.Motions))) return null
    for (const [group, entries] of Object.entries(refs.Motions ?? {})) {
      if (!Array.isArray(entries)) return null
      for (const [index, entry] of entries.entries()) {
        metadata.motions.push({ group, index, json: json(entry.File) })
        if (entry.Sound) read(entry.Sound)
      }
    }
    // This algorithm is versioned separately from the DS baseline manifest signature.
    const hashes = [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])
    const signature = createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
    return { modelSignature: `uta-live2d-assets-v1:${signature}`, metadata }
  } catch { return null }
}
