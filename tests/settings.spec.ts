import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_REVIEW_UI_SETTINGS,
  autoReviewSettingsBase,
  reviewerModelId,
} from '../src/settings.ts'

describe('Auto Review WebUI settings contract', () => {
  it('defaults to the low-latency Flash reviewer', () => {
    expect(DEFAULT_AUTO_REVIEW_UI_SETTINGS).toMatchObject({
      enabled: true,
      reviewerModel: 'flash',
      maxAttempts: 3,
      failureThreshold: 3,
    })
    expect(reviewerModelId('flash')).toBe('deepseek-v4-flash')
    expect(reviewerModelId('pro')).toBe('deepseek-v4-pro')
  })

  it('projects deployed composition values into the editable settings base', () => {
    expect(autoReviewSettingsBase(
      { mode: 'shadow', failureThreshold: 5, breakerCooldownMs: 12_000 },
      {
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'low',
        maxInputBytes: 24_000,
        maxOutputTokens: 900,
        timeoutMs: 45_000,
        maxAttempts: 2,
        retryDelayMs: 100,
        transcriptMaxEntries: 9,
        transcriptMaxBytes: 18_000,
      },
    )).toEqual({
      enabled: true,
      reviewerModel: 'pro',
      maxInputBytes: 24_000,
      maxOutputTokens: 900,
      timeoutMs: 45_000,
      maxAttempts: 2,
      transcriptMaxEntries: 9,
      transcriptMaxBytes: 18_000,
      failureThreshold: 5,
      breakerCooldownMs: 12_000,
    })
  })

  it('keeps a disabled deployment disabled in its initial WebUI state', () => {
    expect(autoReviewSettingsBase({ mode: 'disabled' }).enabled).toBe(false)
  })
})
