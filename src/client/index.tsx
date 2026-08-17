import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type SVGProps } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ActionKind, AutoReviewMetricsSnapshot, AutoReviewUiSettings } from '../types.ts'
import type { AutoReviewSettingsSnapshot } from '../settings-provider.ts'
import { ReviewStatusClient } from './review-status.ts'

const LOCALE_NAMESPACE = 'settings.autoReview'
const STYLE_ID = '@jhckevin/dsh-auto-review/webui'

const zh = {
  nav: '自动审批审查', title: 'Auto Review', subtitle: '依据权限模式、原生沙盒边界与当前策略，将需要审查的动作交给独立模型。',
  enabled: '启用 Auto Review', enabledHint: '关闭后完全回到 Harness 原生审批链，扩展不再路由、批准或拒绝动作。',
  sandboxDefaultAllow: '原生沙盒内默认通过', sandboxDefaultAllowHint: '默认开启。read-only / workspace-write 中已由原生文件沙盒约束的动作不调用模型；关闭后沙盒内动作也进入 reviewer。Full Access 没有沙盒边界，始终不进入 Auto Review。',
  model: '审查模型', flash: 'Flash（默认）', flashHint: '低延迟，适合动作关键路径。', pro: 'Pro', proHint: '更高审查能力，延迟与成本更高。',
  modelStrategy: '模型策略', single: '单模型', riskTiered: '风险分级', primaryProfile: '常规模型', strongProfile: '高风险模型',
  modelStrategyHint: '单模型始终使用常规模型；风险分级会让指定高风险类型直接使用高风险模型，并可在结论不确定时升级一次。',
  primaryProfileHint: '处理日常审查。Provider 路由和模型必须已在 Harness 服务端配置，凭据不会进入浏览器。', strongProfileHint: '仅在风险分级策略命中高风险类型或触发升级时使用。',
  provider: 'Provider 路由', modelId: '模型 ID', reasoningEffort: 'Reasoning effort（留空使用模型默认）',
  reasoningEffortHint: '这是可选的 Provider 参数；留空最兼容，填写不受支持的值会由 Provider 报错。',
  escalateUncertain: '不确定或高风险结论升级到高风险模型', strongKinds: '直接使用高风险模型的动作类型',
  escalateUncertainHint: '升级与重试共享同一总超时，不会绕过拒绝、沙盒或人工审批。', strongKindsHint: '勾选的类型跳过常规模型，直接交给高风险模型。',
  advanced: '高级参数', maxInputBytes: '最大证据字节', maxOutputTokens: '最大输出 token', timeoutMs: '超时（毫秒）',
  maxAttempts: '最多尝试次数', transcriptMaxEntries: '历史条目上限', transcriptMaxBytes: '历史字节上限',
  failureThreshold: '熔断失败阈值', breakerCooldownMs: '熔断冷却（毫秒）', save: '保存', reset: '恢复部署默认值',
  advancedHint: '这些值限制单次审查的证据、输出、重试和故障恢复开销；一般建议保留部署默认值。',
  maxInputBytesHint: '发送给 reviewer 的净化动作证据上限，不是主 Agent 的完整上下文。', maxOutputTokensHint: '仅限制 reviewer 的结构化判定输出。', timeoutMsHint: '单个动作的总审查时限，包含重试和风险升级。', maxAttemptsHint: '仅在调用或协议失败时创建全新 reviewer session 重试，最多 3 次。',
  transcriptMaxEntriesHint: '最多携带多少条与当前动作有关的净化历史证据。', transcriptMaxBytesHint: '历史证据的总字节上限；不会扩张主 Agent 上下文。', failureThresholdHint: '连续 reviewer 故障达到此数时进入失效保护熔断。', breakerCooldownMsHint: '熔断后等待多久才允许再次探测 reviewer。',
  saved: '设置已保存并实时生效。', failed: '设置未能保存，请检查参数或连接。', inherited: '继承', overridden: '用户覆盖',
  reviewing: 'Auto Review 正在审查此工具调用', denied: 'Auto Review 已拒绝此工具调用',
  funnel: '运行态动作漏斗', totalActions: '全部动作', insideBoundary: '原生沙盒内', autoReviewed: '进入审查', approved: '自动批准', deniedCount: '拒绝', manual: '人工处理',
  policyLookups: '策略检索调用', policyBytes: '策略返回字节',
  behavior: '当前权限组合行为', behaviorDisabled: 'Auto Review 已关闭：所有权限档位均完全使用 Harness 原生审批链。', behaviorDefault: '只读/工作区写入：沙盒内普通动作直接通过；越界、敏感和网络动作进入 Reviewer。', behaviorStrict: '只读/工作区写入：沙盒内动作也进入 Reviewer，但实际执行仍受原生沙盒约束。', fullAccessNative: 'Full Access：没有原生沙盒边界，因此不进入 Auto Review。',
}
const en = {
  nav: 'Auto Review', title: 'Auto Review', subtitle: 'Route actions to an isolated reviewer according to the permission mode, native sandbox boundary, and active policy.',
  enabled: 'Enable Auto Review', enabledHint: 'When disabled, the extension leaves routing, approval, and denial entirely to the native Harness chain.',
  sandboxDefaultAllow: 'Allow native-sandbox actions by default', sandboxDefaultAllowHint: 'On by default. Actions confined by read-only/workspace-write bypass the model; when off, sandboxed actions are reviewed too. Full Access has no sandbox boundary and never enters Auto Review.',
  model: 'Reviewer model', flash: 'Flash (default)', flashHint: 'Low latency for the action critical path.', pro: 'Pro', proHint: 'Higher review capability with greater latency and cost.',
  modelStrategy: 'Model strategy', single: 'Single model', riskTiered: 'Risk tiered', primaryProfile: 'Primary reviewer', strongProfile: 'High-risk reviewer',
  modelStrategyHint: 'Single always uses the primary reviewer. Risk tiering routes selected action kinds directly to the strong reviewer and can escalate one uncertain result.',
  primaryProfileHint: 'Handles routine reviews. The provider route and model must already exist in the Harness host configuration; credentials never enter the browser.', strongProfileHint: 'Used only for configured high-risk kinds or an enabled uncertainty escalation.',
  provider: 'Provider route', modelId: 'Model ID', reasoningEffort: 'Reasoning effort (empty uses model default)',
  reasoningEffortHint: 'Optional provider parameter. Empty is most portable; unsupported values surface as provider errors.',
  escalateUncertain: 'Escalate uncertain or high-risk conclusions to the strong reviewer', strongKinds: 'Action kinds routed directly to the strong reviewer',
  escalateUncertainHint: 'Escalation shares the same total timeout as retries and never bypasses denial, sandboxing, or manual approval.', strongKindsHint: 'Selected kinds skip the primary reviewer and go directly to the strong reviewer.',
  advanced: 'Advanced parameters', maxInputBytes: 'Maximum evidence bytes', maxOutputTokens: 'Maximum output tokens', timeoutMs: 'Timeout (ms)',
  maxAttempts: 'Maximum attempts', transcriptMaxEntries: 'Transcript entry limit', transcriptMaxBytes: 'Transcript byte limit',
  failureThreshold: 'Failure breaker threshold', breakerCooldownMs: 'Breaker cooldown (ms)', save: 'Save', reset: 'Restore deployment defaults',
  advancedHint: 'These values bound evidence, output, retries, and failure recovery for one review. Deployment defaults are recommended.',
  maxInputBytesHint: 'Maximum sanitized action evidence sent to the reviewer, not the main agent context.', maxOutputTokensHint: 'Limits only the reviewer structured decision output.', timeoutMsHint: 'Total review deadline for one action, including retries and risk escalation.', maxAttemptsHint: 'Starts a fresh reviewer session only after call or protocol failure; maximum 3.',
  transcriptMaxEntriesHint: 'Maximum sanitized history entries relevant to the current action.', transcriptMaxBytesHint: 'Total history-evidence byte limit; it does not expand the main agent context.', failureThresholdHint: 'Consecutive reviewer failures before the fail-safe breaker opens.', breakerCooldownMsHint: 'How long the breaker waits before allowing another reviewer probe.',
  saved: 'Settings saved and applied live.', failed: 'Settings could not be saved. Check the values or connection.', inherited: 'Inherited', overridden: 'User override',
  reviewing: 'Auto Review is checking this tool call', denied: 'Auto Review denied this tool call',
  funnel: 'Live action funnel', totalActions: 'All actions', insideBoundary: 'Inside sandbox', autoReviewed: 'Auto-reviewed', approved: 'Approved', deniedCount: 'Denied', manual: 'Manual',
  policyLookups: 'Policy retrieval calls', policyBytes: 'Policy result bytes',
  behavior: 'Current permission behavior', behaviorDisabled: 'Auto Review is off: every permission tier uses the native Harness approval chain only.', behaviorDefault: 'Read-only / Workspace Write: ordinary confined actions pass; boundary-crossing, sensitive, and network actions enter the reviewer.', behaviorStrict: 'Read-only / Workspace Write: confined actions are reviewed too, while execution remains restricted by the native sandbox.', fullAccessNative: 'Full Access: there is no native sandbox boundary, so actions do not enter Auto Review.',
}

type LocaleKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.autoReview': LocaleKey
  }
}

interface AutoReviewSettingsInjected {
  read: (signal?: AbortSignal) => Promise<AutoReviewSettingsSnapshot>
  update: (patch: Partial<AutoReviewUiSettings>, expectedRevision: number, signal?: AbortSignal) => Promise<AutoReviewSettingsSnapshot>
  reset: (expectedRevision: number, signal?: AbortSignal) => Promise<AutoReviewSettingsSnapshot>
  metrics: (signal?: AbortSignal) => Promise<AutoReviewMetricsSnapshot>
}

interface AutoReviewBadgeInjected {
  readonly reviewStatus: ReviewStatusClient
}

interface AutoReviewBadgeOwner {
  readonly sessionId: string
  readonly callId: string
}

interface AutoReviewBadgeSlots {
  inject(name: 'tool.call.badges', register: () => unknown): unknown
  register(
    options: {
      name: 'tool.call.badges'
      id: string
      order: number
      locale: typeof LOCALE_NAMESPACE
      inject: () => AutoReviewBadgeInjected
    },
    component: (props: BadgeProps) => ReactNode,
  ): unknown
}

interface PageSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value?: AutoReviewUiSettings
  readonly user?: Partial<AutoReviewUiSettings>
  readonly revision: number
  readonly writable: boolean
  readonly metrics?: AutoReviewMetricsSnapshot
}

