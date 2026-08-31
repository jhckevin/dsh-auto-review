import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import {
  createUserMessage,
  ReasoningEffortId,
  type ContentBlock,
} from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { guardianBootstrapPrompt } from './policy-corpus.ts'
import { parseReviewDecision, ReviewProtocolError } from './protocol.ts'
import { redactJson } from './redaction.ts'
import { installReviewerPolicyTools } from './reviewer-policy-tools.ts'
import { STRONG_REVIEW_KINDS } from './settings.ts'
import {
  unavailableDecision,
  type ActionKind,
  type ActionReviewer,
  type AutoReviewUiSettings,
  type LlmReviewerConfig,
  type ReviewDecision,
  type ReviewerFailureCategory,
} from './types.ts'

export const name = 'auto-review-llm-provider'
export const inject = ['actionReview', 'agents', 'systemPrompt', 'tools']

export const Config: z<LlmReviewerConfig> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
  modelStrategy: z.union(['single', 'risk-tiered'] as const).default('single'),
  strongProvider: z.string(),
  strongModel: z.string(),
  strongReasoningEffort: z.string(),
  strongReviewKinds: z.array(z.union([
    'workspace-read', 'workspace-write', 'process', 'network', 'sensitive-read', 'destructive',
    'permission-change', 'production-change', 'sandbox-escalation', 'extension-unknown', 'hard-deny',
  ] as ActionKind[])),
  escalateUncertainToStrong: z.boolean().default(true),
  maxInputBytes: z.number().step(1).min(1).required(),
  maxOutputTokens: z.number().step(1).min(1).required(),
  timeoutMs: z.number().step(1).min(1).required(),
  maxAttempts: z.number().step(1).min(1).max(3).default(3),
  retryDelayMs: z.number().step(1).min(0).default(250),
  transcriptMaxEntries: z.number().step(1).min(1).max(64).default(12),
  transcriptMaxBytes: z.number().step(1).min(1).default(32768),
})

const SYSTEM = guardianBootstrapPrompt()

interface ValidatedReviewerConfig {
  provider: string
  model: string
  reasoningEffort?: string
  modelStrategy: 'single' | 'risk-tiered'
  strongProvider: string
  strongModel: string
  strongReasoningEffort?: string
  strongReviewKinds: ActionKind[]
  escalateUncertainToStrong: boolean
  maxInputBytes: number
  maxOutputTokens: number
  timeoutMs: number
  maxAttempts: number
  retryDelayMs: number
  transcriptMaxEntries: number
  transcriptMaxBytes: number
}

function normalizedEffort(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function validateConfig(config: LlmReviewerConfig): ValidatedReviewerConfig {
  if (config.provider.trim().length === 0 || config.model.trim().length === 0) {
    throw new TypeError('auto-review: provider and model must be non-empty')
  }
  const { reasoningEffort: _reasoningEffort, strongReasoningEffort: _strongReasoningEffort, ...base } = config
  const reasoningEffort = normalizedEffort(config.reasoningEffort)
  const strongReasoningEffort = normalizedEffort(config.strongReasoningEffort ?? config.reasoningEffort)
  const resolved = {
    ...base,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    modelStrategy: config.modelStrategy ?? 'single',
    strongProvider: config.strongProvider?.trim() || config.provider,
    strongModel: config.strongModel?.trim() || config.model,
    ...(strongReasoningEffort === undefined ? {} : { strongReasoningEffort }),
    strongReviewKinds: [...(config.strongReviewKinds ?? STRONG_REVIEW_KINDS)],
    escalateUncertainToStrong: config.escalateUncertainToStrong ?? true,
    maxAttempts: config.maxAttempts ?? 3,
    retryDelayMs: config.retryDelayMs ?? 250,
    transcriptMaxEntries: config.transcriptMaxEntries ?? 12,
    transcriptMaxBytes: config.transcriptMaxBytes ?? 32768,
  }
  for (const key of ['maxInputBytes', 'maxOutputTokens', 'timeoutMs', 'maxAttempts', 'transcriptMaxEntries', 'transcriptMaxBytes'] as const) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 1) {
      throw new TypeError(`auto-review: ${key} must be a positive safe integer`)
    }
  }
  if (!Number.isSafeInteger(resolved.retryDelayMs) || resolved.retryDelayMs < 0) {
    throw new TypeError('auto-review: retryDelayMs must be a non-negative safe integer')
  }
  if (resolved.maxAttempts > 3) throw new TypeError('auto-review: maxAttempts cannot exceed 3')
  if (resolved.strongProvider.length === 0 || resolved.strongModel.length === 0) {
    throw new TypeError('auto-review: strong provider and model must be non-empty')
  }
  return resolved
}

