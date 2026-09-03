import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AutoReviewCallBadge } from '../src/client/index.tsx'

// Opt-in source-plane proof against a separate, patched alpha.5 worktree.
const upstream = process.env['DSH_BADGE_PROOF_ROOT']
describe.skipIf(upstream === undefined)('alpha.5 native badge owner patch', () => {
  async function owner(): Promise<ComponentType<Record<string, unknown>>> {
    const generic = `${upstream}/packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx`
    vi.doMock(generic, () => ({ GenericToolCard: () => createElement('span', null, 'generic fallback') }))
    const loaded = await import(`${upstream}/packages/client/ui-tool/src/client/tool/ToolCallTree.tsx`)
    return loaded.ToolCallTree as ComponentType<Record<string, unknown>>
  }

  it('renders pending/denied SVG beside original views for root and nested calls', async () => {
    const Tree = await owner()
    const renderSlot = vi.fn((name: string, props: {callId: string; toolName: string}) => {
      if (name === 'tool.call.toolview') return createElement('span', {'data-original-tool': props.callId}, props.toolName)
      if (name === 'tool.call.badges') return createElement(AutoReviewCallBadge as never, {
        callId: props.callId, t: (key: string) => key,
        useReviewStatus: (select: (value: unknown) => unknown) => select({revision: 1, indicators: [
          {callId: 'root', state: 'reviewing'}, {callId: 'child', state: 'denied'},
        ]}),
      })
      throw new Error(`Unexpected owner slot: ${name}`)
    })
    const html = renderToStaticMarkup(createElement(Tree, {
      renderSlot, node: {data: {root: {callId: 'root', name: 'bash', subCalls: [
        {callId: 'child', name: 'read_file', subCalls: []},
      ]}}}, openFile() {}, inspectCall() {}, useHostInfo: (select: (value: unknown) => unknown) => select({}),
      useHostDescription: (select: (value: unknown) => unknown) => select({}),
      t: (key: string) => key,
    }))
    expect(html).toContain('data-original-tool="root"')
    expect(html).toContain('data-original-tool="child"')
    expect(html).toContain('data-auto-review-state="reviewing"')
    expect(html).toContain('data-auto-review-state="denied"')
    expect(html).toContain('M9.06543 1.95123')
    expect(html).toContain('m2 2 20 20')
    expect(renderSlot.mock.calls.filter(([name]) => name === 'tool.call.badges')).toHaveLength(2)
  })

  it('preserves ordinary views when no plugin contributes a badge', async () => {
    const Tree = await owner()
    const html = renderToStaticMarkup(createElement(Tree, {
      renderSlot: (name: string) => name === 'tool.call.toolview' ? createElement('span', null, 'original view') : null,
      node: {data: {root: {callId: 'ordinary', name: 'bash', subCalls: []}}}, openFile() {}, inspectCall() {},
      useHostInfo: (select: (value: unknown) => unknown) => select({}), t: (key: string) => key,
      useHostDescription: (select: (value: unknown) => unknown) => select({}),
    }))
    expect(html).toContain('original view')
    expect(html).not.toContain('data-auto-review-state')
  })
})
