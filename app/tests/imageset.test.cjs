'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/services/imageset/loader.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function load(page, responseUrl, body = JSON.stringify({ images: { neutral: 'neutral.svg' }, talk: 'talk.svg' }), ImageClass) {
  const module = { exports: {} }, requests = []
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, console: { info() {} }, window: { location: { href: page } },
    Image: ImageClass, queueMicrotask,
    fetch: async url => { requests.push(url); return { ok: true, url: responseUrl || '', text: async () => body } },
  })
  return { load: module.exports.loadImageSet, requests }
}

class FakeImage {
  onload = null
  onerror = null
  set src(_value) {
    queueMicrotask(() => this.onload?.())
  }
}

class BrokenImage {
  onload = null
  onerror = null
  set src(_value) {
    queueMicrotask(() => this.onerror?.(new Error('fixture image failure')))
  }
}

test('the default portrait must actually decode before the manifest is accepted', async () => {
  const ok = load('file:///D:/app/index.html', '', undefined, FakeImage)
  const manifest = await ok.load('./models/sample_static/deskpet-images.json')
  assert.equal(manifest.default, 'neutral')
  const broken = load('file:///D:/app/index.html', '', undefined, BrokenImage)
  await assert.rejects(
    broken.load('./models/sample_static/deskpet-images.json'),
    /立绘图片加载失败/,
  )
})
for (const page of [
  'file:///D:/Test%20Project/out/renderer/index.html',
  'http://127.0.0.1:5173/index.html',
  'http://127.0.0.1:5173/subdir/index.html',
]) {
  test(`relative manifest resolves images and talk: ${page}`, async () => {
    const h = load(page)
    const manifest = './models/sample_static/deskpet-images.json'
    const absolute = new URL(manifest, page).href
    const result = await h.load(manifest)
    assert.equal(h.requests[0], absolute)
    assert.equal(result.images.neutral, new URL('neutral.svg', absolute).href)
    assert.equal(result.talk, new URL('talk.svg', absolute).href)
  })
}
test('custom deskpet protocol remains unchanged', async () => {
  const h = load('file:///D:/app/index.html')
  const result = await h.load('deskpet://models/sample/deskpet-images.json')
  assert.equal(result.images.neutral, 'deskpet://models/sample/neutral.svg')
})
test('redirected HTTP manifests resolve images relative to final response URL', async () => {
  const h = load('http://localhost/index.html', 'http://localhost/assets/v2/deskpet-images.json')
  const result = await h.load('./original.json')
  assert.equal(result.images.neutral, 'http://localhost/assets/v2/neutral.svg')
})
test('spaces and non-ASCII model paths are resolved safely', async () => {
  const h = load('file:///D:/app/index.html')
  const manifest = './models/静态 立绘/deskpet-images.json'
  const result = await h.load(manifest)
  assert.equal(result.images.neutral, new URL('neutral.svg', new URL(manifest, 'file:///D:/app/index.html')).href)
})
test('HTML fallback still reports an invalid manifest', async () => {
  const h = load('http://localhost/index.html', '', '<html>fallback</html>')
  await assert.rejects(h.load('./missing.json'), /立绘清单无法解析/)
})

test('file names containing # or % survive URL resolution', async () => {
  const body = JSON.stringify({ images: { neutral: 'neutral#1.png', happy: 'face%20alt.png' }, talk: 'talk#1.svg' })
  const h = load('file:///D:/app/index.html', '', body, FakeImage)
  const result = await h.load('./models/sample/deskpet-images.json')
  const base = 'file:///D:/app/models/sample/'
  assert.equal(result.images.neutral, base + 'neutral%231.png')
  assert.equal(result.images.happy, base + 'face%2520alt.png')
  assert.equal(result.talk, base + 'talk%231.svg')
})

test('a manifest using an encoded filename still loads when the literal path is absent', async () => {
  class LegacyImage {
    set src(value) {
      queueMicrotask(() => (value.includes('%2520') ? this.onerror?.() : this.onload?.()))
    }
  }
  const h = load('file:///D:/app/index.html', '', JSON.stringify({ images: { neutral: 'face%20alt.png' } }), LegacyImage)
  const result = await h.load('./models/sample/deskpet-images.json')
  assert.equal(result.images.neutral, 'file:///D:/app/models/sample/face%20alt.png')
})

class SelectiveImage {
  onload = null
  onerror = null
  set src(value) {
    queueMicrotask(() => (value.includes('missing') ? this.onerror?.(new Error('missing')) : this.onload?.()))
  }
}

test('missing non-default portraits are reported instead of failing the whole pack', async () => {
  const body = JSON.stringify({
    images: { neutral: 'neutral.svg', happy: 'missing-happy.svg' },
    talk: 'missing-talk.svg',
  })
  const h = load('file:///D:/app/index.html', '', body, SelectiveImage)
  const result = await h.load('./models/sample/deskpet-images.json')
  assert.equal(result.images.neutral, 'file:///D:/app/models/sample/neutral.svg')
  assert.equal(result.images.happy, undefined)
  assert.equal(result.talk, undefined)
  assert.equal([...result.missingImages].sort().join('|'), 'happy|talk')
  const stage = fs.readFileSync(path.join(__dirname, '../src/renderer/components/StaticStage.vue'), 'utf8')
  assert.match(stage, /emit\('notice'/)
})
