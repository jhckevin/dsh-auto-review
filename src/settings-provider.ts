/** Explicit Host settings bridge for the Auto Review capability. */
import { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './service.ts'
import type { AutoReviewIndicatorSnapshot, AutoReviewUiSettings } from './types.ts'
import {
  AUTO_REVIEW_SETTINGS_NAMESPACE,
  AutoReviewUiSettingsSchema,
} from './settings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    actionReviewSettings: AutoReviewSettingsBridge
  }
}

export const name = 'auto-review-settings'

export interface AutoReviewSettingsSnapshot {
  readonly value: AutoReviewUiSettings
  readonly base: AutoReviewUiSettings
  readonly user: Partial<AutoReviewUiSettings>
  readonly revision: number
  readonly writable: boolean
}

export interface AutoReviewSettingsUpdate {
  readonly patch: Partial<AutoReviewUiSettings>
  readonly expectedRevision: number
}

export interface AutoReviewSettingsReset {
  readonly expectedRevision: number
}

export interface AutoReviewStatusRequest {
  readonly sessionId: string
}

const SETTINGS_NS = settingsNamespace(AUTO_REVIEW_SETTINGS_NAMESPACE)
const SETTINGS_FIELDS = new Set<keyof AutoReviewUiSettings>([
  'enabled', 'reviewerModel', 'maxInputBytes', 'maxOutputTokens', 'timeoutMs',
  'sandboxDefaultAllow',
  'maxAttempts', 'transcriptMaxEntries', 'transcriptMaxBytes', 'failureThreshold',
  'breakerCooldownMs',
])

/**
 * Own the WebUI namespace and expose only this extension's non-secret fields
 * through a dedicated Typert Remote. Harness deliberately does not expose
 * arbitrary settings namespaces through its privileged core Settings API.
 */
export class AutoReviewSettingsBridge extends TypertRemoteService {
  static inject = ['actionReview', 'settings']
  private readonly scope: SettingsScope<AutoReviewUiSettings>

  constructor(ctx: Context) {
    super(ctx, 'actionReviewSettings')
    this.scope = ctx.settings.register(
      SETTINGS_NS,
      AutoReviewUiSettingsSchema,
      { base: ctx.actionReview.settingsDefaults(), applies: 'live' },
    )
    ctx.effect(() => ctx.actionReview.attachSettings(this.scope), 'auto-review-settings.attach()')
  }

  /** Return a detached projection containing no Host path or secret. */
  @Remote('read')
  read(): AutoReviewSettingsSnapshot {
    const descriptor = this.ctx.settings.describe().find(item => item.ns === SETTINGS_NS)
    if (descriptor === undefined) throw new Error('auto-review: settings namespace is unavailable')
    return Object.freeze({
      value: Object.freeze({ ...this.scope.get() }),
      base: Object.freeze({ ...((descriptor.base as AutoReviewUiSettings | undefined) ?? this.ctx.actionReview.settingsDefaults()) }),
      user: Object.freeze({ ...((descriptor.user as Partial<AutoReviewUiSettings> | undefined) ?? {}) }),
      revision: descriptor.revision,
      writable: this.ctx.settings.writable,
    })
  }

  /** Read only the reviewer lifecycle marks needed by Tool-call badges. */
  @Remote('reviewStatus')
  reviewStatus(request: AutoReviewStatusRequest): AutoReviewIndicatorSnapshot {
    if (typeof request.sessionId !== 'string' || request.sessionId.trim().length === 0) {
      throw new TypeError('auto-review: sessionId must be a non-empty string')
    }
    return this.ctx.actionReview.reviewIndicatorSnapshot(request.sessionId)
  }

  /** Atomically validate and persist one bounded patch. */
  @Remote('update')
  async update(request: AutoReviewSettingsUpdate): Promise<AutoReviewSettingsSnapshot> {
    this.assertRevision(request.expectedRevision)
    if (typeof request.patch !== 'object' || request.patch === null || Array.isArray(request.patch)) {
      throw new TypeError('auto-review: patch must be an object')
    }
    for (const field of Object.keys(request.patch)) {
      if (!SETTINGS_FIELDS.has(field as keyof AutoReviewUiSettings)) {
        throw new TypeError(`auto-review: unknown settings field ${JSON.stringify(field)}`)
      }
    }
    await this.ctx.settings.update(SETTINGS_NS, request.patch, request.expectedRevision)
    return this.read()
  }

  /** Remove all user overrides and re-apply the deployment defaults. */
  @Remote('reset')
  async reset(request: AutoReviewSettingsReset): Promise<AutoReviewSettingsSnapshot> {
    this.assertRevision(request.expectedRevision)
    await this.ctx.settings.replace(SETTINGS_NS, {}, request.expectedRevision)
    return this.read()
  }

  private assertRevision(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('auto-review: expectedRevision must be a non-negative safe integer')
    }
  }
}

export default AutoReviewSettingsBridge
