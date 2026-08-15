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
  sandbox: { mode: 'workspace-write', workspaceRoot: '/workspace' },
  paths: [],
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
})
