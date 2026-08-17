import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AutoReviewFunnel } from '../src/client/index.tsx'
import type { AutoReviewMetricsSnapshot } from '../src/types.ts'

describe('Auto Review WebUI funnel', () => {
  it('renders the blog-aligned action split from content-free aggregate counters', () => {
    const metrics: AutoReviewMetricsSnapshot = {
      totalActions: 10_000, insideBoundary: 9_280, autoReviewed: 720,
      approved: 713, denied: 7, manual: 0, unavailable: 0, hardDenied: 0,
      successfulActions: 9_993, failedActions: 7, ticketRejected: 0,
      retriedDeniedAction: 0, retriedEquivalentEffect: 0,
      continuedWithDifferentAction: 4, stoppedAfterDenial: 3,
      reviewerLatencyMs: { count: 720, mean: 120, max: 900 },
      policyRetrieval: { outlineCalls: 5, searchCalls: 11, getCalls: 3, resultBytes: 4096 },
      approvalRate: 713 / 720, effectiveAutomationRate: 0.9993, byActionKind: {},
    }
    const html = renderToStaticMarkup(<AutoReviewFunnel metrics={metrics} t={key => key} />)
    for (const value of ['10000', '9280', '720', '713', '7']) expect(html).toContain(value)
    expect(html).toContain('aria-label="funnel"')
    expect(html).toContain('4096')
    expect(html).not.toContain('actionDigest')
  })
})
