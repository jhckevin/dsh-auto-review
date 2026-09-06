import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
async function fixture(t, version = '0.1.1-rc.2') {
  const root = mkdtempSync(join(tmpdir(), 'ar-selective-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'ui'))
  for (const name of ['install-ui.mjs', 'prepare-ui.mjs']) copyFileSync(new URL(name, import.meta.url), join(root, 'scripts', name))
  const host = join(root, 'host'), payloads = new Map()
  const cohorts = [['0.1.0-rc.6','rc6'], ['0.1.1-rc.2','rc2'], ['0.1.2-alpha.5','alpha5']].map(([dshVersion, channel]) => ({
    dshVersion, files: ['tool','settings-general'].map(name => {
      const artifact = 'ui/' + channel + '/ui-' + name + '.js'
      const bytes = 'patched-' + channel + '-' + name
      payloads.set(artifact, bytes)
      return { package: 'dsh-client-ui-' + name, artifact, originalSha256: hash('original-' + name), patchedSha256: hash(bytes) }
    }),
  }))
  for (const file of cohorts[0].files) {
    const dir = join(host, '@deepseek-ai', file.package)
    mkdirSync(join(dir, 'lib'), {recursive:true})
    writeFileSync(join(dir, 'package.json'), JSON.stringify({version}))
    writeFileSync(join(dir, 'lib/client.js'), 'original-' + file.package.replace('dsh-client-ui-',''))
  }
  writeFileSync(join(root, 'ui/manifest.json'), JSON.stringify({cohorts}))
  const { prepareUi } = await import(pathToFileURL(join(root, 'scripts/prepare-ui.mjs')))
  const requests = []
  const fetcher = async url => { requests.push(url); return new Response(payloads.get(url.split('/v0.6.0/')[1])) }
  const original = () => readFileSync(join(host, '@deepseek-ai/dsh-client-ui-tool/lib/client.js'), 'utf8')
  return {host, prepareUi, requests, fetcher, original}
}

test('downloads only the selected cohort for each of the three hosts; repeat and restore need no network', async t => {
  for (const [version, channel] of [['0.1.0-rc.6','rc6'], ['0.1.1-rc.2','rc2'], ['0.1.2-alpha.5','alpha5']]) {
    const f = await fixture(t, version)
    assert.equal((await f.prepareUi(f.host, {}, f.fetcher)).changed, 2)
    assert.equal(f.requests.length, 2)
    assert(f.requests.every(url => url.includes('/ui/' + channel + '/')))
    const offline = async () => {throw Error('offline')}
    assert.equal((await f.prepareUi(f.host, {}, offline)).changed, 0)
    assert.equal((await f.prepareUi(f.host, {restore:true}, offline)).changed, 2)
    assert.equal(f.original(), 'original-tool')
  }
})
test('preflight refuses unknown or mixed host versions before any network request', async t => {
  for (const version of ['unknown', '0.1.1-rc.2']) {
    const f = await fixture(t, version)
    writeFileSync(join(f.host, '@deepseek-ai/dsh-client-ui-settings-general/package.json'), '{"version":"unknown"}')
    await assert.rejects(f.prepareUi(f.host, {}, f.fetcher), /Unsupported UI version/)
    assert.equal(f.requests.length, 0)
    assert.equal(f.original(), 'original-tool')
  }
})
test('download failure, truncated or oversized payloads do not modify the host', async t => {
  for (const response of [new Response('missing',{status:404}), new Response('corrupt'), new Response(new Uint8Array(8*1024*1024+1))]) {
    const f = await fixture(t)
    await assert.rejects(f.prepareUi(f.host, {}, async () => response), /download/)
    assert.equal(f.original(), 'original-tool')
  }
})
test('a second payload failure leaves the first owner unchanged', async t => {
  const f = await fixture(t); let calls = 0
  await assert.rejects(f.prepareUi(f.host, {}, async url => ++calls === 1 ? f.fetcher(url) : new Response('bad')), /integrity/)
  assert.equal(f.original(), 'original-tool')
})
