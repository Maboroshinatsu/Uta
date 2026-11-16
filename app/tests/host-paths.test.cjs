'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const createLoader = require('./support/settings-loader.cjs')

const {
  readHostPathOverrides,
  resolveHostPaths,
  findOnPath,
  writeDshHomeOverride,
  writeHostPathOverride,
} = createLoader()('main/host-paths')

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-host-paths-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '')
  return file
}

test('host paths come from config, environment and PATH instead of the dev machine', (t) => {
  const root = tempDir(t)
  const bin = path.join(root, 'bin')
  const runtime = path.join(root, 'runtime')
  const files = {
    harnessExe: touch(path.join(root, 'portable', 'DeepSeek Harness.exe')),
    opencodeExe: touch(path.join(bin, 'opencode.exe')),
    zcodeCli: touch(path.join(root, 'tools', 'zcode.cjs')),
    nodeExe: touch(path.join(bin, 'node.exe')),
    claudeExe: touch(path.join(root, 'npm', 'claude.exe')),
    codexExe: touch(path.join(root, 'codex', 'codex.exe')),
  }
  const cli = touch(path.join(
    root,
    'portable',
    'resources',
    'app.asar',
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh-desktop-host',
    'lib',
    'cli.js',
  ))
  fs.mkdirSync(runtime, { recursive: true })
  fs.writeFileSync(path.join(runtime, 'host-paths.json'), JSON.stringify({
    harnessExe: files.harnessExe,
    opencodeExe: 'C:/missing/opencode.exe',
    zcodeCli: files.zcodeCli,
    nodeExe: files.nodeExe,
    claudeExe: files.claudeExe,
    codexExe: files.codexExe,
  }))

  const paths = resolveHostPaths(root, runtime, {
    PATH: bin,
    Path: bin,
    APPDATA: '',
    LOCALAPPDATA: '',
  })
  assert.equal(readHostPathOverrides(path.join(runtime, 'host-paths.json')).harnessExe, files.harnessExe)
  assert.equal(paths.harnessExe, files.harnessExe)
  assert.equal(paths.harnessCli, cli, 'a configured harness should derive its bundled CLI')
  assert.equal(paths.opencodeExe, files.opencodeExe, 'a missing configured path should fall back to PATH')
  assert.equal(paths.zcodeCli, files.zcodeCli)
  assert.equal(paths.nodeExe, files.nodeExe)
  assert.equal(paths.claudeExe, files.claudeExe)
  assert.equal(paths.codexExe, files.codexExe)
})

test('batch shims are not advertised as direct host executables', (t) => {
  const root = tempDir(t)
  const shim = touch(path.join(root, 'codex.cmd'))
  const paths = resolveHostPaths(root, path.join(root, 'runtime'), {
    PATH: '',
    APPDATA: '',
    LOCALAPPDATA: '',
    UTA_CODEX_EXE: shim,
  })
  assert.notEqual(paths.codexExe, shim)
  assert.equal(findOnPath(['codex.exe', 'codex'], { PATH: path.dirname(shim) }), '')
})

test('Claude can resolve a JS entry when no native exe is available', (t) => {
  const root = tempDir(t)
  const claudeJs = touch(path.join(
    root, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js',
  ))
  const paths = resolveHostPaths(root, path.join(root, 'runtime'), {
    PATH: '',
    APPDATA: root,
    LOCALAPPDATA: '',
  })
  assert.equal(paths.claudeJs, claudeJs)
  assert.equal(paths.claudeExe, '')
})

