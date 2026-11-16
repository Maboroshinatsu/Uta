import type { ModelInspectionInput } from './first-wave-contracts'
/** Read-only structural surface of an initialized Cubism Core model. Not a PIXI wrapper. */
export interface CoreModelView {
  parameters: {
    count: number
    ids: ArrayLike<string>
    minimumValues: ArrayLike<number>
    maximumValues: ArrayLike<number>
    defaultValues: ArrayLike<number>
  }
}
/** JSON is supplied by a trusted resource reader; the adapter validates these unknown values. */
export interface ModelMetadataSource {
  cdi: unknown | null
  physics: unknown | null
  expressions: Array<{ name: string; json: unknown }>
  motions: Array<{ group: string; index: number; json: unknown }>
}
export interface CoreInspectionRequest {
  modelSignature: string
  metadata: ModelMetadataSource
  overrides: ModelInspectionInput['overrides']
}
export type CoreInspectionResult =
  | { ok: true; input: ModelInspectionInput }
  | { ok: false; issues: Array<{ code: 'invalid-core' | 'invalid-metadata' | 'invalid-profile'; path: string; message: string }> }
