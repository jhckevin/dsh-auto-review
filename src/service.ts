import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  ActionEnvelope,
  ActionReviewer,
  AutoReviewAuditRecord,
  AutoReviewConfig,
  ResolvedAutoReviewConfig,
  ReviewDecision,
} from './types.ts'
import { unavailableDecision } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    actionReview: ActionReviewRuntime
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'auto-review/decision': AutoReviewAuditRecord
    'auto-review/breaker': {
      readonly state: 'opened' | 'closed'
      readonly failures: number
      readonly until?: number
    }
  }
}

export const name = 'auto-review'

export class ActionReviewRuntime extends Service {
  static Config: z<AutoReviewConfig> = z.object({
    mode: z.union(['disabled', 'shadow', 'enforcing'] as const).default('enforcing'),
    failureThreshold: z.number().step(1).min(1).default(3),
    breakerCooldownMs: z.number().step(1).min(1).default(60000),
  })

  readonly config: ResolvedAutoReviewConfig
  private reviewer: ActionReviewer | undefined
  private failures = 0
  private breakerUntil = 0

  constructor(ctx: Context, config: AutoReviewConfig = {}) {
    super(ctx, 'actionReview')
    this.config = Object.freeze({
      mode: config.mode ?? 'enforcing',
      failureThreshold: config.failureThreshold ?? 3,
      breakerCooldownMs: config.breakerCooldownMs ?? 60000,
    })
    if (!Number.isSafeInteger(this.config.failureThreshold) || this.config.failureThreshold < 1) {
      throw new TypeError('auto-review: failureThreshold must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.config.breakerCooldownMs) || this.config.breakerCooldownMs < 1) {
      throw new TypeError('auto-review: breakerCooldownMs must be a positive safe integer')
    }
  }

  registerReviewer(reviewer: ActionReviewer): () => void {
    if (reviewer.id.trim().length === 0) throw new TypeError('auto-review: reviewer id must be non-empty')
    if (this.reviewer !== undefined) throw new Error(`auto-review: reviewer ${JSON.stringify(this.reviewer.id)} is already registered`)
    return this.ctx.effect(function* (this: ActionReviewRuntime) {
      this.reviewer = reviewer
      yield () => {
        if (this.reviewer === reviewer) this.reviewer = undefined
      }
    }.bind(this), 'actionReview.registerReviewer()')
  }

  hardDenyReason(action: ActionEnvelope): string | undefined {
    return action.disposition === 'hard-deny'
      ? `Auto Review hard policy denied ${action.toolName}: ${action.reason}`
      : undefined
  }

  async review(action: ActionEnvelope, session: Session | undefined, signal: AbortSignal): Promise<ReviewDecision> {
    if (this.config.mode === 'disabled') {
      return Object.freeze({
        schemaVersion: 1,
        outcome: 'approved',
        riskLevel: 'low',
        rationale: 'Auto Review is disabled by deployment configuration.',
        policyRuleIds: Object.freeze(['AR-DISABLED']),
        uncertainty: '',
      })
    }
    const startedAt = Date.now()
    const reviewer = this.reviewer
    let decision: ReviewDecision
    if (reviewer === undefined) {
      decision = unavailableDecision('No Auto Review provider is mounted.')
    } else if (this.breakerUntil > startedAt) {
      decision = unavailableDecision(`Auto Review circuit breaker is open until ${this.breakerUntil}.`)
    } else {
      try {
        decision = await reviewer.review({ action, signal })
        signal.throwIfAborted()
        if (decision.outcome === 'unavailable') this.recordFailure(session)
        else this.recordSuccess(session)
      } catch (error) {
        decision = unavailableDecision(error instanceof Error ? error.message : String(error))
        this.recordFailure(session)
      }
    }
    const effective = this.config.mode === 'shadow' && decision.outcome !== 'approved'
      ? Object.freeze({
        schemaVersion: 1 as const,
        outcome: 'approved' as const,
        riskLevel: decision.riskLevel,
        rationale: `Shadow mode observed ${decision.outcome}: ${decision.rationale}`,
        policyRuleIds: Object.freeze([...decision.policyRuleIds, 'AR-SHADOW']),
        ...(decision.saferAlternative === undefined ? {} : { saferAlternative: decision.saferAlternative }),
        uncertainty: decision.uncertainty,
      })
      : decision
    if (session !== undefined) {
      session.append('auto-review/decision', {
        schemaVersion: 1,
        actionId: action.actionId,
        actionDigest: action.actionDigest,
        toolName: action.toolName,
        actionKind: action.actionKind,
        disposition: action.disposition,
        mode: this.config.mode,
        ...(reviewer === undefined ? {} : { reviewer: reviewer.id }),
        decision,
        startedAt,
        finishedAt: Date.now(),
      })
    }
    return effective
  }

  private recordFailure(session: Session | undefined): void {
    this.failures += 1
    if (this.failures < this.config.failureThreshold || this.breakerUntil > Date.now()) return
    this.breakerUntil = Date.now() + this.config.breakerCooldownMs
    session?.append('auto-review/breaker', {
      state: 'opened', failures: this.failures, until: this.breakerUntil,
    })
  }

  private recordSuccess(session: Session | undefined): void {
    if (this.failures === 0 && this.breakerUntil === 0) return
    this.failures = 0
    this.breakerUntil = 0
    session?.append('auto-review/breaker', { state: 'closed', failures: 0 })
  }
}

export default ActionReviewRuntime
