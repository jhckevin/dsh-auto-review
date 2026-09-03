import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import * as ReviewerProvider from '../src/llm-provider.ts'
import ActionReviewRuntime from '../src/service.ts'
import AutoReviewSettingsBridge from '../src/settings-provider.ts'
import { STRONG_REVIEW_KINDS } from '../src/settings.ts'
import type { LlmReviewerConfig } from '../src/types.ts'

const input = {
  provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'off',
  maxInputBytes: 16384, maxOutputTokens: 2048, timeoutMs: 90000,
} satisfies LlmReviewerConfig

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> {return Promise.resolve({})}
  protected persist(): Promise<void> {return Promise.resolve()}
}

async function mount(config: Partial<LlmReviewerConfig> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ActionReviewRuntime)
  await ctx.plugin(MemorySettings)
  // Pass the module rather than calling apply: Cordis runs Config.~standard
  // before activating the provider, exactly as the profile Loader does.
  await ctx.plugin(ReviewerProvider, {...input, ...config})
  await ctx.plugin(AutoReviewSettingsBridge)
  return ctx
}

describe('reviewer defaults through the native module schema', () => {
  it('retains the five default categories through standard-schema parsing', () => {
    const result = ReviewerProvider.Config['~standard'].validate(input)
    expect(result).toMatchObject({value: {strongReviewKinds: [...STRONG_REVIEW_KINDS]}})
    expect(ReviewerProvider.Config({...input, strongReviewKinds: []}).strongReviewKinds).toEqual([])
  })

  it('loads official Flash as primary and official Pro as the strong default', async () => {
    const ctx = await mount()
    expect(ctx.actionReviewSettings.read().value).toMatchObject({
      primaryProvider: 'deepseek-official', primaryModel: 'deepseek-v4-flash',
      strongProvider: 'deepseek-official', strongModel: 'deepseek-v4-pro',
      strongReviewKinds: [...STRONG_REVIEW_KINDS],
    })
  })

  it.each([
    {provider: 'openai-compatible', model: 'gpt-5.6-terra'},
    {provider: 'custom', model: 'vendor-flash-preview'},
    {provider: 'custom', model: 'deepseek-v4-flash'},
    {provider: 'deepseek-official', model: 'deepseek-v4-flash', strongProvider: 'custom'},
  ])('does not invent a strong model id for $provider/$model', async config => {
    const ctx = await mount(config)
    expect(ctx.actionReviewSettings.read().value.strongModel).toBe(config.model)
  })

  it('keeps explicit strong model and an explicitly empty risk set', async () => {
    const ctx = await mount({strongProvider: 'custom', strongModel: 'reviewer-v2', strongReviewKinds: []})
    expect(ctx.actionReviewSettings.read().value).toMatchObject({
      strongProvider: 'custom', strongModel: 'reviewer-v2', strongReviewKinds: [],
    })
  })

  it('does not rewrite saved overrides when defaults or unrelated fields are used', async () => {
    const ctx = await mount()
    const first = await ctx.actionReviewSettings.update({
      patch: {strongModel: 'deepseek-v4-flash', strongReviewKinds: []}, expectedRevision: 0,
    })
    const next = await ctx.actionReviewSettings.update({patch: {maxAttempts: 1}, expectedRevision: first.revision})
    expect(next.value).toMatchObject({strongModel: 'deepseek-v4-flash', strongReviewKinds: [], maxAttempts: 1})
    expect(next.base).toMatchObject({strongModel: 'deepseek-v4-pro', strongReviewKinds: [...STRONG_REVIEW_KINDS]})
  })
})
