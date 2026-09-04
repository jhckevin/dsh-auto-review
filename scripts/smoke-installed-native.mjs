import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function smokeInstalledNative(installRoot) {
  const require = createRequire(join(resolve(installRoot), 'package.json'))
  const entry = require.resolve('@jhckevin/dsh-auto-review-bridge-host')
  const { createCodexApprovalBridge } = await import(pathToFileURL(entry))
  const bridge = createCodexApprovalBridge()
  const session = bridge.createSession()
  try {
    const result = await bridge.request(
      session,
      'parse_core_review_decision',
      JSON.stringify('approved'),
      { signal: AbortSignal.timeout(15_000) },
    )
    assert.equal(result.canonicalWire, '"approved"')
    assert.equal(result.ir.schemaVersion, 1)
    return {
      status: 'PASS',
      canonicalWire: result.canonicalWire,
      irSchemaVersion: result.ir.schemaVersion,
    }
  } finally {
    await bridge.closeSession(session)
    await bridge.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const installRoot = process.argv[2]
  assert(installRoot, 'usage: node scripts/smoke-installed-native.mjs <install-root>')
  console.log(JSON.stringify(await smokeInstalledNative(installRoot)))
}
