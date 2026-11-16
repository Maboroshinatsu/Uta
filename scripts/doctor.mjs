#!/usr/bin/env node
/** 脱敏诊断；只查询明确 profile，不探测或修复其他实例。 */
import { resolveRuntimePaths } from '../plugin/shared/uta-environment.mjs'
import { getHealth } from '../plugin/shared/uta-runtime-client.mjs'

try {
  const env = { ...process.env, UTA_PROFILE: process.argv[2] || process.env.UTA_PROFILE || 'stable' }
  const paths = resolveRuntimePaths(env)
  console.log(JSON.stringify(paths, null, 2))
  console.log(JSON.stringify(await getHealth({ env, timeoutMs: 3000 }), null, 2))
} catch (error) {
  console.error(`Uta connection failed: ${error.message}`)
  process.exitCode = 1
}
