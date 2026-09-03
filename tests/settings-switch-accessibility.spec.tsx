import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_AUTO_REVIEW_UI_SETTINGS } from '../src/settings.ts'
import { apply } from '../src/client/index.tsx'

const state = vi.hoisted(() => ({ values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  // This SSR regression supplies the loaded settings state; it does not claim
  // to test browser hydration, RPC, or click/persistence behavior.
  useState: () => [state.values.shift(), vi.fn()],
}))

it.each([true, false])('labels every real settings switch when enabled=%s', enabled => {
  const draft = { ...DEFAULT_AUTO_REVIEW_UI_SETTINGS, enabled }
  state.values = [{ status: 'ready', revision: 0, writable: true }, draft, false, undefined]
  let section: ComponentType<Record<string, unknown>> | undefined
  const ctx = {
    effect: () => {},
    get: () => ({ rpc: { call: vi.fn() } }),
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (options: { name: string }, component: unknown) => {
        if (options.name === 'settings.section') section = component as ComponentType<Record<string, unknown>>
      },
    },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0])
  expect(section).toBeDefined()
  const html = renderToStaticMarkup(createElement(section!, { t: (key: string) => `localized:${key}` }))
  const switches = [...html.matchAll(/<button\b[^>]*role="switch"[^>]*>/g)].map(match => match[0])
  expect(switches).toHaveLength(3)
  for (const [index, label] of ['enabled', 'sandboxDefaultAllow', 'reviewFullAccess'].entries()) {
    expect(switches[index]).toContain(`aria-label="localized:${label}"`)
    expect(switches[index]).toContain(`aria-checked="${index === 0 ? enabled : true}"`)
    if (index === 0 || enabled) expect(switches[index]).not.toContain('disabled=')
    else expect(switches[index]).toContain('disabled=""')
  }
  expect(state.values).toHaveLength(0)
})
