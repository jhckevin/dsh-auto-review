import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { canonicalJson, sha256Json, toJsonValue } from './canonical.ts'
import type {
  ActionExecutionTicket,
  ActionEnvelope,
  ActionClassification,
  ActionReviewAuditSink,
  ActionReviewer,
  ActionSemanticsContribution,
  TicketIssueRequest,
  ToolSecurityDescriptor,
  AutoReviewAuditEnvelope,
  AutoReviewAuditKind,
  AutoReviewAuditPayloadMap,
  AutoReviewMetricsSnapshot,
  AutoReviewIndicator,
  AutoReviewIndicatorSnapshot,
  AutoReviewConfig,
  AutoReviewUiSettings,
  LlmReviewerConfig,
  ResolvedAutoReviewConfig,
  ReviewDecision,
} from './types.ts'
import { unavailableDecision } from './types.ts'
import { autoReviewSettingsBase } from './settings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    actionReview: ActionReviewRuntime
  }
}

export const name = 'auto-review'

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeJson(entry)
    Object.freeze(value)
  }
  return value
}

interface MutableMetrics {
  totalActions: number
  insideBoundary: number
  autoReviewed: number
  approved: number
  denied: number
  manual: number
  unavailable: number
  hardDenied: number
  successfulActions: number
  failedActions: number
  ticketRejected: number
  retriedDeniedAction: number
  retriedEquivalentEffect: number
  continuedWithDifferentAction: number
  stoppedAfterDenial: number
  reviewerLatencyCount: number
  reviewerLatencySum: number
  reviewerLatencyMax: number
  policyOutlineCalls: number
  policySearchCalls: number
  policyGetCalls: number
  policyResultBytes: number
  byActionKind: Map<string, number>
}

function newMetrics(): MutableMetrics {
  return {
    totalActions: 0, insideBoundary: 0, autoReviewed: 0, approved: 0, denied: 0,
    manual: 0, unavailable: 0, hardDenied: 0, successfulActions: 0, failedActions: 0,
    ticketRejected: 0, retriedDeniedAction: 0, retriedEquivalentEffect: 0, continuedWithDifferentAction: 0,
    stoppedAfterDenial: 0, reviewerLatencyCount: 0, reviewerLatencySum: 0,
    reviewerLatencyMax: 0, byActionKind: new Map(),
    policyOutlineCalls: 0, policySearchCalls: 0, policyGetCalls: 0, policyResultBytes: 0,
  }
}

export class ActionReviewRuntime extends Service {
  static Config: z<AutoReviewConfig> = z.object({
    mode: z.union(['disabled', 'shadow', 'enforcing'] as const).default('enforcing'),
    sandboxDefaultAllow: z.boolean().default(true),
    failureThreshold: z.number().step(1).min(1).default(3),
    breakerCooldownMs: z.number().step(1).min(1).default(60000),
    auditMemoryLimit: z.number().step(1).min(1).max(100000).default(4096),
    ticketTtlMs: z.number().step(1).min(1).default(120000),
    denialConsecutiveLimit: z.number().step(1).min(1).default(3),
    denialWindowSize: z.number().step(1).min(1).default(50),
    denialWindowLimit: z.number().step(1).min(1).default(10),
    overrideTtlMs: z.number().step(1).min(1).default(300000),
  })

  private readonly deployedConfig: ResolvedAutoReviewConfig
  private settingsBase: AutoReviewUiSettings
  private settingsScope: SettingsScope<AutoReviewUiSettings> | undefined
  private reviewer: ActionReviewer | undefined
  private auditSink: ActionReviewAuditSink | undefined
  private readonly semantics = new Map<string, { owner: string; classification: ActionClassification }>()
  private readonly descriptors = new Map<string, { owner: string; descriptor: ToolSecurityDescriptor }>()
  private readonly audit = new Array<AutoReviewAuditEnvelope>()
  private readonly processInstanceId = randomUUID()
  private auditSequence = 0
  private previousAuditDigest: string | undefined
  private indicatorRevision = 0
  private readonly reviewIndicators = new Map<string, AutoReviewIndicator>()
  private failures = 0
  private breakerUntil = 0
  private readonly ticketSecret = randomBytes(32)
  private readonly tickets = new Map<ToolExecutionToken, ActionExecutionTicket>()
  private readonly denialStates = new Map<string, { consecutive: number; recent: boolean[]; paused: boolean }>()
  private readonly overrides = new Map<string, { actionDigest: string; expiresAt: number; retriesRemaining: number }>()
  private readonly lastDenied = new Map<string, { actionDigest: string; turn: number; deniedAt: number }>()
  private readonly pendingDenials = new Map<string, {
    actionDigest: string
    effectDigest: string
    turn: number
    saferAlternativeSuggested: boolean
  }>()
  private readonly globalMetrics = newMetrics()
  private readonly sessionMetrics = new Map<string, MutableMetrics>()
  private readonly reviewerSessions = new WeakSet<Session>()

