import z from '@deepseek-ai/schemastery'
import type { ActionKind, AutoReviewConfig, AutoReviewUiSettings, LlmReviewerConfig } from './types.ts'

/** Durable settings namespace consumed by both the Host runtime and WebUI. */
export const AUTO_REVIEW_SETTINGS_NAMESPACE = 'auto-review'

export const STRONG_REVIEW_KINDS: readonly ActionKind[] = Object.freeze([
  'network', 'sensitive-read', 'destructive', 'permission-change', 'production-change',
])

const ACTION_KINDS: readonly ActionKind[] = Object.freeze([
  'workspace-read', 'workspace-write', 'process', 'network', 'sensitive-read', 'destructive',
  'permission-change', 'production-change', 'sandbox-escalation', 'extension-unknown', 'hard-deny',
])

/** Flash remains the default reviewer because review sits on the critical action path. */
export const DEFAULT_AUTO_REVIEW_UI_SETTINGS: AutoReviewUiSettings = Object.freeze({
  enabled: true,
  sandboxDefaultAllow: true,
  reviewFullAccess: true,
  reviewerModel: 'flash',
  modelStrategy: 'single',
  primaryProvider: 'deepseek-official',
  primaryModel: 'deepseek-v4-flash',
  primaryReasoningEffort: '',
  strongProvider: 'deepseek-official',
  strongModel: 'deepseek-v4-pro',
  strongReasoningEffort: '',
  strongReviewKinds: [...STRONG_REVIEW_KINDS],
  escalateUncertainToStrong: true,
  maxInputBytes: 16384,
  maxOutputTokens: 2048,
  timeoutMs: 90000,
  maxAttempts: 3,
  transcriptMaxEntries: 12,
  transcriptMaxBytes: 32768,
  failureThreshold: 3,
  breakerCooldownMs: 60000,
})

/** Wire-visible schema for the Auto Review configuration page. */
export const AutoReviewUiSettingsSchema: z<AutoReviewUiSettings> = z.object({
  enabled: z.boolean().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.enabled),
  sandboxDefaultAllow: z.boolean().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.sandboxDefaultAllow),
  reviewFullAccess: z.boolean().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.reviewFullAccess),
  reviewerModel: z.union(['flash', 'pro'] as const).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.reviewerModel),
  modelStrategy: z.union(['single', 'risk-tiered'] as const).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.modelStrategy),
  primaryProvider: z.string().required().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.primaryProvider),
  primaryModel: z.string().required().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.primaryModel),
  primaryReasoningEffort: z.string().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.primaryReasoningEffort),
  strongProvider: z.string().required().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.strongProvider),
  strongModel: z.string().required().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.strongModel),
  strongReasoningEffort: z.string().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.strongReasoningEffort),
  strongReviewKinds: z.array(z.union(ACTION_KINDS as ActionKind[])).default([...STRONG_REVIEW_KINDS]),
  escalateUncertainToStrong: z.boolean().default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.escalateUncertainToStrong),
  maxInputBytes: z.number().step(1).min(1024).max(262144).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.maxInputBytes),
  maxOutputTokens: z.number().step(1).min(128).max(4096).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.maxOutputTokens),
  timeoutMs: z.number().step(1).min(1000).max(300000).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.timeoutMs),
  maxAttempts: z.number().step(1).min(1).max(3).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.maxAttempts),
  transcriptMaxEntries: z.number().step(1).min(1).max(64).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.transcriptMaxEntries),
  transcriptMaxBytes: z.number().step(1).min(1024).max(262144).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.transcriptMaxBytes),
  failureThreshold: z.number().step(1).min(1).max(20).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.failureThreshold),
  breakerCooldownMs: z.number().step(1).min(1000).max(3600000).default(DEFAULT_AUTO_REVIEW_UI_SETTINGS.breakerCooldownMs),
})

/** Resolve the composition base shown in WebUI from the deployed plugin rows. */
export function autoReviewSettingsBase(
  runtime: AutoReviewConfig,
  reviewer?: LlmReviewerConfig,
): AutoReviewUiSettings {
  const model = reviewer?.model.toLocaleLowerCase().includes('pro') ? 'pro' : 'flash'
  const primaryProvider = reviewer?.provider ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.primaryProvider
  const primaryModel = reviewer?.model ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.primaryModel
  const inferredStrongModel = primaryModel.toLocaleLowerCase().includes('flash')
    ? primaryModel.replace(/flash/ig, 'pro')
    : primaryModel
  return {
    enabled: runtime.mode !== 'disabled',
    sandboxDefaultAllow: runtime.sandboxDefaultAllow ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.sandboxDefaultAllow,
    reviewFullAccess: runtime.reviewFullAccess ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.reviewFullAccess,
    reviewerModel: model,
    modelStrategy: reviewer?.modelStrategy ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.modelStrategy,
    primaryProvider,
    primaryModel,
    primaryReasoningEffort: reviewer?.reasoningEffort ?? '',
    strongProvider: reviewer?.strongProvider ?? primaryProvider,
    strongModel: reviewer?.strongModel ?? inferredStrongModel,
    strongReasoningEffort: reviewer?.strongReasoningEffort ?? reviewer?.reasoningEffort ?? '',
    strongReviewKinds: [...(reviewer?.strongReviewKinds ?? STRONG_REVIEW_KINDS)],
    escalateUncertainToStrong: reviewer?.escalateUncertainToStrong ?? true,
    maxInputBytes: reviewer?.maxInputBytes ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.maxInputBytes,
    maxOutputTokens: reviewer?.maxOutputTokens ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.maxOutputTokens,
    timeoutMs: reviewer?.timeoutMs ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.timeoutMs,
    maxAttempts: reviewer?.maxAttempts ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.maxAttempts,
    transcriptMaxEntries: reviewer?.transcriptMaxEntries ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.transcriptMaxEntries,
    transcriptMaxBytes: reviewer?.transcriptMaxBytes ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.transcriptMaxBytes,
    failureThreshold: runtime.failureThreshold ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.failureThreshold,
    breakerCooldownMs: runtime.breakerCooldownMs ?? DEFAULT_AUTO_REVIEW_UI_SETTINGS.breakerCooldownMs,
  }
}

/** Map the settings tier to the provider's canonical model id. */
export function reviewerModelId(tier: AutoReviewUiSettings['reviewerModel']): string {
  return tier === 'pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash'
}
