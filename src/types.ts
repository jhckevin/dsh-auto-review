import type { CallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'

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
  | 'sandbox-escalation'
  | 'extension-unknown'
  | 'hard-deny'

export type ReviewOutcome = 'approved' | 'denied' | 'manual' | 'unavailable'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type UserAuthorization = 'unknown' | 'low' | 'medium' | 'high'
export type AutoReviewModelStrategy = 'single' | 'risk-tiered'
export type AutoReviewModelTier = 'primary' | 'strong'

export type ActionEffect =
  | { readonly type: 'fs.read'; readonly paths: readonly string[] }
  | { readonly type: 'fs.write'; readonly paths: readonly string[]; readonly destructive: boolean }
  | { readonly type: 'process.exec'; readonly commandDigest: string; readonly cwd?: string }
  | { readonly type: 'network.connect'; readonly targets: readonly string[] }
  | { readonly type: 'credential.read'; readonly paths: readonly string[] }
  | { readonly type: 'permission.change'; readonly paths: readonly string[] }
  | { readonly type: 'production.change'; readonly targets: readonly string[] }
  | { readonly type: 'external.tool'; readonly name: string }
  | { readonly type: 'opaque'; readonly reason: string }

export interface ActionBoundarySnapshot {
  readonly sandboxMode: SandboxMode
  readonly workspaceRoot: string
  readonly realpathVerified: boolean
}

export interface ActionPolicySnapshot {
  readonly mode: AutoReviewMode
  readonly sandboxDefaultAllow: boolean
  readonly resolverId: string
  readonly disposition: ActionDisposition
  readonly ruleIds: readonly string[]
}

export interface ReviewTranscriptEntry {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly trust: 'trusted-user-intent' | 'untrusted-model' | 'untrusted-tool-output'
  readonly text: string
}

export interface ActionEnvelope {
  readonly schemaVersion: 1
  readonly actionId: string
  readonly actionDigest: string
  readonly policyDigest: string
  readonly boundaryDigest: string
  readonly callId: CallId
  readonly rootCallId: CallId
  readonly toolName: string
  readonly arguments: JsonValue
  readonly actionKind: ActionKind
  readonly disposition: ActionDisposition
  readonly reason: string
  readonly resolverId: string
  readonly effects: readonly ActionEffect[]
  readonly policy: ActionPolicySnapshot
  readonly boundary: ActionBoundarySnapshot
  readonly sandbox: {
    readonly mode: SandboxMode
    readonly workspaceRoot: string
  }
  readonly paths: readonly string[]
  readonly authority: {
    readonly sessionId?: string
    readonly turn?: number
    readonly currentUserRequest?: string
    readonly transcript: readonly ReviewTranscriptEntry[]
    readonly exactApproval?: {
      readonly actionDigest: string
      readonly approvedAt: number
      readonly source: 'human-command'
    }
  }
  readonly requestedEscalation?: {
    readonly mode: string
    readonly justification: string
  }
}

export interface ToolSecurityDescription {
  readonly classification: ActionClassification
  readonly effects: readonly ActionEffect[]
  readonly ruleIds?: readonly string[]
}

export interface ToolSecurityDescriptor {
  readonly id: string
  readonly toolNames: readonly string[]
  describe(execution: Readonly<ToolExecution>): ToolSecurityDescription
}

export interface ActionClassification {
  readonly actionKind: ActionKind
  readonly disposition: ActionDisposition
  readonly reason: string
}

export interface ActionSemanticsContribution {
  readonly id: string
  readonly tools: Readonly<Record<string, ActionClassification>>
}

export interface ReviewDecision {
  readonly schemaVersion: 1
  readonly outcome: ReviewOutcome
  readonly riskLevel: RiskLevel
  /** Canonical Guardian authorization score. Required for model decisions; optional on synthetic runtime decisions. */
  readonly userAuthorization?: UserAuthorization
  readonly rationale: string
  readonly policyRuleIds: readonly string[]
  readonly saferAlternative?: string
  readonly uncertainty: string
  readonly reviewerExecution?: {
    readonly tier: AutoReviewModelTier
    readonly provider: string
    readonly model: string
    readonly escalatedFrom?: { readonly provider: string; readonly model: string }
  }
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
  readonly callId?: CallId
  readonly rootCallId?: CallId
  readonly toolName: string
  readonly actionKind: ActionKind
  readonly disposition: ActionDisposition
  readonly turn: number
  readonly mode: AutoReviewMode
  readonly reviewer?: string
  readonly decision: ReviewDecision
  readonly startedAt: number
  readonly finishedAt: number
  readonly latencyMs: number
}

export type AutoReviewIndicatorState = 'reviewing' | 'denied'

/** Non-secret WebUI projection for one exact Tool call that entered the reviewer. */
export interface AutoReviewIndicator {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly callId: CallId
  readonly rootCallId: CallId
  readonly actionId: string
  readonly toolName: string
  readonly state: AutoReviewIndicatorState
  readonly startedAt: number
  readonly finishedAt?: number
}

export interface AutoReviewIndicatorSnapshot {
  readonly revision: number
  readonly indicators: readonly AutoReviewIndicator[]
}

export interface AutoReviewRouteRecord {
  readonly schemaVersion: 1
  readonly actionId: string
  readonly actionDigest: string
  readonly callId: CallId
  readonly rootCallId: CallId
  readonly toolName: string
  readonly actionKind: ActionKind
  readonly disposition: ActionDisposition
  readonly resolverId: string
  readonly sandboxMode: SandboxMode
  readonly pathCount: number
  readonly routedAt: number
}

export type AutoReviewApprovalPath =
  | 'inside-boundary'
  | 'auto-review'
  | 'native-manual'
  | 'hard-deny'

export interface AutoReviewResultRecord {
  readonly schemaVersion: 1
  readonly actionId: string
  readonly actionDigest: string
  readonly callId: CallId
  readonly rootCallId: CallId
  readonly toolName: string
  readonly actionKind: ActionKind
  readonly disposition: ActionDisposition
  readonly approvalPath: AutoReviewApprovalPath
  readonly reviewOutcome?: ReviewOutcome
  readonly finalOutcome: 'success' | 'error'
  readonly errorCode?: string
  readonly resultDigest: string
  readonly routedAt: number
  readonly finishedAt: number
}

export interface AutoReviewBreakerRecord {
  readonly state: 'opened' | 'closed'
  readonly reason: 'reviewer-failure' | 'denial-rate'
  readonly failures?: number
  readonly consecutiveDenials?: number
  readonly recentDenials?: number
  readonly recentWindow?: number
  readonly until?: number
}

export type TicketGrant = 'inside-boundary' | 'auto-review' | 'native-manual' | 'exact-override'

export interface ActionExecutionTicket {
  readonly schemaVersion: 1
  readonly ticketId: string
  readonly actionId: string
  readonly actionDigest: string
  readonly policyDigest: string
  readonly boundaryDigest: string
  readonly sessionId?: string
  readonly callId: CallId
  readonly grant: TicketGrant
  readonly issuedAt: number
  readonly expiresAt: number
  readonly nonce: string
  readonly mac: string
}

export interface AutoReviewTicketRecord {
  readonly state: 'issued' | 'consumed' | 'rejected' | 'expired'
  readonly ticketId: string
  readonly actionId: string
  readonly actionDigest: string
  readonly policyDigest: string
  readonly boundaryDigest: string
  readonly callId: CallId
  readonly grant: TicketGrant
  readonly at: number
  readonly reason?: string
}

export interface AutoReviewOverrideRecord {
  readonly state: 'armed' | 'consumed' | 'expired'
  readonly sessionId: string
  readonly actionDigest: string
  readonly retriesRemaining: number
  readonly at: number
}

export interface AutoReviewPostDenialRecord {
  readonly outcome: 'retried-denied-action' | 'continued-with-different-action' | 'stopped-after-denial'
  readonly deniedActionDigest: string
  readonly nextActionDigest?: string
  readonly turn: number
  readonly saferAlternativeSuggested: boolean
  readonly at: number
}

export interface AutoReviewMetricsSnapshot {
  readonly totalActions: number
  readonly insideBoundary: number
  readonly autoReviewed: number
  readonly approved: number
  readonly denied: number
  readonly manual: number
  readonly unavailable: number
  readonly hardDenied: number
  readonly successfulActions: number
  readonly failedActions: number
  readonly ticketRejected: number
  readonly retriedDeniedAction: number
  readonly continuedWithDifferentAction: number
  readonly stoppedAfterDenial: number
  readonly reviewerLatencyMs: { readonly count: number; readonly mean: number; readonly max: number }
  readonly approvalRate: number
  readonly effectiveAutomationRate: number
  readonly byActionKind: Readonly<Partial<Record<ActionKind, number>>>
}

export interface AutoReviewAuditPayloadMap {
  readonly routed: AutoReviewRouteRecord
  readonly decision: AutoReviewAuditRecord
  readonly result: AutoReviewResultRecord
  readonly breaker: AutoReviewBreakerRecord
  readonly ticket: AutoReviewTicketRecord
  readonly override: AutoReviewOverrideRecord
  readonly postDenial: AutoReviewPostDenialRecord
}

export type AutoReviewAuditKind = keyof AutoReviewAuditPayloadMap

export interface AutoReviewAuditEnvelope<K extends AutoReviewAuditKind = AutoReviewAuditKind> {
  readonly schemaVersion: 1
  readonly processInstanceId: string
  readonly sequence: number
  readonly kind: K
  readonly sessionId?: string
  readonly data: AutoReviewAuditPayloadMap[K]
  readonly previousDigest?: string
  readonly recordDigest: string
}

export interface ActionReviewAuditSink {
  readonly id: string
  write(record: AutoReviewAuditEnvelope): void
}

export interface JsonlAuditConfig {
  readonly root: string
  readonly fsync?: boolean
  readonly replayMaxBytes?: number
}

export interface AutoReviewConfig {
  readonly mode?: AutoReviewMode
  readonly sandboxDefaultAllow?: boolean
  readonly failureThreshold?: number
  readonly breakerCooldownMs?: number
  readonly auditMemoryLimit?: number
  readonly ticketTtlMs?: number
  readonly denialConsecutiveLimit?: number
  readonly denialWindowSize?: number
  readonly denialWindowLimit?: number
  readonly overrideTtlMs?: number
}

export interface ResolvedAutoReviewConfig {
  readonly mode: AutoReviewMode
  readonly sandboxDefaultAllow: boolean
  readonly failureThreshold: number
  readonly breakerCooldownMs: number
  readonly auditMemoryLimit: number
  readonly ticketTtlMs: number
  readonly denialConsecutiveLimit: number
  readonly denialWindowSize: number
  readonly denialWindowLimit: number
  readonly overrideTtlMs: number
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
  readonly modelStrategy?: AutoReviewModelStrategy
  readonly strongProvider?: string
  readonly strongModel?: string
  readonly strongReasoningEffort?: string
  readonly strongReviewKinds?: ActionKind[]
  readonly escalateUncertainToStrong?: boolean
  readonly maxInputBytes: number
  readonly maxOutputTokens: number
  readonly timeoutMs: number
  readonly maxAttempts?: number
  readonly retryDelayMs?: number
  readonly transcriptMaxEntries?: number
  readonly transcriptMaxBytes?: number
}

/** Models exposed by the Auto Review settings surface. */
export type AutoReviewReviewerModel = 'flash' | 'pro'

/** Live, user-editable Auto Review settings shared by the Host and WebUI. */
export interface AutoReviewUiSettings {
  /** Whether actions routed to review may be decided by the reviewer. */
  readonly enabled: boolean
  /** Let actions already confined by the native sandbox bypass model review. */
  readonly sandboxDefaultAllow: boolean
  /** Reviewer model tier. Flash is the low-latency default. */
  readonly reviewerModel: AutoReviewReviewerModel
  /** Select one model for all reviews or a configurable primary/strong split. */
  readonly modelStrategy: AutoReviewModelStrategy
  /** Registered Harness provider and provider-owned model id for ordinary reviews. */
  readonly primaryProvider: string
  readonly primaryModel: string
  /** Empty means use the selected model/provider default. */
  readonly primaryReasoningEffort: string
  /** Registered Harness provider and provider-owned model id for high-risk reviews. */
  readonly strongProvider: string
  readonly strongModel: string
  /** Empty means use the selected model/provider default. */
  readonly strongReasoningEffort: string
  /** Deterministic action kinds sent directly to the strong profile. */
  readonly strongReviewKinds: ActionKind[]
  /** Re-run an uncertain/high-risk primary decision with the strong profile. */
  readonly escalateUncertainToStrong: boolean
  /** Maximum redacted evidence payload accepted by the reviewer. */
  readonly maxInputBytes: number
  /** Maximum reviewer response tokens. */
  readonly maxOutputTokens: number
  /** Per-decision timeout. */
  readonly timeoutMs: number
  /** Bounded attempts for transient provider failures. */
  readonly maxAttempts: number
  /** Maximum recent transcript entries supplied as evidence. */
  readonly transcriptMaxEntries: number
  /** Maximum total transcript bytes supplied as evidence. */
  readonly transcriptMaxBytes: number
  /** Consecutive reviewer failures before the circuit breaker opens. */
  readonly failureThreshold: number
  /** Circuit-breaker cooling period. */
  readonly breakerCooldownMs: number
}

export interface TicketIssueRequest {
  readonly token: ToolExecutionToken
  readonly action: ActionEnvelope
  readonly grant: TicketGrant
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