function configFromSettings(deployed: ValidatedReviewerConfig, ui: AutoReviewUiSettings | undefined): ValidatedReviewerConfig {
  if (ui === undefined) return deployed
  const primaryEffort = normalizedEffort(ui.primaryReasoningEffort)
  const strongEffort = normalizedEffort(ui.strongReasoningEffort)
  const { reasoningEffort: _deployedEffort, strongReasoningEffort: _deployedStrongEffort, ...base } = deployed
  return validateConfig({
    ...base,
    provider: ui.primaryProvider,
    model: ui.primaryModel,
    ...(primaryEffort === undefined ? {} : { reasoningEffort: primaryEffort }),
    modelStrategy: ui.modelStrategy,
    strongProvider: ui.strongProvider,
    strongModel: ui.strongModel,
    ...(strongEffort === undefined ? {} : { strongReasoningEffort: strongEffort }),
    strongReviewKinds: [...ui.strongReviewKinds],
    escalateUncertainToStrong: ui.escalateUncertainToStrong,
    maxInputBytes: ui.maxInputBytes,
    maxOutputTokens: ui.maxOutputTokens,
    timeoutMs: ui.timeoutMs,
    maxAttempts: ui.maxAttempts,
    transcriptMaxEntries: ui.transcriptMaxEntries,
    transcriptMaxBytes: ui.transcriptMaxBytes,
  })
}

function transcriptWithinBudget(
  entries: readonly { role: string; trust: string; text: string }[],
  maxEntries: number,
  maxBytes: number,
): readonly { role: string; trust: string; text: string }[] {
  const selected: Array<{ role: string; trust: string; text: string }> = []
  let bytes = 0
  for (const entry of entries.slice(-maxEntries).reverse()) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8')
    if (bytes + entryBytes > maxBytes) break
    selected.push(entry)
    bytes += entryBytes
  }
  return Object.freeze(selected.reverse())
}

function reviewerPayload(config: ReturnType<typeof validateConfig>, action: Parameters<ActionReviewer['review']>[0]['action']): string {
  const payload = JSON.stringify({
    schemaVersion: 1,
    evidenceTrustPolicy: {
      authority: ['trusted-user-intent'],
      untrusted: ['untrusted-model', 'untrusted-tool-output', 'action-arguments', 'tool-description'],
    },
    action: {
      actionId: action.actionId,
      actionDigest: action.actionDigest,
      effectDigest: action.effectDigest ?? action.actionDigest,
      policyDigest: action.policyDigest,
      boundaryDigest: action.boundaryDigest,
      toolName: action.toolName,
      arguments: redactJson(action.arguments),
      effects: action.effects,
      actionKind: action.actionKind,
      disposition: action.disposition,
      reason: action.reason,
      policy: action.policy,
      boundary: action.boundary,
      sandbox: action.sandbox,
      paths: action.paths,
      authority: {
        sessionId: action.authority.sessionId,
        turn: action.authority.turn,
        currentUserRequest: action.authority.currentUserRequest,
        exactApproval: action.authority.exactApproval,
        transcript: transcriptWithinBudget(
          action.authority.transcript,
          config.transcriptMaxEntries,
          config.transcriptMaxBytes,
        ),
      },
      ...(action.requestedEscalation === undefined ? {} : { requestedEscalation: action.requestedEscalation }),
    },
  })
  const bytes = Buffer.byteLength(payload, 'utf8')
  if (bytes > config.maxInputBytes) {
    throw new Error(`auto-review: redacted reviewer input is ${bytes} bytes, exceeding maxInputBytes ${config.maxInputBytes}`)
  }
  return payload
}

