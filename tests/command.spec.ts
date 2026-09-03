import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { apply as applyCommand } from '../src/command.ts'
import ActionReviewRuntime from '../src/service.ts'
import type { ActionEnvelope } from '../src/types.ts'

function stubAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {}, followup: () => {}, steer: () => {}, inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function action(sessionId: string): ActionEnvelope {
  return Object.freeze<ActionEnvelope>({
    schemaVersion: 1,
    actionId: 'call:deadbeef',
    actionDigest: 'd'.repeat(64),
    effectDigest: 'd'.repeat(64),
    policyDigest: 'e'.repeat(64),
    boundaryDigest: 'f'.repeat(64),
    callId: ToolCallId('call'),
    rootCallId: ToolCallId('call'),
    toolName: 'bash',
    arguments: { command: 'echo ok' },
    actionKind: 'process',
    disposition: 'review',
    reason: 'process',
    resolverId: 'builtin',
    effects: [{ type: 'process.exec', commandDigest: 'a'.repeat(64) }],
    policy: { mode: 'enforcing', sandboxDefaultAllow: true, resolverId: 'builtin', disposition: 'review', ruleIds: ['TEST'] },
    boundary: { sandboxMode: 'workspace-write', workspaceRoot: '/workspace', realpathVerified: false },
    sandbox: { mode: 'workspace-write', workspaceRoot: '/workspace' },
    paths: [],
    authority: { sessionId, turn: 1, transcript: [] },
  })
}

async function harness(id: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ActionReviewRuntime)
  applyCommand(ctx)
  const agent = stubAgent(ctx, id)
  ctx.agents.register(agent)
  return { ctx, agent }
}

describe('/approve exact-action command', () => {
  it('arms one matching retry only after a real denial', async () => {
    const { ctx, agent } = await harness('approve-session')
    ctx.actionReview.registerReviewer({
      id: 'deny-fixture',
      review: async () => ({
        schemaVersion: 1,
        outcome: 'denied',
        riskLevel: 'high',
        rationale: 'fixture denial',
        policyRuleIds: ['FIXTURE'],
        uncertainty: '',
      }),
    })
    const deniedAction = action(agent.session.id)
    await ctx.actionReview.review(deniedAction, agent.session, new AbortController().signal)
    const execution = await ctx.commands.execute(
      agent,
      `/approve ${deniedAction.actionDigest}`,
      [], new AbortController().signal,
    )
    expect(execution?.result).toMatchObject({ kind: 'success' })
    expect(execution?.result.text).toContain('still passes Auto Review')
    expect(ctx.actionReview.consumeExactOverride(deniedAction)).toMatchObject({
      actionDigest: deniedAction.actionDigest,
      source: 'human-command',
    })
    expect(ctx.actionReview.consumeExactOverride(deniedAction)).toBeUndefined()
    expect(agent.session.snapshotEvents().map(event => event.type)).toContain('command/run')
    expect(agent.session.snapshotEvents().map(event => event.type)).toContain('command/done')
  })

  it('rejects missing history and a digest that differs from the latest denial', async () => {
    const empty = await harness('empty-session')
    await expect(empty.ctx.commands.execute(
      empty.agent, '/approve', [], new AbortController().signal,
    )).resolves.toMatchObject({ result: { kind: 'error' } })

    const test = await harness('mismatch-session')
    test.ctx.actionReview.registerReviewer({
      id: 'deny-fixture',
      review: async () => ({
        schemaVersion: 1, outcome: 'denied', riskLevel: 'high', rationale: 'no', policyRuleIds: ['X'], uncertainty: '',
      }),
    })
    const deniedAction = action(test.agent.session.id)
    await test.ctx.actionReview.review(deniedAction, test.agent.session, new AbortController().signal)
    await expect(test.ctx.commands.execute(
      test.agent, `/approve ${'0'.repeat(64)}`, [], new AbortController().signal,
    )).resolves.toMatchObject({ result: { kind: 'error', text: expect.stringContaining('does not match') } })
  })
})

describe('/auto-review metrics command', () => {
  it('reports the native per-session safety funnel', async () => {
    const { ctx, agent } = await harness('metrics-session')
    const reviewedAction = action(agent.session.id)
    ctx.actionReview.recordAudit('routed', {
      schemaVersion: 1,
      actionId: reviewedAction.actionId,
      actionDigest: reviewedAction.actionDigest,
      callId: reviewedAction.callId,
      rootCallId: reviewedAction.rootCallId,
      toolName: reviewedAction.toolName,
      actionKind: reviewedAction.actionKind,
      disposition: reviewedAction.disposition,
      resolverId: reviewedAction.resolverId,
      sandboxMode: reviewedAction.sandbox.mode,
      pathCount: reviewedAction.paths.length,
      routedAt: 10,
    }, agent.session.id)
    ctx.actionReview.registerReviewer({
      id: 'approve-fixture',
      review: async () => ({
        schemaVersion: 1, outcome: 'approved', riskLevel: 'low', rationale: 'bounded', policyRuleIds: ['FIXTURE'], uncertainty: '',
      }),
    })
    await ctx.actionReview.review(reviewedAction, agent.session, new AbortController().signal)

    const execution = await ctx.commands.execute(agent, '/auto-review', [], new AbortController().signal)
    expect(execution?.result).toMatchObject({ kind: 'success' })
    expect(execution?.result.text).toContain('1 total; 0 inside boundary; 1 reviewed')
    expect(execution?.result.text).toContain('1 approved; 0 denied')
    expect(execution?.result.text).toContain('100.0% reviewer approval')
  })
})
