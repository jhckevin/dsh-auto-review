import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { guardedEntry } from '../src/guarded-entry.ts'
import { activationHealthy, activationStatus } from '../src/activation-health.ts'
import DefaultRuntime, { ActionReviewRuntime } from '../src/index.ts'

const supported = () => ({ supported: true, versions: {} })
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)) }

describe('Issue #34 guarded Loader entry', () => {
  const roles = ['auto-review', 'auto-review-llm', 'auto-review-audit', 'auto-review-settings', 'auto-review-policy']
  it('preserves the original programmatic default export', () => {
    expect(DefaultRuntime).toBe(ActionReviewRuntime)
    expect(activationHealthy(new Context())).toBe(true)
  })

  it('keeps cold-start health in the same scope when the root provides its real service', async () => {
    const ctx = new Context()
    const observations: boolean[] = []
    await ctx.plugin(guardedEntry('auto-review', [], async () => ({ apply(owner: Context) {
      observations.push(activationHealthy(owner))
      owner.provide('actionReview', {} as never)
      observations.push(activationHealthy(owner))
    } }), supported))
    expect(observations).toEqual([false, false])
    expect(activationStatus(ctx)).toContainEqual(expect.objectContaining({ name: 'auto-review', state: 'active' }))
    for (const name of roles.slice(1)) {
      await ctx.plugin(guardedEntry(name, ['actionReview'], async () => ({ apply() {} }), supported))
    }
    await settle()
    expect(activationHealthy(ctx)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('does not share readiness across isolated actionReview scopes', async () => {
    const root = new Context()
    const good = root.isolate('actionReview')
    const bad = root.isolate('actionReview')
    for (const name of roles) {
      await good.plugin(guardedEntry(name, [], async () => ({ apply() {} }), supported))
      await bad.plugin(guardedEntry(name, [], async () => ({ apply() {
        if (name === 'auto-review-policy') throw new Error('isolated failure')
      } }), supported))
    }
    expect(activationHealthy(good)).toBe(true)
    expect(activationHealthy(bad)).toBe(false)
    await root.fiber.dispose()
  })

  it('rechecks the actual implementation Fiber and reports missing roles', async () => {
    const ctx = new Context()
    const inner = { apply() {} }
    for (const name of roles.filter(name => name !== 'auto-review-audit')) {
      await ctx.plugin(guardedEntry(name, [], async () => name === 'auto-review-policy' ? inner : { apply() {} }, supported))
    }
    expect(activationHealthy(ctx)).toBe(false)
    expect(activationStatus(ctx)).toContainEqual(expect.objectContaining({ name: 'auto-review-audit', state: 'waiting' }))
    await ctx.plugin(guardedEntry('auto-review-audit', [], async () => ({ apply() {} }), supported))
    expect(activationHealthy(ctx)).toBe(true)
    const implementation = [...ctx.registry.get(inner)!.fibers][0]!
    await implementation.dispose()
    expect(activationHealthy(ctx)).toBe(false)
    expect(activationStatus(ctx)).toContainEqual(expect.objectContaining({ name: 'auto-review-policy', state: 'waiting' }))
    await ctx.fiber.dispose()
  })

  it('does not apply an old import after the same service object is re-provided', async () => {
    const ctx = new Context()
    const service = {}
    const provide = (owner: Context) => { owner.provide('actionReview', service as never) }
    const first = await ctx.plugin(provide)
    let release!: () => void
    const loaded = new Promise<void>(resolve => { release = resolve })
    const apply = vi.fn()
    await ctx.plugin(guardedEntry('pending-import', ['actionReview'], async () => { await loaded; return { apply } }, supported))
    await settle()
    const removing = first.dispose()
    await settle()
    await ctx.plugin(provide)
    release()
    await removing
    await settle()
    expect(apply).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('does not equate a pending implementation with active readiness', async () => {
    const ctx = new Context()
    await ctx.plugin(guardedEntry('auto-review-policy', [], async () => ({ inject: ['missing'], apply() {} }), supported))
    expect(activationStatus(ctx)).toContainEqual(expect.objectContaining({ name: 'auto-review-policy', state: 'waiting' }))
    await ctx.fiber.dispose()
  })

  it('releases all managed health when the bundle is uninstalled', async () => {
    const ctx = new Context()
    const first = await ctx.plugin(guardedEntry('auto-review-audit', [], async () => ({ apply() {} }), supported))
    expect(activationHealthy(ctx)).toBe(false)
    await first.dispose()
    expect(activationHealthy(ctx)).toBe(true)
    expect(activationStatus(ctx)).toEqual([])
    const again = await ctx.plugin(guardedEntry('auto-review-audit', [], async () => ({ apply() {} }), supported))
    expect(activationStatus(ctx).filter(row => row.name === 'auto-review-audit')).toHaveLength(1)
    await again.dispose()
    expect(activationStatus(ctx)).toEqual([])
    await ctx.fiber.dispose()
  })
  it('reports a failed implementation instead of equating Loader ACTIVE with readiness', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(guardedEntry('auto-review-policy', [], async () => ({ apply() { throw new Error('fixture failure') } }), supported))
    expect(fiber.state).toBe(2)
    expect(activationStatus(ctx)).toContainEqual(expect.objectContaining({name: 'auto-review-policy', state: 'failed'}))
    expect(activationHealthy(ctx)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('does not call a dynamically imported implementation after its dependency is removed', async () => {
    const ctx = new Context()
    const provider = await ctx.plugin((owner: Context) => { owner.provide('actionReview', {} as never) })
    let release!: () => void
    const apply = vi.fn()
    const loaded = new Promise<void>(resolve => { release = resolve })
    const fiber = await ctx.plugin(guardedEntry('pending-import', ['actionReview'], async () => { await loaded; return { apply } }, supported))
    await settle()
    const disposing = provider.dispose()
    await settle()
    release()
    await disposing
    await settle()
    expect(apply.mock.calls.length).toBe(0)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('publishes readiness only after configuration is applied', async () => {
    const ctx = new Context()
    const order: string[] = []
    await ctx.plugin(guardedEntry('settings', ['fixtureDefaultsReady'], async () => ({ apply() { order.push('settings') } }), supported))
    await ctx.plugin(guardedEntry('provider', [], async () => ({ apply() { order.push('defaults') } }), supported, 'fixtureDefaultsReady'))
    await settle()
    expect(order).toEqual(['defaults', 'settings'])
    await ctx.fiber.dispose()
  })

  it('keeps the real defaults barrier distinct from the actionReview service', async () => {
    const root = new Context()
    const order: string[] = []
    for (const label of ['first', 'second']) {
      const ctx = root.isolate('actionReview')
      await ctx.plugin(guardedEntry('auto-review-settings', ['actionReview', 'actionReviewDefaultsReady'], async () => ({ apply() {
        order.push(label + ':settings')
      } }), supported))
      await ctx.plugin(guardedEntry('auto-review', [], async () => ({ apply(owner: Context) {
        owner.provide('actionReview', { label } as never)
      } }), supported))
      await settle()
      expect(order).not.toContain(label + ':settings')
      await ctx.plugin(guardedEntry('auto-review-llm', ['actionReview'], async () => ({ apply() {
        order.push(label + ':defaults')
      } }), supported, 'actionReviewDefaultsReady'))
      await settle()
      expect(activationStatus(ctx)).toContainEqual(expect.objectContaining({ name: 'auto-review-llm', state: 'active' }))
    }
    expect(order).toEqual(['first:defaults', 'first:settings', 'second:defaults', 'second:settings'])
    await root.fiber.dispose()
  })
  it('unknown host stays active without importing a host implementation', async () => {
    const ctx = new Context()
    const load = vi.fn(async () => ({ apply: vi.fn() }))
    const fiber = await ctx.plugin(guardedEntry('unknown', ['actionReview'], load,
      () => ({ supported: false, versions: {}, reason: 'unsupported cohort' })))
    expect(fiber.state).toBe(2)
    expect(load).not.toHaveBeenCalled()
    expect(ctx.get('actionReview')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('root absent does not leave the Loader-facing child pending', async () => {
    const ctx = new Context()
    const load = vi.fn(async () => ({ apply: vi.fn() }))
    const fiber = await ctx.plugin(guardedEntry('dependent', ['actionReview'], load, supported))
    expect(fiber.state).toBe(2)
    expect(load).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('children attach, detach, and reattach with the service without duplicate hooks', async () => {
    const ctx = new Context()
    let active = 0, starts = 0, stops = 0
    const entry = guardedEntry('dependent', ['actionReview'], async () => ({ apply(owner: Context) {
      active++; starts++
      owner.effect(() => () => { active--; stops++ })
    } }), supported)
    const fiber = await ctx.plugin(entry)
    expect(active).toBe(0)
    const provider = (owner: Context) => { owner.provide('actionReview', {} as never) }
    const first = await ctx.plugin(provider)
    await settle()
    expect(active).toBe(1)
    await first.dispose()
    await settle()
    expect(active).toBe(0)
    const second = await ctx.plugin(provider)
    await settle()
    expect(active).toBe(1)
    await fiber.dispose()
    expect(active).toBe(0)
    expect([starts, stops]).toEqual([2, 2])
    await second.dispose()
    await ctx.fiber.dispose()
  })
})
