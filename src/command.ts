import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

export const name = 'auto-review-command'
export const inject = ['actionReview', 'commands']

const SHA256 = /^[a-f0-9]{64}$/u

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'approve',
    description: 'approve one re-review of the latest Auto Review denial',
    input: { hint: '[latest-action-digest]' },
    handler(invocation) {
      invocation.signal.throwIfAborted()
      const input = invocation.rawInput.trim()
      if (input.length > 0 && !SHA256.test(input)) {
        return {
          kind: 'error',
          text: 'Usage: /approve [latest-action-digest]. The optional digest must be 64 lowercase hexadecimal characters.',
        }
      }
      try {
        const digest = ctx.actionReview.armDeniedOverride(
          invocation.agent.session.id,
          input.length === 0 ? undefined : input,
        )
        return {
          kind: 'success',
          text: `Approved one re-review of exact action ${digest}. The next matching retry still passes Auto Review and all hard policy checks.`,
        }
      } catch (error) {
        return {
          kind: 'error',
          text: error instanceof Error ? error.message : 'Auto Review could not arm the exact-action approval.',
        }
      }
    },
  })

  ctx.commands.register({
    name: 'auto-review',
    description: 'show Auto Review safety funnel and lifecycle metrics for this session',
    handler(invocation) {
      invocation.signal.throwIfAborted()
      const metrics = ctx.actionReview.metrics(invocation.agent.session.id)
      return {
        kind: 'success',
        text: [
          'Auto Review session metrics',
          `Actions: ${metrics.totalActions} total; ${metrics.insideBoundary} inside boundary; ${metrics.autoReviewed} reviewed; ${metrics.hardDenied} hard-denied.`,
          `Review: ${metrics.approved} approved; ${metrics.denied} denied; ${metrics.manual} manual; ${metrics.unavailable} unavailable.`,
          `Execution: ${metrics.successfulActions} succeeded; ${metrics.failedActions} failed; ${metrics.ticketRejected} ticket rejections.`,
          `After denial: ${metrics.continuedWithDifferentAction} different-action candidates; ${metrics.retriedDeniedAction} exact retries; ${metrics.stoppedAfterDenial} stopped.`,
          `Rates: ${percent(metrics.approvalRate)} reviewer approval; ${percent(metrics.effectiveAutomationRate)} effective automation.`,
          `Reviewer latency: ${metrics.reviewerLatencyMs.count} samples; ${metrics.reviewerLatencyMs.mean.toFixed(1)} ms mean; ${metrics.reviewerLatencyMs.max.toFixed(1)} ms max.`,
        ].join('\n'),
      }
    },
  })
}
