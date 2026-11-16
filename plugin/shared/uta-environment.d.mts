export interface RuntimePaths {
  profile: string
  userData: string
  runtimeDir: string
  hooksDir: string
  endpointFile: string
  isStable: boolean
  explicit: boolean
}
export function resolveRuntimePaths(
  env?: NodeJS.ProcessEnv,
  options?: { appData?: string },
): RuntimePaths
export function resolveAppEnvironment(
  env: NodeJS.ProcessEnv,
  options: { appData: string; sourceDir: string; isPackaged: boolean },
): RuntimePaths
