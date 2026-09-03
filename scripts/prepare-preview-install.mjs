// 只生成全新隔离安装目录；不修改用户现有 profile、不执行 sudo、不下载或启动服务。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [artifactsArg, destinationArg] = process.argv.slice(2)
assert(artifactsArg && destinationArg, 'usage: node scripts/prepare-preview-install.mjs ABS_ARTIFACTS NEW_ABS_DIRECTORY')
assert(isAbsolute(artifactsArg) && isAbsolute(destinationArg), 'absolute paths required')
const artifacts = realpathSync(artifactsArg)
const destination = resolve(destinationArg)
assert.equal(realpathSync(dirname(destination)), dirname(destination), 'parent must be canonical and already exist')
assert(!existsSync(destination), 'destination must not exist; existing profiles are never overwritten')
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const checksums = new Map()
for (const line of readFileSync(join(artifacts, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
  const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line)
  assert(match, 'invalid checksum line')
  assert(!checksums.has(match[2]), 'duplicate checksum entry')
  checksums.set(match[2], match[1])
}
const names = readdirSync(artifacts).filter(name => name.endsWith('.tgz'))
assert.equal(names.length, 10, 'dedicated directory must contain main, host, platform and seven runtime dependencies')
const expected = new Set(['@jhckevin/dsh-auto-review', '@jhckevin/dsh-auto-review-bridge-host', '@jhckevin/dsh-auto-review-bridge-linux-x64-gnu', '@deepseek-ai/schemastery', '@deepseek-ai/cosmokit', '@standard-schema/spec', 'node-addon-api', 'node-gyp-build', 'tree-sitter', 'tree-sitter-bash'])
const runtimeVersions = { '@deepseek-ai/schemastery': '3.18.2', '@deepseek-ai/cosmokit': '1.8.3', '@standard-schema/spec': '1.1.0', 'node-addon-api': '8.9.2', 'node-gyp-build': '4.8.4', 'tree-sitter': '0.25.1', 'tree-sitter-bash': '0.25.1' }
const packages = names.map(file => {
  assert(lstatSync(join(artifacts, file)).isFile() && !lstatSync(join(artifacts, file)).isSymbolicLink(), 'regular archives only')
  assert.equal(digest(join(artifacts, file)), checksums.get(file), `artifact checksum mismatch: ${file}`)
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', join(artifacts, file), 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
  assert(expected.delete(manifest.name), `unknown/duplicate artifact: ${manifest.name}`)
  if (runtimeVersions[manifest.name]) assert.equal(manifest.version, runtimeVersions[manifest.name], 'unvalidated runtime version')
  return { file, manifest }
})
assert.equal(expected.size, 0)
const plugin = packages.find(item => item.manifest.name === '@jhckevin/dsh-auto-review').manifest
const versions = new Set(Object.entries(plugin.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-')).map(([, version]) => version))
assert.equal(versions.size, 1, 'mixed DSH peer graph is forbidden')
const [dshVersion] = versions
assert(['0.1.0-rc.6', '0.1.1-rc.2', '0.1.2-alpha.5'].includes(dshVersion))
const families = JSON.parse(readFileSync(fileURLToPath(new URL('./public-dsh-family.json', import.meta.url)), 'utf8'))
const family = families[dshVersion]
assert(Array.isArray(family) && family.includes('@deepseek-ai/dsh'), 'missing validated public DSH family')
assert.equal(new Set(family).size, family.length, 'duplicate family entry')
assert(family.every(name => /^@deepseek-ai\/dsh(?:-[a-z0-9-]+)?$/.test(name)), 'invalid DSH family entry')
const nativeHost = packages.find(item => item.manifest.name === '@jhckevin/dsh-auto-review-bridge-host').manifest
const platform = packages.find(item => item.manifest.name === '@jhckevin/dsh-auto-review-bridge-linux-x64-gnu').manifest
assert.equal(plugin.dependencies[nativeHost.name], nativeHost.version)
assert.equal(nativeHost.optionalDependencies?.[platform.name] ?? nativeHost.dependencies?.[platform.name], platform.version)
// 原子占有全新目录；不要先递归创建，否则可能覆写竞争创建的路径。
mkdirSync(destination, { mode: 0o700 })
mkdirSync(join(destination, 'vendor'))
mkdirSync(join(destination, 'home'))
mkdirSync(join(destination, 'workspace'))
const dependencies = { '@deepseek-ai/dsh': dshVersion, ...plugin.peerDependencies, '@deepseek-ai/cordis': '4.0.1', react: '18.3.1' }
// 锁定完整公开 DSH 家族，阻止上游 ^ prerelease 范围悄悄拉入其他通道。
for (const name of family) dependencies[name] = dshVersion
dependencies['@deepseek-ai/cordis-plugin-group'] = '1.0.2'
const overrides = Object.fromEntries(family.map(name => [name, `$${name}`]))
for (const { file, manifest } of packages) {
  copyFileSync(join(artifacts, file), join(destination, 'vendor', file))
  assert.equal(digest(join(destination, 'vendor', file)), checksums.get(file), 'artifact changed during copy')
  dependencies[manifest.name] = `file:vendor/${file}`
  overrides[manifest.name] = `$${manifest.name}`
}
writeFileSync(join(destination, 'package.json'), JSON.stringify({ name: 'auto-review-isolated-preview', private: true, type: 'module', dependencies, overrides }, null, 2) + '\n')
writeFileSync(join(destination, '.npmrc'), 'registry=https://registry.npmmirror.com\nignore-scripts=true\naudit=false\nfund=false\nlegacy-peer-deps=true\n')
writeFileSync(join(destination, 'install-plan.json'), JSON.stringify({ dshVersion, pluginVersion: plugin.version, nativeVersion: nativeHost.version, nativeRuntimeRequiresAdministrator: true, source: artifacts }, null, 2) + '\n')
console.log(`Prepared ${destination}; run npm install there. Native runtime must be administrator-installed before review. No service started.`)
