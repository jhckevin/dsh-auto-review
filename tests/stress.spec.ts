import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import ActionReviewRuntime from '../src/service.ts'
import type { ActionEnvelope } from '../src/types.ts'

function action(index: number): ActionEnvelope {
  const digest = index.toString(16).padStart(64, '0')
  return {
    schemaVersion: 1, actionId: `stress:${index}`, actionDigest: digest, effectDigest: digest,
    policyDigest: 'a'.repeat(64), boundaryDigest: 'b'.repeat(64), callId: CallId(`stress-${index}`),
    rootCallId: CallId(`stress-${index}`), toolName: 'bash', arguments: { command: `echo ${index}` },
    actionKind: 'process', disposition: 'review', reason: 'stress', resolverId: 'builtin',
    effects: [{ type: 'process.exec', commandDigest: digest }],
    policy: { mode: 'enforcing', sandboxDefaultAllow: false, resolverId: 'builtin', disposition: 'review', ruleIds: ['STRESS'] },
    boundary: { sandboxMode: 'workspace-write', workspaceRoot: '/workspace', realpathVerified: false },
    sandbox: { mode: 'workspace-write', workspaceRoot: '/workspace' }, paths: [],
    authority: { sessionId: `stress-session-${index % 8}`, turn: index + 1, transcript: [] },
  }
}

describe('production concurrency gate', () => {
  it('keeps 256 concurrent decisions isolated and the audit chain contiguous', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime, { denialConsecutiveLimit: 512, denialWindowSize: 512, denialWindowLimit: 512 })
    ctx.actionReview.registerReviewer({
      id: 'stress-fixture',
      review: async request => ({
        schemaVersion: 1, outcome: Number.parseInt(request.action.actionDigest.slice(-2), 16) % 7 === 0 ? 'denied' : 'approved',
        riskLevel: 'medium', userAuthorization: 'medium', rationale: 'deterministic stress decision',
        policyRuleIds: ['STRESS'], uncertainty: '',
      }),
    })
    await Promise.all(Array.from({ length: 256 }, (_, index) => (
      ctx.actionReview.review(action(index), undefined, new AbortController().signal)
    )))
    const records = ctx.actionReview.auditRecords()
    expect(records).toHaveLength(256)
    expect(new Set(records.map(record => { if (!('actionDigest' in record.data)) throw new Error('missing decision action'); return record.data.actionDigest })).size).toBe(256)
    for (let index = 1; index < records.length; index += 1) {
      expect(records[index]?.sequence).toBe((records[index - 1]?.sequence ?? 0) + 1)
      expect(records[index]?.previousDigest).toBe(records[index - 1]?.recordDigest)
    }
  })
})