function finalAssistantContent(events: readonly SessionEvent[]): readonly ContentBlock[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'assistant/message' && event.data.message.content.length > 0) {
      return event.data.message.content
    }
  }
  throw new Error('auto-review: reviewer agent produced no assistant message')
}

function decisionFromSession(events: readonly SessionEvent[]): ReviewDecision {
  const blocks = finalAssistantContent(events)
  if (blocks.some(block => block.type !== 'text')) {
    throw new TypeError('auto-review: reviewer response must contain text only')
  }
  return parseReviewDecision(blocks.map(block => block.type === 'text' ? block.text : '').join(''))
}

interface PolicyRetrievalStats {
  readonly outlineCalls: number
  readonly searchCalls: number
  readonly getCalls: number
  readonly resultBytes: number
}

interface ReviewerAttempt {
  readonly decision: ReviewDecision
  readonly policyRetrieval: PolicyRetrievalStats
  readonly attempts: number
  readonly failureCategories: readonly ReviewerFailureCategory[]
}

class ReviewerAttemptError extends Error {
  override readonly name = 'ReviewerAttemptError'

  constructor(
    readonly original: unknown,
    readonly policyRetrieval: PolicyRetrievalStats,
  ) {
    super(original instanceof Error ? original.message : 'auto-review reviewer attempt failed')
  }
}

function combinePolicyRetrieval(left: PolicyRetrievalStats, right: PolicyRetrievalStats): PolicyRetrievalStats {
  return Object.freeze({
    outlineCalls: left.outlineCalls + right.outlineCalls,
    searchCalls: left.searchCalls + right.searchCalls,
    getCalls: left.getCalls + right.getCalls,
    resultBytes: left.resultBytes + right.resultBytes,
  })
}

function policyRetrievalStats(events: readonly SessionEvent[]): PolicyRetrievalStats {
  let outlineCalls = 0
  let searchCalls = 0
  let getCalls = 0
  let resultBytes = 0
  for (const event of events) {
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type !== 'tool-call') continue
        if (block.name === 'guardian_policy_outline') outlineCalls += 1
        else if (block.name === 'guardian_policy_search') searchCalls += 1
        else if (block.name === 'guardian_policy_get') getCalls += 1
      }
    } else if (event.type === 'tool/result') {
      resultBytes += Buffer.byteLength(JSON.stringify(event.data), 'utf8')
    }
  }
  return Object.freeze({ outlineCalls, searchCalls, getCalls, resultBytes })
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const done = (): void => {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(done, ms)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function waitForIdle(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      () => {
        signal.removeEventListener('abort', abort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

async function runAttempt(
  ctx: Context,
  config: ReturnType<typeof validateConfig>,
  payload: string,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<ReviewerAttempt> {
  const selection = {
    current: {
      provider: config.provider,
      model: config.model,
      ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(config.reasoningEffort) }),
    },
    assembled: undefined,
  }
  const handle = await ctx.agents.create({
    sessionId: SessionId(`auto-review-${randomUUID()}`),
    meta: { cwd: workspaceRoot },
    agentOptions: {
      provider: config.provider,
      model: config.model,
      maxTokens: config.maxOutputTokens,
    },
    signal,
    setup(reviewerCtx) {
      reviewerCtx.tools.restrict({ allow: [] })
      installReviewerPolicyTools(reviewerCtx)
      installModelSelection(reviewerCtx, selection)
      reviewerCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembled = await next()
        return {
          ...assembled,
          sections: [{ name: 'auto-review:system', order: 0, text: SYSTEM }],
          contexts: [],
          tools: assembled.tools,
        }
      }, { prepend: true })
    },
  })
  const unmarkReviewer = ctx.actionReview.registerReviewerSession(handle.agent.session)
  try {
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: payload }],
      source: { kind: 'plugin', plugin: 'dsh-auto-review' },
    }))
    await waitForIdle(handle.agent.whenIdle(), signal)
    signal.throwIfAborted()
    const policyRetrieval = policyRetrievalStats(handle.agent.session.events)
    try {
      return Object.freeze({
        decision: decisionFromSession(handle.agent.session.events),
        policyRetrieval,
        attempts: 1,
        failureCategories: Object.freeze([]),
      })
    } catch (error) {
      throw new ReviewerAttemptError(error, policyRetrieval)
    }
  } finally {
    try {
      await handle.dispose()
    } finally {
      unmarkReviewer()
    }
  }
}

