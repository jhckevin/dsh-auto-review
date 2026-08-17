import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import ActionReviewRuntime from '../src/service.ts'
import AutoReviewSettingsBridge from '../src/settings-provider.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(): Promise<void> { return Promise.resolve() }
}

describe('explicit settings provider', () => {
  it('publishes generic provider defaults when the reviewer config is bound first', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(ActionReviewRuntime, { mode: 'enforcing' })
    ctx.actionReview.configureReviewerSettingsDefaults({
      provider: 'openai-compatible', model: 'gpt-5.6-terra', reasoningEffort: 'high',
      modelStrategy: 'risk-tiered', strongProvider: 'deepseek-official', strongModel: 'deepseek-v4-pro',
      maxInputBytes: 16_384, maxOutputTokens: 768, timeoutMs: 90_000,
    })
    await ctx.plugin(AutoReviewSettingsBridge)
    expect(ctx.actionReviewSettings.read().value).toMatchObject({
      primaryProvider: 'openai-compatible', primaryModel: 'gpt-5.6-terra', primaryReasoningEffort: 'high',
      modelStrategy: 'risk-tiered', strongProvider: 'deepseek-official', strongModel: 'deepseek-v4-pro',
    })
  })

  it('publishes Flash defaults and updates the live runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(ActionReviewRuntime, { mode: 'enforcing' })
    await ctx.plugin(AutoReviewSettingsBridge)

    const section = ctx.settings.describe().find(item => item.ns === 'auto-review')
    expect(section?.value).toMatchObject({ enabled: true, sandboxDefaultAllow: true, modelStrategy: 'single', primaryModel: 'deepseek-v4-flash' })
    const initial = ctx.actionReviewSettings.read()
    expect(initial).toMatchObject({
      value: { reviewerModel: 'flash' }, revision: 0, writable: true,
      metrics: { totalActions: 0, insideBoundary: 0, autoReviewed: 0, approved: 0, denied: 0 },
    })
    const updated = await ctx.actionReviewSettings.update({
      patch: { modelStrategy: 'risk-tiered', primaryProvider: 'openai-compatible', primaryModel: 'gpt-5.6-terra', sandboxDefaultAllow: false, failureThreshold: 5 },
      expectedRevision: initial.revision,
    })
    expect(updated).toMatchObject({ value: { modelStrategy: 'risk-tiered', primaryProvider: 'openai-compatible', primaryModel: 'gpt-5.6-terra', failureThreshold: 5 }, revision: 1 })
    expect(ctx.actionReview.uiSettings()).toMatchObject({ modelStrategy: 'risk-tiered', primaryModel: 'gpt-5.6-terra', failureThreshold: 5 })
    expect(ctx.actionReview.config).toMatchObject({ failureThreshold: 5, sandboxDefaultAllow: false })
    const reset = await ctx.actionReviewSettings.reset({ expectedRevision: updated.revision })
    expect(reset).toMatchObject({ value: { reviewerModel: 'flash', failureThreshold: 3 }, user: {} })
    expect(ctx.actionReviewSettings.reviewStatus({ sessionId: 's1' })).toEqual({ revision: 0, indicators: [] })
    expect(() => ctx.actionReviewSettings.reviewStatus({ sessionId: '' })).toThrow(/sessionId must be a non-empty string/)
    expect(ctx.actionReviewSettings.metrics()).toMatchObject({ totalActions: 0, policyRetrieval: { searchCalls: 0 } })
  })

  it('rejects fields outside the closed extension settings vocabulary', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(ActionReviewRuntime, { mode: 'enforcing' })
    await ctx.plugin(AutoReviewSettingsBridge)
    await expect(ctx.actionReviewSettings.update({
      patch: { arbitraryHostField: true } as never,
      expectedRevision: 0,
    })).rejects.toThrow(/unknown settings field/)
  })
})
