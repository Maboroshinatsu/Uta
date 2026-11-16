import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isModelCalibrationEntries as validate, type ModelCalibration } from '../shared/model-calibration-contracts'

const MAX_BYTES = 512 * 1024
const SIGNATURE = /^uta-live2d-assets-v1:[a-f0-9]{64}$/
export function createModelCalibration(directory: string) {
  const file = path.join(directory, 'model-calibration.v1.json')
  function read(): { ok: true; models: Record<string, ModelCalibration[]> } | { ok: false } {
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return { ok: false }
      const raw = fs.readFileSync(file, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return { ok: false }
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false }
      const doc = parsed as Record<string, unknown>
      if (doc.version !== 1 || Object.keys(doc).some(key => !['version', 'models'].includes(key)) || !doc.models || typeof doc.models !== 'object' || Array.isArray(doc.models)) return { ok: false }
      const models = doc.models as Record<string, ModelCalibration[]>
      if (Object.keys(models).length > 100 || Object.entries(models).some(([signature, list]) => !SIGNATURE.test(signature) || !validate(list))) return { ok: false }
      return { ok: true, models }
    } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: true, models: {} } : { ok: false } }
  }
  function get(signature: string): ModelCalibration[] | null {
    const state = read()
    return state.ok ? (state.models[signature] ?? []) : null
  }
  function saveAll(models: Record<string, ModelCalibration[]>): boolean {
    if (Object.keys(models).length > 100) return false
    const content = JSON.stringify({ version: 1, models })
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return false
    const temp = path.join(directory, `.model-calibration-${randomUUID()}.tmp`)
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, file)
      return true
    } catch { try { fs.unlinkSync(temp) } catch { /* no temp */ }; return false }
  }
  function write(signature: string, value: unknown, expected?: unknown): boolean {
    if (!SIGNATURE.test(signature) || !validate(value) || (expected !== undefined && !validate(expected))) return false
    const state = read()
    if (!state.ok) return false
    if (expected !== undefined && JSON.stringify(state.models[signature] ?? []) !== JSON.stringify(expected)) return false
    return saveAll({ ...state.models, [signature]: value })
  }
  function merge(incoming: unknown, expected: unknown): { ok: boolean; imported: number; skipped: number } {
    const fail = { ok: false, imported: 0, skipped: 0 }
    const state = read()
    if (!state.ok || !expected || typeof expected !== 'object' || Array.isArray(expected) ||
      !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return fail
    try {
      const snapshot = JSON.stringify(expected)
      if (Buffer.byteLength(snapshot, 'utf8') > MAX_BYTES || JSON.stringify(state.models) !== snapshot) return fail
    } catch { return fail }
    const values = incoming as Record<string, unknown>
    if (Object.keys(values).length > 100 || Object.entries(values).some(([key, list]) => !SIGNATURE.test(key) || !validate(list))) return fail
    const models = { ...state.models }
    let imported = 0, skipped = 0
    for (const [signature, list] of Object.entries(values)) {
      if (Object.hasOwn(models, signature)) { skipped++; continue }
      models[signature] = list as ModelCalibration[]
      imported++
    }
    if (imported && !saveAll(models)) return fail
    return { ok: true, imported, skipped }
  }
  return { get, read, write, merge }
}
