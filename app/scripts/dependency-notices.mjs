/** Collect installed production dependency notices without accessing the network. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(fs.readFileSync(path.join(appDir, 'package-lock.json'), 'utf8'))
const supplement = new Map([['@vue/devtools-api@6.6.4', path.join(appDir, 'resources/licenses/vue-devtools-api-LICENSE.md')]])
const sections = ['Uta third-party dependency notices', 'Generated from package-lock.json and installed production packages. Each component retains its own license.', 'Live2D Core and model terms: THIRD_PARTY_LICENSES.md. Electron and Chromium notices are supplied with the executable.']
let count = 0
for (const [relative, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!relative || entry.dev) continue
  const dir = path.resolve(appDir, relative)
  if (!dir.startsWith(path.join(appDir, 'node_modules') + path.sep)) throw new Error('Unexpected dependency path: ' + relative)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  if (pkg.version !== entry.version) throw new Error('Dependency differs from lockfile: ' + relative)
  const files = fs.readdirSync(dir).filter(name => /^(licen[cs]e|copying|notice)([._-]|$)/i.test(name) && fs.statSync(path.join(dir, name)).isFile())
  const texts = files.sort().map(name => fs.readFileSync(path.join(dir, name), 'utf8'))
  const extra = supplement.get(pkg.name + '@' + pkg.version)
  if (extra) texts.push(fs.readFileSync(extra, 'utf8'))
  if (!texts.length) throw new Error('Missing license text: ' + pkg.name + '@' + pkg.version)
  sections.push('\n' + '='.repeat(72) + '\n' + pkg.name + '@' + pkg.version + '\nLicense: ' + (entry.license ?? pkg.license ?? 'See original text') + '\n\n' + texts.join('\n\n'))
  count++
}
const output = path.join(appDir, 'build', 'THIRD-PARTY-NOTICES.txt')
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, sections.join('\n\n') + '\n', 'utf8')
console.log('Collected license texts for ' + count + ' production dependency entries.')
