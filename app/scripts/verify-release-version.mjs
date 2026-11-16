import fs from 'node:fs'

const app = new URL('../', import.meta.url)
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', app), 'utf8'))
const lock = JSON.parse(fs.readFileSync(new URL('package-lock.json', app), 'utf8'))
if (process.env.GITHUB_REF_NAME !== `v${pkg.version}` || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  throw Error('Tag, package.json and package-lock.json versions must match.')
}
console.log(`Release version verified: v${pkg.version}`)
