export declare const name = 'uta-deskpet'

/** Cordis 的 inject 只表达「必需服务」；本插件不声明硬依赖，见 src/index.mjs 注释。 */
export declare const inject: string[]

export interface UtaDshPluginConfig {
  endpointFile?: string
  approvalTimeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export declare function resolveEndpointCandidates(
  config?: UtaDshPluginConfig,
  env?: NodeJS.ProcessEnv,
): string[]

export declare function readRuntimeEndpoint(
  config?: UtaDshPluginConfig,
  env?: NodeJS.ProcessEnv,
): { port: number; token: string; endpointFile: string } | null

export declare function extractInlineExpressionTags(rawText: string): {
  cleanText: string
  emotion?: string
  preset?: string
}

export declare function requestRuntime(
  method: 'GET' | 'POST',
  route: string,
  body?: unknown,
  options?: {
    config?: UtaDshPluginConfig
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<Record<string, unknown>>

export declare function buildModelContextText(
  contextSnapshot?: {
    characterAvailable?: boolean
    modelContext?: {
      modelName?: string
      presetGroups?: Array<string | { group: string; presets?: string[] }>
    }
  } | null,
): string

export declare function apply(ctx: unknown, config?: UtaDshPluginConfig): void
