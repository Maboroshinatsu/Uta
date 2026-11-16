import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const requireFromApp = createRequire(path.join(pluginRoot, '..', 'app', 'package.json'))
const esbuild = requireFromApp('esbuild')

/** 把宿主入口与 plugin/shared 打成单文件，产物不再需要复制或改写 import。 */
export function bundleEntry({ entry, outfile }) {
  esbuild.buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
  })
}
