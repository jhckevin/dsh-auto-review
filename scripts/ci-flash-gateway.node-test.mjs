import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createGateway, usageFromProvider } from './ci-flash-gateway.mjs'
test('input cache and reasoning are subsets, not added twice', () => {
  assert.deepEqual(usageFromProvider({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80, completion_tokens_details: { reasoning_tokens: 12 } }),
    { input: 100, output: 20, total: 120, cacheInput: 80, uncachedInput: 20, reasoningOutput: 12 })
  assert.equal(usageFromProvider({ prompt_tokens: 1, completion_tokens: 2, prompt_cache_hit_tokens: 3 }), null)
  assert.equal(usageFromProvider({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 11 }), null)
  assert.equal(usageFromProvider({ prompt_tokens: 10, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 3 } }), null)
  assert.equal(usageFromProvider({ prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 8 } }).cacheInput, 8)
  assert.equal(usageFromProvider({ prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 7, prompt_tokens_details: { cached_tokens: 8 } }), null)
})
async function fixture(t, usage, limit = 1100000) {
  const root = mkdtempSync(join(tmpdir(), 'ar34-gateway-'))
  writeFileSync(join(root, 'active.json'), JSON.stringify({ cohort: 'rc6', session: 'synthetic-unit' }))
  let calls = 0
  const server = createGateway({ root, key: 'synthetic-key', limit, fetchImpl: async () => {
    calls++
    return new Response('data: ' + JSON.stringify({ usage }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => server.close())
  const post = (cohort = 'rc6', model = 'deepseek-v4-flash') => fetch('http://127.0.0.1:' + server.address().port + '/' + cohort + '/chat/completions',
    { method: 'POST', body: JSON.stringify({ model, stream: true, max_tokens: 2048, messages: [{ role: 'user', content: 'test' }] }) })
  return { root, post, calls: () => calls }
}
test('records authoritative SSE usage once and blocks other cohorts/models', async t => {
  const f = await fixture(t, { prompt_tokens: 100, completion_tokens: 20 })
  assert.equal((await f.post('rc2')).status, 402)
  assert.equal((await f.post('rc6', 'unapproved-model')).status, 400)
  const response = await f.post(); await response.text()
  const rows = readFileSync(join(f.root, 'requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(rows.length, 1); assert.equal(rows[0].usage.total, 120); assert.equal(f.calls(), 1)
})
test('stops on missing provider usage and reserves budget before sending', async t => {
  const f = await fixture(t, undefined)
  await (await f.post()).text()
  assert.equal(existsSync(join(f.root, 'rc6.STOP')), true)
  const bounded = await fixture(t, { prompt_tokens: 1, completion_tokens: 1 }, 100)
  assert.equal((await bounded.post()).status, 402); assert.equal(bounded.calls(), 0)
})
test('a closed stream after DONE and usage is complete, but early close is not', async t => {
  for (const complete of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), 'ar34-close-'))
    writeFileSync(join(root, 'active.json'), JSON.stringify({ cohort: 'rc2', session: 'close-fixture' }))
    const server = createGateway({ root, key: 'synthetic', fetchImpl: async () => ({
      status: 200, ok: true, headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: (async function*() {
        yield new TextEncoder().encode('data: ' + JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 2 } }) + '\n\n' + (complete ? 'data: [DONE]\n\n' : ''))
        throw new Error('SDK closed the stream')
      })(),
    }) })
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close())
    try {
      const result = await fetch('http://127.0.0.1:' + server.address().port + '/rc2/chat/completions', { method: 'POST',
        body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 1024, stream: true, messages: [] }) })
      await result.text()
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(existsSync(join(root, 'rc2.STOP')), !complete)
    const row = JSON.parse(readFileSync(join(root, 'requests.jsonl'), 'utf8'))
    assert.equal(row.usage.total, 12)
  }
})
test('clean EOF without a DONE marker stops further spending', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ar34-eof-'))
  writeFileSync(join(root, 'active.json'), JSON.stringify({ cohort: 'rc6', session: 'eof' }))
  const server = createGateway({ root, key: 'synthetic', fetchImpl: async () => new Response(
    'data: {"usage":{"prompt_tokens":20,"completion_tokens":1}}\n\n', { headers: { 'content-type': 'text/event-stream' } }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close())
  await (await fetch('http://127.0.0.1:' + server.address().port + '/rc6/chat/completions', { method: 'POST',
    body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 1024, stream: true, messages: [] }) })).text()
  assert.equal(existsSync(join(root, 'rc6.STOP')), true)
})
test('unreconciled crash reservations prevent new requests after restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ar34-wal-'))
  writeFileSync(join(root, 'inflight.json'), JSON.stringify({ id: '000001', cohort: 'rc2', reservedTokens: 8000, state: 'inflight' }))
  writeFileSync(join(root, 'active.json'), JSON.stringify({ cohort: 'alpha5', session: 'switch-after-crash' }))
  const before = readFileSync(join(root, 'inflight.json'), 'utf8')
  assert.throws(() => createGateway({ root, key: 'synthetic' }), /Unreconciled provider reservation/)
  assert.equal(existsSync(join(root, 'rc2.STOP')), true)
  assert.equal(readFileSync(join(root, 'inflight.json'), 'utf8'), before)
})
