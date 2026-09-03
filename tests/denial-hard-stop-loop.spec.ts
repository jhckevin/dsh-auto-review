import { expect, it } from 'vitest'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import ActionReviewRuntime from '../src/service.ts'
import { apply, inject } from '../src/policy.ts'
import { isAutoReviewInterruption } from '../src/denial-breaker.ts'
import type { ReviewDecision, ActionReviewerRequest } from '../src/types.ts'

// Real DSH scheduling/cancellation; only the model and reviewer answers are scripted.
// No network, shell, private session or native binary is used by these fixtures.
class ScriptAdapter extends LlmAdapter {
  requests = 0
  constructor(private readonly plans: string[][]) { super() }
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const calls = this.plans[this.requests++] ?? []
    for (const [index, command] of calls.entries()) {
      const id = CallId(`model-${this.requests}-${index}`)
      const args = JSON.stringify({ command })
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index, id, name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'bash', arguments: args } }
    }
    if (!calls.length) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Finished safe fixture.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Finished safe fixture.' } }
    }
    yield { type: 'finish', reason: { kind: calls.length ? 'tool-calls' : 'stop' } }
  }
}
const decision = (outcome: 'approved' | 'denied'): ReviewDecision => ({ schemaVersion: 1, outcome, riskLevel: 'medium', rationale: 'Scripted fixture decision', policyRuleIds: ['FIXTURE'], uncertainty: '' })
async function fixture(plans: string[][], review: (request: ActionReviewerRequest) => Promise<ReviewDecision>, body?: (command: string, exec: ToolExecution) => Promise<string>, useDefaultThreshold = false) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 4 })
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: '/workspace' })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(ActionReviewRuntime, useDefaultThreshold ? { mode: 'enforcing' } : { mode: 'enforcing', denialConsecutiveLimit: 2, denialWindowSize: 4, denialWindowLimit: 2 })
  await ctx.plugin({ apply, inject })
  ctx.actionReview.registerReviewer({ id: 'scripted-reviewer', review })
  const executed: string[] = []
  ctx.tools.register(defineTool({ name: 'bash', description: 'Inert test marker, never runs a command', parameters: { command: { type: 'string' } },
    isConcurrencySafe: () => true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) { const command = String((args as { command: string }).command); executed.push(command); return body ? body(command, exec) : 'inert marker' },
  }))
  const adapter = new ScriptAdapter(plans)
  ctx.llm.registerAdapter(['fixture'], adapter)
  const handle = await ctx.agents.create({ sessionId: SessionId('denial-loop-fixture'), meta: { cwd: '/workspace' }, agentOptions: { provider: 'fixture', model: 'script' } })
  const send = () => handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Perform the fixture task.' }], source: { kind: 'user' } }))
  return { ctx, adapter, handle, executed, send }
}

it('real loop trips on two denials, persists hook end, stops model replenishment and permits a new user turn', async () => {
  let reviews = 0
  const f = await fixture([['echo denied-a'], ['echo denied-b'], ['echo safe-new-turn'], []], async () => decision(++reviews <= 2 ? 'denied' : 'approved'))
  try {
    f.send(); await f.handle.agent.whenIdle()
    expect(f.adapter.requests).toBe(2)
    expect(f.executed).toEqual([])
    const end = f.handle.agent.session.events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && isAutoReviewInterruption(end.data.reason)).toBe(true)
    f.send(); await f.handle.agent.whenIdle()
    expect(f.adapter.requests).toBe(4)
    expect(f.executed).toEqual(['echo safe-new-turn'])
    const ends = f.handle.agent.session.events.filter(e => e.type === 'turn/end')
    expect(ends).toHaveLength(2)
    expect(ends[1]?.data.reason).toMatchObject({ kind: 'completed' })
  } finally { await f.handle.dispose() }
}, 10000)

