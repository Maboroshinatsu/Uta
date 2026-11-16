import type { DeskpetModel } from './loader'

const WATERMARK_DRAWABLE = /^(?:watermark|shuiyin)(?:[_-]?\d+)?$/i
const ELLEN_ASSET_SIGNATURE = 'uta-live2d-assets-v1:a4496b307bbeec92781ba2098fb0e0078d67e5da517bdf6f4470f4d36b3c16ca'

/** Only omit complete triangles from the atlas region verified for this model. */
function withoutEllenCredits(indices: Uint16Array, uv: Float32Array): Uint16Array | null {
  const kept: number[] = []
  const inCredits = (index: number): boolean => {
    const u = uv[index * 2]
    const v = uv[index * 2 + 1]
    return u >= 0.065 && u <= 0.15 && v >= 0.77 && v <= 0.97
  }
  if (indices.length % 3 !== 0) return null
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    const covered = [a, b, c].filter(inCredits).length
    if (covered !== 0 && covered !== 3) return null
    if (covered === 0) kept.push(a, b, c)
  }
  return kept.length < indices.length ? Uint16Array.from(kept) : null
}

export function prepareModelWatermarkDrawables(model: DeskpetModel, hidden: string[], signature?: string): string[] {
  const core = (model.internalModel as any)?.coreModel
  const drawableIds = core?._model?.drawables?.ids
  if (!Array.isArray(drawableIds)) return hidden
  const hiddenIds = new Set(hidden)
  for (const id of drawableIds) {
    if (typeof id === 'string' && WATERMARK_DRAWABLE.test(id)) hiddenIds.add(id)
  }

  if (signature === ELLEN_ASSET_SIGNATURE && typeof core.getDrawableVertexIndices === 'function' &&
    typeof core.getDrawableVertexIndexCount === 'function' && typeof core.getDrawableVertexUvs === 'function') {
    const face = drawableIds.indexOf('ArtMesh183')
    const duplicate = drawableIds.indexOf('ArtMesh255')
    if (face >= 0 && duplicate >= 0) {
      const faceIndices = withoutEllenCredits(core.getDrawableVertexIndices(face), core.getDrawableVertexUvs(face))
      const duplicateIndices = withoutEllenCredits(core.getDrawableVertexIndices(duplicate), core.getDrawableVertexUvs(duplicate))
      // The credits are duplicated in a separate mesh and in the face mesh.
      if (faceIndices?.length && duplicateIndices?.length === 0) {
        hiddenIds.add('ArtMesh255')
        const originalIndices = core.getDrawableVertexIndices.bind(core)
        const originalCount = core.getDrawableVertexIndexCount.bind(core)
        core.getDrawableVertexIndices = (index: number) => index === face ? faceIndices : originalIndices(index)
        core.getDrawableVertexIndexCount = (index: number) => index === face ? faceIndices.length : originalCount(index)
      }
    }
  }
  return [...hiddenIds]
}
