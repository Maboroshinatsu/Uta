'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createLoader = require('./support/settings-loader.cjs')

const mod = createLoader()('main/host-onboarding')

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uta-host-onboarding-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const appData = path.join(root, 'appdata')
  const runtimeDir = path.join(root, 'runtime')
  const codexHome = path.join(root, 'codex-home')
  const dshHome = path.join(root, 'dsh-home')
  const assetRoot = path.join(root, 'assets')
  const marketplace = path.join(assetRoot, 'codex-marketplace')
  const pluginDir = path.join(marketplace, 'plugins', 'uta-deskpet', '.codex-plugin')
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'uta-deskpet', version: '0.2.2' }))
  fs.mkdirSync(codexHome, { recursive: true })
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "keep-me"\n')
  const codexExe = path.join(root, 'codex.exe')
  fs.writeFileSync(codexExe, 'fake')
  return { root, appData, runtimeDir, codexHome, dshHome, assetRoot, marketplace, codexExe }
}

function fakeCodex(initialInstalled = false) {
  const state = { installed: initialInstalled, version: '0.2.2', calls: [] }
  const run = async (file, args) => {
    state.calls.push(args.join(' '))
    if (args[0] === '--version') return { code: 0, stdout: 'codex-cli 0.164.0\n', stderr: '' }
    if (args[0] === 'plugin' && args[1] === 'list') {
      const installed = state.installed ? [{
        name: 'uta-deskpet', pluginId: 'uta-deskpet@uta', marketplaceName: 'uta',
        version: state.version, installed: true, enabled: true,
      }] : []
      return { code: 0, stdout: JSON.stringify({ installed, available: [] }), stderr: '' }
    }
    if (args[0] === 'mcp' && args[1] === 'list') {
      return {
        code: 0,
        stdout: state.installed
          ? JSON.stringify({ servers: [{ name: 'uta-deskpet', enabled: true }] })
          : JSON.stringify({ servers: [] }),
        stderr: '',
      }
    }
    if (args[0] === 'plugin' && args[1] === 'marketplace') return { code: 0, stdout: '{"alreadyAdded":false}', stderr: '' }
    if (args[0] === 'plugin' && args[1] === 'add') {
      state.installed = true
      return { code: 0, stdout: '{"ok":true}', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { state, run }
}

function makeService(box, hostRun, extra = {}) {
  return mod.createHostOnboarding({
    appData: box.appData,
    runtimeDir: box.runtimeDir,
    env: {
      ...process.env,
      CODEX_HOME: box.codexHome,
      DSH_HOME: box.dshHome,
      USERPROFILE: box.root,
      HOME: box.root,
      APPDATA: box.appData,
      LOCALAPPDATA: '',
      PROGRAMFILES: '',
      'PROGRAMFILES(X86)': '',
    },
    codexExe: box.codexExe,
    harnessExe: '',
    qoderExe: '',
    antigravityExe: '',
    assetRoot: box.assetRoot,
    exists: file => fs.existsSync(file),
    run: hostRun,
    isRuntimeReady: () => true,
    getSessions: hostId => hostId === 'codex'
      ? [{ sessionId: 's1', label: 'Codex 当前聊天', selected: true }]
      : [],
    ...extra,
  })
}

function dshAssets(box) {
  const plugin = path.join(box.assetRoot, 'deepseek-harness')
  fs.mkdirSync(plugin, { recursive: true })
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({
    name: '@uta/deepseek-harness-plugin',
    version: '0.5.3',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  fs.writeFileSync(path.join(plugin, 'cordis.patch.yml'), 'plugins: []\n')
  return plugin
}

function dshInstall(box) {
  const exe = path.join(box.root, 'DeepSeek Harness.exe')
  fs.writeFileSync(exe, 'fake')
  const cli = path.join(
    box.root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai',
    'dsh-desktop-host', 'lib', 'cli.js',
  )
  fs.mkdirSync(path.dirname(cli), { recursive: true })
  fs.writeFileSync(cli, 'fake cli')
  fs.mkdirSync(path.join(box.root, 'resources', 'runtime', 'cli', 'bin'), { recursive: true })
  fs.writeFileSync(path.join(box.root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'), 'fake shim')
  return { exe, cli }
}

function dshProfile(box, { plugin = false, home = box.dshHome } = {}) {
  const profile = path.join(home, 'profiles', 'desktop')
  fs.mkdirSync(profile, { recursive: true })
  const pkg = {
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }
  if (plugin) {
    const pluginDir = dshAssets(box)
    pkg.dependencies['@uta/deepseek-harness-plugin'] = `link:${pluginDir}`
    pkg.dsh.profile.bundles.push('@uta/deepseek-harness-plugin')
    const link = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(pluginDir, link, 'junction')
  }
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), 'profile: keep\n')
  return { profile, pkg }
}

function fakeDshRun(box, { running = false, fail = false } = {}) {
  dshAssets(box)
  const state = { calls: [] }
  const run = async (file, args, options = {}) => {
    state.calls.push({ file, args, env: options.env || {} })
    if (args[0] === '/FI') {
      return {
        code: 0,
        stdout: running ? '"DeepSeek Harness.exe","1234","Console","1","100 K"\r\n' : '',
        stderr: '',
      }
    }
    if (args.includes('add') && args.includes('desktop')) {
      const profile = path.join(box.dshHome, 'profiles', 'desktop')
      const packageFile = path.join(profile, 'package.json')
      if (fail) {
        fs.writeFileSync(packageFile, JSON.stringify({ broken: true }) + '\n')
        return { code: 1, stdout: '', stderr: 'fake CLI failure' }
      }
      const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
      pkg.dependencies = pkg.dependencies || {}
      const installedSource = args.at(-1)
      pkg.dependencies['@uta/deepseek-harness-plugin'] = `link:${installedSource}`
      pkg.dsh = pkg.dsh || { profile: { bundles: [] } }
      pkg.dsh.profile = pkg.dsh.profile || { bundles: [] }
      if (!pkg.dsh.profile.bundles.includes('@uta/deepseek-harness-plugin')) {
        pkg.dsh.profile.bundles.push('@uta/deepseek-harness-plugin')
      }
      fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n')
      const link = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.rmSync(link, { recursive: true, force: true })
      fs.symlinkSync(installedSource, link, 'junction')
      return { code: 0, stdout: 'installed', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { state, run }
}

test('Codex detection reports real stages and an installed plugin', async t => {
  const box = sandbox(t)
  const { run } = fakeCodex(true)
  const service = makeService(box, run)
  const detection = await service.detect()
  const codex = detection.hosts.find(host => host.id === 'codex')
  assert.equal(codex.installed, true)
  assert.equal(codex.pluginInstalled, true)
  assert.equal(codex.autoInstall, true)
  assert.equal(codex.stages.find(stage => stage.id === 'plugin').state, 'verified')
  // A registered MCP entry is not proof of a live handshake; keep the tool
  // stage pending instead of claiming the tools are already usable.
  assert.equal(codex.stages.find(stage => stage.id === 'tools').state, 'pending')
  assert.match(codex.stages.find(stage => stage.id === 'tools').detail, /MCP 已登记并启用/)
  assert.equal(codex.stages.find(stage => stage.id === 'session').state, 'verified')
  assert.match(codex.stages.find(stage => stage.id === 'session').detail, /Codex 当前聊天/)
})

test('install is idempotent, backs up the existing config and asks for a new session', async t => {
  const box = sandbox(t)
  const { state, run } = fakeCodex(false)
  const service = makeService(box, run)
  const first = await service.install('codex')
  assert.equal(first.ok, true)
  assert.equal(first.sessionRequired, true)
  assert.ok(first.backupPath && fs.existsSync(first.backupPath))
  assert.equal(fs.readFileSync(first.backupPath, 'utf8'), 'model = "keep-me"\n')
  assert.ok(state.calls.some(call => call.startsWith('plugin marketplace add')))
  assert.ok(state.calls.some(call => call.startsWith('plugin add uta-deskpet@uta')))

  const callsBefore = state.calls.filter(call => call.startsWith('plugin add')).length
  const second = await service.install('codex')
  assert.equal(second.ok, true)
  assert.match(second.detail, /无需重复安装/)
  assert.equal(state.calls.filter(call => call.startsWith('plugin add')).length, callsBefore)
})

test('a same-name plugin from another marketplace is reported instead of replaced', async t => {
  const box = sandbox(t)
  const calls = []
  const run = async (file, args) => {
    calls.push(args.join(' '))
    if (args[0] === '--version') return { code: 0, stdout: 'codex-cli\n', stderr: '' }
    if (args[0] === 'plugin' && args[1] === 'list') {
      return {
        code: 0, stderr: '',
        stdout: JSON.stringify({ installed: [{
          name: 'uta-deskpet', marketplaceName: 'someone-else', version: '0.2.2', installed: true, enabled: true,
        }] }),
      }
    }
    if (args[0] === 'mcp' && args[1] === 'list') return { code: 0, stdout: '', stderr: '' }
    return { code: 0, stdout: '{}', stderr: '' }
  }
  const service = makeService(box, run)
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.error, /someone-else/)
  assert.equal(calls.some(call => call.startsWith('plugin add')), false)
})

test('a failed install restores the previous Codex config and keeps a retry path', async t => {
  const box = sandbox(t)
  const { state, run } = fakeCodex(false)
  const failingRun = async (file, args) => {
    if (args[0] === 'plugin' && args[1] === 'marketplace') {
      fs.writeFileSync(path.join(box.codexHome, 'config.toml'), 'broken = true\n')
      return { code: 0, stdout: '{}', stderr: '' }
    }
    if (args[0] === 'plugin' && args[1] === 'add') {
      return { code: 1, stdout: '', stderr: 'marketplace exploded' }
    }
    return run(file, args)
  }
  const service = makeService(box, failingRun)
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.error, /marketplace exploded/)
  assert.equal(fs.readFileSync(path.join(box.codexHome, 'config.toml'), 'utf8'), 'model = "keep-me"\n')
  assert.ok(result.backupPath)
  assert.equal(state.installed, false)
})

test('a failed backup blocks installation before any config write', async t => {
  const box = sandbox(t)
  fs.writeFileSync(path.join(box.codexHome, 'uta-backups'), 'not a directory')
  const { state, run } = fakeCodex(false)
  const service = makeService(box, run)
  const before = fs.readFileSync(path.join(box.codexHome, 'config.toml'), 'utf8')
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.error, /备份/)
  assert.equal(state.calls.some(call => call.startsWith('plugin marketplace add')), false)
  assert.equal(fs.readFileSync(path.join(box.codexHome, 'config.toml'), 'utf8'), before)
})

test('lookalike names and disabled plugins are not treated as an up-to-date Uta install', async t => {
  assert.equal(mod.parseCodexPluginList(JSON.stringify({
    installed: [{ name: 'uta-deskpet-pro-plus', version: '0.2.2', installed: true, enabled: true }],
  })), null)

  const box = sandbox(t)
  const { state, run } = fakeCodex(false)
  const disabledRun = async (file, args) => {
    if (args[0] === 'plugin' && args[1] === 'list') {
      state.calls.push(args.join(' '))
      return {
        code: 0, stderr: '',
        stdout: JSON.stringify({ installed: [{
          name: 'uta-deskpet', marketplaceName: 'uta', version: '0.2.2', installed: true, enabled: false,
        }] }),
      }
    }
    return run(file, args)
  }
  const service = makeService(box, disabledRun)
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.error, /停用/)
  assert.equal(state.calls.some(call => call.startsWith('plugin add')), false)
})

test('an installed Uta plugin with unknown marketplace is not replaced', async t => {
  const box = sandbox(t)
  const calls = []
  const run = async (file, args) => {
    calls.push(args.join(' '))
    if (args[0] === '--version') return { code: 0, stdout: 'codex-cli\n', stderr: '' }
    if (args[0] === 'plugin' && args[1] === 'list') {
      return {
        code: 0, stderr: '',
        stdout: JSON.stringify({ installed: [{
          name: 'uta-deskpet', version: '0.2.2', installed: true, enabled: true,
        }] }),
      }
    }
    if (args[0] === 'mcp' && args[1] === 'list') return { code: 0, stdout: '', stderr: '' }
    return { code: 0, stdout: '{}', stderr: '' }
  }
  const service = makeService(box, run)
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.error, /无法确认|同名/)
  assert.equal(calls.some(call => call.startsWith('plugin add')), false)
})

test('DSH detection exposes one-click install plus program/home fallbacks', async t => {
  const box = sandbox(t)
  dshAssets(box)
  const { exe, cli } = dshInstall(box)
  dshProfile(box)
  const service = makeService(box, fakeDshRun(box).run, { harnessExe: exe, harnessCli: cli })
  const detection = await service.detect()
  const dsh = detection.hosts.find(host => host.id === 'deepseek-harness')
  assert.equal(dsh.installed, true)
  assert.equal(dsh.pluginInstalled, false)
  assert.equal(dsh.autoInstall, true)
  assert.equal(dsh.installLabel, '安装 Uta 插件')
  assert.equal(dsh.pathActionLabel, '选择 DSH 程序')
  assert.equal(dsh.homeActionLabel, '选择 DSH 数据目录')
  assert.equal(dsh.stages.find(stage => stage.id === 'plugin').state, 'manual')
  assert.ok(dsh.manualSteps.some(step => step.includes('dsh.cmd')))
})

test('DSH one-click install backs up, runs the official CLI and verifies the link', async t => {
  const box = sandbox(t)
  dshAssets(box)
  const { exe, cli } = dshInstall(box)
  const { profile, pkg } = dshProfile(box)
  const fake = fakeDshRun(box)
  const service = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli })
  const result = await service.install('deepseek-harness')
  assert.equal(result.ok, true)
  assert.equal(result.restartRequired, true)
  assert.ok(result.backupPath && fs.existsSync(result.backupPath))
  assert.ok(fs.existsSync(path.join(result.backupPath, 'package.json')))
  const after = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
  assert.equal(after.dependencies['@uta/deepseek-harness-plugin'], `link:${path.join(box.assetRoot, 'deepseek-harness')}`)
  assert.ok(after.dsh.profile.bundles.includes('@uta/deepseek-harness-plugin'))
  assert.ok(fs.existsSync(path.join(
    profile, 'node_modules', '@uta', 'deepseek-harness-plugin', 'package.json',
  )))
  assert.equal(result.stages.find(stage => stage.id === 'plugin').state, 'verified')
  const addCall = fake.state.calls.find(call => call.args.includes('add'))
  assert.ok(addCall, 'the official CLI add command should run')
  assert.equal(
    addCall.args.slice(-3).join('|'),
    ['desktop', 'add', path.join(box.assetRoot, 'deepseek-harness')].join('|'),
  )
  assert.equal(addCall.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(addCall.env.DSH_HOME, box.dshHome)
})

test('DSH install refuses while the host is running and changes nothing', async t => {
  const box = sandbox(t)
  dshAssets(box)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box)
  const before = fs.readFileSync(path.join(profile, 'package.json'), 'utf8')
  const fake = fakeDshRun(box, { running: true })
  const service = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli })
  const result = await service.install('deepseek-harness')
  assert.equal(result.ok, false)
  assert.match(result.error, /正在运行/)
  assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), before)
  assert.equal(fake.state.calls.some(call => call.args.includes('add')), false)
})

