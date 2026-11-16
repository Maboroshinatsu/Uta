export type OnboardingHostId =
  | 'codex'
  | 'deepseek-harness'
  | 'maibot'
  | 'qoder'
  | 'antigravity'
  | 'claude-code'
  | 'zcode'
  | 'opencode'
  | 'standalone'

export type OnboardingStageId =
  | 'detected'
  | 'plugin'
  | 'tools'
  | 'runtime'
  | 'session'
  | 'response'

export type OnboardingStageState =
  | 'verified'
  | 'pending'
  | 'manual'
  | 'failed'
  | 'unavailable'

export interface OnboardingStage {
  id: OnboardingStageId
  state: OnboardingStageState
  detail: string
}

export interface OnboardingHost {
  id: OnboardingHostId
  name: string
  description: string
  installed: boolean
  executable: string
  configPath: string
  autoInstall: boolean
  pluginInstalled: boolean
  pluginVersion: string
  stages: OnboardingStage[]
  notes: string[]
  manualSteps: string[]
  /** Optional install-button label for hosts whose action is more specific than "安装并连接". */
  installLabel?: string
  /** Optional explanation shown next to the install/path actions. */
  installNote?: string
  /** Optional path picker label for hosts that need an executable selected manually. */
  pathActionLabel?: string
  /** Optional directory picker label for hosts with a non-standard data directory. */
  homeActionLabel?: string
}

export interface OnboardingDetection {
  hosts: OnboardingHost[]
  runtime: {
    activeHostId: string
    connected: boolean
    sessions: Array<{ sessionId: string; label: string; selected: boolean }>
  }
  checkedAt: string
}

export interface OnboardingInstallResult {
  ok: boolean
  hostId: OnboardingHostId
  stages: OnboardingStage[]
  backupPath: string
  restartRequired: boolean
  sessionRequired: boolean
  error: string
  detail: string
  /** A timed-out writer may still own the host config; retry stays blocked until release. */
  retryBlocked?: boolean
}
