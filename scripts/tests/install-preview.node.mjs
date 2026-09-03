import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../prepare-preview-install.mjs', import.meta.url))
const fixtures = [
  { name: '@jhckevin/dsh-auto-review', version: '0.5.6-rc.4', peerDependencies: { '@deepseek-ai/dsh-agent': '0.1.1-rc.2' }, dependencies: { '@jhckevin/dsh-auto-review-bridge-host': '0.1.0-rc.2' } },
  { name: '@jhckevin/dsh-auto-review-bridge-host', version: '0.1.0-rc.2', optionalDependencies: { '@jhckevin/dsh-auto-review-bridge-linux-x64-gnu': '0.1.0-rc.2' } },
  ...Object.entries({ '@jhckevin/dsh-auto-review-bridge-linux-x64-gnu': '0.1.0-rc.2', '@deepseek-ai/schemastery': '3.18.2', '@deepseek-ai/cosmokit': '1.8.3', '@standard-schema/spec': '1.1.0', 'node-addon-api': '8.9.2', 'node-gyp-build': '4.8.4', 'tree-sitter': '0.25.1', 'tree-sitter-bash': '0.25.1' }).map(([name, version]) => ({ name, version })),
]
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'auto-review-installer-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const artifacts = join(root, 'artifacts'), contents = join(root, 'contents')
  mkdirSync(artifacts); mkdirSync(contents); mkdirSync(join(contents, 'package'))
  const sums = fixtures.map((pkg, i) => {
    writeFileSync(join(contents, 'package/package.json'), JSON.stringify(pkg))
    const name = `artifact-${i}.tgz`
    execFileSync('tar', ['-czf', join(artifacts, name), '-C', contents, 'package'])
    return `${createHash('sha256').update(readFileSync(join(artifacts, name))).digest('hex')}  ${name}`
  })
  writeFileSync(join(artifacts, 'SHA256SUMS'), sums.join('\n') + '\n')
  const destination = join(root, 'install')
  const run = () => spawnSync(process.execPath, [script, artifacts, destination], { encoding: 'utf8' })
  return { root, artifacts, destination, run }
}
test('checked artifacts prepare isolated exact peers without running npm', t => {
  const f = fixture(t); assert.equal(f.run().status, 0)
  const p = JSON.parse(readFileSync(join(f.destination, 'package.json')))
  assert.equal(p.dependencies['@deepseek-ai/dsh'], '0.1.1-rc.2')
  assert.equal(p.dependencies['@deepseek-ai/cordis-plugin-group'], '1.0.2')
  assert.equal(p.overrides['@deepseek-ai/dsh'], '$@deepseek-ai/dsh')
  const family = Object.entries(p.dependencies).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.equal(family.length, 189)
  for (const [name, version] of family) {
    assert.equal(version, '0.1.1-rc.2')
    assert.equal(p.overrides[name], `$${name}`)
  }
  assert.match(readFileSync(join(f.destination, '.npmrc'), 'utf8'), /ignore-scripts=true/)
})
test('modified package is refused before creating destination', t => {
  const f = fixture(t); writeFileSync(join(f.artifacts, 'artifact-0.tgz'), 'tamper')
  assert.notEqual(f.run().status, 0)
})
test('existing directory is never overwritten', t => {
  const f = fixture(t); mkdirSync(f.destination); writeFileSync(join(f.destination, 'keep'), 'original')
  assert.notEqual(f.run().status, 0); assert.equal(readFileSync(join(f.destination, 'keep'), 'utf8'), 'original')
})
test('archive symlink is refused even when target bytes match checksum', t => {
  const f = fixture(t); const path = join(f.artifacts, 'artifact-0.tgz'), copy = join(f.root, 'same.tgz')
  writeFileSync(copy, readFileSync(path)); rmSync(path); symlinkSync(copy, path)
  assert.notEqual(f.run().status, 0)
})
test('missing checksum manifest is refused', t => {
  const f = fixture(t); rmSync(join(f.artifacts, 'SHA256SUMS')); assert.notEqual(f.run().status, 0)
})
test('duplicate checksum entry is refused', t => {
  const f = fixture(t); const file = join(f.artifacts, 'SHA256SUMS')
  const original = readFileSync(file, 'utf8')
  writeFileSync(file, original + original.split('\n')[0] + '\n')
  assert.notEqual(f.run().status, 0)
})
