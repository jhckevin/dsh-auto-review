import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AutoReviewTurnInterruption, autoReviewInterruptionDetail } from '../src/client/index.tsx'
const detail = '[AUTO_REVIEW_DENIAL_BREAKER] 本轮操作已被自动审查终止 consecutive=3; denied=3; window=3.'
const reason = { kind: 'aborted', reason: { kind: 'hook', reason: detail } }
it('renders durable turn end after JSON replay without live review state', () => {
  const original = { end: { data: { reason } } }
  const turn = JSON.parse(JSON.stringify(original)) as typeof original
  const html = renderToStaticMarkup(createElement(AutoReviewTurnInterruption, { turn }))
  for (const text of ['role="status"', '本轮操作已被自动审查终止', 'consecutive=3', 'M9.06543 1.95123', 'm2 2 20 20']) expect(html).toContain(text)
})
it('does not label unrelated cancellation, errors or running turns', () => {
  for (const candidate of [null, detail, { kind: 'error' }, { kind: 'aborted', reason: { kind: 'user' } }, { kind: 'aborted', reason: { kind: 'hook', reason: 'other' } }]) {
    expect(autoReviewInterruptionDetail(candidate)).toBeNull()
    expect(renderToStaticMarkup(createElement(AutoReviewTurnInterruption, { turn: { end: { data: { reason: candidate } } } }))).toBe('')
  }
  expect(renderToStaticMarkup(createElement(AutoReviewTurnInterruption, { turn: {} }))).toBe('')
})
it('escapes detail HTML', () => {
  const turn = { end: { data: { reason: { ...reason, reason: { kind: 'hook', reason: detail + '<script>alert(1)</script>' } } } } }
  const html = renderToStaticMarkup(createElement(AutoReviewTurnInterruption, { turn }))
  expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;')
})
