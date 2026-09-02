import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ReviewDecision } from './types.ts'

// Core serde integration only. Risk classification remains the reviewer model's
// responsibility; this adapter must not be advertised as a Guardian engine port.
const UPSTREAM = '9f97cb79eb15b38d24c552c56fe24e211ff9cf3a'
const METHOD = 'parse_core_review_decision'
const PACKAGE = '@dsh/codex-approval-bridge-host'
interface Host {
  readonly pid?: number
  createSession(): unknown
  request(session: unknown, method: string, wire: string, options: { signal: AbortSignal }): Promise<unknown>
  closeSession(session: unknown): Promise<void>
  close(): Promise<void>
}
let hostPromise: Promise<Host> | undefined
let shuttingDown = false

export class NativeApprovalProtocolError extends Error {
  override readonly name = 'NativeApprovalProtocolError'
  constructor(readonly failureKind: string) {
    super('Native approval protocol is unavailable; automatic approval is prohibited.')
  }
}

function host(): Promise<Host> {
  if (shuttingDown) return Promise.reject(new NativeApprovalProtocolError('shutdown'))
  hostPromise ??= import(PACKAGE).then(module => {
    const acquired = module.acquireCodexApprovalBridge() as Host
    // One shared owner for the host process, not one process per model turn.
    // Session handles are always released below. Application shutdown may use
    // the explicit terminal shutdown hook; exit cleanup must remain synchronous.
    process.once('exit', () => {
      if (acquired.pid !== undefined) {
        try { process.kill(acquired.pid, 'SIGKILL') } catch { /* already exited */ }
      }
    })
    return acquired
  }).catch(error => {
    hostPromise = undefined
    throw error
  })
  return hostPromise
}

/** Terminal host shutdown, not a per-session disposer or a hot-reload hook. */
export async function shutdownNativeApprovalBridge(): Promise<void> {
  shuttingDown = true
  if (hostPromise !== undefined) await (await hostPromise).close()
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
const object = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

export async function validateNativeApprovalDecision(
  ctx: Context,
  decision: ReviewDecision,
  reviewerSessionId: string,
  parentSessionId: string | undefined,
  signal: AbortSignal,
): Promise<ReviewDecision> {
  // Manual/unavailable never becomes a Core approval and never receives a grant.
  if (decision.outcome !== 'approved' && decision.outcome !== 'denied') return decision
  const core = decision.outcome === 'approved'
    ? 'approved'
    : { denied: { rejection: decision.rationale } }
  const wire = JSON.stringify(core)
  const base = {
    method: METHOD as typeof METHOD,
    reviewerSessionId,
    protocol: 'codex-core-review-decision' as const,
    upstreamCommit: UPSTREAM,
    wireSha256: digest(wire),
  }
  let owner: Host | undefined, session: unknown, opened = false
  try {
    signal.throwIfAborted()
    ctx.actionReview.recordAudit('native-protocol', { ...base, status: 'preflight', at: Date.now() }, parentSessionId)
    owner = await host()
    signal.throwIfAborted()
    session = owner.createSession()
    opened = true
    const result = await owner.request(session, METHOD, wire, { signal })
    signal.throwIfAborted()
    if (!object(result) || typeof result.canonicalWire !== 'string'
      || !object(result.ir) || result.ir.schemaVersion !== 1) {
      throw new NativeApprovalProtocolError('invalid-result')
    }
    // Consume the native IR, not the pre-native model outcome. This adapter
    // deliberately accepts no session/amendment grants not requested by DSH.
    const native = result.ir.decision
    let outcome: 'approved' | 'denied'
    if (native === 'approved' && decision.outcome === 'approved') outcome = 'approved'
    else if (object(native) && Object.keys(native).length === 1
      && object(native.denied) && Object.keys(native.denied).length === 1
      && native.denied.rejection === decision.rationale && decision.outcome === 'denied') outcome = 'denied'
    else throw new NativeApprovalProtocolError('decision-mismatch')
    if (JSON.stringify(JSON.parse(result.canonicalWire)) !== wire) {
      throw new NativeApprovalProtocolError('wire-mismatch')
    }
    await owner.closeSession(session)
    opened = false
    signal.throwIfAborted()
    ctx.actionReview.recordAudit('native-protocol', {
      ...base, status: 'validated', outcome, resultSha256: digest(result.canonicalWire), at: Date.now(),
    }, parentSessionId)
    return Object.freeze({ ...decision, outcome })
  } catch (error) {
    const failureKind = error instanceof NativeApprovalProtocolError ? error.failureKind
      : signal.aborted ? 'cancelled'
        : object(error) && typeof error.kind === 'string' ? error.kind : 'bridge-unavailable'
    ctx.actionReview.recordAudit('native-protocol', {
      ...base, status: 'error', failureKind, at: Date.now(),
    }, parentSessionId)
    throw new NativeApprovalProtocolError(failureKind)
  } finally {
    if (opened && owner !== undefined) {
      try { await owner.closeSession(session) } catch { /* original error already fails closed */ }
    }
  }
}
