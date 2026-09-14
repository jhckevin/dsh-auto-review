import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const hash = value => createHash('sha256').update(value).digest('hex')
test('alpha5 profile discovery uses native path anchoring, is reversible and rejects local edits', async t => {
  const f = await fixture(t)
  copyFileSync(new URL('../package.json', import.meta.url), join(f.dir, 'package.json'))
  copyFileSync(new URL('../cordis.patch.yml', import.meta.url), join(f.dir, 'cordis.patch.yml'))
  const pkg = join(f.dir, 'profile/node_modules/@jhckevin/dsh-auto-review')
  mkdirSync(pkg, { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml']) copyFileSync(join(f.dir, file), join(pkg, file))
  const target = join(pkg, 'cordis.patch.yml'), original = readFileSync(target, 'utf8')
  const { prepareProfileUi } = await import(pathToFileURL(join(f.dir, 'scripts/prepare-profile-ui.mjs')))
  const options = { profileRoot: join(f.dir, 'profile') }
  assert.equal(prepareProfileUi('0.1.1-rc.2', options).applicable, false)
  assert.equal(prepareProfileUi('0.1.2-alpha.5', { ...options, check: true }).adapted, false)
  assert.equal(readFileSync(target, 'utf8'), original)
  const overlay = join(f.dir, 'profile/cordis.patch.yml')
  writeFileSync(overlay, "- id: auto-review\n  name: '@jhckevin/dsh-auto-review/entries/runtime'\n  disabled: true\n")
  assert.throws(() => prepareProfileUi('0.1.2-alpha.5', options), /Custom overlay/)
  assert.equal(readFileSync(target, 'utf8'), original)
  writeFileSync(overlay, '- id: auto-review\n  disabled: true\n')
  assert.throws(() => prepareProfileUi('0.1.2-alpha.5', options), /Custom overlay/)
  writeFileSync(overlay, '# custom\r- id: auto-review\r  disabled: true\r')
  assert.throws(() => prepareProfileUi('0.1.2-alpha.5', options), /Custom overlay/)
  writeFileSync(overlay, '- id: auto-review\n  name: "@jhckevin\\u002fdsh-auto-review/entries/runtime"\n  disabled: true\n')
  assert.throws(() => prepareProfileUi('0.1.2-alpha.5', options), /Custom overlay/)
  assert.equal(readFileSync(target, 'utf8'), original)
  writeFileSync(overlay, '[]\n')
  assert.equal(prepareProfileUi('0.1.2-alpha.5', options).changed, true)
  assert.match(readFileSync(target, 'utf8'), /name: '\.\/lib\/entries\/runtime\.js'/)
  assert.equal(prepareProfileUi('0.1.2-alpha.5', options).changed, false)
  assert.equal(prepareProfileUi('0.1.2-alpha.5', { ...options, restore: true }).changed, true)
  assert.equal(readFileSync(target, 'utf8'), original)
  writeFileSync(target, original + '\n# user modification')
  assert.throws(() => prepareProfileUi('0.1.2-alpha.5', options), /Locally modified/)
  assert.throws(() => prepareProfileUi('0.1.2-alpha.5', { profileRoot: join(f.dir, 'missing') }), /Cannot find/)
  const other = join(f.dir, 'other/node_modules/@jhckevin')
  mkdirSync(other, { recursive: true }); symlinkSync(pkg, join(other, 'dsh-auto-review'))
  assert.throws(() => prepareProfileUi('0.1.2-alpha.5', { profileRoot: join(f.dir, 'other') }), /Shared plugin/)
})
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ar-ui-install-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'ui'))
  copyFileSync(new URL('./install-ui.mjs', import.meta.url), join(dir, 'scripts/install-ui.mjs'))
  copyFileSync(new URL('./prepare-ui.mjs', import.meta.url), join(dir, 'scripts/prepare-ui.mjs'))
  copyFileSync(new URL('./prepare-profile-ui.mjs', import.meta.url), join(dir, 'scripts/prepare-profile-ui.mjs'))
  const base = join(dir, 'node_modules'); const files = []
  for (const name of ['tool', 'settings']) {
    const pkg = 'dsh-client-ui-' + name
    const target = join(base, '@deepseek-ai', pkg)
    mkdirSync(join(target, 'lib'), { recursive: true })
    writeFileSync(join(target, 'package.json'), JSON.stringify({ version: '0.1.1-rc.2' }))
    writeFileSync(join(target, 'lib/client.js'), 'original-' + name)
    writeFileSync(join(dir, 'ui', name + '.js'), 'patched-' + name)
    files.push({ package: pkg, artifact: 'ui/' + name + '.js', originalSha256: hash('original-' + name), patchedSha256: hash('patched-' + name) })
  }
  writeFileSync(join(dir, 'ui/manifest.json'), JSON.stringify({ dshVersion: '0.1.1-rc.2', files }))
  const { installUi } = await import(pathToFileURL(join(dir, 'scripts/install-ui.mjs')))
  return { dir, base, installUi, target: name => join(base, '@deepseek-ai', 'dsh-client-ui-' + name, 'lib/client.js') }
}
test('install, idempotence, dry run and restore preserve originals', async t => {
  const f = await fixture(t)
  assert.equal(f.installUi(f.base, { check: true }).changed, 0)
  assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
  assert.equal(f.installUi(f.base).changed, 2)
  assert.equal(f.installUi(f.base).changed, 0)
  assert.equal(f.installUi(f.base, { restore: true }).changed, 2)
  assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
})
test('second owner mismatch must not mutate the first owner', async t => {
  const f = await fixture(t)
  writeFileSync(f.target('settings'), 'local-change')
  assert.throws(() => f.installUi(f.base), /Locally modified/)
  assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
  assert.equal(existsSync(f.target('tool') + '.auto-review-original'), false)
})
test('wrong version fails closed', async t => {
  const f = await fixture(t)
  writeFileSync(join(f.base, '@deepseek-ai/dsh-client-ui-settings/package.json'), '{"version":"unknown"}')
  assert.throws(() => f.installUi(f.base), /Unsupported UI version/)
  assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
})
test('tampered backup and packaged artifact fail closed', async t => {
  const f = await fixture(t)
  writeFileSync(f.target('tool') + '.auto-review-original', 'bad')
  assert.throws(() => f.installUi(f.base), /Backup integrity/)
  writeFileSync(f.target('tool') + '.auto-review-original', 'original-tool')
  writeFileSync(join(f.dir, 'ui/tool.js'), 'bad')
  assert.throws(() => f.installUi(f.base), /Packaged UI integrity/)
})
test('existing temp is not deleted and earlier owner is rolled back', async t => {
  const f = await fixture(t)
  const temp = f.target('settings') + '.auto-review-' + process.pid + '.tmp'
  writeFileSync(temp, 'not-ours')
  assert.throws(() => f.installUi(f.base), /EEXIST/)
  assert.equal(readFileSync(temp, 'utf8'), 'not-ours')
  assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
})
test('missing backup cannot silently restore a patched owner', async t => {
  const f = await fixture(t)
  writeFileSync(f.target('tool'), 'patched-tool')
  assert.throws(() => f.installUi(f.base, { restore: true }), /backup is missing/)
})
test('CLI rejects unknown arguments without changing UI', async t => {
  const f = await fixture(t)
  const result = spawnSync(process.execPath, [join(f.dir, 'scripts/install-ui.mjs'), '--dsh-root', f.base, '--typo'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unknown argument/)
  assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
})

test('real CLI --check completes instead of deadlocking its dynamic import cycle', async t => {
  const f = await fixture(t)
  const result = spawnSync(process.execPath, [join(f.dir, 'scripts/install-ui.mjs'), '--dsh-root', f.base, '--check'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"checked":2/)
  assert.doesNotMatch(result.stderr, /unsettled top-level await/)
  assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
})

test('catalog selects each host cohort and refuses mixed owner versions', async t => {
  for (const version of ['0.1.0-rc.6', '0.1.1-rc.2', '0.1.2-alpha.5']) {
    const f = await fixture(t)
    const manifestPath = join(f.dir, 'ui/manifest.json')
    const original = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const versions = ['0.1.0-rc.6', '0.1.1-rc.2', '0.1.2-alpha.5']
    const cohorts = versions.map(dshVersion => ({
      ...original, dshVersion,
      files: original.files.map(file => {
        const artifact = file.artifact.replace('.js', '-' + dshVersion + '.js')
        const bytes = 'patched-' + dshVersion + '-' + file.package
        writeFileSync(join(f.dir, artifact), bytes)
        return { ...file, artifact, patchedSha256: hash(bytes) }
      }),
    }))
    writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 2, cohorts }))
    for (const name of ['tool', 'settings']) {
      writeFileSync(join(f.base, '@deepseek-ai/dsh-client-ui-' + name, 'package.json'), JSON.stringify({ version }))
    }
    assert.equal(f.installUi(f.base, { check: true }).version, version)
    assert.equal(f.installUi(f.base).changed, 2)
    assert.equal(readFileSync(f.target('tool'), 'utf8'), 'patched-' + version + '-dsh-client-ui-tool')
    assert.equal(f.installUi(f.base).changed, 0)
    assert.equal(f.installUi(f.base, { restore: true }).changed, 2)
    writeFileSync(join(f.base, '@deepseek-ai/dsh-client-ui-settings/package.json'), JSON.stringify({ version: '0.9.9' }))
    assert.throws(() => f.installUi(f.base), /Unsupported UI version/)
    assert.equal(readFileSync(f.target('tool'), 'utf8'), 'original-tool')
  }
})
test('unknown first owner in a multi-version catalog fails before backup', async t => {
  const f = await fixture(t)
  const manifestPath = join(f.dir, 'ui/manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 2, cohorts: [manifest] }))
  writeFileSync(join(f.base, '@deepseek-ai/dsh-client-ui-tool/package.json'), JSON.stringify({ version: '0.9.9' }))
  assert.throws(() => f.installUi(f.base), /Unsupported UI version/)
  assert.equal(existsSync(f.target('tool') + '.auto-review-original'), false)
})
