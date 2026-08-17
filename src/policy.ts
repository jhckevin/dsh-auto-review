import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  PreToolDecision,
  ToolExecution,
  ToolExecutionResult,
  ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { sha256Json, toJsonValue } from './canonical.ts'
import { ActionRouter } from './router.ts'
import type {
  ActionEnvelope,
  AutoReviewApprovalPath,
  ReviewOutcome,
  RouterConfig,
} from './types.ts'

export const name = 'auto-review-policy'
export const inject = ['actionReview', 'tools', 'sandboxPolicy', 'approval']

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

function denialMessage(toolName: string, rationale: string, saferAlternative?: string): string {
  const alternative = saferAlternative === undefined
    ? 'Stop and ask the user before attempting another action with the same effect.'
    : `Use this materially safer alternative if it still satisfies the task: ${saferAlternative}`
  return `Auto Review denied ${toolName}: ${rationale} Do not retry the same action or an equivalent bypass. ${alternative}`
}

interface PendingReview {
  readonly action: ActionEnvelope
  readonly routedAt: number
  approvalPath: AutoReviewApprovalPath
  reviewOutcome?: ReviewOutcome
}

function callKey(sessionId: string, callId: string): string {
  return `${sessionId}\u0000${callId}`
}

function expectedEscalationReason(action: ActionEnvelope): string | undefined {
  const escalation = action.requestedEscalation
  return escalation === undefined
    ? undefined
    : `escalate sandbox to ${escalation.mode}: ${escalation.justification}`
}

function isMatchingEscalation(request: ApprovalRequest, pending: PendingReview): boolean {
  return pending.action.actionKind === 'sandbox-escalation'
    && request.agent.session.id === pending.action.authority.sessionId
    && request.callId === pending.action.callId
    && request.toolName === pending.action.toolName
    && request.reason === expectedEscalationReason(pending.action)
}

