import type { AutoReviewIndicator, AutoReviewIndicatorSnapshot } from '../types.ts'

const EMPTY_SNAPSHOT: AutoReviewIndicatorSnapshot = Object.freeze({
  revision: 0,
  indicators: Object.freeze([]),
})

export interface ReviewStatusRemote {
  read(sessionId: string, signal: AbortSignal): Promise<AutoReviewIndicatorSnapshot>
}

interface SessionReviewState {
  readonly listeners: Set<() => void>
  snapshot: AutoReviewIndicatorSnapshot
  timer: ReturnType<typeof globalThis.setInterval> | undefined
  request: AbortController | undefined
}

/** One bounded poller per visible session, shared by every Tool-call badge. */
export class ReviewStatusClient {
  private readonly sessions = new Map<string, SessionReviewState>()

  constructor(
    private readonly remote: ReviewStatusRemote,
    private readonly pollIntervalMs = 200,
  ) {
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 50) {
      throw new TypeError('auto-review: status poll interval must be an integer of at least 50ms')
    }
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    const state = this.state(sessionId)
    state.listeners.add(listener)
    if (state.listeners.size === 1) this.start(sessionId, state)
    return () => {
      state.listeners.delete(listener)
      if (state.listeners.size === 0) this.stop(sessionId, state)
    }
  }

  snapshot(sessionId: string): AutoReviewIndicatorSnapshot {
    return this.sessions.get(sessionId)?.snapshot ?? EMPTY_SNAPSHOT
  }

  indicator(sessionId: string, callId: string): AutoReviewIndicator | undefined {
    return this.snapshot(sessionId).indicators.find(indicator => indicator.callId === callId)
  }

  dispose(): void {
    for (const [sessionId, state] of this.sessions) this.stop(sessionId, state)
    this.sessions.clear()
  }

  private state(sessionId: string): SessionReviewState {
    if (sessionId.trim().length === 0) throw new TypeError('auto-review: session id must be non-empty')
    let state = this.sessions.get(sessionId)
    if (state === undefined) {
      state = { listeners: new Set(), snapshot: EMPTY_SNAPSHOT, timer: undefined, request: undefined }
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
    if (state.listeners.size === 0) this.sessions.delete(sessionId)
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