test('DSH CLI failure restores the prior desktop profile', async t => {
  const box = sandbox(t)
  dshAssets(box)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box)
  const packageBefore = fs.readFileSync(path.join(profile, 'package.json'), 'utf8')
  const cordisBefore = fs.readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8')
  const fake = fakeDshRun(box, { fail: true })
  const service = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli })
  const result = await service.install('deepseek-harness')
  assert.equal(result.ok, false)
  assert.match(result.error, /失败/)
  assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), packageBefore)
  assert.equal(fs.readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8'), cordisBefore)
  assert.ok(result.backupPath && fs.existsSync(result.backupPath))
})

test('DSH missing profile points the user to launch once or choose a home', async t => {
  const box = sandbox(t)
  dshAssets(box)
  const { exe, cli } = dshInstall(box)
  const service = makeService(box, fakeDshRun(box).run, { harnessExe: exe, harnessCli: cli })
  const detection = await service.detect()
  const dsh = detection.hosts.find(host => host.id === 'deepseek-harness')
  assert.equal(dsh.autoInstall, false)
  assert.equal(dsh.installed, true)
  assert.match(dsh.stages.find(stage => stage.id === 'plugin').detail, /打开一次|数据目录/)
  const result = await service.install('deepseek-harness')
  assert.equal(result.ok, false)
  assert.match(result.error, /desktop profile/)
})