type Props = PropsRuntime<'settings.section'> & PropsLocale<'settings.autoReview'> & InjectFace<AutoReviewSettingsInjected>
type BadgeProps = AutoReviewBadgeOwner & PropsLocale<'settings.autoReview'> & InjectFace<AutoReviewBadgeInjected>
type NumericField = 'maxInputBytes' | 'maxOutputTokens' | 'timeoutMs' | 'maxAttempts' | 'transcriptMaxEntries' | 'transcriptMaxBytes' | 'failureThreshold' | 'breakerCooldownMs'

const NUMERIC_FIELDS: readonly NumericField[] = [
  'maxInputBytes', 'maxOutputTokens', 'timeoutMs', 'maxAttempts', 'transcriptMaxEntries',
  'transcriptMaxBytes', 'failureThreshold', 'breakerCooldownMs',
]

const NUMERIC_HINTS: Readonly<Record<NumericField, LocaleKey>> = {
  maxInputBytes: 'maxInputBytesHint', maxOutputTokens: 'maxOutputTokensHint', timeoutMs: 'timeoutMsHint',
  maxAttempts: 'maxAttemptsHint', transcriptMaxEntries: 'transcriptMaxEntriesHint', transcriptMaxBytes: 'transcriptMaxBytesHint',
  failureThreshold: 'failureThresholdHint', breakerCooldownMs: 'breakerCooldownMsHint',
}

const STRONG_KIND_OPTIONS: readonly ActionKind[] = [
  'network', 'sensitive-read', 'destructive', 'permission-change', 'production-change', 'sandbox-escalation',
]

