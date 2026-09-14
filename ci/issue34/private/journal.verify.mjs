import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = process.env.TARGET_ROOT || '/solution'
const { openJournal } = await import(pathToFileURL(join(root, 'src/journal.mjs')))
const fresh = () => mkdtemp(join(tmpdir(), 'journal-independent-'))
test('invalid JSON values and batches preserve the committed state', async () => {
  const db = await openJournal(await fresh())
  await db.set('original', { ok: true })
  const cyclic = {}; cyclic.self = cyclic
  for (const value of [undefined, NaN, Infinity, () => 1, Symbol('x'), cyclic, new Date(), { x: undefined }]) {
    await assert.rejects(db.set('bad', value))
    assert.equal(db.revision, 1)
  }
  await assert.rejects(db.batch([{ type: 'delete', key: 'original' }, { type: 'set', key: 'bad', value: NaN }]))
  assert.deepEqual(await db.get('original'), { ok: true })
  await db.set('after', 2); assert.equal(db.revision, 2); await db.close()
})
test('key boundaries and special keys are ordinary data', async () => {
  const db = await openJournal(await fresh())
  for (const key of ['', 'x'.repeat(257), null, 3]) await assert.rejects(db.set(key, 1))
  for (const key of ['__proto__', 'constructor', 'toString', 'x'.repeat(256)]) await db.set(key, key)
  assert.equal(await db.get('__proto__'), '__proto__')
  assert.deepEqual(await db.keys({ prefix: 'con' }), ['constructor']); await db.close()
})
test('read after queued mutations is serialized and values stay detached', async () => {
  const db = await openJournal(await fresh())
  const values = Array.from({ length: 60 }, (_, n) => db.set('k' + n, { n }))
  const observed = db.get('k59')
  assert.deepEqual(await observed, { n: 59 })
  assert.deepEqual(await Promise.all(values), Array.from({ length: 60 }, (_, n) => n + 1))
  const x = await db.get('k59'); x.n = -1; assert.deepEqual(await db.get('k59'), { n: 59 }); await db.close()
})
test('snapshot, new commits and original idempotency survive two restarts', async () => {
  const path = await fresh(); let db = await openJournal(path)
  await db.batch([{ type: 'set', key: 'a', value: 1 }, { type: 'set', key: 'b', value: 2 }], { opId: 'batch-1' })
  await db.snapshot(); await db.set('c', 3); await db.close()
  db = await openJournal(path); assert.equal(db.revision, 2)
  assert.equal(await db.batch([{ type: 'set', key: 'a', value: 1 }, { type: 'set', key: 'b', value: 2 }], { opId: 'batch-1' }), 1)
  await assert.rejects(db.set('a', 9, { opId: 'batch-1' }))
  await db.delete('b', { opId: 'delete-b' }); await db.snapshot(); await db.close()
  db = await openJournal(path); assert.equal(await db.delete('b', { opId: 'delete-b' }), 3)
  assert.deepEqual(await db.keys(), ['a', 'c']); assert.equal(await db.get('b'), undefined); await db.close()
})
test('incomplete tail is repaired before subsequent durable append', async () => {
  const path = await fresh(); let db = await openJournal(path); await db.set('before', 'kept'); await db.close()
  await appendFile(join(path, 'journal.jsonl'), '{"crash":')
  db = await openJournal(path); await db.set('after', 'also-kept'); await db.close()
  db = await openJournal(path); assert.equal(await db.get('before'), 'kept'); assert.equal(await db.get('after'), 'also-kept'); await db.close()
})
test('malformed complete lines and tampered checksums reject recovery', async () => {
  const path = await fresh(); const db = await openJournal(path); await db.set('a', 'ORIGINAL_SENTINEL'); await db.close()
  const file = join(path, 'journal.jsonl'), raw = await readFile(file, 'utf8')
  assert.ok(raw.includes('ORIGINAL_SENTINEL'))
  await writeFile(file, raw.replace('ORIGINAL_SENTINEL', 'MODIFIED_SENTINEL'))
  await assert.rejects(openJournal(path))
  await writeFile(file, raw + 'not-json\n'); await assert.rejects(openJournal(path))
})
test('close drains writes and rejects all subsequent API operations', async () => {
  const path = await fresh(); const db = await openJournal(path)
  const writes = Array.from({ length: 10 }, (_, n) => db.set(String(n), n))
  await db.close(); await Promise.all(writes); await db.close()
  await assert.rejects(db.get('0')); await assert.rejects(db.keys()); await assert.rejects(db.snapshot())
  const reopened = await openJournal(path); assert.equal(reopened.revision, 10); await reopened.close()
})
test('CLI success and invalid-input exit codes are deterministic', async () => {
  const path = await fresh()
  const run = (...args) => spawnSync(process.execPath, [join(root, 'cli.mjs'), '--db', path, ...args], { encoding: 'utf8', timeout: 5000 })
  assert.equal(run('set', 'q', '{"x":3}').status, 0)
  const got = run('get', 'q'); assert.equal(got.status, 0); assert.deepEqual(JSON.parse(got.stdout), { x: 3 })
  assert.deepEqual(JSON.parse(run('list').stdout), ['q'])
  assert.equal(run('delete', 'q').status, 0); assert.equal(JSON.parse(run('get', 'q').stdout), null)
  for (const args of [['unknown'], ['set', 'q', 'invalid-json'], ['get'], ['set', 'q']]) assert.equal(run(...args).status, 2)
})