function selectedProfile(config: ValidatedReviewerConfig, tier: 'primary' | 'strong'): ValidatedReviewerConfig {
  if (tier === 'primary') return config
  const { reasoningEffort: _reasoningEffort, ...base } = config
  return {
    ...base,
    provider: config.strongProvider,
    model: config.strongModel,
    ...(config.strongReasoningEffort === undefined ? {} : { reasoningEffort: config.strongReasoningEffort }),
  }
}

function withReviewerExecution(
  decision: ReviewDecision,
  config: ValidatedReviewerConfig,
  tier: 'primary' | 'strong',
  escalatedFrom?: ValidatedReviewerConfig,
  policyRetrieval: PolicyRetrievalStats = { outlineCalls: 0, searchCalls: 0, getCalls: 0, resultBytes: 0 },
  attempts = 1,
  failureCategories: readonly ReviewerFailureCategory[] = [],
): ReviewDecision {
  return Object.freeze({
    ...decision,
    reviewerExecution: Object.freeze({
      tier,
      provider: config.provider,
      model: config.model,
      attempts,
      failureCategories: Object.freeze([...failureCategories]),
      policyRetrieval: Object.freeze({ ...policyRetrieval }),
      ...(escalatedFrom === undefined ? {} : {
        escalatedFrom: Object.freeze({ provider: escalatedFrom.provider, model: escalatedFrom.model }),
      }),
    }),
  })
}

function failureCategory(error: unknown): ReviewerFailureCategory {
  const original = error instanceof ReviewerAttemptError ? error.original : error
  if (original instanceof ReviewProtocolError
    || (error instanceof ReviewerAttemptError && original instanceof TypeError)) return 'protocol'
  const record = original !== null && typeof original === 'object'
    ? original as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown }
    : {}
  const status = Number(record.status ?? record.statusCode)
  const text = [
    typeof record.name === 'string' ? record.name : '',
    typeof record.code === 'string' ? record.code : '',
    typeof record.message === 'string' ? record.message : String(original),
  ].join(' ').toLowerCase()
  if (text.includes('abort')) return 'cancelled'
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout'
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)
    || /rate.?limit|temporar|overload|unavailable|connection|econn|reset|socket|gateway/.test(text)) {
    return 'provider-transient'
  }
  if (Number.isFinite(status) && status >= 400 && status < 500) return 'provider-terminal'
  return 'unknown'
}

function retryable(category: ReviewerFailureCategory): boolean {
  return category === 'protocol' || category === 'provider-transient'
}

function needsStrongReview(decision: ReviewDecision): boolean {
  return decision.riskLevel === 'high'
    || decision.riskLevel === 'critical'
    || decision.outcome === 'manual'
    || decision.outcome === 'unavailable'
    || decision.uncertainty.trim().length > 0
}

