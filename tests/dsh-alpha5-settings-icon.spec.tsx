// @vitest-environment jsdom
import { act, createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AutoReviewNavIcon } from '../src/client/index.tsx'

const upstream = process.env['DSH_BADGE_PROOF_ROOT']
describe.skipIf(upstream === undefined)('alpha.5 settings-navigation owner patch', () => {
  it('opens the real settings panel and renders the plugin SVG without replacing fallback navigation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const icon = () => createElement('svg', {'data-native-fallback': true})
    vi.doMock('@deepseek-ai/dsh-client-ui-primitives', () => ({ConnectionIndicator: () => null,
      IconAgentPresetOutline16: icon, IconCloseOutline16: icon, IconDataOutline16: icon,
      IconPersonalizationOutline16: icon, IconSettingsOutline16: icon}))
    const loaded = await import(`${upstream}/packages/client/ui-settings-general/src/client/SettingsRoot.tsx`)
    const SettingsRoot = loaded.SettingsRoot as ComponentType<Record<string, unknown>>
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    const renderSlot = vi.fn((name: string, _owner: unknown, options?: {entryKey?: string; fallback?: ReactNode}) => {
      if (name === 'settings.section.icon') return options?.entryKey === 'auto-review' ? createElement(AutoReviewNavIcon) : options?.fallback
      if (name === 'settings.trigger') return 'Open settings'
      if (name === 'settings.header') return 'Settings'
      if (name === 'settings.close') return 'Close'
      return null
    })
    try {
      await act(async () => {root.render(createElement(SettingsRoot, {
        wide: true, reconnect() {}, renderSlot, t: (key: string) => key,
        useConnectionState: (select: (v: string) => unknown) => select('connected'),
        useSections: (select: (v: unknown) => unknown) => select([{id: 'auto-review', label: 'Auto Review', order: 1}, {id: 'general', label: 'General', order: 2}]),
        useOnboardingSteps: (select: (v: unknown) => unknown) => select([]),
        useSessions: (select: (v: unknown) => unknown) => select({phase: 'ready', current: 's1', byId: {s1: {blank: false}}}),
      }))})
      const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
      await act(async () => {trigger.click()})
      const dialog = container.querySelector('[role="dialog"]')!
      expect(dialog).not.toBeNull()
      const auto = [...dialog.querySelectorAll('nav button')].find(x => x.textContent === 'Auto Review')!
      expect(auto.querySelector('svg')?.getAttribute('width')).toBe('16')
      expect(auto.innerHTML).toContain('M9.06543 1.95123')
      expect(auto.innerHTML).not.toContain('m2 2 20 20')
      const general = [...dialog.querySelectorAll('nav button')].find(x => x.textContent === 'General')!
      expect(general.querySelector('[data-native-fallback]')).not.toBeNull()
      await act(async () => {document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))})
      expect(container.querySelector('[role="dialog"]')).toBeNull()
    } finally {await act(async () => {root.unmount()}); container.remove(); vi.unstubAllGlobals()}
  })
})
