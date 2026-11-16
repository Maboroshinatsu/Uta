'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appDir = path.join(__dirname, '..')
const repoDir = path.join(appDir, '..')
const workflowDir = path.join(repoDir, 'docs', 'workflow')
const archiveDir = path.join(workflowDir, 'archive')

// GBK 误编码后残留的稀有字符集：UTF-8 中文被按 GBK 解码再存回 UTF-8 时高频出现，
// 正常中文文档里这些字组合几乎不会成行出现。刻意排除 交/成/浜/」 等在正规中文里合法的字符。
const MOJIBAKE_CHARS = new Set(
  '澶鑳鎸鐨娴缁浠涓庡搴曠Щ闄厰鐗欐悶鎬閮嬮瀹屾垚娓鍗曠敓姘斿姩浣滃満鐘舵€佽浇鍏鐢ㄦ埛璇勫'
    .split('')
)

function mojibakeLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => {
      let hits = 0
      for (const ch of line) if (MOJIBAKE_CHARS.has(ch)) hits += 1
      return hits >= 5
    })
    .map(([number]) => number)
}

function liveDocs() {
  return fs
    .readdirSync(workflowDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(workflowDir, name))
}

test('every handoff doc stays UTF-8 readable with no GBK mojibake lines', () => {
  const broken = []
  for (const file of liveDocs()) {
    const lines = mojibakeLines(file)
    if (lines.length > 0) broken.push(`${path.basename(file)}@${lines.slice(0, 3).join(',')}`)
  }
  assert.deepEqual(broken, [], `交接文档出现 GBK 乱码行：${broken.join(' | ')}`)
})

test('archived history is preserved and readable except the flagged corrupted copy', () => {
  const files = fs
    .readdirSync(archiveDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('HANDOFF-corrupted') && !name.startsWith('root-HANDOFF-copy'))
  assert.ok(files.length >= 3, `归档文件过少：${files.join(',')}`)
  const broken = files.filter((name) => mojibakeLines(path.join(archiveDir, name)).length > 0)
  assert.deepEqual(broken, [], `归档出现新的乱码文件：${broken.join(',')}`)
  const totalLines = files.reduce((sum, name) => sum + fs.readFileSync(path.join(archiveDir, name), 'utf8').split(/\r?\n/).length, 0)
  assert.ok(totalLines > 1500, `归档历史体量异常（${totalLines} 行），疑似历史条目被丢弃`)
})

test('the handoff page describes only the current site instead of appending rounds', () => {
  const file = path.join(workflowDir, 'HANDOFF.md')
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/).length
  assert.ok(lines <= 200, `HANDOFF.md 已膨胀到 ${lines} 行：单页现场必须原地覆盖，历史条目移入 archive/`)
  assert.equal(text.includes('# Uta 交接现场'), true, 'HANDOFF.md 缺少单页现场标题')
  for (const heading of ['## 1. 仓库与版本', '## 3. 验证状态', '## 4. 已知未修问题', '## 6. 下一步建议', '## 7. 未核实项']) {
    assert.ok(text.includes(heading), `HANDOFF.md 缺少现场必备小节：${heading}`)
  }
  assert.equal(/PID\s*\d{3,}/.test(text), false, 'HANDOFF.md 把进程号写成了现场，应改为重新探测的命令')
})

test('live docs never prescribe the retired Uta-Workspace tree as a write target', () => {
  const pattern = /Uta-Workspace\/(?:runtime|operations|build|tasks|profiles)/
  // 顶部带历史/暂停声明横幅的文档属于存档，允许保留旧路径引用
  const BANNER = /历史流程|已弃用|暂停执行|存档|仅作历史|不代表当前/
  const offenders = []
  for (const file of liveDocs()) {
    const text = fs.readFileSync(file, 'utf8')
    if (BANNER.test(text.split(/\r?\n/, 10).join('\n'))) continue
    text.split(/\r?\n/).forEach((line, index) => {
      if (pattern.test(line) && !/已弃用|历史|不可当作|不得|过期/.test(line)) {
        offenders.push(`${path.basename(file)}:${index + 1}`)
      }
    })
  }
  assert.deepEqual(offenders, [], `当前文档把已弃用目录写成可引用路径：${offenders.join(' | ')}`)
})

test('the app test entry discovers files instead of enumerating them', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
  const script = pkg.scripts.test
  assert.match(script, /--test/, 'test 脚本不再是 node --test 入口')
  assert.match(script, /\*\.test\.cjs/, 'test 脚本必须使用通配自动发现，手工枚举会漏登记新测试')
  assert.equal(/tests\/[a-z0-9-]+\.test\.cjs\s+tests\//.test(script), false, 'test 脚本退回成手工枚举清单')
})

test('every relative link in the user-facing docs resolves to a real file', () => {
  const docs = [path.join(repoDir, 'README.md'), path.join(repoDir, 'plugin', 'README.md')]
  const broken = []
  for (const doc of docs) {
    const base = path.dirname(doc)
    const text = fs.readFileSync(doc, 'utf8')
    for (const match of text.matchAll(/\]\(([^)\s#][^)]*)\)/g)) {
      const target = match[1].split('#')[0].trim()
      if (!target || /^[a-z]+:\/\//i.test(target)) continue
      if (!fs.existsSync(path.resolve(base, target))) broken.push(`${path.basename(base)}/${path.basename(doc)} -> ${target}`)
    }
  }
  assert.deepEqual(broken, [], `文档里有指向不存在文件的链接：${broken.join(' | ')}`)
})

test('user-facing docs do not advertise removed capabilities by their old names', () => {
  const retired = ['切换平台', '解除平台绑定', '角色与动作', '使用刚导入的角色', 'MCP 5 工具', '系统语音（system）']
  const docs = [path.join(repoDir, 'README.md'), path.join(repoDir, 'plugin', 'README.md')]
  const hits = []
  for (const doc of docs) {
    const text = fs.readFileSync(doc, 'utf8')
    for (const word of retired) {
      if (text.includes(word)) hits.push(`${path.basename(path.dirname(doc))}/${path.basename(doc)} 含「${word}」`)
    }
  }
  assert.deepEqual(hits, [], `用户文档仍在用已改名的旧入口：${hits.join(' | ')}`)
})

test('every test file in tests/ is actually matched by the discovery pattern', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
  const raw = pkg.scripts.test.match(/"([^"]*\.test\.cjs)"/) || pkg.scripts.test.match(/'([^']*\.test\.cjs)'/)
  assert.ok(raw, '无法从 test 脚本解析出发现模式')
  const glob = raw[1].replace(/\\/g, '/')
  const pattern = new RegExp(
    '^' + glob.split('/').map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*')).join('/') + '$'
  )
  const dir = glob.split('/')[0]
  const unmatched = fs
    .readdirSync(path.join(appDir, dir))
    .filter((name) => name.endsWith('.test.cjs'))
    .map((name) => `${dir}/${name}`)
    .filter((rel) => !pattern.test(rel))
  assert.deepEqual(unmatched, [], `以下测试不会被 npm test 执行：${unmatched.join(', ')}`)
  const count = fs.readdirSync(path.join(appDir, dir)).filter((name) => name.endsWith('.test.cjs')).length
  assert.ok(count >= 145, `发现的测试文件数异常（${count}），请确认目录或模式是否被改动`)
})