test('a saved DSH program/home override is used without recreating the service', async t => {
  const box = sandbox(t)
  const customHome = path.join(box.root, 'custom-dsh')
  dshAssets(box)
  const { exe, cli } = dshInstall(box)
  dshProfile(box, { home: customHome })
  fs.mkdirSync(box.runtimeDir, { recursive: true })
  fs.writeFileSync(path.join(box.runtimeDir, 'host-paths.json'), JSON.stringify({
    harnessExe: exe,
    harnessCli: cli,
    harnessHome: customHome,
  }))
  const service = makeService(box, fakeDshRun(box).run, {
    harnessExe: undefined,
    harnessCli: undefined,
  })
  const detection = await service.detect()
  const dsh = detection.hosts.find(host => host.id === 'deepseek-harness')
  assert.equal(dsh.autoInstall, true)
  assert.equal(dsh.configPath, path.join(customHome, 'profiles', 'desktop'))
})

test('an already-linked DSH plugin is reported as installed without rewriting', async t => {
  const box = sandbox(t)
  dshAssets(box)
  const { exe, cli } = dshInstall(box)
  dshProfile(box, { plugin: true })
  const fake = fakeDshRun(box)
  const service = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli })
  const detection = await service.detect()
  const dsh = detection.hosts.find(host => host.id === 'deepseek-harness')
  assert.equal(dsh.pluginInstalled, true)
  const result = await service.install('deepseek-harness')
  assert.equal(result.ok, true)
  assert.match(result.detail, /无需重复安装/)
  assert.equal(fake.state.calls.some(call => call.args.includes('add')), false)
})

test('saving a Codex executable refreshes detection and installation without recreating the service', async t => {
  const box = sandbox(t)
  const selected = path.join(box.root, 'selected-codex.exe')
  fs.writeFileSync(selected, 'fake')
  const fake = fakeCodex(false)
  const invoked = []
  const service = makeService(box, (file, args, options) => {
    invoked.push({ file, args })
    return fake.run(file, args, options)
  }, { codexExe: undefined })
  fs.mkdirSync(box.runtimeDir, { recursive: true })
  fs.writeFileSync(path.join(box.runtimeDir, 'host-paths.json'), JSON.stringify({ codexExe: selected }))
  const codex = (await service.detect()).hosts.find(host => host.id === 'codex')
  assert.equal(codex.executable, selected)
  assert.equal((await service.install('codex')).ok, true)
  assert.ok(invoked.length > 0)
  assert.ok(invoked.filter(call => call.args.includes('--json')).every(call => call.file === selected))
  assert.ok(invoked.some(call => call.file === selected && call.args[0] === 'plugin' && call.args[1] === 'add'))
})

test('Codex upgrades an older connector and verifies the installed version', async t => {
  const box = sandbox(t)
  const fake = fakeCodex(true)
  fake.state.version = '0.2.1'
  const service = makeService(box, (file, args, options) => {
    if (args[0] === 'plugin' && args[1] === 'add') fake.state.version = '0.2.2'
    return fake.run(file, args, options)
  })
  assert.equal((await service.install('codex')).ok, true)
  assert.equal(fake.state.version, '0.2.2')
  assert.ok(fake.state.calls.some(call => call.startsWith('plugin add')))
})