/** Exact 20px Codex Desktop Auto Review glyph, scaled into Harness's 24px icon grid. */
export function ReviewerShieldIcon({ denied = false, ...props }: SVGProps<SVGSVGElement> & { denied?: boolean }): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <g transform="scale(1.2)">
        <path fillRule="evenodd" clipRule="evenodd" d="M9.06543 1.95123C9.66107 1.69076 10.3389 1.69071 10.9346 1.95123L15.9346 4.13873C16.7832 4.51008 17.3311 5.34917 17.3311 6.27545V10.5528C17.3309 14.6017 14.0489 17.8847 10 17.8848C5.95108 17.8846 2.66813 14.6017 2.66797 10.5528V6.27545C2.66797 5.34924 3.21695 4.51012 4.06543 4.13873L9.06543 1.95123ZM10.4014 3.16998C10.1456 3.05814 9.85444 3.05819 9.59863 3.16998L4.59863 5.35748C4.23427 5.51708 3.99805 5.87764 3.99805 6.27545V10.5528C3.99821 13.8671 6.68563 16.5546 10 16.5547C13.3144 16.5546 16.0008 13.8671 16.001 10.5528V6.27545C16.001 5.87756 15.7658 5.51703 15.4014 5.35748L10.4014 3.16998Z" fill="currentColor" />
        <path d="M13.4678 11.4318L13.333 11.4182H10.833C10.466 11.4183 10.1682 11.7162 10.168 12.0832C10.168 12.4504 10.4659 12.7481 10.833 12.7482H13.333L13.4678 12.7346C13.7706 12.6724 13.9981 12.4044 13.9981 12.0832C13.9979 11.7621 13.7706 11.494 13.4678 11.4318Z" fill="currentColor" />
        <path d="M7.65336 12.426C7.46431 12.7406 7.05607 12.8424 6.74125 12.6535C6.42646 12.4646 6.32395 12.0563 6.51274 11.7414L7.55668 10.0002L6.51274 8.25899C6.32395 7.94412 6.42646 7.53583 6.74125 7.34688C7.05607 7.15799 7.46431 7.25975 7.65336 7.57442L8.90336 9.6584C9.0296 9.86893 9.0296 10.1315 8.90336 10.342L7.65336 12.426Z" fill="currentColor" />
      </g>
      {denied ? <path d="m2 2 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : null}
    </svg>
  )
}

/** Product mark: the same canonical Auto Review glyph, never the denied variant. */
export function AutoReviewLogo(): ReactNode {
  return (
    <span className="ar-product-logo" data-auto-review-logo="canonical" aria-hidden="true">
      <ReviewerShieldIcon width={24} height={24} />
    </span>
  )
}

/** Settings-navigation mark: the canonical product glyph at the shell's 16px size. */
export function AutoReviewNavIcon(): ReactNode {
  return <ReviewerShieldIcon width={16} height={16} />
}

export function AutoReviewCallBadge({ sessionId, callId, reviewStatus, t }: BadgeProps): ReactNode {
  const subscribe = useCallback((listener: () => void) => reviewStatus.subscribe(sessionId, listener), [reviewStatus, sessionId])
  const getSnapshot = useCallback(() => reviewStatus.snapshot(sessionId), [reviewStatus, sessionId])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const indicator = snapshot.indicators.find(item => item.callId === callId)
  if (indicator === undefined) return null
  const denied = indicator.state === 'denied'
  const label = t(denied ? 'denied' : 'reviewing')
  return (
    <span
      className="ar-call-badge"
      data-auto-review-state={indicator.state}
      role="status"
      aria-live="polite"
      aria-label={label}
      title={label}
    >
      <ReviewerShieldIcon denied={denied} />
    </span>
  )
}

