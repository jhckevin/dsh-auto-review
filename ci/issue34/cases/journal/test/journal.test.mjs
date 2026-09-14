import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openJournal } from '../src/journal.mjs'
const directory = () => mkdtemp(join(tmpdir(), 'journal-public-'))
test('commit, clone and reopen', async () => {
  const path=await directory(); let db=await openJournal(path)
  const value={nested:[1,2]}; assert.equal(await db.set('x',value),1); value.nested.push(3)
  assert.deepEqual(await db.get('x'),{nested:[1,2]}); await db.close()
  db=await openJournal(path); assert.equal(db.revision,1); assert.deepEqual(await db.get('x'),{nested:[1,2]}); await db.close()
})
test('batch atomicity and queue recovery', async () => {
  const db=await openJournal(await directory())
  await assert.rejects(db.batch([{type:'set',key:'valid',value:1},{type:'set',key:'',value:2}]))
  assert.equal(await db.get('valid'),undefined); assert.equal(db.revision,0)
  assert.equal(await db.set('valid',3),1); await db.close()
})
test('idempotency survives snapshots', async () => {
  const path=await directory(); let db=await openJournal(path)
  assert.equal(await db.set('a',1,{opId:'request-1'}),1)
  assert.equal(await db.set('a',1,{opId:'request-1'}),1)
  await db.snapshot(); await db.close(); db=await openJournal(path)
  assert.equal(await db.set('a',1,{opId:'request-1'}),1)
  await assert.rejects(db.set('a',2,{opId:'request-1'})); await db.close()
})
test('parallel writes produce unique consecutive revisions', async () => {
  const db=await openJournal(await directory())
  const revisions=await Promise.all(Array.from({length:40},(_,i)=>db.set('k'+i,i)))
  assert.deepEqual(revisions,Array.from({length:40},(_,i)=>i+1)); assert.equal((await db.keys()).length,40); await db.close()
})
test('ignored crash tail must not damage subsequent appends', async () => {
  const path=await directory(); let db=await openJournal(path)
  await db.set('before',1); await db.close()
  await appendFile(join(path,'journal.jsonl'),'{"partial":')
  db=await openJournal(path); assert.equal(await db.get('before'),1); await db.set('after',2); await db.close()
  db=await openJournal(path); assert.equal(await db.get('after'),2); await db.close()
})
test('special keys and detached reads', async () => {
  const db=await openJournal(await directory())
  await db.set('__proto__',{safe:true}); await db.set('constructor',2)
  const value=await db.get('__proto__'); value.safe=false
  assert.deepEqual(await db.get('__proto__'),{safe:true}); assert.deepEqual(await db.keys(),['__proto__','constructor']); await db.close()
})
test('closed instances reject future operations', async () => {
  const db=await openJournal(await directory()); await db.close(); await db.close()
  await assert.rejects(db.set('x',1)); await assert.rejects(db.get('x'))
})