test('DSH upgrades an old package path and version, then makes a repeated install a no-op', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box, { plugin: true })
  const fake = fakeDshRun(box)
  const newAssets = path.join(box.root, 'new-assets')
  fs.cpSync(box.assetRoot, newAssets, { recursive: true })
  const newPlugin = path.join(newAssets, 'deepseek-harness')
  const manifest = path.join(newPlugin, 'package.json')
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest)), version: '0.5.4' }))
  const service = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli, assetRoot: newAssets })
  const before = (await service.detect()).hosts.find(host => host.id === 'deepseek-harness')
  assert.equal(before.pluginVersion, '0.5.3')
  assert.equal(before.stages.find(stage => stage.id === 'plugin').state, 'manual')
  assert.equal((await service.install('deepseek-harness')).ok, true)
  const pkg = JSON.parse(fs.readFileSync(path.join(profile, 'package.json')))
  assert.equal(pkg.dependencies['@uta/deepseek-harness-plugin'], `link:${newPlugin}`)
  const link = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
  assert.equal(fs.realpathSync(link), fs.realpathSync(newPlugin))
  const after = (await service.detect()).hosts.find(host => host.id === 'deepseek-harness')
  assert.equal(after.pluginVersion, '0.5.4')
  assert.equal(after.stages.find(stage => stage.id === 'plugin').state, 'verified')
  assert.match((await service.install('deepseek-harness')).detail, /无需重复安装/)
  assert.equal(fake.state.calls.filter(call => call.args.includes('add')).length, 1)
})

test('DSH still updates the source path when the old connector has the same version', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box, { plugin: true })
  const fake = fakeDshRun(box)
  const newAssets = path.join(box.root, 'same-version-assets')
  fs.cpSync(box.assetRoot, newAssets, { recursive: true })
  const service = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli, assetRoot: newAssets })
  assert.equal((await service.install('deepseek-harness')).ok, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'package.json')))
    .dependencies['@uta/deepseek-harness-plugin'], `link:${path.join(newAssets, 'deepseek-harness')}`)
})

test('DSH reports a failed upgrade when CLI success leaves the old connector installed', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box, { plugin: true })
  const before = fs.readFileSync(path.join(profile, 'package.json'), 'utf8')
  const newAssets = path.join(box.root, 'new-assets')
  fs.cpSync(box.assetRoot, newAssets, { recursive: true })
  const service = makeService(box, async () => ({ code: 0, stdout: '', stderr: '' }),
    { harnessExe: exe, harnessCli: cli, assetRoot: newAssets })
  assert.equal((await service.install('deepseek-harness')).ok, false)
  assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), before)
})

test('DSH restores the previous link when an upgrade changes it but fails verification', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box, { plugin: true })
  const link = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
  const oldTarget = fs.realpathSync(link)
  const before = fs.readFileSync(path.join(profile, 'package.json'), 'utf8')
  const fake = fakeDshRun(box)
  const newAssets = path.join(box.root, 'new-assets')
  fs.cpSync(box.assetRoot, newAssets, { recursive: true })
  const service = makeService(box, async (file, args, options) => {
    const result = await fake.run(file, args, options)
    if (args.includes('add')) return { ...result, code: 1, stderr: 'failed after linking' }
    return result
  }, { harnessExe: exe, harnessCli: cli, assetRoot: newAssets })
  assert.equal((await service.install('deepseek-harness')).ok, false)
  assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), before)
  assert.equal(fs.realpathSync(link), oldTarget)
})

test('DSH preserves a dangling old link when a repair fails after linking the new plugin', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box, { plugin: true })
  const fake = fakeDshRun(box)
  const link = path.join(profile, 'node_modules', '@uta', 'deepseek-harness-plugin')
  const oldTarget = fs.readlinkSync(link)
  const newAssets = path.join(box.root, 'new-assets')
  fs.cpSync(box.assetRoot, newAssets, { recursive: true })
  fs.rmSync(path.join(box.assetRoot, 'deepseek-harness'), { recursive: true, force: true })
  const service = makeService(box, async (file, args, options) => {
    const result = await fake.run(file, args, options)
    return args.includes('add') ? { ...result, code: 1, stderr: 'failed after linking' } : result
  }, { harnessExe: exe, harnessCli: cli, assetRoot: newAssets })
  assert.equal((await service.install('deepseek-harness')).ok, false)
  assert.equal(fs.readlinkSync(link), oldTarget)
})

test('DSH serializes installs across Uta profiles even when the host home uses a junction alias', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  dshProfile(box)
  const fake = fakeDshRun(box)
  let admitted
  const entered = new Promise(resolve => { admitted = resolve })
  let resume
  const paused = new Promise(resolve => { resume = resolve })
  const run = async (file, args, options) => {
    if (args.includes('add')) { admitted(); await paused }
    return fake.run(file, args, options)
  }
  const a = makeService(box, run, { harnessExe: exe, harnessCli: cli })
  const runtimeB = path.join(box.root, 'second-profile')
  const alias = path.join(box.root, 'dsh-home-alias')
  fs.symlinkSync(box.dshHome, alias, 'junction')
  fs.mkdirSync(runtimeB, { recursive: true })
  fs.writeFileSync(path.join(runtimeB, 'host-paths.json'), JSON.stringify({ harnessHome: alias }))
  const b = makeService(box, run, { harnessExe: exe, harnessCli: cli, runtimeDir: runtimeB })
  const first = a.install('deepseek-harness')
  await entered
  const second = b.install('deepseek-harness')
  let blocked
  try {
    blocked = await Promise.race([second, new Promise(resolve => setTimeout(() => resolve({ ok: true }), 1000))])
    if (!blocked.ok) assert.equal(b.unblockInstall('deepseek-harness').ok, false)
  } finally { resume() }
  assert.equal((await first).ok, true)
  await second
  assert.equal(blocked.ok, false)
  assert.equal(fake.state.calls.filter(call => call.args.includes('add')).length, 1)
  assert.match((await b.install('deepseek-harness')).detail, /无需重复安装/)
})

test('an unsettled DSH writer blocks retries from every Uta profile until explicitly cleared', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  dshProfile(box)
  const fake = fakeDshRun(box)
  let writes = 0
  const run = (file, args, options) => {
    if (args.includes('add') && ++writes === 1) return Promise.resolve({ code: -1, stdout: '', stderr: 'timeout', stillRunning: true })
    return fake.run(file, args, options)
  }
  const a = makeService(box, run, { harnessExe: exe, harnessCli: cli })
  assert.equal((await a.install('deepseek-harness')).retryBlocked, true)
  const b = makeService(box, run, { harnessExe: exe, harnessCli: cli, runtimeDir: path.join(box.root, 'second-profile') })
  assert.equal((await b.install('deepseek-harness')).retryBlocked, true)
  assert.equal(writes, 1)
  assert.equal(b.unblockInstall('deepseek-harness').ok, true)
  assert.equal((await b.install('deepseek-harness')).ok, true)
})

