import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = '/opt/cli/lib/node_modules/@deepseek-ai/dsh'
const file = root + '/package.json'
const manifest = JSON.parse(readFileSync(file, 'utf8'))
const families = JSON.parse(readFileSync(new URL('./public-dsh-family.json', import.meta.url)))
assert.equal(manifest.name, '@deepseek-ai/dsh')
const family = families[manifest.version]
assert.ok(family, 'Only the three explicitly supported CI cohorts may be pinned.')
// Published development-only dependencies need not exist for this historical tag.
// This is a runtime host installation, not a build of the DSH monorepo.
delete manifest.devDependencies
// Test only: do not rewrite an existing end-user/global DSH installation.
// Exact transitive overrides prevent old launcher tags resolving later prereleases.
manifest.overrides ??= {}
for (const name of family) {
  if (name === manifest.name) continue
  manifest.overrides[name] = manifest.version
  if (manifest.dependencies?.[name]) manifest.dependencies[name] = manifest.version
  if (manifest.devDependencies?.[name]) manifest.devDependencies[name] = manifest.version
  if (manifest.optionalDependencies?.[name]) manifest.optionalDependencies[name] = manifest.version
}
writeFileSync(file, JSON.stringify(manifest, null, 2))
const result = spawnSync('npm', ['install', '--prefix', root, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com'],
  { stdio: 'inherit', timeout: 600000 })
assert.equal(result.status, 0, 'Pinned host installation failed.')
const lock = JSON.parse(readFileSync(root + '/package-lock.json', 'utf8'))
const versions = Object.entries(lock.packages).filter(([path]) => /node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path))
for (const [path, pkg] of versions) assert.equal(pkg.version, manifest.version, path)
writeFileSync('/work/results/pinned-host.json', JSON.stringify({ version: manifest.version, packages: versions.map(([path, pkg]) => ({ path, version: pkg.version })) }, null, 2))
console.log('PINNED_HOST_COMPLETE', manifest.version, versions.length)
