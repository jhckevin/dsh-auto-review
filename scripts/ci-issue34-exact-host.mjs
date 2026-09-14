import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const version = process.env.DSH_VERSION
const family = JSON.parse(fs.readFileSync(new URL('./public-dsh-family.json', import.meta.url)))[version]
assert.ok(family, 'Unknown historical cohort')
const root = '/opt/cli/lib/node_modules/@deepseek-ai/dsh'
assert.equal(fs.existsSync(root), false, 'Exact CI installation requires an empty host; never rewrite a user installation')
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 600000, killSignal: 'SIGKILL' })
  if (result.status !== 0) throw new Error(command + ' failed: ' + result.stderr)
  return result.stdout
}
const cache = fs.mkdtempSync('/work/dsh-source-')
const packed = JSON.parse(run('npm', ['pack', '@deepseek-ai/dsh@' + version, '--json', '--ignore-scripts', '--pack-destination', cache, '--registry=https://registry.npmmirror.com']))[0]
fs.mkdirSync(root, { recursive: true })
run('tar', ['-xzf', path.join(cache, packed.filename), '-C', root, '--strip-components=1'])
const manifest = JSON.parse(fs.readFileSync(root + '/package.json'))
assert.equal(manifest.version, version)
delete manifest.devDependencies
manifest.overrides = {}
manifest.allowScripts = Object.fromEntries(['@deepseek-ai/dsh-subprocess-local', 'koffi', 'fs-ext', 'node-pty', '@google/genai', 'protobufjs'].map(name => [name, true]))
for (const name of family) {
  if (name === manifest.name) continue
  manifest.overrides[name] = version
  if (manifest.dependencies?.[name]) manifest.dependencies[name] = version
  if (manifest.optionalDependencies?.[name]) manifest.optionalDependencies[name] = version
}
fs.writeFileSync(root + '/package.json', JSON.stringify(manifest, null, 2))
run('npm', ['install', '--prefix', root, '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com'])
fs.mkdirSync('/opt/cli/bin', { recursive: true })
fs.symlinkSync('../lib/node_modules/@deepseek-ai/dsh/lib/bin.js', '/opt/cli/bin/dsh')
const lock = JSON.parse(fs.readFileSync(root + '/package-lock.json'))
const packages = Object.entries(lock.packages).filter(([name]) => /node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(name))
for (const [name, pkg] of packages) assert.equal(pkg.version, version, name)
fs.writeFileSync('/work/results/exact-host.json', JSON.stringify({ version, source: packed, packages: packages.map(([name, pkg]) => ({ name, version: pkg.version })) }, null, 2))
console.log('EXACT_HOST_COMPLETE', version, packages.length)
