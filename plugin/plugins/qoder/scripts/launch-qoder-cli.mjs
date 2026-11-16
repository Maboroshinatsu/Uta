/** Explicit CLI provenance: desktop hooks never inherit a guessed CLI configuration. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

export function buildLaunch(argv, env = process.env) {
  const separator = argv.indexOf('--')
  const options = separator < 0 ? argv : argv.slice(0, separator)
  const args = separator < 0 ? [] : argv.slice(separator + 1)
  const values = {}
  for (let i = 0; i < options.length; i += 2) {
    if (!['--uta-exe', '--uta-config-dir'].includes(options[i]) || !options[i + 1]) throw Error('用法：--uta-exe <CLI 程序绝对路径> --uta-config-dir <配置目录绝对路径> -- [Qoder 参数]')
    values[options[i]] = options[i + 1]
  }
  const command = values['--uta-exe']
  const configDir = values['--uta-config-dir']
  if (!command || !path.isAbsolute(command) || !fs.statSync(command).isFile() || ['.cmd', '.bat', '.ps1'].includes(path.extname(command).toLowerCase())) throw Error('请选择 Qoder CLI 原生程序的绝对路径')
  if (!configDir || !path.isAbsolute(configDir) || !fs.statSync(configDir).isDirectory()) throw Error('请选择已有 Qoder CLI 配置目录的绝对路径')
  if (args.some(arg => arg === '--config-dir' || arg.startsWith('--config-dir='))) throw Error('配置目录请使用 --uta-config-dir 指定一次')
  const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  return { command, args: ['--config-dir', configDir, '--plugin-dir', pluginDir, ...args], env: {
    ...env, UTA_QODER_SURFACE: 'cli', UTA_QODER_EXE: command, UTA_QODER_CONFIG_DIR: configDir, UTA_QODER_PLUGIN_DIR: pluginDir,
  } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const launch = buildLaunch(process.argv.slice(2))
    const child = spawn(launch.command, launch.args, { shell: false, stdio: 'inherit', env: launch.env, windowsHide: false })
    child.on('error', () => { process.stderr.write('无法启动 Qoder CLI\n'); process.exitCode = 1 })
    child.on('exit', code => { process.exitCode = code ?? 1 })
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
