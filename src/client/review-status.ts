import type { AutoReviewIndicator, AutoReviewIndicatorSnapshot } from '../types.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

const EMPTY_SNAPSHOT: AutoReviewIndicatorSnapshot = Object.freeze({
  revision: 0,
  indicators: Object.freeze([]),
})

export interface ReviewStatusRemote {
  read(sessionId: string, signal: AbortSignal): Promise<AutoReviewIndicatorSnapshot>
}

interface SessionReviewState {
  readonly source: HostObservable<AutoReviewIndicatorSnapshot>
  readonly listeners: Set<() => void>
  snapshot: AutoReviewIndicatorSnapshot
  timer: ReturnType<typeof globalThis.setInterval> | undefined
  request: AbortController | undefined
}

/** One bounded poller per visible session, shared by every Tool-call badge. */
export class ReviewStatusClient {
  private readonly sessions = new Map<string, SessionReviewState>()
  private disposed = false

  constructor(
    private readonly remote: ReviewStatusRemote,
    private readonly pollIntervalMs = 200,
  ) {
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 50) {
      throw new TypeError('auto-review: status poll interval must be an integer of at least 50ms')
    }
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    if (this.disposed) return () => {}
    const state = this.state(sessionId)
    state.listeners.add(listener)
    if (state.listeners.size === 1) this.start(sessionId, state)
    let active = true
    return () => {
      if (!active) return
      active = false
      state.listeners.delete(listener)
      if (state.listeners.size === 0) this.stop(sessionId, state)
    }
  }

  snapshot(sessionId: string): AutoReviewIndicatorSnapshot {
    return this.sessions.get(sessionId)?.snapshot ?? EMPTY_SNAPSHOT
  }

  /** Bare observable bound to a framework-created useReviewStatus hook.
   * @param sessionId - selected session identity.
   * @returns stable source shared by visible badges in the session.
   */
  source(sessionId: string): HostObservable<AutoReviewIndicatorSnapshot> {
    return this.state(sessionId).source
  }

  indicator(sessionId: string, callId: string): AutoReviewIndicator | undefined {
    return this.snapshot(sessionId).indicators.find(indicator => indicator.callId === callId)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [sessionId, state] of this.sessions) this.stop(sessionId, state)
    this.sessions.clear()
  }

  private state(sessionId: string): SessionReviewState {
    if (this.disposed) throw new Error('auto-review: status client is disposed')
    if (sessionId.trim().length === 0) throw new TypeError('auto-review: session id must be non-empty')
    let state = this.sessions.get(sessionId)
    if (state === undefined) {
      state = { listeners: new Set(), snapshot: EMPTY_SNAPSHOT, timer: undefined, request: undefined,
        source: { getSnapshot: () => this.snapshot(sessionId), subscribe: listener => this.subscribe(sessionId, listener) } }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private start(sessionId: string, state: SessionReviewState): void {
    void this.refresh(sessionId, state)
    state.timer = globalThis.setInterval(() => { void this.refresh(sessionId, state) }, this.pollIntervalMs)
  }

  private stop(sessionId: string, state: SessionReviewState): void {
    if (state.timer !== undefined) globalThis.clearInterval(state.timer)
    state.timer = undefined
    state.request?.abort()
    state.request = undefined
    if (state.listeners.size === 0 && this.sessions.get(sessionId) === state) this.sessions.delete(sessionId)
  }

  private async refresh(sessionId: string, state: SessionReviewState): Promise<void> {
    if (state.request !== undefined) return
    const request = new AbortController()
    state.request = request
    try {
      const next = await this.remote.read(sessionId, request.signal)
      if (request.signal.aborted || state.listeners.size === 0) return
      if (next.revision === state.snapshot.revision) return
      state.snapshot = Object.freeze({
        revision: next.revision,
        indicators: Object.freeze(next.indicators.map(indicator => Object.freeze({ ...indicator }))),
      })
      for (const listener of state.listeners) listener()
    } catch {
      // Remote failures are intentionally non-fatal to the conversation UI.
    } finally {
      if (state.request === request) state.request = undefined
    }
  }
}
