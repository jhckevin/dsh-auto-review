import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import ActionReviewRuntime from '../src/service.ts'

describe('reviewer session identity boundary', () => {
  it('bypasses recursion only for the exact runtime object and revokes the mark', async () => {
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    const reviewer = { id: 'same-id' } as Session
    const forged = { id: 'same-id' } as Session
    const revoke = ctx.actionReview.registerReviewerSession(reviewer)
    expect(ctx.actionReview.isReviewerSession(reviewer)).toBe(true)
    expect(ctx.actionReview.isReviewerSession(forged)).toBe(false)
    revoke()
    expect(ctx.actionReview.isReviewerSession(reviewer)).toBe(false)
  })
})
