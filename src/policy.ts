import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { ActionRouter } from './router.ts'
import type { RouterConfig } from './types.ts'

export const name = 'auto-review-policy'
export const inject = ['actionReview', 'tools', 'sandboxPolicy']

export const Config: z<RouterConfig> = z.object({
  unknownTool: z.union(['review', 'manual'] as const).default('manual'),
  allowWorkspaceReads: z.boolean().default(true),
  allowWorkspaceWrites: z.boolean().default(true),
  productionMarkers: z.array(z.string()),
  sensitiveMarkers: z.array(z.string()),
  hardDenyToolNames: z.array(z.string()),
})

function askReason(action: ReturnType<ActionRouter['route']>, prefix: string): string {
  const alternative = action.disposition === 'manual'
    ? ' A human decision is required because this extension has no registered action semantics.'
    : ''
  return `${prefix}: ${action.reason}${alternative}`
}

export function apply(ctx: Context, config: RouterConfig = {}): void {
  const router = new ActionRouter(config)

  ctx.tools.guard((exec) => {
    const session = exec.agent?.session
    const sandbox = ctx.sandboxPolicy.resolve(session === undefined ? {} : { session })
    const action = router.route(exec, sandbox)
    return ctx.actionReview.hardDenyReason(action)
  })

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    exec.signal.throwIfAborted()
    const session = exec.agent?.session
    const sandbox = ctx.sandboxPolicy.resolve(session === undefined ? {} : { session })
    const action = router.route(exec, sandbox)
    switch (action.disposition) {
      case 'inside-boundary':
        return next()
      case 'hard-deny':
        return { kind: 'deny', reason: askReason(action, 'Auto Review hard policy denied the action') }
      case 'manual':
        return { kind: 'ask', reason: askReason(action, 'Auto Review routed the action to manual approval') }
      case 'review': {
        const decision = await ctx.actionReview.review(action, exec.agent?.session, exec.signal)
        exec.signal.throwIfAborted()
        switch (decision.outcome) {
          case 'approved':
            return next()
          case 'denied':
            return {
              kind: 'deny',
              reason: `Auto Review denied ${exec.name}: ${decision.rationale}${decision.saferAlternative === undefined ? '' : ` Safer alternative: ${decision.saferAlternative}`}`,
            }
          case 'manual':
            return { kind: 'ask', reason: `Auto Review requires manual approval: ${decision.rationale}` }
          case 'unavailable':
            return { kind: 'ask', reason: `Auto Review failed closed and requires manual approval: ${decision.rationale}` }
          default: {
            const exhaustive: never = decision.outcome
            return { kind: 'deny', reason: `Auto Review returned an unsupported decision ${String(exhaustive)}` }
          }
        }
      }
      default: {
        const exhaustive: never = action.disposition
        return { kind: 'deny', reason: `Auto Review router returned an unsupported disposition ${String(exhaustive)}` }
      }
    }
  })
}

export default { name, inject, Config, apply }