  constructor(ctx: Context, config: AutoReviewConfig = {}) {
    super(ctx, 'actionReview')
    this.deployedConfig = Object.freeze({
      mode: config.mode ?? 'enforcing',
      sandboxDefaultAllow: config.sandboxDefaultAllow ?? true,
      failureThreshold: config.failureThreshold ?? 3,
      breakerCooldownMs: config.breakerCooldownMs ?? 60000,
      auditMemoryLimit: config.auditMemoryLimit ?? 4096,
      ticketTtlMs: config.ticketTtlMs ?? 120000,
      denialConsecutiveLimit: config.denialConsecutiveLimit ?? 3,
      denialWindowSize: config.denialWindowSize ?? 50,
      denialWindowLimit: config.denialWindowLimit ?? 10,
      overrideTtlMs: config.overrideTtlMs ?? 300000,
    })
    this.settingsBase = Object.freeze(autoReviewSettingsBase(config))
    if (!Number.isSafeInteger(this.deployedConfig.failureThreshold) || this.deployedConfig.failureThreshold < 1) {
      throw new TypeError('auto-review: failureThreshold must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.deployedConfig.breakerCooldownMs) || this.deployedConfig.breakerCooldownMs < 1) {
      throw new TypeError('auto-review: breakerCooldownMs must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.deployedConfig.auditMemoryLimit) || this.deployedConfig.auditMemoryLimit < 1 || this.deployedConfig.auditMemoryLimit > 100000) {
      throw new TypeError('auto-review: auditMemoryLimit must be an integer from 1 to 100000')
    }
    for (const key of ['ticketTtlMs', 'denialConsecutiveLimit', 'denialWindowSize', 'denialWindowLimit', 'overrideTtlMs'] as const) {
      if (!Number.isSafeInteger(this.deployedConfig[key]) || this.deployedConfig[key] < 1) {
        throw new TypeError(`auto-review: ${key} must be a positive safe integer`)
      }
    }
    if (this.deployedConfig.denialWindowLimit > this.deployedConfig.denialWindowSize) {
      throw new TypeError('auto-review: denialWindowLimit cannot exceed denialWindowSize')
    }
  }

  /** Composition defaults used by the explicit settings bridge row. */
  settingsDefaults(): AutoReviewUiSettings {
    return Object.freeze({ ...this.settingsBase })
  }

  /** Bind provider-owned model defaults before the settings namespace is registered. */
  configureReviewerSettingsDefaults(config: LlmReviewerConfig): void {
    if (this.settingsScope !== undefined) {
      throw new Error('auto-review: reviewer defaults must be configured before the settings bridge is mounted')
    }
    this.settingsBase = Object.freeze(autoReviewSettingsBase(this.deployedConfig, config))
  }

  /** Attach the one live settings owner; the bridge row owns its lifetime. */
  attachSettings(scope: SettingsScope<AutoReviewUiSettings>): () => void {
    if (this.settingsScope !== undefined) throw new Error('auto-review: settings scope is already attached')
    this.settingsScope = scope
    return () => {
      if (this.settingsScope === scope) this.settingsScope = undefined
    }
  }

  /** Effective runtime policy after the live WebUI layer is applied. */
  get config(): ResolvedAutoReviewConfig {
    const settings = this.uiSettings() ?? this.settingsBase
    const deployedMode = this.deployedConfig.mode
    return Object.freeze({
      ...this.deployedConfig,
      mode: settings.enabled ? (deployedMode === 'disabled' ? 'enforcing' : deployedMode) : 'disabled',
      sandboxDefaultAllow: settings.sandboxDefaultAllow,
      failureThreshold: settings.failureThreshold,
      breakerCooldownMs: settings.breakerCooldownMs,
    })
  }

  /** Read a detached snapshot for reviewer providers and diagnostics. */
  uiSettings(): AutoReviewUiSettings | undefined {
    const settings = this.settingsScope?.get()
    return settings === undefined ? undefined : Object.freeze({ ...settings })
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

  /** Mark only the exact runtime-created reviewer session so its private read-only policy tools cannot recurse into Auto Review. */
  registerReviewerSession(session: Session): () => void {
    this.reviewerSessions.add(session)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.reviewerSessions.delete(session)
    }
  }

  /** Identity check, deliberately not based on a forgeable session id or metadata string. */
  isReviewerSession(session: Session | undefined): boolean {
    return session !== undefined && this.reviewerSessions.has(session)
  }

  registerAuditSink(sink: ActionReviewAuditSink): () => void {
    if (sink.id.trim().length === 0) throw new TypeError('auto-review: audit sink id must be non-empty')
    if (this.auditSink !== undefined) throw new Error(`auto-review: audit sink ${JSON.stringify(this.auditSink.id)} is already registered`)
    return this.ctx.effect(function* (this: ActionReviewRuntime) {
      this.auditSink = sink
      yield () => {
        if (this.auditSink === sink) this.auditSink = undefined
      }
    }.bind(this), 'actionReview.registerAuditSink()')
  }

  recordAudit<K extends AutoReviewAuditKind>(
    kind: K,
    data: AutoReviewAuditPayloadMap[K],
    sessionId?: string,
  ): AutoReviewAuditEnvelope<K> {
    const sequence = this.auditSequence + 1
    const dataSnapshot = freezeJson(toJsonValue(data)) as unknown as AutoReviewAuditPayloadMap[K]
    const unsigned = {
      schemaVersion: 1 as const,
      processInstanceId: this.processInstanceId,
      sequence,
      kind,
      ...(sessionId === undefined ? {} : { sessionId }),
      data: dataSnapshot,
      ...(this.previousAuditDigest === undefined ? {} : { previousDigest: this.previousAuditDigest }),
    }
    const record = freezeJson({
      ...unsigned,
      recordDigest: sha256Json(toJsonValue(unsigned)),
    }) as AutoReviewAuditEnvelope<K>
    this.auditSink?.write(record)
    this.applyMetrics(this.globalMetrics, record)
    if (sessionId !== undefined) {
      const metrics = this.sessionMetrics.get(sessionId) ?? newMetrics()
      this.applyMetrics(metrics, record)
      this.sessionMetrics.set(sessionId, metrics)
    }
    this.auditSequence = sequence
    this.previousAuditDigest = record.recordDigest
    this.audit.push(record)
    if (this.audit.length > this.config.auditMemoryLimit) this.audit.shift()
    return record
  }

  auditRecords(sessionId?: string): readonly AutoReviewAuditEnvelope[] {
    const records = sessionId === undefined ? this.audit : this.audit.filter(record => record.sessionId === sessionId)
    return Object.freeze([...records])
  }

  /** Return a detached, non-secret reviewer state projection for one session. */
  reviewIndicatorSnapshot(sessionId: string): AutoReviewIndicatorSnapshot {
    if (sessionId.trim().length === 0) throw new TypeError('auto-review: session id must be non-empty')
    const indicators = [...this.reviewIndicators.values()]
      .filter(indicator => indicator.sessionId === sessionId)
      .sort((left, right) => left.startedAt - right.startedAt || left.callId.localeCompare(right.callId))
    return Object.freeze({
      revision: this.indicatorRevision,
      indicators: Object.freeze(indicators.map(indicator => Object.freeze({ ...indicator }))),
    })
  }

  private indicatorKey(sessionId: string, callId: string): string {
    return `${sessionId}\u0000${callId}`
  }

  private setReviewIndicator(
    action: Pick<ActionEnvelope, 'actionId' | 'callId' | 'rootCallId' | 'toolName'>,
    sessionId: string,
    state: AutoReviewIndicator['state'] | undefined,
    startedAt: number,
    finishedAt?: number,
  ): void {
    const key = this.indicatorKey(sessionId, action.callId)
    if (state === undefined) {
      if (this.reviewIndicators.delete(key)) this.indicatorRevision += 1
      return
    }
    const next: AutoReviewIndicator = Object.freeze({
      schemaVersion: 1,
      sessionId,
      callId: action.callId,
      rootCallId: action.rootCallId,
      actionId: action.actionId,
      toolName: action.toolName,
      state,
      startedAt,
      ...(finishedAt === undefined ? {} : { finishedAt }),
    })
    this.reviewIndicators.delete(key)
    this.reviewIndicators.set(key, next)
    while (this.reviewIndicators.size > this.config.auditMemoryLimit) {
      const oldest = this.reviewIndicators.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.reviewIndicators.delete(oldest)
    }
    this.indicatorRevision += 1
  }

  restoreAudit(records: readonly AutoReviewAuditEnvelope[]): void {
    for (const record of records) {
      const sessionId = record.sessionId
      this.applyMetrics(this.globalMetrics, record)
      if (sessionId !== undefined) {
        const metrics = this.sessionMetrics.get(sessionId) ?? newMetrics()
        this.applyMetrics(metrics, record)
        this.sessionMetrics.set(sessionId, metrics)
      }
      if (sessionId === undefined) continue
      switch (record.kind) {
        case 'decision': {
          const data = record.data as AutoReviewAuditPayloadMap['decision']
          const turn = data.turn ?? 0
          const key = `${sessionId}\u0000${turn}`
          if (data.decision.outcome === 'unavailable') break
          if (data.callId !== undefined && data.rootCallId !== undefined) {
            const restoredAction: Pick<ActionEnvelope, 'actionId' | 'callId' | 'rootCallId' | 'toolName'> = {
              actionId: data.actionId,
              callId: data.callId,
              rootCallId: data.rootCallId,
              toolName: data.toolName,
            }
            this.setReviewIndicator(
              restoredAction,
              sessionId,
              data.decision.outcome === 'denied' && this.config.mode !== 'shadow' ? 'denied' : undefined,
              data.startedAt,
              data.finishedAt,
            )
          }
          const state = this.denialStates.get(key) ?? { consecutive: 0, recent: [], paused: false }
          const denied = data.decision.outcome === 'denied'
          state.consecutive = denied ? state.consecutive + 1 : 0
          state.recent.push(denied)
          if (state.recent.length > this.config.denialWindowSize) state.recent.shift()
          const recentDenials = state.recent.filter(Boolean).length
          state.paused = state.paused
            || state.consecutive >= this.config.denialConsecutiveLimit
            || recentDenials >= this.config.denialWindowLimit
          this.denialStates.set(key, state)
          if (denied) {
            this.lastDenied.set(sessionId, { actionDigest: data.actionDigest, turn, deniedAt: data.finishedAt })
            this.pendingDenials.set(sessionId, {
              actionDigest: data.actionDigest,
              effectDigest: data.effectDigest ?? data.actionDigest,
              turn,
              saferAlternativeSuggested: data.decision.saferAlternative !== undefined,
            })
          } else {
            this.lastDenied.delete(sessionId)
            this.pendingDenials.delete(sessionId)
          }
          break
        }
        case 'override': {
          const data = record.data as AutoReviewAuditPayloadMap['override']
          if (data.state === 'armed') {
            const expiresAt = data.at + this.config.overrideTtlMs
            if (expiresAt > Date.now()) this.overrides.set(sessionId, { actionDigest: data.actionDigest, expiresAt, retriesRemaining: 1 })
          } else {
            this.overrides.delete(sessionId)
          }
          break
        }
        case 'postDenial':
          if (!['retried-denied-action', 'retried-equivalent-effect'].includes((record.data as AutoReviewAuditPayloadMap['postDenial']).outcome)) {
            this.pendingDenials.delete(sessionId)
          }
          break
        default:
          break
      }
    }
  }

  metrics(sessionId?: string): AutoReviewMetricsSnapshot {
    const state = sessionId === undefined ? this.globalMetrics : this.sessionMetrics.get(sessionId) ?? newMetrics()
    const approvalRate = state.autoReviewed === 0 ? 0 : state.approved / state.autoReviewed
    const effectiveAutomationRate = state.totalActions === 0
      ? 0
      : (state.insideBoundary + state.approved) / state.totalActions
    return freezeJson({
      totalActions: state.totalActions,
      insideBoundary: state.insideBoundary,
      autoReviewed: state.autoReviewed,
      approved: state.approved,
      denied: state.denied,
      manual: state.manual,
      unavailable: state.unavailable,
      hardDenied: state.hardDenied,
      successfulActions: state.successfulActions,
      failedActions: state.failedActions,
      ticketRejected: state.ticketRejected,
      retriedDeniedAction: state.retriedDeniedAction,
      retriedEquivalentEffect: state.retriedEquivalentEffect,
      continuedWithDifferentAction: state.continuedWithDifferentAction,
      stoppedAfterDenial: state.stoppedAfterDenial,
      reviewerLatencyMs: {
        count: state.reviewerLatencyCount,
        mean: state.reviewerLatencyCount === 0 ? 0 : state.reviewerLatencySum / state.reviewerLatencyCount,
        max: state.reviewerLatencyMax,
      },
      policyRetrieval: {
        outlineCalls: state.policyOutlineCalls,
        searchCalls: state.policySearchCalls,
        getCalls: state.policyGetCalls,
        resultBytes: state.policyResultBytes,
      },
      approvalRate,
      effectiveAutomationRate,
      byActionKind: Object.fromEntries([...state.byActionKind.entries()].sort(([left], [right]) => left < right ? -1 : 1)),
    }) as AutoReviewMetricsSnapshot
  }

  registerActionSemantics(contribution: ActionSemanticsContribution): () => void {
    const id = contribution.id.trim()
    if (id.length === 0) throw new TypeError('auto-review: action semantics id must be non-empty')
    const entries = Object.entries(contribution.tools)
    if (entries.length === 0) throw new TypeError(`auto-review: action semantics ${JSON.stringify(id)} has no tools`)
    const normalized = entries.map(([toolName, classification]) => {
      const tool = toolName.trim()
      if (tool.length === 0) throw new TypeError(`auto-review: action semantics ${JSON.stringify(id)} has an empty tool name`)
      if (classification.disposition === 'hard-deny' && classification.actionKind !== 'hard-deny') {
        throw new TypeError('auto-review: only hard-deny actions may use the hard-deny disposition')
      }
      if (classification.actionKind === 'hard-deny' && classification.disposition !== 'hard-deny') {
        throw new TypeError('auto-review: hard-deny actions must use the hard-deny disposition')
      }
      if (classification.reason.trim().length === 0) {
        throw new TypeError(`auto-review: action semantics for ${JSON.stringify(tool)} must include a reason`)
      }
      return [tool, {
        owner: id,
        classification: Object.freeze({ ...classification }),
      }] as const
    })
    for (const [toolName] of normalized) {
      const existing = this.semantics.get(toolName)
      if (existing !== undefined) {
        throw new Error(`auto-review: tool ${JSON.stringify(toolName)} is already claimed by action semantics ${JSON.stringify(existing.owner)}`)
      }
    }
    return this.ctx.effect(function* (this: ActionReviewRuntime) {
      for (const [toolName, value] of normalized) this.semantics.set(toolName, value)
      yield () => {
        for (const [toolName, value] of normalized) {
          if (this.semantics.get(toolName) === value) this.semantics.delete(toolName)
        }
      }
    }.bind(this), `actionReview.registerActionSemantics(${JSON.stringify(id)})`)
  }

  registerToolSecurityDescriptor(descriptor: ToolSecurityDescriptor): () => void {
    const id = descriptor.id.trim()
    if (id.length === 0) throw new TypeError('auto-review: tool security descriptor id must be non-empty')
    const names = [...new Set(descriptor.toolNames.map(name => name.trim()))]
    if (names.length === 0 || names.some(name => name.length === 0)) {
      throw new TypeError(`auto-review: tool security descriptor ${JSON.stringify(id)} must name at least one non-empty tool`)
    }
    for (const name of names) {
      const existing = this.descriptors.get(name)
      if (existing !== undefined) {
        throw new Error(`auto-review: tool ${JSON.stringify(name)} is already claimed by security descriptor ${JSON.stringify(existing.owner)}`)
      }
    }
    return this.ctx.effect(function* (this: ActionReviewRuntime) {
      for (const name of names) this.descriptors.set(name, { owner: id, descriptor })
      yield () => {
        for (const name of names) {
          if (this.descriptors.get(name)?.descriptor === descriptor) this.descriptors.delete(name)
        }
      }
    }.bind(this), `actionReview.registerToolSecurityDescriptor(${JSON.stringify(id)})`)
  }

  securityDescriptorFor(toolName: string): { resolverId: string; descriptor: ToolSecurityDescriptor } | undefined {
    const value = this.descriptors.get(toolName)
    return value === undefined ? undefined : Object.freeze({ resolverId: value.owner, descriptor: value.descriptor })
  }

  classificationFor(toolName: string): { resolverId: string; classification: ActionClassification } | undefined {
    const value = this.semantics.get(toolName)
    return value === undefined
      ? undefined
      : Object.freeze({ resolverId: value.owner, classification: value.classification })
  }

  hardDenyReason(action: ActionEnvelope): string | undefined {
    return action.disposition === 'hard-deny'
      ? `Auto Review hard policy denied ${action.toolName}: ${action.reason}`
      : undefined
  }

  issueTicket(request: TicketIssueRequest): ActionExecutionTicket {
    if (this.tickets.has(request.token)) throw new Error('auto-review: execution token already has a ticket')
    const issuedAt = Date.now()
    const unsigned = {
      schemaVersion: 1 as const,
      ticketId: randomUUID(),
      actionId: request.action.actionId,
      actionDigest: request.action.actionDigest,
      policyDigest: request.action.policyDigest,
      boundaryDigest: request.action.boundaryDigest,
      ...(request.action.authority.sessionId === undefined ? {} : { sessionId: request.action.authority.sessionId }),
      callId: request.action.callId,
      grant: request.grant,
      issuedAt,
      expiresAt: issuedAt + this.config.ticketTtlMs,
      nonce: randomBytes(16).toString('hex'),
    }
    const ticket = freezeJson({
      ...unsigned,
      mac: createHmac('sha256', this.ticketSecret).update(canonicalJson(toJsonValue(unsigned))).digest('hex'),
    }) as ActionExecutionTicket
    this.tickets.set(request.token, ticket)
    this.recordAudit('ticket', {
      state: 'issued', ticketId: ticket.ticketId, actionId: ticket.actionId,
      actionDigest: ticket.actionDigest, policyDigest: ticket.policyDigest,
      boundaryDigest: ticket.boundaryDigest, callId: ticket.callId, grant: ticket.grant, at: issuedAt,
    }, ticket.sessionId)
    return ticket
  }

  consumeTicket(token: ToolExecutionToken, action: ActionEnvelope): string | undefined {
    const ticket = this.tickets.get(token)
    if (ticket === undefined) return 'Auto Review denied dispatch: no execution ticket was issued.'
    this.tickets.delete(token)
    const unsigned = { ...ticket } as Record<string, unknown>
    delete unsigned.mac
    const expected = createHmac('sha256', this.ticketSecret).update(canonicalJson(toJsonValue(unsigned))).digest('hex')
    const authentic = ticket.mac.length === expected.length
      && timingSafeEqual(Buffer.from(ticket.mac, 'hex'), Buffer.from(expected, 'hex'))
    const now = Date.now()
    const mismatch = !authentic
      ? 'ticket authentication failed'
      : now > ticket.expiresAt
        ? 'ticket expired before dispatch'
        : ticket.actionDigest !== action.actionDigest || ticket.policyDigest !== action.policyDigest
          || ticket.boundaryDigest !== action.boundaryDigest || ticket.callId !== action.callId
          ? 'ticket does not match the exact action, policy, boundary, and call'
          : undefined
    this.recordAudit('ticket', {
      state: mismatch === undefined ? 'consumed' : now > ticket.expiresAt ? 'expired' : 'rejected',
      ticketId: ticket.ticketId, actionId: ticket.actionId, actionDigest: ticket.actionDigest,
      policyDigest: ticket.policyDigest, boundaryDigest: ticket.boundaryDigest,
      callId: ticket.callId, grant: ticket.grant, at: now, ...(mismatch === undefined ? {} : { reason: mismatch }),
    }, ticket.sessionId)
    return mismatch === undefined ? undefined : `Auto Review denied dispatch: ${mismatch}.`
  }

  discardTicket(token: ToolExecutionToken): void {
    this.tickets.delete(token)
  }

  armDeniedOverride(sessionId: string, requestedDigest?: string): string {
    const denied = this.lastDenied.get(sessionId)
    if (denied === undefined) throw new Error('auto-review: this session has no denied action to approve')
    if (requestedDigest !== undefined && requestedDigest !== denied.actionDigest) {
      throw new Error('auto-review: requested digest does not match the latest denied action')
    }
    const actionDigest = denied.actionDigest
    if (!/^[a-f0-9]{64}$/u.test(actionDigest)) throw new TypeError('auto-review: override requires an exact SHA-256 action digest')
    this.overrides.set(sessionId, {
      actionDigest,
      expiresAt: Date.now() + this.config.overrideTtlMs,
      retriesRemaining: 1,
    })
    this.recordAudit('override', { state: 'armed', sessionId, actionDigest, retriesRemaining: 1, at: Date.now() }, sessionId)
    return actionDigest
  }

  consumeExactOverride(action: ActionEnvelope): ActionEnvelope['authority']['exactApproval'] | undefined {
    const sessionId = action.authority.sessionId
    if (sessionId === undefined) return undefined
    const override = this.overrides.get(sessionId)
    if (override === undefined) return undefined
    if (Date.now() > override.expiresAt) {
      this.overrides.delete(sessionId)
      this.recordAudit('override', { state: 'expired', sessionId, actionDigest: override.actionDigest, retriesRemaining: 0, at: Date.now() }, sessionId)
      return undefined
    }
    if (override.actionDigest !== action.actionDigest || override.retriesRemaining !== 1) return undefined
    this.overrides.delete(sessionId)
    const approvedAt = Date.now()
    this.recordAudit('override', { state: 'consumed', sessionId, actionDigest: override.actionDigest, retriesRemaining: 0, at: approvedAt }, sessionId)
    return Object.freeze({ actionDigest: override.actionDigest, approvedAt, source: 'human-command' as const })
  }

  reviewPaused(action: ActionEnvelope): boolean {
    return this.denialStates.get(this.denialKey(action))?.paused ?? false
  }

  observeRoutedAction(action: ActionEnvelope): 'none' | 'exact-retry' | 'equivalent-retry' | 'different' {
    const sessionId = action.authority.sessionId
    if (sessionId === undefined) return 'none'
    const pending = this.pendingDenials.get(sessionId)
    if (pending === undefined) return 'none'
    const actionEffectDigest = action.effectDigest ?? action.actionDigest
    const same = pending.actionDigest === action.actionDigest
    const equivalent = !same && pending.effectDigest === actionEffectDigest
    this.recordAudit('postDenial', {
      outcome: same ? 'retried-denied-action' : equivalent ? 'retried-equivalent-effect' : 'continued-with-different-action',
      deniedActionDigest: pending.actionDigest,
      deniedEffectDigest: pending.effectDigest,
      nextActionDigest: action.actionDigest,
      nextEffectDigest: actionEffectDigest,
      turn: pending.turn,
      saferAlternativeSuggested: pending.saferAlternativeSuggested,
      at: Date.now(),
    }, sessionId)
    if (!same && !equivalent) this.pendingDenials.delete(sessionId)
    return same ? 'exact-retry' : equivalent ? 'equivalent-retry' : 'different'
  }

  observeTurnEnd(sessionId: string, turn: number): void {
    const pending = this.pendingDenials.get(sessionId)
    if (pending === undefined || pending.turn !== turn) return
    this.pendingDenials.delete(sessionId)
    this.recordAudit('postDenial', {
      outcome: 'stopped-after-denial',
      deniedActionDigest: pending.actionDigest,
      deniedEffectDigest: pending.effectDigest,
      turn,
      saferAlternativeSuggested: pending.saferAlternativeSuggested,
      at: Date.now(),
    }, sessionId)
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
    const indicatorSessionId = action.authority.sessionId ?? session?.id
    const indicatorEligible = action.disposition === 'review' && indicatorSessionId !== undefined
    let reviewerInvoked = false
    if (this.reviewPaused(action)) {
      return Object.freeze({
        schemaVersion: 1,
        outcome: 'manual',
        riskLevel: 'high',
        rationale: 'Automatic review is paused for this turn after repeated denials.',
        policyRuleIds: Object.freeze(['AR-DENIAL-BREAKER']),
        uncertainty: 'A human must approve an exact action digest or continue without the denied capability.',
      })
    }
    const reviewer = this.reviewer
    let decision: ReviewDecision
    if (reviewer === undefined) {
      decision = unavailableDecision('No Auto Review provider is mounted.')
    } else if (this.breakerUntil > startedAt) {
      decision = unavailableDecision(`Auto Review circuit breaker is open until ${this.breakerUntil}.`)
    } else {
      try {
        if (indicatorEligible) {
          this.setReviewIndicator(action, indicatorSessionId, 'reviewing', startedAt)
          reviewerInvoked = true
        }
        decision = await reviewer.review({ action, signal })
        signal.throwIfAborted()
        if (decision.outcome === 'unavailable') this.recordFailure(session)
        else this.recordSuccess(session)
      } catch (error) {
        if (indicatorEligible && reviewerInvoked) this.setReviewIndicator(action, indicatorSessionId, undefined, startedAt)
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
    this.recordReviewOutcome(action, decision, session)
    const finishedAt = Date.now()
    if (indicatorEligible && reviewerInvoked) {
      this.setReviewIndicator(
        action,
        indicatorSessionId,
        effective.outcome === 'denied' ? 'denied' : undefined,
        startedAt,
        finishedAt,
      )
    }
    this.recordAudit('decision', {
      schemaVersion: 1,
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      effectDigest: action.effectDigest ?? action.actionDigest,
      callId: action.callId,
      rootCallId: action.rootCallId,
      toolName: action.toolName,
      actionKind: action.actionKind,
      disposition: action.disposition,
      turn: action.authority.turn ?? 0,
      mode: this.config.mode,
      ...(reviewer === undefined ? {} : { reviewer: reviewer.id }),
      decision,
      startedAt,
      finishedAt,
      latencyMs: finishedAt - startedAt,
    }, session?.id)
    return effective
  }

  private recordFailure(session: Session | undefined): void {
    this.failures += 1
    if (this.failures < this.config.failureThreshold || this.breakerUntil > Date.now()) return
    this.breakerUntil = Date.now() + this.config.breakerCooldownMs
    this.recordAudit('breaker', {
      state: 'opened', reason: 'reviewer-failure', failures: this.failures, until: this.breakerUntil,
    }, session?.id)
  }

  private recordSuccess(session: Session | undefined): void {
    if (this.failures === 0 && this.breakerUntil === 0) return
    this.failures = 0
    this.breakerUntil = 0
    this.recordAudit('breaker', { state: 'closed', reason: 'reviewer-failure', failures: 0 }, session?.id)
  }

  private denialKey(action: ActionEnvelope): string {
    return `${action.authority.sessionId ?? '<unscoped>'}\u0000${action.authority.turn ?? 0}`
  }

  private recordReviewOutcome(action: ActionEnvelope, decision: ReviewDecision, session: Session | undefined): void {
    if (decision.outcome === 'unavailable') return
    const key = this.denialKey(action)
    const state = this.denialStates.get(key) ?? { consecutive: 0, recent: [], paused: false }
    const denied = decision.outcome === 'denied'
    if (denied && action.authority.sessionId !== undefined) {
      this.lastDenied.set(action.authority.sessionId, {
        actionDigest: action.actionDigest,
        turn: action.authority.turn ?? 0,
        deniedAt: Date.now(),
      })
      this.pendingDenials.set(action.authority.sessionId, {
        actionDigest: action.actionDigest,
        effectDigest: action.effectDigest ?? action.actionDigest,
        turn: action.authority.turn ?? 0,
        saferAlternativeSuggested: decision.saferAlternative !== undefined,
      })
    } else if (action.authority.sessionId !== undefined) {
      this.lastDenied.delete(action.authority.sessionId)
      this.pendingDenials.delete(action.authority.sessionId)
    }
    state.consecutive = denied ? state.consecutive + 1 : 0
    state.recent.push(denied)
    if (state.recent.length > this.config.denialWindowSize) state.recent.shift()
    const recentDenials = state.recent.filter(Boolean).length
    const mustPause = state.consecutive >= this.config.denialConsecutiveLimit
      || recentDenials >= this.config.denialWindowLimit
    if (mustPause && !state.paused) {
      state.paused = true
      this.recordAudit('breaker', {
        state: 'opened', reason: 'denial-rate', consecutiveDenials: state.consecutive,
        recentDenials, recentWindow: state.recent.length,
      }, session?.id)
    }
    this.denialStates.set(key, state)
  }

  private applyMetrics(state: MutableMetrics, record: AutoReviewAuditEnvelope): void {
    switch (record.kind) {
      case 'routed': {
        const data = record.data as AutoReviewAuditPayloadMap['routed']
        state.totalActions += 1
        if (data.disposition === 'inside-boundary') state.insideBoundary += 1
        if (data.disposition === 'hard-deny') state.hardDenied += 1
        state.byActionKind.set(data.actionKind, (state.byActionKind.get(data.actionKind) ?? 0) + 1)
        break
      }
      case 'decision': {
        const data = record.data as AutoReviewAuditPayloadMap['decision']
        state.autoReviewed += 1
        switch (data.decision.outcome) {
          case 'approved': state.approved += 1; break
          case 'denied': state.denied += 1; break
          case 'manual': state.manual += 1; break
          case 'unavailable': state.unavailable += 1; break
        }
        state.reviewerLatencyCount += 1
        state.reviewerLatencySum += data.latencyMs
        state.reviewerLatencyMax = Math.max(state.reviewerLatencyMax, data.latencyMs)
        const policy = data.decision.reviewerExecution?.policyRetrieval
        if (policy !== undefined) {
          state.policyOutlineCalls += policy.outlineCalls
          state.policySearchCalls += policy.searchCalls
          state.policyGetCalls += policy.getCalls
          state.policyResultBytes += policy.resultBytes
        }
        break
      }
      case 'result': {
        const data = record.data as AutoReviewAuditPayloadMap['result']
        if (data.finalOutcome === 'success') state.successfulActions += 1
        else state.failedActions += 1
        break
      }
      case 'ticket': {
        const data = record.data as AutoReviewAuditPayloadMap['ticket']
        if (data.state === 'rejected' || data.state === 'expired') state.ticketRejected += 1
        break
      }
      case 'postDenial': {
        const data = record.data as AutoReviewAuditPayloadMap['postDenial']
        if (data.outcome === 'retried-denied-action') state.retriedDeniedAction += 1
        else if (data.outcome === 'retried-equivalent-effect') state.retriedEquivalentEffect += 1
        else if (data.outcome === 'continued-with-different-action') state.continuedWithDifferentAction += 1
        else state.stoppedAfterDenial += 1
        break
      }
      default:
        break
    }
  }
}

export default ActionReviewRuntime
