import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ReviewDecision } from '../src/types.ts'

const fixture = vi.hoisted(() => ({
  request: vi.fn(), createSession: vi.fn(() => Object.freeze({})),
  closeSession: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
}))
vi.mock('@jhckevin/dsh-auto-review-bridge-host', () => ({ createCodexApprovalBridge: () => fixture }))
import { NativeApprovalScope, validateNativeApprovalDecision } from '../src/native-approval-protocol.ts'
const approved: ReviewDecision = {
  schemaVersion: 1, outcome: 'approved', riskLevel: 'low', rationale: 'allowed',
  policyRuleIds: [], uncertainty: '',
}
function runtime() {
  const records: Array<{ kind: string; data: any; sessionId?: string }> = []
  const ctx = { actionReview: { recordAudit(kind: string, data: unknown, sessionId?: string) {
    records.push({ kind, data, ...(sessionId ? { sessionId } : {}) })
  } } } as unknown as Context
  return { ctx, records }
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.request.mockImplementation(async (_session, _method, wire) => ({
    ir: { schemaVersion: 1, decision: JSON.parse(wire) }, canonicalWire: wire,
  }))
})
describe('native Core decision gate (mock transport unit tests; real package separately)', () => {
  it('retains an owner only for the supplied activation and permits reactivation', async () => {
    const { ctx } = runtime(), scope = new NativeApprovalScope()
    await validateNativeApprovalDecision(ctx, approved, 'r1', 'p', new AbortController().signal, scope)
    await validateNativeApprovalDecision(ctx, approved, 'r2', 'p', new AbortController().signal, scope)
    expect(fixture.close).not.toHaveBeenCalled()
    await scope.dispose()
    await scope.dispose()
    expect(fixture.close).toHaveBeenCalledTimes(1)
    await expect(validateNativeApprovalDecision(ctx, approved, 'old', 'p', new AbortController().signal, scope)).rejects.toThrow()
    const next = new NativeApprovalScope()
    await expect(validateNativeApprovalDecision(ctx, approved, 'new', 'p', new AbortController().signal, next)).resolves.toMatchObject({outcome: 'approved'})
    await next.dispose()
    expect(fixture.close).toHaveBeenCalledTimes(2)
  })
  it('cancels a pending native result on scope disposal and releases the exit listener', async () => {
    const { ctx, records } = runtime(), scope = new NativeApprovalScope()
    const listeners = process.listenerCount('exit')
    let entered!: () => void, complete!: (value: unknown) => void
    const started = new Promise<void>(resolve => { entered = resolve })
    fixture.request.mockImplementation(() => { entered(); return new Promise(resolve => { complete = resolve }) })
    const pending = validateNativeApprovalDecision(ctx, approved, 'r', 'p', new AbortController().signal, scope)
    const rejected = expect(pending).rejects.toMatchObject({failureKind: 'shutdown'})
    await started
    expect(process.listenerCount('exit')).toBe(listeners + 1)
    await scope.dispose()
    complete({ir: {schemaVersion: 1, decision: 'approved'}, canonicalWire: '\"approved\"'})
    await rejected
    expect(records.some(r => r.data.status === 'validated')).toBe(false)
    expect(process.listenerCount('exit')).toBe(listeners)
  })
  it('can dispose an unused scope without importing a native owner', async () => {
    const scope = new NativeApprovalScope()
    await scope.dispose()
    expect(fixture.close).not.toHaveBeenCalled()
    await expect(scope.host()).rejects.toMatchObject({failureKind: 'shutdown'})
  })
  it('passes exact approved wire through native and correlates audits', async () => {
    const { ctx, records } = runtime()
    expect((await validateNativeApprovalDecision(ctx, approved, 'review-1', 'parent', new AbortController().signal)).outcome).toBe('approved')
    expect(fixture.request.mock.calls[0]?.slice(1, 3)).toEqual(['parse_core_review_decision', '"approved"'])
    expect(fixture.closeSession).toHaveBeenCalledTimes(1)
    expect(records.map(r => r.data.status)).toEqual(['preflight', 'validated'])
    expect(records[1]).toMatchObject({ sessionId: 'parent', data: { reviewerSessionId: 'review-1', outcome: 'approved' } })
  })
  it('uses exact denied rejection and preserves saferAlternative', async () => {
    const { ctx } = runtime()
    const denial = { ...approved, outcome: 'denied' as const, rationale: 'Do not transmit.', saferAlternative: 'Use local metadata.' }
    expect(await validateNativeApprovalDecision(ctx, denial, 'r', 'p', new AbortController().signal)).toEqual(denial)
    expect(JSON.parse(fixture.request.mock.calls[0]?.[2])).toEqual({ denied: { rejection: denial.rationale } })
  })
  it.each(['approved_for_session', 'abort', { denied: { rejection: 'different' } }])('rejects unexpected native result %j', async result => {
    const { ctx, records } = runtime()
    fixture.request.mockResolvedValue({ ir: { schemaVersion: 1, decision: result }, canonicalWire: JSON.stringify(result) })
    await expect(validateNativeApprovalDecision(ctx, approved, 'r', 'p', new AbortController().signal)).rejects.toMatchObject({ failureKind: 'decision-mismatch' })
    expect(records.some(r => r.data.status === 'validated')).toBe(false)
    expect(fixture.closeSession).toHaveBeenCalledTimes(1)
  })
  it.each(['artifact', 'timeout', 'transport', 'serde'])('fails closed on %s without TS fallback', async kind => {
    const { ctx, records } = runtime()
    fixture.request.mockRejectedValue(Object.assign(new Error('not trusted'), { kind }))
    await expect(validateNativeApprovalDecision(ctx, approved, 'r', 'p', new AbortController().signal)).rejects.toMatchObject({ failureKind: kind })
    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(records.at(-1)?.data.status).toBe('error')
    expect(fixture.closeSession).toHaveBeenCalledTimes(1)
  })
  it('cannot approve a response that arrives after cancellation', async () => {
    const { ctx } = runtime(), controller = new AbortController()
    fixture.request.mockImplementation(async (_s, _m, wire) => {
      controller.abort()
      return { ir: { schemaVersion: 1, decision: 'approved' }, canonicalWire: wire }
    })
    await expect(validateNativeApprovalDecision(ctx, approved, 'r', 'p', controller.signal)).rejects.toMatchObject({ failureKind: 'cancelled' })
  })
  it('rejects canonical wire disagreement even when IR approves', async () => {
    const { ctx, records } = runtime()
    fixture.request.mockResolvedValue({ ir: { schemaVersion: 1, decision: 'approved' }, canonicalWire: '"abort"' })
    await expect(validateNativeApprovalDecision(ctx, approved, 'r', 'p', new AbortController().signal)).rejects.toMatchObject({ failureKind: 'wire-mismatch' })
    expect(records.some(r => r.data.status === 'validated')).toBe(false)
  })
  it('fails closed if releasing native session fails before authorization', async () => {
    const { ctx, records } = runtime()
    fixture.closeSession.mockRejectedValueOnce(new Error('release failed'))
    await expect(validateNativeApprovalDecision(ctx, approved, 'r', 'p', new AbortController().signal)).rejects.toThrow()
    expect(records.some(r => r.data.status === 'validated')).toBe(false)
  })
  it.each(['manual', 'unavailable'] as const)('never maps %s into approval', async outcome => {
    const { ctx } = runtime(), decision = { ...approved, outcome }
    expect(await validateNativeApprovalDecision(ctx, decision, 'r', 'p', new AbortController().signal)).toEqual(decision)
    expect(fixture.request).not.toHaveBeenCalled()
  })
})