async function reviewWithProfile(
  ctx: Context,
  config: ValidatedReviewerConfig,
  payload: string,
  workspaceRoot: string,
  requestSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<ReviewerAttempt> {
  const signal = AbortSignal.any([requestSignal, timeoutSignal])
  let policyRetrieval: PolicyRetrievalStats = { outlineCalls: 0, searchCalls: 0, getCalls: 0, resultBytes: 0 }
  const failureCategories: ReviewerFailureCategory[] = []
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const result = await runAttempt(ctx, config, payload, workspaceRoot, signal)
      return Object.freeze({
        ...result,
        policyRetrieval: combinePolicyRetrieval(policyRetrieval, result.policyRetrieval),
        attempts: attempt,
        failureCategories: Object.freeze([...failureCategories]),
      })
    } catch (error) {
      if (error instanceof ReviewerAttemptError) {
        policyRetrieval = combinePolicyRetrieval(policyRetrieval, error.policyRetrieval)
      }
      const category = requestSignal.aborted
        ? 'cancelled'
        : timeoutSignal.aborted
          ? 'timeout'
          : failureCategory(error)
      failureCategories.push(category)
      if (requestSignal.aborted || timeoutSignal.aborted || !retryable(category) || attempt === config.maxAttempts) {
        return Object.freeze({
          decision: unavailableDecision(
            category === 'timeout'
              ? `Reviewer timed out after ${config.timeoutMs}ms.`
              : 'Reviewer did not produce a valid authoritative decision.',
          ),
          policyRetrieval,
          attempts: attempt,
          failureCategories: Object.freeze([...failureCategories]),
        })
      }
      const backoff = config.retryDelayMs * (2 ** (attempt - 1))
      try {
        await delay(backoff, signal)
      } catch {
        const interruptedCategory = requestSignal.aborted ? 'cancelled' : 'timeout'
        failureCategories.push(interruptedCategory)
        return Object.freeze({
          decision: unavailableDecision(
            interruptedCategory === 'timeout'
              ? `Reviewer timed out after ${config.timeoutMs}ms.`
              : 'Reviewer request was cancelled.',
          ),
          policyRetrieval,
          attempts: attempt,
          failureCategories: Object.freeze([...failureCategories]),
        })
      }
    }
  }
  throw new Error('auto-review: unreachable reviewer retry state')
}

export function apply(ctx: Context, input: LlmReviewerConfig): void {
  const deployed = validateConfig(input)
  ctx.actionReview.configureReviewerSettingsDefaults(deployed)
  const reviewer: ActionReviewer = {
    get id() {
      const config = configFromSettings(deployed, ctx.actionReview.uiSettings())
      return `agent:${config.modelStrategy}:${config.provider}/${config.model}`
    },
    async review(request) {
      request.signal.throwIfAborted()
      const config = configFromSettings(deployed, ctx.actionReview.uiSettings())
      const payload = reviewerPayload(config, request.action)
      const timeoutSignal = AbortSignal.timeout(config.timeoutMs)
      const directStrong = config.modelStrategy === 'risk-tiered'
        && config.strongReviewKinds.includes(request.action.actionKind)
      const firstTier = directStrong ? 'strong' as const : 'primary' as const
      const firstConfig = selectedProfile(config, firstTier)
      const first = await reviewWithProfile(
        ctx, firstConfig, payload, request.action.sandbox.workspaceRoot, request.signal, timeoutSignal,
      )
      if (
        config.modelStrategy === 'risk-tiered'
        && firstTier === 'primary'
        && config.escalateUncertainToStrong
        && needsStrongReview(first.decision)
      ) {
        const strong = selectedProfile(config, 'strong')
        const decision = await reviewWithProfile(
          ctx, strong, payload, request.action.sandbox.workspaceRoot, request.signal, timeoutSignal,
        )
        return withReviewerExecution(
          decision.decision, strong, 'strong', firstConfig,
          combinePolicyRetrieval(first.policyRetrieval, decision.policyRetrieval),
          first.attempts + decision.attempts,
          [...first.failureCategories, ...decision.failureCategories],
        )
      }
      return withReviewerExecution(
        first.decision, firstConfig, firstTier, undefined, first.policyRetrieval,
        first.attempts, first.failureCategories,
      )
    },
  }
  ctx.actionReview.registerReviewer(reviewer)
}
