import { ToolCallId } from './compat-fixtures.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AutoReviewCallBadge, AutoReviewLogo, AutoReviewNavIcon } from '../src/client/index.tsx'
import type { AutoReviewIndicatorSnapshot } from '../src/types.ts'

function renderBadge(snapshot: AutoReviewIndicatorSnapshot, callId = 'call-reviewed'): string {
  return renderToStaticMarkup(createElement(AutoReviewCallBadge as never, {
    sessionId: 'session-1',
    callId,
    useReviewStatus: (select: (value: AutoReviewIndicatorSnapshot) => unknown) => select(snapshot),
    t: (key: string) => key,
  }))
}

function snapshot(state?: 'reviewing' | 'denied'): AutoReviewIndicatorSnapshot {
  return Object.freeze({
    revision: state === undefined ? 0 : 1,
    indicators: state === undefined ? Object.freeze([]) : Object.freeze([Object.freeze({
      schemaVersion: 1,
      sessionId: 'session-1',
      callId: ToolCallId('call-reviewed'),
      rootCallId: ToolCallId('call-reviewed'),
      actionId: 'action-1',
      toolName: 'bash',
      state,
      startedAt: 10,
      ...(state === 'denied' ? { finishedAt: 20 } : {}),
    })]),
  })
}

describe('AutoReviewCallBadge', () => {
  it('renders nothing for calls that never entered reviewer handling', () => {
    expect(renderBadge(snapshot())).toBe('')
    expect(renderBadge(snapshot('reviewing'), 'call-unreviewed')).toBe('')
  })

  it('renders the exact shield-terminal glyph while review is pending', () => {
    const html = renderBadge(snapshot('reviewing'))
    expect(html).toContain('data-auto-review-state="reviewing"')
    expect(html).toContain('aria-label="reviewing"')
    expect(html).toContain('M9.06543 1.95123')
    expect(html).not.toContain('m2 2 20 20')
  })

  it('renders the same glyph in denied state with the red slash geometry', () => {
    const html = renderBadge(snapshot('denied'))
    expect(html).toContain('data-auto-review-state="denied"')
    expect(html).toContain('aria-label="denied"')
    expect(html).toContain('M9.06543 1.95123')
    expect(html).toContain('m2 2 20 20')
  })

  it('uses the same canonical glyph as the Auto Review product logo', () => {
    const html = renderToStaticMarkup(createElement(AutoReviewLogo))
    expect(html).toContain('data-auto-review-logo="canonical"')
    expect(html).toContain('M9.06543 1.95123')
    expect(html).not.toContain('m2 2 20 20')
    expect(html).toContain('width="24"')
  })

  it('uses the canonical glyph at 16px in the settings navigation', () => {
    const html = renderToStaticMarkup(createElement(AutoReviewNavIcon))
    expect(html).toContain('M9.06543 1.95123')
    expect(html).not.toContain('m2 2 20 20')
    expect(html).toContain('width="16"')
    expect(html).toContain('height="16"')
  })
})
