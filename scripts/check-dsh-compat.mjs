import assert from 'node:assert/strict'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DSH_VERSION = '0.1.2-alpha.5'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const retired = new Set(['@deepseek-ai/dsh-client-runtime'])

/** Reject unsupported Node versions before importing the installed runtime. */
export function checkNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  assert(major > 24 || (major === 24 && minor >= 11), `NODE_VERSION: requires >=24.11, got ${version}`)
}

/** Inspect actual package files, including nested installations, not lockfile claims. */
export async function checkInstalledVersions(nodeModules = join(root, 'node_modules')) {
  const seen = new Set(), packages = []
  async function directory(path, required = false) {
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) }
    catch (error) { if (!required && error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryPath = join(path, entry.name)
      if (entry.name.startsWith('@')) { await directory(entryPath, true); continue }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const actual = await realpath(entryPath)
      if (seen.has(actual)) continue
      seen.add(actual)
      let metadata
      try { metadata = JSON.parse(await readFile(join(actual, 'package.json'), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (metadata.name?.startsWith('@deepseek-ai/dsh-')) {
        assert(!retired.has(metadata.name), `RETIRED_RUNTIME: ${metadata.name}`)
        assert.equal(metadata.version, DSH_VERSION, `DSH_VERSION: ${metadata.name} at ${actual}`)
        packages.push({ name: metadata.name, version: metadata.version, path: actual })
      }
      await directory(join(actual, 'node_modules'))
    }
  }
  await directory(nodeModules, true)
  assert(packages.length > 0, 'DSH_PACKAGES_MISSING')
  assert(packages.some(p => p.name === '@deepseek-ai/dsh-session-projection'), 'SESSION_PROJECTION_PACKAGE_MISSING')
  return packages
}

/** Missing required projection capability must stop the smoke before tool execution. */
export function requireSessionProjections(ctx) {
  assert(ctx.sessionProjections, 'SESSION_PROJECTIONS_MISSING: refusing to execute any tool')
}

/** Built-artifact smoke using the real Cordis/DSH services and an inert tool body. */
export async function checkActivatedPolicy() {
  const [{ Context }, { default: SystemPrompt }, { default: ToolRuntime, defineTool },
    { default: SessionStore, Session, SessionId, SessionSeq }, { default: SessionProjection },
    { default: SandboxPolicy }, { default: Approval }, { ToolCallId, createUserMessage },
    { default: ActionReview }, policy] = await Promise.all([
    import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-system-prompt'), import('@deepseek-ai/dsh-tools'),
    import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-session-projection'),
    import('@deepseek-ai/dsh-sandbox-policy'), import('@deepseek-ai/dsh-user-approval'), import('@deepseek-ai/dsh-llm'),
    import('../lib/service.js'), import('../lib/policy.js'),
  ])
  assert.equal(typeof Session.prototype.snapshotEvents, 'function', 'SESSION_SNAPSHOT_API_MISSING')
  assert.equal(typeof Session.prototype.eventAt, 'function', 'SESSION_EVENT_AT_API_MISSING')
  assert.equal(ToolCallId('compat'), 'compat')
  const ctx = new Context(), fibers = []
  let executions = 0, reviews = 0
  async function mount(plugin, config) {
    const fiber = await ctx.plugin(plugin, config)
    fibers.push(fiber)
    assert.equal(fiber.state, 2, 'PLUGIN_NOT_ACTIVE: expected Cordis FiberState.ACTIVE')
  }
  try {
    await mount(SystemPrompt)
    await mount(ToolRuntime)
    await mount(SessionStore)
    await mount(SessionProjection)
    requireSessionProjections(ctx)
    await mount(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root })
    await mount(Approval)
    await mount(ActionReview, { mode: 'enforcing', reviewFullAccess: true })
    await mount(policy, { hardDenyToolNames: ['compat-hard-deny'] })
    ctx.actionReview.registerReviewer({ id: 'compat-inert', review: async () => {
      reviews += 1
      return { schemaVersion: 1, outcome: 'denied', riskLevel: 'high', rationale: 'Compatibility fixture denial', policyRuleIds: ['COMPAT'], uncertainty: '' }
    } })
    for (const name of ['compat-review-deny', 'compat-hard-deny']) ctx.tools.register(defineTool({
      name, description: 'Inert compatibility fixture; never executes processes or writes files', parameters: {},
      output: { schema: { type: 'string' }, render: () => [] },
      async execute() { executions += 1; return 'INERT_BODY' },
    }))
    const session = ctx.sessions.create(SessionId('compat-real-session'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Do not perform either fixture action.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    assert.equal(session.eventAt(SessionSeq(0)).type, 'turn/start')
    assert.equal(session.snapshotEvents().length, 2)
    for (const name of ['compat-review-deny', 'compat-hard-deny']) {
      const result = await ctx.tools.execute({ agent: { session }, callId: ToolCallId(name), name, arguments: {}, signal: new AbortController().signal })
      assert.equal(result.isError, true, `POLICY_DID_NOT_DENY: ${name}`)
    }
    assert.equal(reviews, 1, 'REVIEWER_NOT_INVOKED_EXACTLY_ONCE')
    assert.equal(executions, 0, 'DENIED_BODY_EXECUTED')
    const metrics = ctx.actionReview.metrics(session.id)
    assert.equal(metrics.denied, 1)
    assert.equal(metrics.hardDenied, 1)
    return { activeFibers: fibers.length, reviews, executions, nativeBridge: 'NOT_TESTED', api: 'NOT_CALLED' }
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
}

export async function checkCompatibility() {
  checkNodeVersion()
  const packages = await checkInstalledVersions()
  const policy = await checkActivatedPolicy()
  return { status: 'PASS', dshVersion: DSH_VERSION, node: process.versions.node, installedPackages: packages.length, policy }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkCompatibility().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
