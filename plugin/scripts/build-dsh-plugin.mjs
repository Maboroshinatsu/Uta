/**
 * 把 DeepSeek Harness 原生插件打成单文件包。
 *
 * 源码可以直接被 DSH 以符号链接加载；这个产物用于复制/分发的场景，
 * 确保 plugin/shared 已被内联，不依赖仓库目录结构。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleEntry } from './plugin-bundler.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const srcDir = path.join(pluginRoot, 'plugins', 'deepseek-harness')
const outDir = path.join(pluginRoot, 'dist', 'deepseek-harness')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

bundleEntry({
  entry: path.join(srcDir, 'src', 'index.mjs'),
  outfile: path.join(outDir, 'index.mjs'),
})
fs.copyFileSync(path.join(srcDir, 'src', 'index.d.ts'), path.join(outDir, 'index.d.ts'))
fs.copyFileSync(path.join(srcDir, 'cordis.patch.yml'), path.join(outDir, 'cordis.patch.yml'))

const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'))
manifest.main = './index.mjs'
manifest.types = './index.d.ts'
manifest.exports = {
  '.': {
    types: './index.d.ts',
    default: './index.mjs',
  },
}
delete manifest.files
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

const text = fs.readFileSync(path.join(outDir, 'index.mjs'), 'utf8')
const relativeImports = [...text.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1])
if (relativeImports.length > 0) {
  throw new Error(`DSH 产物仍有未打包的相对 import: ${relativeImports.join(', ')}`)
}
console.log('built deepseek-harness ->', path.relative(pluginRoot, outDir))
