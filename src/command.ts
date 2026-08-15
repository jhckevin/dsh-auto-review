import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

export const name = 'auto-review-command'
export const inject = ['actionReview', 'commands']

const SHA256 = /^[a-f0-9]{64}$/u

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
}
