import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { resolveContainedModelFile } from './model-path-safety'
import { planVtsImport, type VtsConfig } from './vts-import'
import type { ModelImportCandidate } from '../shared/model-import-contracts'

const MAX_JSON = 8 * 1024 * 1024
const MAX_REFERENCES = 4096
export interface Candidate extends ModelImportCandidate {
  manifest: string; destination: string; files: string[]; sourceAdapter: boolean; generatedAdapter?: string
}
export interface ModelImportInspection { root: string; token: string; models: string; manifest?: string }

export function safeRelative(name: string): string {
  const value = name.replaceAll('\\', '/')
  if (!value || value.includes('\0') || value.startsWith('/') || value.includes(':') || value.split('/').some(part =>
    !part || part === '.' || part === '..' || /[<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) throw Error('资源路径不受支持，请检查压缩包中的文件名。')
  return value
}
export function readModelImportJson(file: string): any {
  if (fs.statSync(file).size > MAX_JSON) throw Error('角色清单太大。')
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('角色清单格式不正确。')
  return value
}
/** 收集 VTS 常用的 sidecar：根目录 .vtube.json、表情 .exp3.json、动画 .motion3.json。 */
function collectVtsSidecars(directory: string): string[] {
  const result: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || result.length >= 256) return
    if (dir !== directory) {
      try {
        const hasOwnModel = fs.readdirSync(dir).some(name => name.toLowerCase().endsWith('.model3.json'))
        if (hasOwnModel) return
      } catch { return }
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (result.length >= 256) return
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!entry.isFile()) continue
      const rel = path.relative(directory, full).split(path.sep).join('/')
      const lower = entry.name.toLowerCase()
      if (lower.endsWith('.vtube.json')) {
        if (!rel.includes('/')) result.push(rel)
        continue
      }
      if (lower.endsWith('.exp3.json') || lower.endsWith('.motion3.json')) result.push(rel)
    }
  }
  walk(directory, 0)
  return result
}

