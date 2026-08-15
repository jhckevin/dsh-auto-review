import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import ActionReviewRuntime from '../src/service.ts'
import type { ActionEnvelope, ActionReviewer } from '../src/types.ts'

const action: ActionEnvelope = Object.freeze({
  schemaVersion: 1,
  actionId: 'call:deadbeef',
  actionDigest: 'd'.repeat(64),
  callId: CallId('call'),
  rootCallId: CallId('call'),
  toolName: 'bash',
  arguments: { command: 'echo ok' },
  actionKind: 'process',
  disposition: 'review',
  reason: 'process',
  resolverId: 'builtin',
  sandbox: { mode: 'workspace-write', workspaceRoot: '/workspace' },
  paths: [],
  authority: {},
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
})
