import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { ReviewStatusClient } from '../src/client/review-status.ts'
import type { AutoReviewIndicatorSnapshot } from '../src/types.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('ReviewStatusClient', () => {
  it('shares one bounded poller across visible call badges and stops after unmount', async () => {
    vi.useFakeTimers()
    let current: AutoReviewIndicatorSnapshot = Object.freeze({ revision: 0, indicators: Object.freeze([]) })
    const read = vi.fn(async () => current)
    const client = new ReviewStatusClient({ read }, 50)
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = client.subscribe('s1', first)
    const offSecond = client.subscribe('s1', second)
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)

    current = Object.freeze({
      revision: 1,
      indicators: Object.freeze([Object.freeze({
        schemaVersion: 1,
        sessionId: 's1',
        callId: CallId('c1'),
        rootCallId: CallId('c1'),
        actionId: 'a1',
        toolName: 'bash',
        state: 'reviewing',
        startedAt: 10,
      })]),
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(read).toHaveBeenCalledTimes(2)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(client.indicator('s1', 'c1')).toMatchObject({ state: 'reviewing', toolName: 'bash' })

    offFirst()
    offSecond()
    await vi.advanceTimersByTimeAsync(200)
    expect(read).toHaveBeenCalledTimes(2)
    expect(client.snapshot('s1')).toEqual({ revision: 0, indicators: [] })
    client.dispose()
  })

  it('ignores remote failures and keeps the last good snapshot', async () => {
    vi.useFakeTimers()
    const good: AutoReviewIndicatorSnapshot = Object.freeze({ revision: 2, indicators: Object.freeze([]) })
    const read = vi.fn()
      .mockResolvedValueOnce(good)
      .mockRejectedValueOnce(new Error('offline'))
    const client = new ReviewStatusClient({ read }, 50)
    const listener = vi.fn()
    const off = client.subscribe('s1', listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.snapshot('s1').revision).toBe(2)
    await vi.advanceTimersByTimeAsync(50)
    expect(client.snapshot('s1').revision).toBe(2)
    off()
    client.dispose()
  })
})