function errorCode(result: Readonly<ToolExecutionResult>): string | undefined {
  if (!result.isError) return undefined
  const code = result.error.info?.code
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

export function apply(ctx: Context, config: RouterConfig = {}): void {
  const router = new ActionRouter(config)
  const pendingByToken = new Map<ToolExecutionToken, PendingReview>()
  const escalationByCall = new Map<string, PendingReview>()

  const sandboxFor = (exec: Readonly<ToolExecution>) => {
    const session = exec.agent?.session
    return ctx.sandboxPolicy.resolve(session === undefined ? {} : { session })
  }

  const autoReviewActive = (exec: Readonly<ToolExecution>): boolean => (
    ctx.actionReview.config.mode !== 'disabled'
    && !ctx.actionReview.isReviewerSession(exec.agent?.session)
    && sandboxFor(exec).mode !== 'danger-full-access'
  )

  const route = (exec: Readonly<ToolExecution>): PendingReview => {
    const existing = pendingByToken.get(exec.token)
    if (existing !== undefined) return existing
    const session = exec.agent?.session
    const sandbox = sandboxFor(exec)
    const descriptor = ctx.actionReview.securityDescriptorFor(exec.name)
    let contribution: Parameters<ActionRouter['route']>[2] = ctx.actionReview.classificationFor(exec.name)
    if (descriptor !== undefined) {
      try {
        const described = descriptor.descriptor.describe(exec)
        contribution = {
          resolverId: descriptor.resolverId,
          classification: described.classification,
          effects: described.effects,
          ...(described.ruleIds === undefined ? {} : { ruleIds: described.ruleIds }),
        }
      } catch {
        contribution = {
          resolverId: descriptor.resolverId,
          classification: {
            actionKind: 'extension-unknown',
            disposition: 'manual',
            reason: 'Registered extension security descriptor failed closed.',
          },
          effects: [{ type: 'opaque', reason: 'Security descriptor failed to describe this action.' }],
          ruleIds: ['AR-DESCRIPTOR-FAILED'],
        }
      }
    }
    const action = router.route(
      exec,
      sandbox,
      contribution,
      ctx.actionReview.config.mode,
      ctx.actionReview.config.sandboxDefaultAllow,
    )
    ctx.actionReview.observeRoutedAction(action)
    const pending: PendingReview = {
      action,
      routedAt: Date.now(),
      approvalPath: action.disposition === 'inside-boundary'
        ? 'inside-boundary'
        : action.disposition === 'hard-deny'
          ? 'hard-deny'
          : 'native-manual',
    }
    pendingByToken.set(exec.token, pending)
    ctx.actionReview.recordAudit('routed', {
      schemaVersion: 1,
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      callId: action.callId,
      rootCallId: action.rootCallId,
      toolName: action.toolName,
      actionKind: action.actionKind,
      disposition: action.disposition,
      resolverId: action.resolverId,
      sandboxMode: action.sandbox.mode,
      pathCount: action.paths.length,
      routedAt: pending.routedAt,
    }, session?.id)
    return pending
  }

  ctx.tools.guard((exec) => {
    if (!autoReviewActive(exec)) return undefined
    const action = route(exec).action
    return ctx.actionReview.hardDenyReason(action) ?? ctx.actionReview.consumeTicket(exec.token, action)
  })

  ctx.on('approval/request', async (request: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => {
    if (ctx.actionReview.config.mode === 'disabled') return next()
    if (ctx.sandboxPolicy.resolve({ session: request.agent.session }).mode === 'danger-full-access') return next()
    if (request.callId === undefined) return next()
    const key = callKey(request.agent.session.id, request.callId)
    const pending = escalationByCall.get(key)
    if (pending === undefined || !isMatchingEscalation(request, pending)) return next()
    escalationByCall.delete(key)
    return pending.reviewOutcome === 'approved' ? 'allowed-once' : next()
  }, { prepend: true })

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    exec.signal.throwIfAborted()
    if (!autoReviewActive(exec)) return next()
    const pending = route(exec)
    const action = pending.action
    switch (action.disposition) {
      case 'inside-boundary': {
        ctx.actionReview.issueTicket({ token: exec.token, action, grant: 'inside-boundary' })
        return next()
      }
      case 'hard-deny':
        throw new HarnessError(
          `${askReason(action, 'Auto Review hard policy denied the action')} Do not retry or bypass this prohibition.`,
          'AUTO_REVIEW_HARD_DENY',
        )
      case 'manual': {
        ctx.actionReview.issueTicket({ token: exec.token, action, grant: 'native-manual' })
        return { kind: 'ask', reason: askReason(action, 'Auto Review routed the action to manual approval') }
      }
      case 'review': {
        const exactApproval = ctx.actionReview.consumeExactOverride(action)
        const reviewAction = exactApproval === undefined
          ? action
          : Object.freeze({
              ...action,
              authority: Object.freeze({ ...action.authority, exactApproval }),
            })
        const decision = await ctx.actionReview.review(reviewAction, exec.agent?.session, exec.signal)
        pending.reviewOutcome = decision.outcome
        exec.signal.throwIfAborted()
        switch (decision.outcome) {
          case 'approved': {
            pending.approvalPath = 'auto-review'
            ctx.actionReview.issueTicket({
              token: exec.token,
              action,
              grant: exactApproval === undefined ? 'auto-review' : 'exact-override',
            })
            if (action.actionKind === 'sandbox-escalation' && exec.agent !== undefined) {
              escalationByCall.set(callKey(exec.agent.session.id, exec.callId), pending)
            }
            return next()
          }
          case 'denied':
            pending.approvalPath = 'auto-review'
            throw new HarnessError(
              denialMessage(exec.name, decision.rationale, decision.saferAlternative),
              'AUTO_REVIEW_DENIED',
            )
          case 'manual':
            pending.approvalPath = 'native-manual'
            ctx.actionReview.issueTicket({ token: exec.token, action, grant: 'native-manual' })
            return action.actionKind === 'sandbox-escalation'
              ? next()
              : { kind: 'ask', reason: `Auto Review requires manual approval: ${decision.rationale}` }
          case 'unavailable':
            pending.approvalPath = 'native-manual'
            ctx.actionReview.issueTicket({ token: exec.token, action, grant: 'native-manual' })
            return action.actionKind === 'sandbox-escalation'
              ? next()
              : { kind: 'ask', reason: `Auto Review failed closed and requires manual approval: ${decision.rationale}` }
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

  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const pending = pendingByToken.get(exec.token)
    if (pending === undefined) return
    pendingByToken.delete(exec.token)
    ctx.actionReview.discardTicket(exec.token)
    const session = exec.agent?.session
    if (session !== undefined) escalationByCall.delete(callKey(session.id, exec.callId))
    const code = errorCode(result)
    ctx.actionReview.recordAudit('result', {
      schemaVersion: 1,
      actionId: pending.action.actionId,
      actionDigest: pending.action.actionDigest,
      callId: pending.action.callId,
      rootCallId: pending.action.rootCallId,
      toolName: pending.action.toolName,
      actionKind: pending.action.actionKind,
      disposition: pending.action.disposition,
      approvalPath: pending.approvalPath,
      ...(pending.reviewOutcome === undefined ? {} : { reviewOutcome: pending.reviewOutcome }),
      finalOutcome: result.isError ? 'error' : 'success',
      ...(code === undefined ? {} : { errorCode: code }),
      resultDigest: sha256Json(toJsonValue(result)),
      routedAt: pending.routedAt,
      finishedAt: Date.now(),
    }, session?.id)
  })

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') ctx.actionReview.observeTurnEnd(session.id, event.data.turn)
  })
}
