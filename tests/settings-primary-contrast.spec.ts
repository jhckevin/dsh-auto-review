import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'

afterEach(() => vi.unstubAllGlobals())

function installedPrimaryRule(): Record<string, string> {
  let css = ''
  vi.stubGlobal('document', {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
    head: { appendChild: (style: { textContent: string }) => { css = style.textContent } },
  })
  const ctx = {
    effect: (effect: () => unknown) => { effect() },
    get: () => ({ rpc: { call: vi.fn() } }),
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: { inject: (_name: string, callback: () => unknown) => callback(), register: () => {} },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0])
  const rule = css.match(/\.ar-primary\{([^}]+)\}/)?.[1]
  expect(rule).toBeDefined()
  return Object.fromEntries(rule!.split(';').filter(Boolean).map(entry => {
    const colon = entry.indexOf(':')
    return [entry.slice(0, colon), entry.slice(colon + 1)]
  }))
}

function resolve(value: string, tokens: Record<string, string>): number[] {
  if (value.startsWith('var(')) {
    const resolved = tokens[value.slice(4, -1)]
    expect(resolved).toBeDefined()
    return resolve(resolved!, tokens)
  }
  if (value === 'white') return [255, 255, 255]
  expect(value).toMatch(/^rgb\([\d, ]+\)$/)
  return value.slice(4, -1).split(',').map(Number)
}

function luminance(rgb: number[]): number {
  const linear = rgb.map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

// Values from official DSH rc.2 b150a551, ui-theme/src/styles/design-platform.css.
// This checks installed CSS token resolution/contrast, not browser computed style.
it.each([
  ['light', 'rgb(15,17,21)', 'rgb(255,255,255)'],
  ['dark', 'rgb(249,250,251)', 'rgb(15,17,21)'],
])('keeps readable primary text with the official %s token pair', (_theme, fill, foreground) => {
  const rule = installedPrimaryRule()
  const tokens = {
    '--dsw-alias-brand-primary': fill,
    '--dsw-alias-button-primary-fill': 'var(--dsw-alias-brand-primary)',
    '--dsw-alias-label-primary-foreground': foreground,
  }
  const bg = resolve(rule['background']!, tokens)
  const fg = resolve(rule['color']!, tokens)
  expect(bg).toEqual(resolve(fill, tokens))
  expect(fg).toEqual(resolve(foreground, tokens))
  const l = [luminance(bg), luminance(fg)].sort((a, b) => a - b)
  expect((l[1]! + 0.05) / (l[0]! + 0.05)).toBeGreaterThanOrEqual(4.5)
})
