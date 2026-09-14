// Installed-host integration test. Real DSH Loop; deterministic model/reviewer.
// Tool bodies are inert markers. No shell command, network or paid model call.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const requireHost = createRequire('/opt/cli/lib/node_modules/@deepseek-ai/dsh/package.json')
const host = name => import(pathToFileURL(requireHost.resolve('@deepseek-ai/' + name)))
const base = '/work/user/.dsh/profiles/web/node_modules/@jhckevin/dsh-auto-review/lib/'
const { Context } = await host('cordis')
const { default: LlmRuntime, LlmAdapter, createUserMessage } = await host('dsh-llm')
const { default: SessionStore, SessionId, Session } = await host('dsh-session')
const { default: ToolRuntime, defineTool } = await host('dsh-tools')
const { default: Agents } = await host('dsh-agent')
const { default: Loop } = await host('dsh-agent-loop')
const { default: SystemPrompt } = await host('dsh-system-prompt')
const { default: SandboxPolicy } = await host('dsh-sandbox-policy')
const { default: Approval } = await host('dsh-user-approval')
const { default: ReviewRuntime } = await import(base + 'service.js')
const policy = await import(base + 'policy.js')
const { snapshotSessionEvents } = await import(base + 'dsh-compat.js')
const { isAutoReviewInterruption } = await import(base + 'denial-breaker.js')
class Adapter extends LlmAdapter {
  requests = 0
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream() {
    const n = ++this.requests
    if (n <= 4) {
      const id = 'controlled-' + n
      const args = JSON.stringify({ command: 'echo ' + (n <= 3 ? 'denied-' + n : 'safe-new-turn') })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'bash', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Safe new turn complete.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Safe new turn complete.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
const output = '/results/loop'
mkdirSync(output, { recursive: true })
let handle
try {
  const ctx = new Context()
  for (const plugin of [LlmRuntime, SessionStore]) await ctx.plugin(plugin)
  if (typeof Session.prototype.snapshotEvents === 'function') await ctx.plugin((await host('dsh-session-projection')).default)
  for (const plugin of [SystemPrompt, ToolRuntime, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [], maxParallelToolCalls: 4 })
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: '/work/loop' })
  await ctx.plugin(Approval)
  await ctx.plugin(ReviewRuntime, { mode: 'enforcing' })
  await ctx.plugin({ apply: policy.apply, inject: policy.inject })
  let reviews = 0
  ctx.actionReview.registerReviewer({ id: 'controlled-no-paid-reviewer', async review() {
    const outcome = ++reviews <= 3 ? 'denied' : 'approved'
    return { schemaVersion: 1, outcome, riskLevel: 'medium', rationale: 'Controlled cancellation test', policyRuleIds: ['FIXTURE'], uncertainty: '' }
  } })
  const executed = []
  ctx.tools.register(defineTool({ name: 'bash', description: 'Inert marker only',
    parameters: { command: { type: 'string' } }, isConcurrencySafe: () => true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { executed.push(args.command); return 'safe inert marker' },
  }))
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  handle = await ctx.agents.create({ sessionId: SessionId('installed-denial-recovery'), meta: { cwd: '/work/loop' }, agentOptions: { provider: 'fixture', model: 'script' } })
  const send = () => handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Perform the inert fixture task.' }], source: { kind: 'user' } }))
  send(); await handle.agent.whenIdle()
  assert.equal(reviews, 3)
  assert.equal(adapter.requests, 3)
  assert.deepEqual(executed, [])
  const first = snapshotSessionEvents(handle.agent.session).findLast(e => e.type === 'turn/end')
  assert.ok(isAutoReviewInterruption(first.data.reason))
  send(); await handle.agent.whenIdle()
  assert.equal(adapter.requests, 5)
  assert.deepEqual(executed, ['echo safe-new-turn'])
  const events = snapshotSessionEvents(handle.agent.session)
  const ends = events.filter(e => e.type === 'turn/end')
  assert.equal(ends.length, 2)
  assert.equal(ends[1].data.reason.kind, 'completed')
  writeFileSync(output + '/events.json', JSON.stringify(events, null, 2))
  writeFileSync(output + '/result.json', JSON.stringify({ pass: true, reviews, modelRequests: adapter.requests,
    paidTokens: 0, thirdDenialAborted: true, fourthOldTurnRequestAbsent: true,
    deniedToolsExecuted: 0, nextTurnRecovered: true, executed, hostVersion: requireHost('./package.json').version }, null, 2))
  console.log('INSTALLED_LOOP_COMPLETE')
} catch (error) { writeFileSync(output + '/FAILED', String(error)); console.error(error); process.exitCode = 1 }
finally { if (handle) await handle.dispose() }
