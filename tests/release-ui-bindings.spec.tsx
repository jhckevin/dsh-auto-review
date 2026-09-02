import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, AutoReviewCallBadge, AutoReviewNavIcon } from '../src/client/index.tsx'
import { ReviewStatusClient } from '../src/client/review-status.ts'

afterEach(() => vi.useRealTimers())

it('registers the rc.2 navigation glyph and session badge through additive child slots', async () => {
  vi.useFakeTimers()
  const entries: Array<{options: Record<string, unknown>; component: unknown}> = []
  const cleanups: Array<() => void> = []
  const rpc = vi.fn(async () => ({ok: true, value: {revision: 1, indicators: [{callId: 'call', state: 'denied'}]}}))
  const ctx = {
    effect: (effect: () => unknown) => {const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)},
    get: () => ({rpc: {call: rpc}}),
    locale: {register: () => () => {}, bind: () => (key: string) => key},
    slots: {inject: (_name: string, callback: () => unknown) => callback(),
      register: (options: Record<string, unknown>, component: unknown) => {entries.push({options, component})}},
  }
  apply(ctx as unknown as Parameters<typeof apply>[0])
  try {
    expect(entries.map(x => x.options['name'])).toEqual(['settings.section', 'settings.section.icon', 'tool.call.badges'])
    expect(entries[0]!.options).not.toHaveProperty('icon')
    expect(entries[1]!.options['key']).toBe('auto-review')
    expect(entries[1]!.component).toBe(AutoReviewNavIcon)
    expect(renderToStaticMarkup(createElement(AutoReviewNavIcon))).toContain('M9.06543 1.95123')
    const badge = entries[2]!
    expect(badge.component).toBe(AutoReviewCallBadge)
    const injected = (badge.options['inject'] as (sessionId: string) => {reviewStatus: ReviewStatusClient})('session')
    const off = injected.reviewStatus.subscribe('session', () => {})
    await vi.advanceTimersByTimeAsync(0)
    const html = renderToStaticMarkup(createElement(badge.component as ComponentType<Record<string, unknown>>, {
      ...injected, sessionId: 'session', callId: 'call', t: (key: string) => key,
    }))
    expect(rpc.mock.calls[0]).toBeDefined()
    expect(html).toContain('data-auto-review-state="denied"')
    expect(html).toContain('m2 2 20 20')
    off()
  } finally {for (const cleanup of cleanups.reverse()) cleanup()}
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps a re-subscribed rc.2 session tracked and makes dispose final', async () => {
  vi.useFakeTimers()
  const read = vi.fn(async () => ({revision: 3, indicators: []}))
  const client = new ReviewStatusClient({read}, 50)
  const old = client.subscribe('same', () => {})
  await vi.advanceTimersByTimeAsync(0)
  old()
  const current = client.subscribe('same', () => {})
  old()
  await vi.advanceTimersByTimeAsync(50)
  expect(client.snapshot('same').revision).toBe(3)
  expect(read).toHaveBeenCalledTimes(3)
  client.dispose()
  current()
  client.subscribe('other', () => {})()
  await vi.advanceTimersByTimeAsync(50)
  expect(read).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
})