test('Claude prefers its npm native binary over a POSIX shell shim on Windows', { skip: process.platform !== 'win32' }, t => {
  const root = tempDir(t)
  const npm = path.join(root, 'npm')
  fs.mkdirSync(npm, { recursive: true })
  const shim = path.join(npm, 'claude')
  fs.writeFileSync(shim, '#! shim fixture\n')
  const binary = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  const hostPaths = createLoader({ 'node:fs': {
    ...fs, statSync: file => file === binary ? { isFile: () => true } : fs.statSync(file),
  } })('main/host-paths')
  const paths = hostPaths.resolveHostPaths(root, path.join(root, 'runtime'), {
    PATH: npm, APPDATA: root, LOCALAPPDATA: '', USERPROFILE: root, HOME: root,
  })
  assert.equal(paths.claudeExe, binary)
  assert.equal(findOnPath(['claude'], { PATH: npm }), '')
  assert.throws(() => writeHostPathOverride(path.join(root, 'runtime'), 'claude-code', shim))
  const js = touch(path.join(root, 'chosen.cjs'))
  const chosen = hostPaths.resolveHostPaths(root, path.join(root, 'runtime'), {
    PATH: npm, APPDATA: root, LOCALAPPDATA: '', USERPROFILE: root, HOME: root, UTA_CLAUDE_JS: js,
  })
  assert.equal(chosen.claudeExe, '', 'an explicitly chosen JS entry takes priority over a discovered native binary')
  assert.equal(chosen.claudeJs, js)
})

test('a chosen host path is saved and reused; batch shims are refused', (t) => {
  const root = tempDir(t)
  const runtime = path.join(root, 'runtime')
  const codex = touch(path.join(root, 'codex.exe'))
  assert.equal(writeHostPathOverride(runtime, 'codex', codex), 'codexExe')
  const paths = resolveHostPaths(root, runtime, { PATH: '', APPDATA: '', LOCALAPPDATA: '' })
  assert.equal(paths.codexExe, codex)
  assert.throws(() => writeHostPathOverride(runtime, 'codex', touch(path.join(root, 'bad.cmd'))))

  const claudeJs = touch(path.join(root, 'claude.js'))
  assert.equal(writeHostPathOverride(runtime, 'claude-code', claudeJs), 'claudeJs')
  assert.equal(
    resolveHostPaths(root, runtime, { PATH: '', APPDATA: '', LOCALAPPDATA: '' }).claudeJs,
    claudeJs,
  )
})

test('environment overrides and PATH lookup are explicit and testable', (t) => {
  const root = tempDir(t)
  const bin = path.join(root, 'bin')
  const executable = touch(path.join(bin, 'opencode.exe'))
  assert.equal(findOnPath(['opencode.exe'], { PATH: bin }), executable)
  const paths = resolveHostPaths(root, path.join(root, 'runtime'), {
    PATH: bin,
    APPDATA: '',
    LOCALAPPDATA: '',
    UTA_OPENCODE_EXE: executable,
  })
  assert.equal(paths.opencodeExe, executable)
})

test('DSH is found in common per-user installs and its data directory can be chosen', (t) => {
  const root = tempDir(t)
  const local = path.join(root, 'local')
  const exe = touch(path.join(local, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'))
  const cli = touch(path.join(
    local, 'Programs', 'DeepSeek Harness',
    'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai',
    'dsh-desktop-host', 'lib', 'cli.js',
  ))
  const paths = resolveHostPaths(root, path.join(root, 'runtime'), {
    PATH: '',
    APPDATA: '',
    LOCALAPPDATA: local,
    PROGRAMFILES: '',
    'PROGRAMFILES(X86)': '',
    USERPROFILE: '',
    HOME: '',
  })
  assert.equal(paths.harnessExe, exe)
  assert.equal(paths.harnessCli, cli)

  const home = path.join(root, 'user', '.dsh')
  fs.mkdirSync(path.join(home, 'profiles', 'desktop'), { recursive: true })
  const saved = writeDshHomeOverride(path.join(root, 'runtime'), path.join(home, 'profiles', 'desktop'))
  assert.equal(saved, home)
  assert.equal(
    resolveHostPaths(root, path.join(root, 'runtime'), { PATH: '', APPDATA: '', LOCALAPPDATA: '' }).harnessHome,
    home,
  )
  assert.throws(() => writeDshHomeOverride(path.join(root, 'runtime'), root))
})
