import { ToolCallId } from './compat-fixtures.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReviewStatusClient } from '../src/client/review-status.ts'
import type { AutoReviewIndicatorSnapshot } from '../src/types.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('ReviewStatusClient', () => {
  it('keeps a new session poller tracked after repeated stale cleanup', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({revision: 3, indicators: []}))
    const client = new ReviewStatusClient({read}, 50)
    const old = client.subscribe('same', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    old()
    const listener = vi.fn()
    const current = client.subscribe('same', listener)
    old()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.snapshot('same').revision).toBe(3)
    expect(listener).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(50)
    expect(read).toHaveBeenCalledTimes(3)
    client.dispose()
    expect(vi.getTimerCount()).toBe(0)
    current()
    current()
  })

  it('makes existing-source subscriptions inert after dispose and rejects new sources', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({revision: 1, indicators: []}))
    const client = new ReviewStatusClient({read}, 50)
    const source = client.source('same')
    client.dispose()
    source.subscribe(vi.fn())()
    client.subscribe('new', vi.fn())()
    client.dispose()
    await vi.advanceTimersByTimeAsync(200)
    expect(read).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(source.getSnapshot().revision).toBe(0)
    expect(() => client.source('new')).toThrow('disposed')
  })

  it('provides one stable bare observable for renderer-made hooks', async () => {
    vi.useFakeTimers()
    const current = Object.freeze({ revision: 2, indicators: Object.freeze([]) })
    const client = new ReviewStatusClient({ read: async () => current }, 50)
    const source = client.source('s1')
    expect(client.source('s1')).toBe(source)
    expect('useStore' in source).toBe(false)
    const listener = vi.fn()
    const off = source.subscribe(listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(source.getSnapshot().revision).toBe(2)
    expect(source.getSnapshot()).toBe(source.getSnapshot())
    expect(listener).toHaveBeenCalledOnce()
    off()
    client.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

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
        callId: ToolCallId('c1'),
        rootCallId: ToolCallId('c1'),
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
