import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const hash = value => createHash('sha256').update(value).digest('hex')
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ar-ui-install-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'ui'))
  copyFileSync(new URL('./install-ui.mjs', import.meta.url), join(dir, 'scripts/install-ui.mjs'))
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