test('DSH refuses to update an old connector while the host is running', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  const { profile } = dshProfile(box, { plugin: true })
  const before = fs.readFileSync(path.join(profile, 'package.json'), 'utf8')
  const fake = fakeDshRun(box, { running: true })
  const newAssets = path.join(box.root, 'new-assets')
  fs.cpSync(box.assetRoot, newAssets, { recursive: true })
  const service = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli, assetRoot: newAssets })
  assert.equal((await service.install('deepseek-harness')).ok, false)
  assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), before)
  assert.equal(fake.state.calls.some(call => call.args.includes('add')), false)
})

test('DSH preserves an unreadable shared lock until the user explicitly clears it', async t => {
  const box = sandbox(t)
  const { exe, cli } = dshInstall(box)
  dshProfile(box)
  const fake = fakeDshRun(box)
  const service = makeService(box, async (file, args, options) => {
    if (args.includes('add')) return { code: -1, stdout: '', stderr: 'timeout', stillRunning: true }
    return fake.run(file, args, options)
  }, { harnessExe: exe, harnessCli: cli })
  assert.equal((await service.install('deepseek-harness')).retryBlocked, true)
  const locks = path.join(box.appData, 'uta-host-locks')
  const lock = path.join(locks, fs.readdirSync(locks).find(name => name.startsWith('dsh-')))
  fs.writeFileSync(lock, 'corrupt')
  const retry = makeService(box, fake.run, { harnessExe: exe, harnessCli: cli })
  assert.equal((await retry.install('deepseek-harness')).retryBlocked, true)
  assert.equal(fs.readFileSync(lock, 'utf8'), 'corrupt')
  assert.equal(retry.unblockInstall('deepseek-harness').ok, true)
  assert.equal((await retry.install('deepseek-harness')).ok, true)
})

test('plugin list parsing ignores unrelated plugins and hook trust is read from config text', () => {
  const parsed = mod.parseCodexPluginList(JSON.stringify({
    installed: [
      { name: 'other', version: '1.0.0', installed: true },
      { name: 'uta-deskpet', marketplaceName: 'uta', version: '0.2.2', installed: true, enabled: true },
    ],
  }))
  assert.equal(parsed.name, 'uta-deskpet')
  assert.equal(parsed.version, '0.2.2')
  assert.equal(parsed.marketplace, 'uta')
  assert.equal(mod.parseCodexPluginList('not json'), null)
  const single = mod.codexHookTrust(
    '[hooks.state."uta-deskpet@uta:plugin.json#hooks[0]:stop:0:0"]\ntrusted_hash = "x"',
  )
  assert.equal(single.state, 'partial')
  assert.equal(single.trusted, 1)
  assert.equal(single.total, 8)
  assert.equal(mod.codexHooksTrusted(
    '[hooks.state."uta-deskpet@uta:plugin.json#hooks[0]:stop:0:0"]\ntrusted_hash = "x"',
  ), false)

  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd', 'Interrupt']
  const allTrusted = events
    .map((event, index) => `[hooks.state."uta-deskpet@uta:plugin.json#hooks[${index}]:${event.toLowerCase()}:0:0"]\ntrusted_hash = "x"`)
    .join('\n')
  assert.equal(mod.codexHookTrust(allTrusted, events).state, 'trusted')
  assert.equal(mod.codexHooksTrusted(allTrusted, events), true)
  const partial = `${allTrusted}\n[hooks.state."uta-deskpet@uta:plugin.json#hooks[4]:posttooluse:0:0"]`.trim()
  assert.equal(mod.codexHookTrust(events.slice(0, 1)
    .map((event, index) => `[hooks.state."uta-deskpet@uta:plugin.json#hooks[${index}]:${event.toLowerCase()}:0:0"]\ntrusted_hash = "x"`)
    .join('\n'), events).state, 'partial')
  assert.equal(mod.codexHooksTrusted(partial, events), true, 'duplicate trusted sections still count as all events')
  assert.equal(mod.codexHooksTrusted('model = "x"'), false)
  assert.equal(mod.codexHooksTrusted('[hooks.state."other"]\ntrusted_hash = "x"\n# uta-deskpet'), false)
  assert.equal(mod.codexHooksTrusted('[hooks.state."uta-deskpet@uta:x"]\ntrusted = false'), false)
})

test('a failed install preserves concurrent config edits before restoring', async t => {
  const box = sandbox(t)
  const { run } = fakeCodex(false)
  const failingRun = async (file, args) => {
    if (args[0] === 'plugin' && args[1] === 'marketplace') {
      fs.writeFileSync(path.join(box.codexHome, 'config.toml'), 'model = "external-edit"\n')
      return { code: 0, stdout: '{}', stderr: '' }
    }
    if (args[0] === 'plugin' && args[1] === 'add') return { code: 1, stdout: '', stderr: 'boom' }
    return run(file, args)
  }
  const service = makeService(box, failingRun)
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.detail, /另存/)
  const preserved = fs.readdirSync(box.codexHome).filter(name => name.startsWith('config.toml.uta-failed-'))
  assert.equal(preserved.length, 1)
  assert.match(fs.readFileSync(path.join(box.codexHome, preserved[0]), 'utf8'), /external-edit/)
})

test('a timed-out process that cannot be stopped skips automatic restore', async t => {
  const box = sandbox(t)
  const run = async (file, args) => {
    if (args[0] === '--version') return { code: 0, stdout: 'codex-cli\n', stderr: '' }
    if (args[0] === 'plugin' && args[1] === 'list') return { code: 0, stdout: '{"installed":[]}', stderr: '' }
    if (args[0] === 'mcp' && args[1] === 'list') return { code: 0, stdout: '', stderr: '' }
    if (args[0] === 'plugin' && args[1] === 'marketplace') {
      return { code: -1, stdout: '', stderr: 'timed out', stillRunning: true }
    }
    return { code: 0, stdout: '{}', stderr: '' }
  }
  const service = makeService(box, run)
  const before = fs.readFileSync(path.join(box.codexHome, 'config.toml'), 'utf8')
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.error, /没有确认退出/)
  assert.match(result.detail, /没有自动恢复/)
  assert.equal(fs.readFileSync(path.join(box.codexHome, 'config.toml'), 'utf8'), before)
})

test('a failed first install removes the config file it created', async t => {
  const box = sandbox(t)
  fs.rmSync(path.join(box.codexHome, 'config.toml'), { force: true })
  const { run } = fakeCodex(false)
  const failingRun = async (file, args) => {
    if (args[0] === 'plugin' && args[1] === 'marketplace') {
      fs.writeFileSync(path.join(box.codexHome, 'config.toml'), 'created = true\n')
      return { code: 0, stdout: '{}', stderr: '' }
    }
    if (args[0] === 'plugin' && args[1] === 'add') return { code: 1, stdout: '', stderr: 'boom' }
    return run(file, args)
  }
  const service = makeService(box, failingRun)
  const result = await service.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.detail, /移走/)
  assert.equal(fs.existsSync(path.join(box.codexHome, 'config.toml')), false)
})

