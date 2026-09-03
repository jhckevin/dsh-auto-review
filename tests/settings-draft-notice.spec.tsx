import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'
import { DEFAULT_AUTO_REVIEW_UI_SETTINGS } from '../src/settings.ts'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  // Exercise the actual registered component's handlers, without claiming
  // browser scheduling or a real RPC round trip in this focused regression.
  useState: () => {
    const index = hooks.cursor++
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
}))

function renderSettings(): ReactNode {
  hooks.values = [{ status: 'ready', revision: 0, writable: true },
    { ...DEFAULT_AUTO_REVIEW_UI_SETTINGS, modelStrategy: 'risk-tiered' }, false, 'saved']
  hooks.cursor = 0
  let section: ((props: Record<string, unknown>) => ReactNode) | undefined
  const ctx = {
    effect: () => {}, get: () => ({ rpc: { call: vi.fn() } }),
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (options: { name: string }, component: unknown) => {
        if (options.name === 'settings.section') section = component as typeof section
      },
    },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0])
  expect(section).toBeDefined()
  return section!({ t: (key: string) => key })
}

function edits(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(edits)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  const editable = typeof node.props['onChange'] === 'function' || node.props['role'] === 'switch'
  return [...(editable ? [node] : []), ...edits(node.props['children'] as ReactNode)]
}

it('clears an earlier saved notice for every rendered draft-edit handler', () => {
  const count = edits(renderSettings()).length
  expect(count).toBeGreaterThanOrEqual(20)
  for (let index = 0; index < count; index++) {
    const edit = edits(renderSettings())[index]!
    const before = hooks.values[1]
    const handler = edit.props['onChange'] ?? edit.props['onClick']
    expect(handler).toBeTypeOf('function')
    ;(handler as (event: unknown) => void)({ currentTarget: { value: edit.type === 'select' ? 'single' : '123' } })
    expect(hooks.values[3], `edit ${index}: ${String(edit.type)}`).toBeUndefined()
    expect(hooks.values[1], `edit ${index}: draft updated`).not.toBe(before)
  }
})
