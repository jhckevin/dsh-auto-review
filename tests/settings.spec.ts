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
      sandboxDefaultAllow: true,
      reviewFullAccess: true,
      reviewerModel: 'flash',
      modelStrategy: 'single',
      primaryModel: 'deepseek-v4-flash',
      strongModel: 'deepseek-v4-pro',
      maxAttempts: 3,
      failureThreshold: 3,
    })
    expect(reviewerModelId('flash')).toBe('deepseek-v4-flash')
    expect(reviewerModelId('pro')).toBe('deepseek-v4-pro')
  })

  it('projects deployed composition values into the editable settings base', () => {
    expect(autoReviewSettingsBase(
      { mode: 'shadow', sandboxDefaultAllow: false, failureThreshold: 5, breakerCooldownMs: 12_000 },
      {
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: 'low',
        modelStrategy: 'risk-tiered',
        strongProvider: 'openai-compatible',
        strongModel: 'gpt-5.6-terra',
        strongReasoningEffort: 'high',
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
      sandboxDefaultAllow: false,
      reviewFullAccess: true,
      reviewerModel: 'pro',
      modelStrategy: 'risk-tiered',
      primaryProvider: 'deepseek-official',
      primaryModel: 'deepseek-v4-pro',
      primaryReasoningEffort: 'low',
      strongProvider: 'openai-compatible',
      strongModel: 'gpt-5.6-terra',
      strongReasoningEffort: 'high',
      strongReviewKinds: ['network', 'sensitive-read', 'destructive', 'permission-change', 'production-change'],
      escalateUncertainToStrong: true,
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