export function AutoReviewFunnel({ metrics, t }: { metrics: AutoReviewMetricsSnapshot; t: (key: LocaleKey) => string }): ReactNode {
  const values = [
    ['totalActions', metrics.totalActions], ['insideBoundary', metrics.insideBoundary],
    ['autoReviewed', metrics.autoReviewed], ['approved', metrics.approved],
    ['deniedCount', metrics.denied], ['manual', metrics.manual],
  ] as const
  return (
    <div className="ar-card"><h3>{t('funnel')}</h3><div className="ar-funnel" aria-label={t('funnel')}>
      {values.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{t(label)}</span></div>)}
    </div><p className="ar-funnel-meta">{t('policyLookups')}: {metrics.policyRetrieval.outlineCalls + metrics.policyRetrieval.searchCalls + metrics.policyRetrieval.getCalls} · {t('policyBytes')}: {metrics.policyRetrieval.resultBytes}</p></div>
  )
}

function AutoReviewSettingsSection({ read, update, reset: resetSettings, metrics: readMetrics, t }: Props): ReactNode {
  const [snapshot, setSnapshot] = useState<PageSnapshot>({ status: 'loading', revision: 0, writable: false })
  const [draft, setDraft] = useState<AutoReviewUiSettings | undefined>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'failed' | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    void read(abort.signal).then(value => {
      if (abort.signal.aborted) return
      setSnapshot({ status: 'ready', ...value })
      setDraft(value.value)
    }, () => {
      if (!abort.signal.aborted) setSnapshot({ status: 'unavailable', revision: 0, writable: false })
    })
    return () => { abort.abort() }
  }, [read])

  useEffect(() => {
    const abort = new AbortController()
    const refresh = (): void => {
      void readMetrics(abort.signal).then(metrics => {
        if (!abort.signal.aborted) setSnapshot(current => ({ ...current, metrics }))
      }, () => undefined)
    }
    const timer = setInterval(refresh, 5000)
    return () => { clearInterval(timer); abort.abort() }
  }, [readMetrics])

  const invalid = useMemo(() => draft === undefined || NUMERIC_FIELDS.some(field => {
    const value = draft[field]
    return !Number.isSafeInteger(value) || value < 1
  }) || draft.maxAttempts > 3 || draft.transcriptMaxEntries > 64
    || draft.primaryProvider.trim().length === 0 || draft.primaryModel.trim().length === 0
    || (draft.modelStrategy === 'risk-tiered' && (draft.strongProvider.trim().length === 0 || draft.strongModel.trim().length === 0)), [draft])

  if (snapshot.status !== 'ready' || draft === undefined) {
    return <section className="ar-page" aria-busy="true"><p className="ar-muted">{snapshot.status === 'unavailable' ? t('failed') : 'Loading…'}</p></section>
  }

  const setNumber = (field: NumericField, text: string): void => {
    const value = Number(text)
    setNotice(undefined)
    setDraft(current => current === undefined ? current : { ...current, [field]: value })
  }
  const setText = (field: 'primaryProvider' | 'primaryModel' | 'primaryReasoningEffort' | 'strongProvider' | 'strongModel' | 'strongReasoningEffort', value: string): void => {
    setNotice(undefined)
    setDraft(current => current === undefined ? current : { ...current, [field]: value })
  }
  const toggleStrongKind = (kind: ActionKind): void => {
    setNotice(undefined)
    setDraft(current => current === undefined ? current : {
      ...current,
      strongReviewKinds: current.strongReviewKinds.includes(kind)
        ? current.strongReviewKinds.filter(value => value !== kind)
        : [...current.strongReviewKinds, kind],
    })
  }
  const save = (): void => {
    if (invalid || saving || !snapshot.writable) return
    setSaving(true)
    setNotice(undefined)
    void update(draft, snapshot.revision).then(next => {
      setSnapshot({ status: 'ready', ...next })
      setDraft(next.value)
      setNotice('saved')
    }, () => {
      setNotice('failed')
    }).finally(() => { setSaving(false) })
  }
  const reset = (): void => {
    if (saving || !snapshot.writable) return
    setSaving(true)
    setNotice(undefined)
    void resetSettings(snapshot.revision).then(next => {
      setSnapshot({ status: 'ready', ...next })
      setDraft(next.value)
      setNotice('saved')
    }, () => {
      setNotice('failed')
    }).finally(() => { setSaving(false) })
  }
  const overridden = (field: keyof AutoReviewUiSettings): boolean => (
    typeof snapshot.user === 'object' && snapshot.user !== null && Object.hasOwn(snapshot.user, field)
  )

  return (
    <section className="ar-page">
      <header className="ar-header"><div className="ar-header-title"><AutoReviewLogo /><div><h2>{t('title')}</h2><p>{t('subtitle')}</p></div></div><span className="ar-live">LIVE</span></header>
      {snapshot.metrics === undefined ? null : <AutoReviewFunnel metrics={snapshot.metrics} t={t} />}
      <div className="ar-card ar-toggle-row">
        <div><strong>{t('enabled')}</strong><p>{t('enabledHint')}</p></div>
        <button className="ar-switch" type="button" role="switch" aria-checked={draft.enabled} onClick={() => { setNotice(undefined); setDraft({ ...draft, enabled: !draft.enabled }) }}><span /></button>
      </div>
      <div className="ar-card ar-behavior"><h3>{t('behavior')}</h3><p>{t(!draft.enabled ? 'behaviorDisabled' : draft.sandboxDefaultAllow ? 'behaviorDefault' : 'behaviorStrict')}</p>{draft.enabled ? <p>{t('fullAccessNative')}</p> : null}</div>
      <div className="ar-card ar-toggle-row">
        <div><strong>{t('sandboxDefaultAllow')}</strong><p>{t('sandboxDefaultAllowHint')}</p></div>
        <button className="ar-switch" type="button" role="switch" aria-checked={draft.sandboxDefaultAllow} disabled={!draft.enabled} onClick={() => { setNotice(undefined); setDraft({ ...draft, sandboxDefaultAllow: !draft.sandboxDefaultAllow }) }}><span /></button>
      </div>
      <div className="ar-card">
        <h3>{t('model')}</h3>
        <div className="ar-setting-block"><label className="ar-select-row"><span>{t('modelStrategy')}</span><select value={draft.modelStrategy} onChange={event => { setDraft({ ...draft, modelStrategy: event.currentTarget.value as AutoReviewUiSettings['modelStrategy'] }) }}><option value="single">{t('single')}</option><option value="risk-tiered">{t('riskTiered')}</option></select></label><p className="ar-help">{t('modelStrategyHint')}</p></div>
        <div className="ar-profile-grid">
          <fieldset><legend>{t('primaryProfile')}</legend><p className="ar-help">{t('primaryProfileHint')}</p><label>{t('provider')}<input value={draft.primaryProvider} onChange={event => { setText('primaryProvider', event.currentTarget.value) }} /></label><label>{t('modelId')}<input value={draft.primaryModel} onChange={event => { setText('primaryModel', event.currentTarget.value) }} /></label><label>{t('reasoningEffort')}<input value={draft.primaryReasoningEffort} onChange={event => { setText('primaryReasoningEffort', event.currentTarget.value) }} /><small className="ar-help">{t('reasoningEffortHint')}</small></label></fieldset>
          {draft.modelStrategy === 'risk-tiered' ? <fieldset><legend>{t('strongProfile')}</legend><p className="ar-help">{t('strongProfileHint')}</p><label>{t('provider')}<input value={draft.strongProvider} onChange={event => { setText('strongProvider', event.currentTarget.value) }} /></label><label>{t('modelId')}<input value={draft.strongModel} onChange={event => { setText('strongModel', event.currentTarget.value) }} /></label><label>{t('reasoningEffort')}<input value={draft.strongReasoningEffort} onChange={event => { setText('strongReasoningEffort', event.currentTarget.value) }} /><small className="ar-help">{t('reasoningEffortHint')}</small></label></fieldset> : null}
        </div>
        {draft.modelStrategy === 'risk-tiered' ? <><label className="ar-check"><input type="checkbox" checked={draft.escalateUncertainToStrong} onChange={() => { setDraft({ ...draft, escalateUncertainToStrong: !draft.escalateUncertainToStrong }) }} />{t('escalateUncertain')}</label><p className="ar-help ar-indented-help">{t('escalateUncertainHint')}</p><div className="ar-kind-grid" aria-label={t('strongKinds')}>{STRONG_KIND_OPTIONS.map(kind => <label key={kind}><input type="checkbox" checked={draft.strongReviewKinds.includes(kind)} onChange={() => { toggleStrongKind(kind) }} />{kind}</label>)}</div><p className="ar-help">{t('strongKindsHint')}</p></> : null}
      </div>
      <details className="ar-card ar-advanced">
        <summary>{t('advanced')}</summary>
        <p className="ar-help ar-advanced-help">{t('advancedHint')}</p>
        <div className="ar-field-grid">
          {NUMERIC_FIELDS.map(field => (
            <label key={field}><span>{t(field)}</span><input type="number" min="1" value={draft[field]} onChange={event => { setNumber(field, event.currentTarget.value) }} /><small className="ar-field-source">{t(overridden(field) ? 'overridden' : 'inherited')}</small><small className="ar-help">{t(NUMERIC_HINTS[field])}</small></label>
          ))}
        </div>
      </details>
      <footer className="ar-actions">
        <button type="button" className="ar-secondary" disabled={saving || !snapshot.writable} onClick={reset}>{t('reset')}</button>
        <button type="button" className="ar-primary" disabled={invalid || saving || !snapshot.writable} onClick={save}>{t('save')}</button>
      </footer>
      {notice !== undefined ? <p className={`ar-notice ar-${notice}`} role="status">{t(notice)}</p> : null}
    </section>
  )
}