test('a disabled Uta MCP entry is not reported as verified tools', async t => {
  const box = sandbox(t)
  const { run } = fakeCodex(true)
  const disabledRun = async (file, args) => {
    if (args[0] === 'mcp' && args[1] === 'list') {
      return {
        code: 0,
        stdout: JSON.stringify({ servers: [{ name: 'uta-deskpet', enabled: false }] }),
        stderr: '',
      }
    }
    return run(file, args)
  }
  const service = makeService(box, disabledRun)
  const detection = await service.detect()
  const tools = detection.hosts.find(host => host.id === 'codex').stages.find(stage => stage.id === 'tools')
  assert.equal(tools.state, 'manual')
  assert.match(tools.detail, /停用/)
})

test('MCP identity parsing ignores lookalikes and unstructured output', () => {
  assert.equal(mod.parseCodexMcpList(JSON.stringify({
    servers: [{ name: 'uta-deskpet-pro', enabled: true }],
  })), null)
  assert.equal(mod.parseCodexMcpList(JSON.stringify({
    servers: [{ name: 'uta_deskpet', enabled: false }],
  })).enabled, false)
  assert.equal(mod.parseCodexMcpList('uta-deskpet enabled'), null)
})

test('a missing node runtime blocks install before any host config write', async t => {
  const box = sandbox(t)
  const { state, run } = fakeCodex(true)
  const noNode = async (file, args) => {
    if (file === 'node') return { code: -2, stdout: '', stderr: 'node not found' }
    return run(file, args)
  }
  const service = makeService(box, noNode)
  const detection = await service.detect()
  const tools = detection.hosts.find(host => host.id === 'codex').stages.find(stage => stage.id === 'tools')
  assert.equal(tools.state, 'pending')
  assert.match(tools.detail, /Node/)

  const fresh = sandbox(t)
  const { state: freshState, run: freshRun } = fakeCodex(false)
  const freshService = makeService(fresh, async (file, args) => {
    if (file === 'node') return { code: -2, stdout: '', stderr: 'node not found' }
    return freshRun(file, args)
  })
  const result = await freshService.install('codex')
  assert.equal(result.ok, false)
  assert.match(result.error, /Node/)
  assert.equal(freshState.calls.some(call => call.startsWith('plugin marketplace add')), false)
  assert.match(fs.readFileSync(path.join(fresh.codexHome, 'config.toml'), 'utf8'), /keep-me/)
  assert.equal(state.installed, true)
})

test('an unsettled timed-out install blocks consecutive retries until released', async t => {
  const box = sandbox(t)
  const { state, run } = fakeCodex(false)
  let marketplaceCalls = 0
  const timeoutOnce = async (file, args) => {
    if (args[0] === 'plugin' && args[1] === 'marketplace') {
      marketplaceCalls += 1
      if (marketplaceCalls === 1) {
        return { code: -1, stdout: '', stderr: 'timed out', stillRunning: true }
      }
    }
    return run(file, args)
  }
  const service = makeService(box, timeoutOnce)
  const first = await service.install('codex')
  assert.equal(first.ok, false)
  assert.equal(first.retryBlocked, true)
  assert.match(first.detail, /解除安装阻断/)

  // The block is persisted, so a restarted app cannot start a second writer
  // just because its in-memory lock was cleared.
  const restarted = makeService(box, timeoutOnce)
  const second = await restarted.install('codex')
  assert.equal(second.ok, false)
  assert.equal(second.retryBlocked, true)
  assert.equal(marketplaceCalls, 1, 'a blocked retry must not start another config writer')

  assert.equal(restarted.unblockInstall('codex').ok, true)
  const third = await restarted.install('codex')
  assert.equal(third.ok, true)
  assert.equal(marketplaceCalls, 2)
  assert.equal(state.installed, true)
})

test('the shared CODEX_HOME lock blocks a second Uta profile', async t => {
  const box = sandbox(t)
  const runtimeA = path.join(box.root, 'runtime-a')
  const runtimeB = path.join(box.root, 'runtime-b')
  fs.mkdirSync(runtimeA, { recursive: true })
  fs.mkdirSync(runtimeB, { recursive: true })
  const { state, run } = fakeCodex(false)
  let marketplaceCalls = 0
  const timeoutOnce = async (file, args) => {
    if (args[0] === 'plugin' && args[1] === 'marketplace') {
      marketplaceCalls += 1
      if (marketplaceCalls === 1) {
        return { code: -1, stdout: '', stderr: 'timed out', stillRunning: true }
      }
    }
    return run(file, args)
  }
  const profileA = makeService(box, timeoutOnce, { runtimeDir: runtimeA })
  const first = await profileA.install('codex')
  assert.equal(first.ok, false)
  assert.equal(first.retryBlocked, true)

  const profileB = makeService(box, timeoutOnce, { runtimeDir: runtimeB })
  const second = await profileB.install('codex')
  assert.equal(second.ok, false)
  assert.equal(second.retryBlocked, true)
  assert.equal(marketplaceCalls, 1, 'a different Uta profile must not write the same Codex home')

  assert.equal(profileB.unblockInstall('codex').ok, true)
  const third = await profileB.install('codex')
  assert.equal(third.ok, true)
  assert.equal(marketplaceCalls, 2)
  assert.equal(state.installed, true)
})

test('desktop host presence detects Qoder and Antigravity without launching them', async t => {
  const box = sandbox(t)
  const qoderExe = path.join(box.root, 'Qoder CN.exe')
  const antigravityExe = path.join(box.root, 'Antigravity.exe')
  fs.writeFileSync(qoderExe, 'fake')
  fs.writeFileSync(antigravityExe, 'fake')
  const service = makeService(box, fakeCodex(false).run, { qoderExe, antigravityExe })
  const presence = await service.detectPresence()
  assert.ok(presence.ids.includes('qoder'))
  assert.ok(presence.ids.includes('antigravity'))
  assert.ok(presence.ids.includes('codex'))
  const detection = await service.detect()
  assert.equal(detection.hosts.find(host => host.id === 'qoder').installed, true)
  assert.equal(detection.hosts.find(host => host.id === 'antigravity').installed, true)
})

