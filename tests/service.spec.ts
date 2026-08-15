import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import ActionReviewRuntime from '../src/service.ts'
import type { ActionEnvelope, ActionReviewer } from '../src/types.ts'

const action: ActionEnvelope = Object.freeze({
  schemaVersion: 1,
  actionId: 'call:deadbeef',
  actionDigest: 'd'.repeat(64),
  policyDigest: 'e'.repeat(64),
  boundaryDigest: 'f'.repeat(64),
  callId: CallId('call'),
  rootCallId: CallId('call'),
  toolName: 'bash',
  arguments: { command: 'echo ok' },
  actionKind: 'process',
  disposition: 'review',
  reason: 'process',
  resolverId: 'builtin',
  effects: [{ type: 'process.exec', commandDigest: 'a'.repeat(64) }],
  policy: { mode: 'enforcing', resolverId: 'builtin', disposition: 'review', ruleIds: ['TEST'] },
  boundary: { sandboxMode: 'workspace-write', workspaceRoot: '/workspace', realpathVerified: false },
  sandbox: { mode: 'workspace-write', workspaceRoot: '/workspace' },
  paths: [],
  authority: { transcript: [] },
})

describe('ActionReviewRuntime', () => {
  it('fails closed when no reviewer is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    await expect(ctx.actionReview.review(action, undefined, new AbortController().signal))
      .resolves.toMatchObject({ outcome: 'unavailable', policyRuleIds: ['AR-FAIL-CLOSED'] })
  })

  it('owns one effect-scoped provider and uses its closed decision', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    const reviewer: ActionReviewer = {
      id: 'fixture',
      review: async () => ({
        schemaVersion: 1,
        outcome: 'denied',
        riskLevel: 'high',
        rationale: 'fixture denial',
        policyRuleIds: ['FIXTURE'],
        uncertainty: '',
      }),
    }
    const dispose = ctx.actionReview.registerReviewer(reviewer)
    await expect(ctx.actionReview.review(action, undefined, new AbortController().signal))
      .resolves.toMatchObject({ outcome: 'denied', rationale: 'fixture denial' })
    await dispose()
    await expect(ctx.actionReview.review(action, undefined, new AbortController().signal))
      .resolves.toMatchObject({ outcome: 'unavailable' })
  })

  it('records the recommendation but allows continuation in shadow mode', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime, { mode: 'shadow' })
    ctx.actionReview.registerReviewer({
      id: 'fixture',
      review: async () => ({
        schemaVersion: 1,
        outcome: 'denied',
        riskLevel: 'high',
        rationale: 'would deny',
        policyRuleIds: ['FIXTURE'],
        uncertainty: '',
      }),
    })
    await expect(ctx.actionReview.review(action, undefined, new AbortController().signal))
      .resolves.toMatchObject({ outcome: 'approved', policyRuleIds: ['FIXTURE', 'AR-SHADOW'] })
  })

  it('owns effect-scoped extension action semantics and rejects ambiguous claims', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    const dispose = ctx.actionReview.registerActionSemantics({
      id: 'fixture-extension',
      tools: {
        fixture_read: {
          actionKind: 'workspace-read',
          disposition: 'inside-boundary',
          reason: 'Fixture read is bounded by its capability provider.',
        },
      },
    })
    expect(ctx.actionReview.classificationFor('fixture_read')).toMatchObject({
      resolverId: 'fixture-extension',
      classification: { actionKind: 'workspace-read', disposition: 'inside-boundary' },
    })
    expect(() => ctx.actionReview.registerActionSemantics({
      id: 'conflict',
      tools: {
        fixture_read: {
          actionKind: 'extension-unknown',
          disposition: 'manual',
          reason: 'conflict',
        },
      },
    })).toThrow(/already claimed/)
    await dispose()
    expect(ctx.actionReview.classificationFor('fixture_read')).toBeUndefined()
  })

  it('owns one effect-scoped audit sink and preserves a hash-linked memory tail', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime, { auditMemoryLimit: 2 })
    const written: string[] = []
    const dispose = ctx.actionReview.registerAuditSink({
      id: 'fixture-audit',
      write: record => { written.push(record.recordDigest) },
    })
    const routed = {
      schemaVersion: 1 as const,
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      callId: action.callId,
      rootCallId: action.rootCallId,
      toolName: action.toolName,
      actionKind: action.actionKind,
      disposition: action.disposition,
      resolverId: action.resolverId,
      sandboxMode: action.sandbox.mode,
      pathCount: 0,
      routedAt: 1,
    }
    const first = ctx.actionReview.recordAudit('routed', routed, 's1')
    const second = ctx.actionReview.recordAudit('routed', { ...routed, routedAt: 2 }, 's1')
    ctx.actionReview.recordAudit('routed', { ...routed, routedAt: 3 }, 's2')
    expect(written).toHaveLength(3)
    expect(second.previousDigest).toBe(first.recordDigest)
    expect(ctx.actionReview.auditRecords()).toHaveLength(2)
    expect(ctx.actionReview.auditRecords('s1')).toHaveLength(1)
    expect(() => ctx.actionReview.registerAuditSink({ id: 'conflict', write: () => undefined })).toThrow(/already registered/)
    await dispose()
    expect(() => ctx.actionReview.registerAuditSink({ id: 'replacement', write: () => undefined })).not.toThrow()
  })

  it('issues an authenticated exact-action ticket and consumes it only once', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    const token = Symbol('ticket') as never
    const ticket = ctx.actionReview.issueTicket({ token, action, grant: 'auto-review' })
    expect(ticket).toMatchObject({
      actionDigest: action.actionDigest,
      policyDigest: action.policyDigest,
      boundaryDigest: action.boundaryDigest,
      grant: 'auto-review',
    })
    expect(ctx.actionReview.consumeTicket(token, action)).toBeUndefined()
    expect(ctx.actionReview.consumeTicket(token, action)).toMatch(/no execution ticket/)
    expect(ctx.actionReview.auditRecords().filter(record => record.kind === 'ticket').map(record => record.data.state))
      .toEqual(['issued', 'consumed'])
  })

  it('pauses automatic review after three consecutive denials in one turn', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
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
    const signal = new AbortController().signal
    await ctx.actionReview.review(action, undefined, signal)
    await ctx.actionReview.review(action, undefined, signal)
    await ctx.actionReview.review(action, undefined, signal)
    await expect(ctx.actionReview.review(action, undefined, signal)).resolves.toMatchObject({
      outcome: 'manual', policyRuleIds: ['AR-DENIAL-BREAKER'],
    })
    expect(ctx.actionReview.auditRecords().find(record => record.kind === 'breaker')?.data)
      .toMatchObject({ state: 'opened', reason: 'denial-rate', consecutiveDenials: 3 })
  })

  it('consumes one exact-action override and does not widen it to another digest', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    const scoped = { ...action, authority: { sessionId: 's1', turn: 2, transcript: [] } }
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
    await ctx.actionReview.review(scoped, undefined, new AbortController().signal)
    expect(ctx.actionReview.armDeniedOverride('s1', action.actionDigest)).toBe(action.actionDigest)
    expect(ctx.actionReview.consumeExactOverride(scoped)).toMatchObject({
      actionDigest: action.actionDigest, source: 'human-command',
    })
    expect(ctx.actionReview.consumeExactOverride(scoped)).toBeUndefined()
    ctx.actionReview.armDeniedOverride('s1', action.actionDigest)
    expect(ctx.actionReview.consumeExactOverride({ ...scoped, actionDigest: '0'.repeat(64) })).toBeUndefined()
  })

  it('records retry, different-action continuation, and turn-end stop after denials', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    ctx.actionReview.registerReviewer({
      id: 'deny-fixture',
      review: async () => ({
        schemaVersion: 1,
        outcome: 'denied',
        riskLevel: 'high',
        rationale: 'fixture denial',
        policyRuleIds: ['FIXTURE'],
        saferAlternative: 'Use a workspace-local read.',
        uncertainty: '',
      }),
    })
    const scoped = { ...action, authority: { sessionId: 'behavior', turn: 4, transcript: [] } }
    const signal = new AbortController().signal
    await ctx.actionReview.review(scoped, undefined, signal)
    ctx.actionReview.observeRoutedAction(scoped)
    ctx.actionReview.observeRoutedAction({ ...scoped, actionDigest: '0'.repeat(64) })
    await ctx.actionReview.review(scoped, undefined, signal)
    ctx.actionReview.observeTurnEnd('behavior', 4)
    expect(ctx.actionReview.auditRecords('behavior').filter(record => record.kind === 'postDenial').map(record => record.data))
      .toEqual([
        expect.objectContaining({ outcome: 'retried-denied-action', saferAlternativeSuggested: true }),
        expect.objectContaining({ outcome: 'continued-with-different-action', nextActionDigest: '0'.repeat(64) }),
        expect.objectContaining({ outcome: 'stopped-after-denial', saferAlternativeSuggested: true }),
      ])
  })

  it('folds the action funnel, execution outcomes, ticket failures, and post-denial behavior', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    const routed = {
      schemaVersion: 1 as const,
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      callId: action.callId,
      rootCallId: action.rootCallId,
      toolName: action.toolName,
      actionKind: action.actionKind,
      disposition: action.disposition,
      resolverId: action.resolverId,
      sandboxMode: action.sandbox.mode,
      pathCount: 0,
      routedAt: 1,
    }
    ctx.actionReview.recordAudit('routed', routed, 'metrics')
    ctx.actionReview.recordAudit('decision', {
      schemaVersion: 1,
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      toolName: action.toolName,
      actionKind: action.actionKind,
      disposition: action.disposition,
      turn: 1,
      mode: 'enforcing',
      reviewer: 'fixture',
      decision: { schemaVersion: 1, outcome: 'denied', riskLevel: 'high', rationale: 'no', policyRuleIds: ['X'], uncertainty: '' },
      startedAt: 10,
      finishedAt: 25,
      latencyMs: 15,
    }, 'metrics')
    ctx.actionReview.recordAudit('postDenial', {
      outcome: 'stopped-after-denial', deniedActionDigest: action.actionDigest, turn: 1,
      saferAlternativeSuggested: false, at: 30,
    }, 'metrics')
    expect(ctx.actionReview.metrics('metrics')).toMatchObject({
      totalActions: 1,
      autoReviewed: 1,
      approved: 0,
      denied: 1,
      stoppedAfterDenial: 1,
      approvalRate: 0,
      effectiveAutomationRate: 0,
      reviewerLatencyMs: { count: 1, mean: 15, max: 15 },
      byActionKind: { process: 1 },
    })
  })
})