const CSS = `
.ar-header-title{display:flex;align-items:flex-start;gap:10px}.ar-product-logo{display:inline-grid;place-items:center;flex:0 0 auto;width:30px;height:30px;color:var(--dsw-alias-label-primary)}
.ar-help{display:block!important;margin-top:5px!important;color:var(--dsw-alias-label-secondary)!important;font-size:11px!important;line-height:1.45!important;font-weight:400!important}.ar-setting-block{margin:10px 0 14px}.ar-setting-block .ar-select-row{margin-bottom:0}.ar-indented-help{margin-left:23px!important}.ar-advanced-help{margin-top:9px!important}.ar-field-grid .ar-field-source{font-size:10px}.ar-field-grid .ar-help{margin-top:0!important}
.ar-page{max-width:760px;padding:8px 4px 36px;color:var(--dsw-alias-label-primary)}.ar-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:18px}.ar-header h2{font-size:22px;margin:0 0 6px}.ar-header p,.ar-card p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}.ar-live{font:600 10px/1.8 ui-monospace,monospace;color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);border-radius:999px;padding:0 8px}.ar-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px;margin:12px 0}.ar-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:22px}.ar-toggle-row strong,.ar-card h3{display:block;margin:0 0 5px;font-size:14px}.ar-switch{width:44px;height:24px;border:0;border-radius:999px;padding:3px;background:var(--dsw-alias-border-l2);cursor:pointer}.ar-switch span{display:block;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}.ar-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.ar-switch[aria-checked=true] span{transform:translateX(20px)}.ar-select-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:10px 0}.ar-select-row select,.ar-profile-grid input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;background:var(--dsw-alias-bg-base);color:inherit}.ar-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ar-profile-grid fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:12px}.ar-profile-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;margin:8px 0}.ar-check{display:flex;align-items:center;gap:7px;margin-top:12px;font-size:12px}.ar-kind-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:10px;font-size:12px}.ar-kind-grid label{display:flex;align-items:center;gap:5px}.ar-advanced summary{cursor:pointer;font-weight:600}.ar-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.ar-field-grid label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px;font-size:12px}.ar-field-grid input{grid-column:1/3;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;background:var(--dsw-alias-bg-base);color:inherit}.ar-field-grid small{grid-column:1/3;color:var(--dsw-alias-label-secondary)}.ar-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.ar-actions button{border-radius:8px;padding:8px 15px;cursor:pointer}.ar-secondary{background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2)}.ar-primary{background:var(--dsw-alias-brand-primary);color:white;border:1px solid var(--dsw-alias-brand-primary)}.ar-actions button:disabled{opacity:.45;cursor:not-allowed}.ar-notice{font-size:12px;text-align:right}.ar-saved{color:var(--dsw-alias-state-success-primary)}.ar-failed{color:var(--dsw-alias-state-error-primary)}.ar-muted{color:var(--dsw-alias-label-secondary)}@media(max-width:680px){.ar-profile-grid,.ar-field-grid{grid-template-columns:1fr}.ar-kind-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ar-funnel{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:12px}.ar-funnel div{display:flex;flex-direction:column;gap:3px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-base);text-align:center}.ar-funnel strong{font:700 18px/1.2 ui-monospace,monospace}.ar-funnel span{font-size:10px;color:var(--dsw-alias-label-secondary)}
.ar-funnel-meta{margin-top:10px!important;font-size:11px!important}
@media(max-width:680px){.ar-funnel{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ar-call-badge{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,currentColor 16%,transparent)}
.ar-call-badge[data-auto-review-state=reviewing]{animation:ar-review-pulse 1.15s ease-in-out infinite}
.ar-call-badge[data-auto-review-state=denied]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,var(--dsw-alias-bg-layer-1))}
@keyframes ar-review-pulse{0%,100%{opacity:.52}50%{opacity:1}}@media(prefers-reduced-motion:reduce){.ar-call-badge{animation:none!important}}
`