function inspect(root: string, manifest: string, token: string, models: string, jsonValidation: Map<string, string | null>): Candidate {
  const relative = path.relative(root, manifest).split(path.sep).join('/')
  const kind = manifest.endsWith('deskpet-images.json') ? 'image-set' : 'live2d'
  const directory = path.dirname(manifest)
  let sourceAdapter = false
  const warnings: string[] = [], errors: string[] = [], files = new Set<string>([path.basename(manifest)])
  let name = path.basename(directory) === 'payload' ? path.basename(manifest).replace(/\.model3\.json$/, '') : path.basename(directory)
  let summary = '', imageUrl: string | undefined
  const baseUrl = `uta://model-import/${token}/`
  const url = (name: string) => baseUrl + name.split('/').map(encodeURIComponent).join('/')
  let references = 0
  const resolved = new Map<string, string | null>()
  const asset = (value: unknown, required = true, isJson = false): string | null => {
    if (++references > MAX_REFERENCES) throw Error('单个模型的资源引用超过 4096 项，请精简角色清单。')
    if (typeof value !== 'string') { if (required) throw Error('缺少必要资源引用。'); return null }
    const key = safeRelative(value)
    if (!resolved.has(key)) {
      const file = resolveContainedModelFile([directory], key)
      resolved.set(key, file && fs.statSync(file).size > 0 ? file : null)
    }
    const full = resolved.get(key)
    if (!full) {
      if (required) throw Error(`缺少必要资源：${key}`)
      warnings.push(`未找到可选资源，已跳过：${key}`); return null
    }
    if (isJson) {
      if (!jsonValidation.has(full)) {
        try { readModelImportJson(full); jsonValidation.set(full, null) } catch (error) {
          jsonValidation.set(full, error instanceof Error ? error.message : '角色资源无法读取。')
        }
      }
      const failure = jsonValidation.get(full)
      if (failure !== null) {
        if (required) throw Error(failure)
        const warning = `可选资源格式不正确，已跳过：${key}`
        if (!warnings.includes(warning)) warnings.push(warning)
        return null
      }
    }
    files.add(key)
    return full
  }
  let generatedAdapter: string | undefined
  try {
    const doc = readModelImportJson(manifest)
    const adapterFile = fs.existsSync(path.join(directory, 'deskpet-adapter.json'))
      ? asset('deskpet-adapter.json', false, true) : null
    sourceAdapter = !!adapterFile
    if (kind === 'image-set') {
      if (!doc.images || typeof doc.images !== 'object' || Array.isArray(doc.images) || !Object.keys(doc.images).length) throw Error('立绘清单缺少图片。')
      name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim().slice(0, 60) : name
      const fallback = typeof doc.default === 'string' ? doc.default : doc.images.normal ? 'normal' : doc.images.neutral ? 'neutral' : Object.keys(doc.images)[0]
      if (!doc.images[fallback]) throw Error('默认立绘不存在。')
      for (const [emotion, value] of Object.entries(doc.images)) {
        const full = asset(value, emotion === fallback)
        if (!full) delete doc.images[emotion]
        else if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(full)) throw Error('立绘引用必须是图片。')
      }
      if (doc.talk && !asset(doc.talk, false)) delete doc.talk
      imageUrl = url(path.relative(root, path.join(directory, doc.images[fallback])).split(path.sep).join('/'))
      summary = `${Object.keys(doc.images).length} 种立绘表情`
    } else {
      const refs = doc.FileReferences
      if (!refs || typeof refs !== 'object' || Array.isArray(refs)) throw Error('Live2D 清单缺少资源引用。')
      const moc = asset(refs.Moc)!
      const header = Buffer.alloc(4), fd = fs.openSync(moc, 'r')
      try { fs.readSync(fd, header, 0, 4, 0) } finally { fs.closeSync(fd) }
      if (header.toString('ascii') !== 'MOC3') throw Error('Live2D 主文件损坏或格式不正确。')
      if (!Array.isArray(refs.Textures) || !refs.Textures.length) throw Error('Live2D 清单没有贴图。')
      for (const texture of refs.Textures) if (!/\.(png|jpe?g|webp)$/i.test(asset(texture)!)) throw Error('Live2D 贴图格式不受支持。')
      for (const key of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) if (refs[key] && !asset(refs[key], false, true)) delete refs[key]
      if (refs.Expressions !== undefined && !Array.isArray(refs.Expressions)) throw Error('表情列表格式不正确。')
      refs.Expressions = (refs.Expressions ?? []).filter((item: any) => !!asset(item?.File, false, true))
      if (refs.Motions !== undefined && (!refs.Motions || typeof refs.Motions !== 'object' || Array.isArray(refs.Motions))) throw Error('动作列表格式不正确。')
      for (const [group, values] of Object.entries(refs.Motions ?? {})) {
        if (!Array.isArray(values)) throw Error('动作组格式不正确。')
        refs.Motions[group] = values.filter(item => {
          if (!asset(item?.File, false, true)) return false
          if (item.Sound && !asset(item.Sound, false)) delete item.Sound
          return true
        })
      }
      summary = `${refs.Textures.length} 张贴图 · ${refs.Expressions.length} 个表情 · ${Object.values(refs.Motions ?? {}).flat().length} 个动作`

      // VTS 常把表情/动画放在未注册的 Exp3/Animation 目录，配置写在 .vtube.json。
      // 不补这些 sidecar，导入后会只剩核心模型，表情和动作全部丢失。
      const vtsSidecars = collectVtsSidecars(directory)
      let vtsConfig: VtsConfig | null = null
      const validSidecars: string[] = []
      for (const rel of vtsSidecars) {
        let key: string
        try { key = safeRelative(rel) } catch { warnings.push(`已跳过非法 VTS 资源：${rel}`); continue }
        const full = asset(key, false, true)
        if (!full) continue
        validSidecars.push(key)
        if (key.toLowerCase().endsWith('.vtube.json')) {
          try { vtsConfig = JSON.parse(fs.readFileSync(full, 'utf8')) as VtsConfig } catch { /* asset 已校验 JSON */ }
        }
      }
      if (validSidecars.length > 0) {
        const plan = planVtsImport({
          sidecars: validSidecars,
          vtsConfig,
          existingExpressionFiles: (refs.Expressions ?? []).map((item: any) => item?.File).filter((file: unknown): file is string => typeof file === 'string'),
          existingExpressionNames: (refs.Expressions ?? []).map((item: any) => item?.Name).filter((name: unknown): name is string => typeof name === 'string'),
          existingMotionGroups: Object.keys(refs.Motions ?? {}),
          existingMotionFiles: Object.values(refs.Motions ?? {}).flat().map((item: any) => item?.File).filter((file: unknown): file is string => typeof file === 'string'),
        })
        if (plan.expressions.length > 0) refs.Expressions = [...(refs.Expressions ?? []), ...plan.expressions]
        if (Object.keys(plan.motions).length > 0) refs.Motions = { ...(refs.Motions ?? {}), ...plan.motions }
        if (plan.expressions.length > 0 || Object.keys(plan.motions).length > 0) {
          summary += ` · VTS 表情 ${plan.expressions.length} · 动作 ${Object.values(plan.motions).flat().length}`
        }
        if (!sourceAdapter) {
          const generated = {
            version: 1,
            name,
            idleMotions: plan.idleMotions,
            lipSync: plan.lipSync ?? { mouthOpenParam: 'ParamMouthOpenY', gain: 1 },
            generatedFocus: plan.focus ?? null,
            ...(plan.baseParameters ? { baseParameters: plan.baseParameters } : {}),
            emotions: plan.emotions ?? {},
            animations: plan.animations ?? {},
            controls: plan.controls ?? {},
          }
          generatedAdapter = JSON.stringify(generated, null, 2)
        }
      }
    }
    // Import known data sidecars; code and unrelated files never enter the managed model.
    if (fs.existsSync(path.join(directory, 'deskpet-presets.json'))) asset('deskpet-presets.json', false, true)
    if (adapterFile) {
      const label = readModelImportJson(adapterFile).name
      if (typeof label === 'string' && label.trim()) name = label.trim().slice(0, 60)
    }
    fs.writeFileSync(manifest, JSON.stringify(doc))
  } catch (error) { errors.push(error instanceof Error ? error.message : '角色资源无法读取。') }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'character'
  const prefix = `${kind}:${name}`
  const folderName = (identity: string) => `imported-${slug}-${createHash('sha256').update(identity).digest('hex').slice(0, 10)}`
  const existing = folderName(prefix)
  const manifestName = path.basename(manifest)
  const variant = folderName(`${prefix}:${manifestName}`)
  const sameDirectoryVariant = kind === 'live2d' && fs.readdirSync(directory)
    .some(file => file !== manifestName && file.endsWith('.model3.json'))
  const destination = fs.existsSync(path.join(path.join(models, existing), manifestName)) ? existing
    : fs.existsSync(path.join(models, variant)) || fs.existsSync(path.join(models, existing)) || sameDirectoryVariant ? variant
      : existing
  return { id: randomUUID(), name, kind, bytes: [...files].reduce((sum, file) => sum + (fs.existsSync(path.join(directory, file)) ? fs.statSync(path.join(directory, file)).size : 0), 0),
    previewUrl: url(relative), ...(imageUrl ? { imageUrl } : {}), summary, warnings, errors, replaces: fs.existsSync(path.join(models, destination)), manifest, destination, files: [...files], sourceAdapter, generatedAdapter }
}

export function inspectModelCandidates({ root, token, models, manifest }: ModelImportInspection): Candidate[] {
  const manifests: string[] = []
  const scan = (directory: string, depth: number): void => {
    if (depth > 5) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) scan(file, depth + 1)
      else if (entry.name.endsWith('.model3.json') || entry.name === 'deskpet-images.json') {
        if (manifests.length >= 32) throw Error('一次最多预览 32 个角色，请分开导入。')
        manifests.push(file)
      }
    }
  }
  if (manifest) manifests.push(manifest)
  else scan(root, 0)
  if (!manifests.length) throw Error('没有找到 .model3.json 或 deskpet-images.json，请选择完整角色包。')
  const validation = new Map<string, string | null>()
  return manifests.map(file => inspect(root, file, token, models, validation))
}