test('other hosts ship packaged artifacts and honest detection wording', async t => {
  const box = sandbox(t)
  const service = makeService(box, fakeCodex(false).run)
  const detection = await service.detect()
  const qoder = detection.hosts.find(host => host.id === 'qoder')
  const antigravity = detection.hosts.find(host => host.id === 'antigravity')
  const claude = detection.hosts.find(host => host.id === 'claude-code')
  const zcode = detection.hosts.find(host => host.id === 'zcode')
  const opencode = detection.hosts.find(host => host.id === 'opencode')
  assert.match(qoder.stages.find(stage => stage.id === 'detected').detail, /未检测到可执行入口/)
  assert.match(antigravity.stages.find(stage => stage.id === 'detected').detail, /未检测到可执行入口/)
  assert.equal(qoder.installed, false)
  assert.equal(antigravity.installed, false)
  assert.ok(qoder.manualSteps.some(step => step.includes('uta-qoder-plugin.zip')))
  assert.ok(antigravity.manualSteps.some(step => step.includes('uta-antigravity-plugin.zip')))
  assert.ok(claude.manualSteps.some(step => step.includes('claude-marketplace')))
  assert.ok(zcode.manualSteps.some(step => step.includes('zcode-marketplace')))
  assert.ok(opencode.manualSteps.some(step => step.includes('uta-opencode-plugin')))
  for (const host of [qoder, antigravity, claude, zcode, opencode]) {
    assert.equal(host.manualSteps[0].includes('plugin/README.md'), false)
  }
})

function packagedConnectorPath(box, id) {
  const config = require('js-yaml').load(fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8'))
  const folder = `uta-${id}-plugin`
  const resource = config.extraResources.find(entry => entry.from === `../plugin/dist/${folder}`)
  assert.equal(resource?.to, `uta-plugins/${folder}`)
  return path.join(box.assetRoot, resource.to.slice('uta-plugins/'.length))
}

test('Antigravity auto-install copies packaged plugin and updates stages', async t => {
  const box = sandbox(t)
  const pluginSrc = packagedConnectorPath(box, 'antigravity')
  fs.mkdirSync(pluginSrc, { recursive: true })
  fs.writeFileSync(path.join(pluginSrc, 'plugin.json'), JSON.stringify({ name: 'uta-deskpet', version: '0.1.8' }))

  const service = makeService(box, fakeCodex(false).run)
  const result = await service.install('antigravity')
  assert.equal(result.ok, true)
  assert.equal(result.hostId, 'antigravity')
  assert.equal(result.restartRequired, true)

  const targetPlugin = path.join(box.root, '.gemini', 'config', 'plugins', 'uta-deskpet', 'plugin.json')
  assert.equal(fs.existsSync(targetPlugin), true)

  const detection = await service.detect()
  const ag = detection.hosts.find(h => h.id === 'antigravity')
  assert.equal(ag.pluginInstalled, true)
  assert.equal(ag.autoInstall, true)
  assert.equal(ag.stages.find(s => s.id === 'plugin').state, 'verified')
  assert.equal(ag.stages.find(s => s.id === 'tools').state, 'pending')
  assert.equal(ag.pluginVersion, '0.1.8')
})

test('Antigravity reports selected workspace and global plugins separately; install updates only global', async t => {
  const box = sandbox(t)
  const workspace = path.join(box.root, 'project')
  const local = path.join(workspace, '.agents', 'plugins', 'uta-deskpet')
  const global = path.join(box.root, '.gemini', 'config', 'plugins', 'uta-deskpet')
  const bundle = packagedConnectorPath(box, 'antigravity')
  for (const [dir, version] of [[local, '0.1.8'], [global, '0.1.5'], [bundle, '0.1.9']]) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ version }))
  }
  const service = makeService(box, fakeCodex(false).run, { getSelectedWorkspace: () => workspace })
  const state = async () => (await service.detect()).hosts.find(host => host.id === 'antigravity')
  assert.match((await state()).stages.find(stage => stage.id === 'plugin').detail, /工作区 0\.1\.8.*全局 0\.1\.5/)
  assert.equal((await service.install('antigravity')).ok, true)
  assert.match((await state()).stages.find(stage => stage.id === 'plugin').detail, /工作区 0\.1\.8.*全局 0\.1\.9/)
})

test('Qoder auto-install copies packaged plugin and updates stages', async t => {
  const box = sandbox(t)
  const pluginSrc = packagedConnectorPath(box, 'qoder')
  fs.mkdirSync(path.join(pluginSrc, '.qoder-plugin'), { recursive: true })
  fs.writeFileSync(path.join(pluginSrc, '.qoder-plugin', 'plugin.json'), JSON.stringify({ name: 'uta-deskpet' }))

  const service = makeService(box, fakeCodex(false).run)
  const result = await service.install('qoder')
  assert.equal(result.ok, true)
  assert.equal(result.hostId, 'qoder')
  assert.equal(result.restartRequired, true)

  const targetPlugin = path.join(box.root, '.qoder-cn', 'plugins', 'cache', 'local', 'uta-deskpet', '0.1.0', '.qoder-plugin', 'plugin.json')
  assert.equal(fs.existsSync(targetPlugin), true)

  const detection = await service.detect()
  const qoder = detection.hosts.find(h => h.id === 'qoder')
  assert.equal(qoder.pluginInstalled, true)
  assert.equal(qoder.autoInstall, true)
  assert.equal(qoder.stages.find(s => s.id === 'plugin').state, 'verified')
})

test('OpenCode auto-install copies plugin script and updates stages', async t => {
  const box = sandbox(t)
  const pluginSrcDir = path.join(box.assetRoot, 'uta-opencode-plugin')
  fs.mkdirSync(pluginSrcDir, { recursive: true })
  fs.writeFileSync(path.join(pluginSrcDir, 'uta-opencode.ts'), '// uta-opencode\n')

  const service = makeService(box, fakeCodex(false).run)
  const result = await service.install('opencode')
  assert.equal(result.ok, true)
  assert.equal(result.hostId, 'opencode')
  assert.equal(result.restartRequired, true)

  const targetFile = path.join(box.root, '.config', 'opencode', 'plugins', 'uta-opencode.ts')
  assert.equal(fs.existsSync(targetFile), true)

  const detection = await service.detect()
  const opencode = detection.hosts.find(h => h.id === 'opencode')
  assert.equal(opencode.pluginInstalled, true)
  assert.equal(opencode.autoInstall, true)
  assert.equal(opencode.stages.find(s => s.id === 'plugin').state, 'verified')
  assert.equal(opencode.stages.find(s => s.id === 'tools').state, 'pending')
})

test('OpenCode installation honors its explicit configuration directory without writing the default home', async t => {
  const box = sandbox(t)
  const configDir = path.join(box.root, 'selected-opencode')
  const sourceDir = path.join(box.assetRoot, 'uta-opencode-plugin')
  fs.mkdirSync(sourceDir, { recursive: true })
  fs.writeFileSync(path.join(sourceDir, 'uta-opencode.ts'), '// fixture')
  const service = makeService(box, fakeCodex(false).run, { env: {
    PATH: '', USERPROFILE: box.root, APPDATA: box.appData, LOCALAPPDATA: '', OPENCODE_CONFIG_DIR: configDir,
  } })
  assert.equal((await service.install('opencode')).ok, true)
  assert.equal(fs.existsSync(path.join(configDir, 'plugins', 'uta-opencode.ts')), true)
  assert.equal(fs.existsSync(path.join(box.root, '.config', 'opencode')), false)
  const detected = (await service.detect()).hosts.find(host => host.id === 'opencode')
  assert.equal(detected.pluginInstalled, true)
  assert.equal(detected.stages.find(stage => stage.id === 'tools').state, 'pending')
})

