import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { checkNodeVersion, checkInstalledVersions, requireSessionProjections, checkActivatedPolicy, DSH_VERSION } from './check-dsh-compat.mjs'

async function installation(entries, run) {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-compat-fixture-'))
  try {
    const nodeModules = join(temporary, 'node_modules')
    await mkdir(nodeModules)
    for (const [relativePath, name, version] of entries) {
      const path = join(nodeModules, relativePath)
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'package.json'), JSON.stringify({ name, version }))
    }
    await run(nodeModules)
  } finally {
    // Only the uniquely created test-owned directory is removed.
    await rm(temporary, { recursive: true, force: true })
  }
}
const projection = ['@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-session-projection', DSH_VERSION]

test('rejects Node below the alpha.5 deployment floor', () => {
  assert.throws(() => checkNodeVersion('24.8.0'), /NODE_VERSION/)
  assert.throws(() => checkNodeVersion('22.20.0'), /NODE_VERSION/)
  checkNodeVersion('24.11.0')
})

test('accepts an exact installed version set', async () => {
  await installation([projection, ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tools', DSH_VERSION]], async path => {
    assert.equal((await checkInstalledVersions(path)).length, 2)
  })
})

test('rejects a nested mixed version even when root packages match', async () => {
  await installation([projection, ['parent', 'fixture-parent', '1.0.0'], ['parent/node_modules/@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session', '0.1.0-rc.6']], async path => {
    await assert.rejects(checkInstalledVersions(path), /DSH_VERSION/)
  })
})

test('rejects old client-runtime even if its version number matches', async () => {
  await installation([projection, ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-runtime', DSH_VERSION]], async path => {
    await assert.rejects(checkInstalledVersions(path), /RETIRED_RUNTIME/)
  })
})

test('rejects a missing projection package before runtime activation', async () => {
  await installation([['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session', DSH_VERSION]], async path => {
    await assert.rejects(checkInstalledVersions(path), /SESSION_PROJECTION_PACKAGE_MISSING/)
  })
})

test('rejects a real Context without sessionProjections before mounting or running any tool', async () => {
  const ctx = new Context()
  const fiber = await ctx.plugin(SessionStore)
  try { assert.throws(() => requireSessionProjections(ctx), /SESSION_PROJECTIONS_MISSING/) }
  finally { await fiber.dispose() }
})

test('activates real built policy and blocks both inert tool bodies', async () => {
  assert.deepEqual(await checkActivatedPolicy(), { activeFibers: 8, reviews: 1, executions: 0, nativeBridge: 'NOT_TESTED', api: 'NOT_CALLED' })
})
