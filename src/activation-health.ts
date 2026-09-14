import { symbols, type Context, type Fiber } from '@deepseek-ai/cordis'

export type ActivationState = 'waiting' | 'active' | 'failed' | 'unsupported' | 'stopped'
export interface ActivationStatus { readonly name: string; readonly state: ActivationState; readonly reason?: string }
interface RecordState { value: ActivationStatus; implementation?: Fiber | undefined; uid?: number | null | undefined }
type Group = Map<string, Map<symbol, RecordState>>
const roots = new WeakMap<Context, Map<symbol | undefined, Group>>()
const readyScopes = new WeakMap<Group, symbol>()
const required = ['auto-review', 'auto-review-llm', 'auto-review-audit', 'auto-review-settings', 'auto-review-policy']

function group(ctx: Context, create = false): Group | undefined {
  // Cordis allocates this default label on first provide(). Reserve it before
  // registration so startup health cannot move to a different scope mid-load.
  if (create) ctx.root[symbols.isolate].actionReview ??= Symbol('actionReview')
  let scopes = roots.get(ctx.root)
  if (!scopes && create) { scopes = new Map(); roots.set(ctx.root, scopes) }
  const key = ctx[symbols.isolate].actionReview
  let value = scopes?.get(key)
  if (!value && create) { value = new Map(); scopes!.set(key, value) }
  return value
}

/** Each Loader row owns a lease; stale cleanup cannot overwrite a new row. */
export function beginActivation(ctx: Context, name: string) {
  const entries = group(ctx, true)!
  let leases = entries.get(name)
  if (!leases) { leases = new Map(); entries.set(name, leases) }
  const key = Symbol(name)
  const record: RecordState = { value: { name, state: 'waiting' } }
  leases.set(key, record)
  let released = false
  return (state: ActivationState, reason?: string, implementation?: Fiber) => {
    if (released) return
    if (state === 'stopped') {
      released = true
      leases!.delete(key)
      if (!leases!.size) entries.delete(name)
      if (!entries.size) roots.get(ctx.root)?.delete(ctx[symbols.isolate].actionReview)
      return
    }
    record.value = Object.freeze({ name, state, ...(reason ? { reason } : {}) })
    record.implementation = implementation
    record.uid = implementation?.uid
  }
}

/** Cordis keys storage by label alone: different services need distinct labels. */
export function defaultsReadyScope(ctx: Context): symbol {
  const entries = group(ctx, true)!
  let label = readyScopes.get(entries)
  if (!label) { label = Symbol('actionReviewDefaultsReady'); readyScopes.set(entries, label) }
  return label
}

function live(record: RecordState): ActivationStatus {
  const { value, implementation } = record
  if (value.state !== 'active') return value
  // Do not turn one successful startup into permanent permission to execute.
  if (!implementation || implementation.state !== 2 || implementation.uid !== record.uid) {
    return { name: value.name, state: 'waiting', reason: 'Implementation is not active.' }
  }
  return value
}

export function activationStatus(ctx: Context): readonly ActivationStatus[] {
  const entries = group(ctx)
  if (!entries) return []
  return Object.freeze([...new Set([...required, ...entries.keys()])].map(name => {
    const records = [...(entries.get(name)?.values() ?? [])]
    // Disposed duplicate rows do not poison a replacement, but a missing role blocks.
    const current = records.map(live).filter(value => value.state !== 'stopped')
    return current.find(value => value.state !== 'active') ?? current[0]
      ?? { name, state: 'waiting' as const, reason: 'Required component is not installed or is disabled.' }
  }))
}
export function activationHealthy(ctx: Context): boolean {
  // The original programmatic API retains its existing lifecycle contract.
  if (!group(ctx)) return true
  return activationStatus(ctx).filter(value => required.includes(value.name)).every(value => value.state === 'active')
}
export const ACTIVATION_DENIAL = 'AR-STARTUP-NOT-READY: Auto Review components are unavailable. This action was not executed. Do not retry through another tool; ask the user to repair or explicitly disable the plugin.'