test('Claude marketplace presence and disabled plugins cannot claim a working installation', async t => {
  const box = sandbox(t)
  const claudeExe = path.join(box.root, 'claude-test.exe')
  fs.writeFileSync(claudeExe, 'fixture')
  fs.mkdirSync(path.join(box.root, '.claude', 'plugins', 'marketplaces', 'uta'), { recursive: true })
  let plugins = []
  const service = makeService(box, async (_file, args) => ({ code: 0,
    stdout: args[0] === 'plugin' && args[1] === 'list' ? JSON.stringify(plugins) : '', stderr: '' }), { claudeExe })
  const detect = async () => (await service.detect()).hosts.find(host => host.id === 'claude-code')
  assert.equal((await detect()).pluginInstalled, false)
  plugins = [{ id: 'uta-deskpet@unrelated', enabled: true }, { id: 'uta-deskpet@uta', enabled: false, version: '0.1.0' }]
  const disabled = await detect()
  assert.equal(disabled.pluginInstalled, false)
  assert.match(disabled.stages.find(stage => stage.id === 'plugin').detail, /未启用/)
  plugins[1].enabled = true
  const enabled = await detect()
  assert.equal(enabled.pluginInstalled, true)
  assert.equal(enabled.pluginVersion, '0.1.0')
  assert.equal(enabled.stages.find(stage => stage.id === 'tools').state, 'pending')
})

test('a newly selected Claude path is used by the existing onboarding service', async t => {
  const box = sandbox(t)
  fs.mkdirSync(path.join(box.assetRoot, 'claude-marketplace'), { recursive: true })
  const calls = []
  const service = makeService(box, async (file, args) => {
    calls.push({ file, args }); return { code: 0, stdout: '[]', stderr: '' }
  })
  const entry = path.join(box.root, 'chosen-claude.cjs')
  fs.writeFileSync(entry, '// fixture')
  createLoader()('main/host-paths').writeHostPathOverride(box.runtimeDir, 'claude-code', entry)
  assert.equal((await service.install('claude-code')).ok, true)
  assert.ok(calls.every(call => call.args[0] === entry))
})

test('Claude Code auto-install executes cli marketplace add and plugin install', async t => {
  const box = sandbox(t)
  const marketSrc = path.join(box.assetRoot, 'claude-marketplace')
  fs.mkdirSync(marketSrc, { recursive: true })
  const claudeExe = path.join(box.root, 'claude.cmd')
  fs.writeFileSync(claudeExe, 'fake')

  const calls = []
  const claudeRun = async (file, args) => {
    calls.push({ file, args })
    return { code: 0, stdout: '', stderr: '' }
  }

  const service = makeService(box, claudeRun, { claudeExe })
  const result = await service.install('claude-code')
  assert.equal(result.ok, true)
  assert.equal(result.hostId, 'claude-code')
  assert.equal(calls.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), ['plugin', 'marketplace', 'add', marketSrc])
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args)), ['plugin', 'install', 'uta-deskpet@uta'])
})

test('Claude Code auto-install handles command failure and blocks second command', async t => {
  const box = sandbox(t)
  const marketSrc = path.join(box.assetRoot, 'claude-marketplace')
  fs.mkdirSync(marketSrc, { recursive: true })
  const claudeExe = path.join(box.root, 'claude.cmd')
  fs.writeFileSync(claudeExe, 'fake')

  const calls = []
  const failingRun = async (file, args) => {
    calls.push({ file, args })
    return { code: 1, stdout: '', stderr: 'mocked marketplace add error' }
  }

  const service = makeService(box, failingRun, { claudeExe })
  const result = await service.install('claude-code')
  assert.equal(result.ok, false)
  assert.equal(result.hostId, 'claude-code')
  assert.equal(calls.length, 1)
  assert.equal(result.error, '添加 Claude 插件市场失败')
  assert.equal(result.detail, 'mocked marketplace add error')
  const pluginStage = result.stages.find(s => s.id === 'plugin')
  assert.equal(pluginStage?.state, 'unavailable')
})

test('Claude JS-only discovery installs through Node with the entry as the first argument', async t => {
  const box = sandbox(t)
  fs.mkdirSync(path.join(box.assetRoot, 'claude-marketplace'), { recursive: true })
  const entry = path.join(box.root, 'claude.cjs')
  const node = path.join(box.root, 'node.exe')
  fs.writeFileSync(entry, '')
  fs.writeFileSync(node, '')
  const calls = []
  const service = makeService(box, async (file, args) => {
    calls.push({ file, args })
    return { code: 0, stdout: '', stderr: '' }
  }, { env: {
    PATH: '', APPDATA: box.appData, LOCALAPPDATA: '', USERPROFILE: box.root, HOME: box.root,
    CODEX_HOME: box.codexHome, DSH_HOME: box.dshHome, UTA_CLAUDE_JS: entry, UTA_NODE_EXE: node,
  } })
  const result = await service.install('claude-code')
  assert.equal(result.ok, true)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.file === node && call.args[0] === entry))
  assert.deepEqual(Array.from(calls[1].args), [entry, 'plugin', 'install', 'uta-deskpet@uta'])
})

test('Claude Code auto-install handles command timeout with stillRunning flag', async t => {
  const box = sandbox(t)
  const marketSrc = path.join(box.assetRoot, 'claude-marketplace')
  fs.mkdirSync(marketSrc, { recursive: true })
  const claudeExe = path.join(box.root, 'claude.cmd')
  fs.writeFileSync(claudeExe, 'fake')

  const calls = []
  const timeoutRun = async (file, args) => {
    calls.push({ file, args })
    return { code: -1, stdout: '', stderr: '', stillRunning: true }
  }

  const service = makeService(box, timeoutRun, { claudeExe })
  const result = await service.install('claude-code')
  assert.equal(result.ok, false)
  assert.equal(result.hostId, 'claude-code')
  assert.equal(calls.length, 1)
  assert.equal(result.error, '添加 Claude 插件市场失败')
  assert.match(result.detail, /超时/)
})

test('unblockInstall allows multi-hosts without error', async t => {
  const box = sandbox(t)
  const service = makeService(box, fakeCodex(false).run)
  assert.equal(service.unblockInstall('antigravity').ok, true)
  assert.equal(service.unblockInstall('qoder').ok, true)
  assert.equal(service.unblockInstall('opencode').ok, true)
  assert.equal(service.unblockInstall('claude-code').ok, true)
  assert.equal(service.unblockInstall('invalid-host').ok, false)
})
