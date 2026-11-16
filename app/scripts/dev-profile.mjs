/** 为源码开发生成独立环境；供同终端启动的宿主插件复用打印的配置。 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveAppEnvironment } from '../../plugin/shared/uta-environment.mjs'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const environment = resolveAppEnvironment(process.env, {
  sourceDir: appDir,
  isPackaged: false,
  appData: process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(process.env.HOME, 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, '.config')),
})
if (environment.isStable) throw new Error('Source development must use a separate profile')
fs.mkdirSync(environment.userData, { recursive: true })
const env = {
  ...process.env,
  UTA_PROFILE: environment.profile,
  UTA_USER_DATA_DIR: environment.userData,
  UTA_RUNTIME_DIR: environment.runtimeDir,
  UTA_ENDPOINT_FILE: environment.endpointFile,
}
delete env.ELECTRON_RUN_AS_NODE
console.log(JSON.stringify({ sourceDir: appDir, ...environment }, null, 2))
const child = spawn(process.execPath, [path.join(appDir, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev', ...process.argv.slice(2)], {
  cwd: appDir, env, stdio: 'inherit', windowsHide: true,
})
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
