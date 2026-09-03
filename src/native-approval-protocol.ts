import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ReviewDecision } from './types.ts'

// Core serde integration only. Risk classification remains the reviewer model's
// responsibility; this adapter must not be advertised as a Guardian engine port.
const UPSTREAM = '9f97cb79eb15b38d24c552c56fe24e211ff9cf3a'
const METHOD = 'parse_core_review_decision'
const PACKAGE = '@jhckevin/dsh-auto-review-bridge-host'
interface Host {
  readonly pid?: number
  createSession(): unknown
  request(session: unknown, method: string, wire: string, options: { signal: AbortSignal }): Promise<unknown>
  closeSession(session: unknown): Promise<void>
  close(): Promise<void>
}
const activeScopes = new Set<NativeApprovalScope>()

export class NativeApprovalProtocolError extends Error {
  override readonly name = 'NativeApprovalProtocolError'
  constructor(readonly failureKind: string) {
    super('Native approval protocol is unavailable; automatic approval is prohibited.')
  }
}

/** One native owner per provider activation. Never borrow the legacy singleton. */
export class NativeApprovalScope {
  private readonly controller = new AbortController()
  private hostPromise: Promise<Host> | undefined
  private closePromise?: Promise<void>
  private exitHandler?: () => void
  readonly signal = this.controller.signal

  async host(): Promise<Host> {
    if (this.signal.aborted) throw new NativeApprovalProtocolError('shutdown')
    this.hostPromise ??= import(PACKAGE).then(module => {
      if (this.signal.aborted) throw new NativeApprovalProtocolError('shutdown')
      if (typeof module.createCodexApprovalBridge !== 'function') {
        throw new NativeApprovalProtocolError('host-api-version')
      }
      const acquired = module.createCodexApprovalBridge() as Host
      this.exitHandler = () => {
        if (acquired.pid !== undefined) {
          try { process.kill(acquired.pid, 'SIGKILL') } catch { /* already exited */ }
        }
      }
      process.once('exit', this.exitHandler)
      activeScopes.add(this)
      return acquired
    }).catch(error => {
      if (!this.signal.aborted) this.hostPromise = undefined
      throw error
    })
    return this.hostPromise
  }

  /** Abort synchronously; await only this activation's child-process cleanup. */
  dispose(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.controller.abort(new NativeApprovalProtocolError('shutdown'))
    this.closePromise = (async () => {
      try {
        const acquired = await this.hostPromise?.catch(() => undefined)
        if (acquired !== undefined) await acquired.close()
      } finally {
        if (this.exitHandler !== undefined) process.off('exit', this.exitHandler)
        activeScopes.delete(this)
      }
    })()
    return this.closePromise
  }
}

/** Close currently acquired owners; a later plugin activation gets a fresh scope. */
export async function shutdownNativeApprovalBridge(): Promise<void> {
  await Promise.all([...activeScopes].map(scope => scope.dispose()))
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
  providerScope?: NativeApprovalScope,
): Promise<ReviewDecision> {
  // Manual/unavailable never becomes a Core approval and never receives a grant.
  if (decision.outcome !== 'approved' && decision.outcome !== 'denied') return decision
  const scope = providerScope ?? new NativeApprovalScope()
  const callerSignal = signal
  signal = AbortSignal.any([signal, scope.signal])
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
    owner = await scope.host()
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
    // Standalone callers do not retain a child process beyond this validation.
    if (providerScope === undefined) await scope.dispose()
    callerSignal.throwIfAborted()
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
    if (providerScope === undefined) await scope.dispose()
  }
}