/** Client services required by settings scopes and the settings slot. */
export const inject = ['slots', 'locale', 'connection', 'remote']

/** Register settings and additive per-call review state badges in Harness WebUI. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'auto-review webui: dictionaries')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = '@jhckevin/dsh-auto-review'
    style.dataset.pluginCss = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'auto-review webui: styles')
  const connection = ctx.get('connection') as ConnectionHandle
  const api = createSettingsRemote(connection)
  const reviewStatus = createReviewStatusClient(connection)
  ctx.effect(() => () => { reviewStatus.dispose() }, 'auto-review webui: review status client')
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  const sectionRegistration = {
    name: 'settings.section', id: 'auto-review', order: 17, label: () => t('nav'), icon: <AutoReviewNavIcon />, locale: LOCALE_NAMESPACE,
    inject: (): AutoReviewSettingsInjected => api,
  } as const
  ctx.slots.inject('settings.section', () => ctx.slots.register(sectionRegistration, AutoReviewSettingsSection))
  // The badge slot is introduced by the paired Harness core change and is not
  // present in the published rc.6 type catalog, so keep this compatibility
  // adapter local instead of globally augmenting SlotMap with a duplicate owner.
  const badgeSlots = ctx.slots as unknown as AutoReviewBadgeSlots
  badgeSlots.inject('tool.call.badges', () => badgeSlots.register({
    name: 'tool.call.badges', id: 'auto-review', order: 20, locale: LOCALE_NAMESPACE,
    inject: (): AutoReviewBadgeInjected => ({ reviewStatus }),
  }, AutoReviewCallBadge))
}

function createSettingsRemote(connection: ConnectionHandle): AutoReviewSettingsInjected {
  const call = async <T,>(method: string, args: object, signal?: AbortSignal): Promise<T> => {
    const result = await connection.rpc.call('/api', `actionReviewSettings/${method}`, { args }, signal)
    if (!result.ok) throw new Error(`actionReviewSettings/${method} failed: ${result.error.code}: ${result.error.message}`)
    return result.value as T
  }
  return {
    read: signal => call('read', {}, signal),
    update: (patch, expectedRevision, signal) => call('update', { request: { patch, expectedRevision } }, signal),
    reset: (expectedRevision, signal) => call('reset', { request: { expectedRevision } }, signal),
    metrics: signal => call('metrics', {}, signal),
  }
}

function createReviewStatusClient(connection: ConnectionHandle): ReviewStatusClient {
  return new ReviewStatusClient({
    read: async (sessionId, signal) => {
      const result = await connection.rpc.call('/api', 'actionReviewSettings/reviewStatus', { args: { request: { sessionId } } }, signal)
      if (!result.ok) throw new Error(`actionReviewSettings/reviewStatus failed: ${result.error.code}: ${result.error.message}`)
      return result.value as import('../types.ts').AutoReviewIndicatorSnapshot
    },
  })
}
