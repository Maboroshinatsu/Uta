export interface ModelImportCandidate {
  id: string
  name: string
  kind: 'live2d' | 'image-set'
  bytes: number
  previewUrl: string
  imageUrl?: string
  summary: string
  warnings: string[]
  errors: string[]
  replaces: boolean
}
export interface ModelImportPreview {
  token: string
  candidates: ModelImportCandidate[]
}
export type ModelImportResult = { ok: true; preview: ModelImportPreview } | { ok: false; error: string }
