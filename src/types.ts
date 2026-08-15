import type { CallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

export type AutoReviewMode = 'disabled' | 'shadow' | 'enforcing'
export type ActionDisposition = 'inside-boundary' | 'review' | 'manual' | 'hard-deny'
export type ActionKind =
  | 'workspace-read'
  | 'workspace-write'
  | 'process'
  | 'network'
  | 'sensitive-read'
  | 'destructive'
  | 'permission-change'
  | 'production-change'
  | 'extension-unknown'
  | 'hard-deny'

export type ReviewOutcome = 'approved' | 'denied' | 'manual' | 'unavailable'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ActionEnvelope {
  readonly schemaVersion: 1
  readonly actionId: string
  readonly actionDigest: string
  readonly callId: CallId
  readonly rootCallId: CallId
  readonly toolName: string
  readonly arguments: JsonValue
  readonly actionKind: ActionKind
  readonly disposition: ActionDisposition
  readonly reason: string
  readonly sandbox: {
    readonly mode: SandboxMode
    readonly workspaceRoot: string
  }
  readonly paths: readonly string[]
}

export interface ReviewDecision {
  readonly schemaVersion: 1
  readonly outcome: ReviewOutcome
  readonly riskLevel: RiskLevel
  readonly rationale: string
  readonly policyRuleIds: readonly string[]
  readonly saferAlternative?: string
  readonly uncertainty: string
}

export interface ActionReviewerRequest {
  readonly action: ActionEnvelope
  readonly signal: AbortSignal
}

export interface ActionReviewer {
  readonly id: string
  review(request: ActionReviewerRequest): Promise<ReviewDecision>
}

export interface AutoReviewAuditRecord {
  readonly schemaVersion: 1
  readonly actionId: string
  readonly actionDigest: string
  readonly toolName: string
  readonly actionKind: ActionKind
  readonly disposition: ActionDisposition
  readonly mode: AutoReviewMode
  readonly reviewer?: string
  readonly decision: ReviewDecision
  readonly startedAt: number
  readonly finishedAt: number
}

export interface AutoReviewConfig {
  readonly mode?: AutoReviewMode
  readonly failureThreshold?: number
  readonly breakerCooldownMs?: number
}

export interface ResolvedAutoReviewConfig {
  readonly mode: AutoReviewMode
  readonly failureThreshold: number
  readonly breakerCooldownMs: number
}

export interface RouterConfig {
  readonly unknownTool?: 'review' | 'manual'
  readonly allowWorkspaceReads?: boolean
  readonly allowWorkspaceWrites?: boolean
  readonly productionMarkers?: string[]
  readonly sensitiveMarkers?: string[]
  readonly hardDenyToolNames?: string[]
}

export interface ResolvedRouterConfig {
  readonly unknownTool: 'review' | 'manual'
  readonly allowWorkspaceReads: boolean
  readonly allowWorkspaceWrites: boolean
  readonly productionMarkers: readonly string[]
  readonly sensitiveMarkers: readonly string[]
  readonly hardDenyToolNames: readonly string[]
}

export interface LlmReviewerConfig {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly maxInputBytes: number
  readonly maxOutputTokens: number
  readonly timeoutMs: number
}

export const CLOSED_REVIEW_OUTCOMES: readonly ReviewOutcome[] = [
  'approved',
  'denied',
  'manual',
  'unavailable',
]

export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical']

export function unavailableDecision(rationale: string): ReviewDecision {
  return Object.freeze({
    schemaVersion: 1,
    outcome: 'unavailable',
    riskLevel: 'high',
    rationale,
    policyRuleIds: Object.freeze(['AR-FAIL-CLOSED']),
    uncertainty: 'Reviewer did not produce an authoritative decision.',
  })
}