it('a real concurrent tools pipeline cannot use a late approval after native turn cancellation or cancel replacement work', async () => {
  const late = Promise.withResolvers<ReviewDecision>()
  const requested = Promise.withResolvers<void>()
  let lateCall: Promise<unknown> | undefined
  let lateSignal: AbortSignal | undefined
  const f = await fixture([['echo running', 'echo denied-a', 'echo denied-b'], ['echo safe-new-turn'], []], async request => {
    const command = (request.action.arguments as { command: string }).command
    if (command === 'echo late') { lateSignal = request.signal; requested.resolve(); return late.promise }
    return decision(command === 'echo running' || command === 'echo safe-new-turn' ? 'approved' : 'denied')
  }, async (command, exec) => {
    if (command !== 'echo running') return 'safe'
    // Launch a genuine second pipeline under the same real agent/turn signal.
    if (exec.agent === undefined) throw new Error('Real agent required')
    lateCall = f.ctx.tools.execute({ callId: CallId('late-pipeline'), name: 'bash', arguments: { command: 'echo late' }, agent: exec.agent, signal: exec.signal })
    await requested.promise
    await new Promise<void>(resolve => { if (exec.signal.aborted) resolve(); else exec.signal.addEventListener('abort', () => resolve(), { once: true }) })
    return 'stopped'
  })
  try {
    f.send(); await f.handle.agent.whenIdle()
    expect(lateSignal?.aborted).toBe(true)
    expect(f.adapter.requests).toBe(1)
    // New explicit input is allowed, while the old reviewer completion is outstanding.
    f.send(); await f.handle.agent.whenIdle()
    late.resolve(decision('approved'))
    await lateCall
    expect(f.executed).toEqual(['echo running', 'echo safe-new-turn'])
    expect(f.adapter.requests).toBe(3)
    const ends = f.handle.agent.session.events.filter(e => e.type === 'turn/end')
    expect(ends).toHaveLength(2)
    expect(ends[1]?.data.reason).toMatchObject({ kind: 'completed' })
  } finally { late.resolve(decision('approved')); await lateCall; await f.handle.dispose() }
}, 10000)

it('real parallel scheduler aborts a started cooperative tool and never dispatches a queued sibling after the trip', async () => {
  let observedAbort = false
  const entered = Promise.withResolvers<void>()
  const f = await fixture([['echo running', 'echo denied-a', 'echo denied-b', 'echo never-dispatched']], async request => {
    if ((request.action.arguments as { command: string }).command === 'echo running') return decision('approved')
    await entered.promise
    return decision('denied')
  }, async (_command, exec) => {
    entered.resolve()
    await new Promise<void>(resolve => { if (exec.signal.aborted) resolve(); else exec.signal.addEventListener('abort', () => { observedAbort = true; resolve() }, { once: true }) })
    return 'cooperatively stopped'
  })
  try {
    f.send(); await f.handle.agent.whenIdle()
    expect(observedAbort).toBe(true)
    expect(f.adapter.requests).toBe(1)
    expect(f.executed).toEqual(['echo running'])
    const events = f.handle.agent.session.events
    expect(events.filter(e => e.type === 'tool/call')).toHaveLength(4)
    expect(events.filter(e => e.type === 'tool/result')).toHaveLength(4)
    const end = events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && isAutoReviewInterruption(end.data.reason)).toBe(true)
  } finally { await f.handle.dispose() }
}, 10000)

it('the actual default consecutive threshold stops the real loop on denial three, not before or after', async () => {
  let reviewed = 0
  const f = await fixture([['echo first'], ['echo second'], ['echo third'], ['echo forbidden-fourth']], async () => { reviewed++; return decision('denied') }, undefined, true)
  try {
    expect(f.ctx.actionReview.config.denialConsecutiveLimit).toBe(3)
    f.send(); await f.handle.agent.whenIdle()
    expect(reviewed).toBe(3)
    expect(f.adapter.requests).toBe(3)
    expect(f.executed).toEqual([])
    const end = f.handle.agent.session.events.findLast(e => e.type === 'turn/end')
    expect(end?.type === 'turn/end' && isAutoReviewInterruption(end.data.reason)).toBe(true)
    const evidenceDir = process.env.AR_LOOP_EVIDENCE_DIR
    if (evidenceDir !== undefined) {
      expect(isAbsolute(evidenceDir)).toBe(true)
      mkdirSync(evidenceDir, { recursive: true })
      expect(realpathSync(evidenceDir)).toBe(evidenceDir)
      // Export actual session output only after the complete behavioral assertions.
      // Exclusive writes retain earlier evidence rather than silently replacing it.
      writeFileSync(join(evidenceDir, 'loop-event.json'), JSON.stringify({ end }, null, 2) + '\n', { flag: 'wx' })
      writeFileSync(join(evidenceDir, 'loop-receipt.json'), JSON.stringify({
        scope: 'real DSH AgentLoop with scripted model/reviewer; no real API',
        realApi: false, modelRequests: f.adapter.requests, reviews: reviewed,
        executed: f.executed.length, threshold: f.ctx.actionReview.config.denialConsecutiveLimit,
        agentStatus: f.handle.agent.status, endSeq: end?.seq,
        interrupted: end?.type === 'turn/end' && isAutoReviewInterruption(end.data.reason),
      }, null, 2) + '\n', { flag: 'wx' })
    }
  } finally { await f.handle.dispose() }
}, 10000)
