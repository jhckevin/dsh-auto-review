import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type SVGProps } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ActionKind, AutoReviewUiSettings } from '../types.ts'
import type { AutoReviewSettingsSnapshot } from '../settings-provider.ts'
import { ReviewStatusClient } from './review-status.ts'

const LOCALE_NAMESPACE = 'settings.autoReview'
const STYLE_ID = '@jhckevin/dsh-auto-review/webui'

const zh = {
  nav: '自动审批审查', title: 'Auto Review', subtitle: '仅对越出原生沙盒边界的动作调用独立审查模型。',
  enabled: '启用 Auto Review', enabledHint: '关闭后完全回到 Harness 原生审批链，扩展不再路由、批准或拒绝动作。',
  sandboxDefaultAllow: '原生沙盒内默认通过', sandboxDefaultAllowHint: '默认开启。read-only / workspace-write 中已由原生文件沙盒约束的动作不调用模型；关闭后沙盒内动作也进入 reviewer。Full Access 没有沙盒边界，始终不进入 Auto Review。',
  model: '审查模型', flash: 'Flash（默认）', flashHint: '低延迟，适合动作关键路径。', pro: 'Pro', proHint: '更高审查能力，延迟与成本更高。',
  modelStrategy: '模型策略', single: '单模型', riskTiered: '风险分级', primaryProfile: '常规模型', strongProfile: '高风险模型',
  provider: 'Provider 路由', modelId: '模型 ID', reasoningEffort: 'Reasoning effort（留空使用模型默认）',
  escalateUncertain: '不确定或高风险结论升级到高风险模型', strongKinds: '直接使用高风险模型的动作类型',
  advanced: '高级参数', maxInputBytes: '最大证据字节', maxOutputTokens: '最大输出 token', timeoutMs: '超时（毫秒）',
  maxAttempts: '最多尝试次数', transcriptMaxEntries: '历史条目上限', transcriptMaxBytes: '历史字节上限',
  failureThreshold: '熔断失败阈值', breakerCooldownMs: '熔断冷却（毫秒）', save: '保存', reset: '恢复部署默认值',
  saved: '设置已保存并实时生效。', failed: '设置未能保存，请检查参数或连接。', inherited: '继承', overridden: '用户覆盖',
  reviewing: 'Auto Review 正在审查此工具调用', denied: 'Auto Review 已拒绝此工具调用',
}
const en = {
  nav: 'Auto Review', title: 'Auto Review', subtitle: 'Use an isolated reviewer only for actions that cross the native sandbox boundary.',
  enabled: 'Enable Auto Review', enabledHint: 'When disabled, the extension leaves routing, approval, and denial entirely to the native Harness chain.',
  sandboxDefaultAllow: 'Allow native-sandbox actions by default', sandboxDefaultAllowHint: 'On by default. Actions confined by read-only/workspace-write bypass the model; when off, sandboxed actions are reviewed too. Full Access has no sandbox boundary and never enters Auto Review.',
  model: 'Reviewer model', flash: 'Flash (default)', flashHint: 'Low latency for the action critical path.', pro: 'Pro', proHint: 'Higher review capability with greater latency and cost.',
  modelStrategy: 'Model strategy', single: 'Single model', riskTiered: 'Risk tiered', primaryProfile: 'Primary reviewer', strongProfile: 'High-risk reviewer',
  provider: 'Provider route', modelId: 'Model ID', reasoningEffort: 'Reasoning effort (empty uses model default)',
  escalateUncertain: 'Escalate uncertain or high-risk conclusions to the strong reviewer', strongKinds: 'Action kinds routed directly to the strong reviewer',
  advanced: 'Advanced parameters', maxInputBytes: 'Maximum evidence bytes', maxOutputTokens: 'Maximum output tokens', timeoutMs: 'Timeout (ms)',
  maxAttempts: 'Maximum attempts', transcriptMaxEntries: 'Transcript entry limit', transcriptMaxBytes: 'Transcript byte limit',
  failureThreshold: 'Failure breaker threshold', breakerCooldownMs: 'Breaker cooldown (ms)', save: 'Save', reset: 'Restore deployment defaults',
  saved: 'Settings saved and applied live.', failed: 'Settings could not be saved. Check the values or connection.', inherited: 'Inherited', overridden: 'User override',
  reviewing: 'Auto Review is checking this tool call', denied: 'Auto Review denied this tool call',
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
}

type Props = PropsRuntime<'settings.section'> & PropsLocale<'settings.autoReview'> & InjectFace<AutoReviewSettingsInjected>
type BadgeProps = AutoReviewBadgeOwner & PropsLocale<'settings.autoReview'> & InjectFace<AutoReviewBadgeInjected>
type NumericField = 'maxInputBytes' | 'maxOutputTokens' | 'timeoutMs' | 'maxAttempts' | 'transcriptMaxEntries' | 'transcriptMaxBytes' | 'failureThreshold' | 'breakerCooldownMs'

const NUMERIC_FIELDS: readonly NumericField[] = [
  'maxInputBytes', 'maxOutputTokens', 'timeoutMs', 'maxAttempts', 'transcriptMaxEntries',
  'transcriptMaxBytes', 'failureThreshold', 'breakerCooldownMs',
]

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

function AutoReviewSettingsSection({ read, update, reset: resetSettings, t }: Props): ReactNode {
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
      <header className="ar-header"><div><h2>{t('title')}</h2><p>{t('subtitle')}</p></div><span className="ar-live">LIVE</span></header>
      <div className="ar-card ar-toggle-row">
        <div><strong>{t('enabled')}</strong><p>{t('enabledHint')}</p></div>
        <button className="ar-switch" type="button" role="switch" aria-checked={draft.enabled} onClick={() => { setNotice(undefined); setDraft({ ...draft, enabled: !draft.enabled }) }}><span /></button>
      </div>
      <div className="ar-card ar-toggle-row">
        <div><strong>{t('sandboxDefaultAllow')}</strong><p>{t('sandboxDefaultAllowHint')}</p></div>
        <button className="ar-switch" type="button" role="switch" aria-checked={draft.sandboxDefaultAllow} disabled={!draft.enabled} onClick={() => { setNotice(undefined); setDraft({ ...draft, sandboxDefaultAllow: !draft.sandboxDefaultAllow }) }}><span /></button>
      </div>
      <div className="ar-card">
        <h3>{t('model')}</h3>
        <label className="ar-select-row"><span>{t('modelStrategy')}</span><select value={draft.modelStrategy} onChange={event => { setDraft({ ...draft, modelStrategy: event.currentTarget.value as AutoReviewUiSettings['modelStrategy'] }) }}><option value="single">{t('single')}</option><option value="risk-tiered">{t('riskTiered')}</option></select></label>
        <div className="ar-profile-grid">
          <fieldset><legend>{t('primaryProfile')}</legend><label>{t('provider')}<input value={draft.primaryProvider} onChange={event => { setText('primaryProvider', event.currentTarget.value) }} /></label><label>{t('modelId')}<input value={draft.primaryModel} onChange={event => { setText('primaryModel', event.currentTarget.value) }} /></label><label>{t('reasoningEffort')}<input value={draft.primaryReasoningEffort} onChange={event => { setText('primaryReasoningEffort', event.currentTarget.value) }} /></label></fieldset>
          {draft.modelStrategy === 'risk-tiered' ? <fieldset><legend>{t('strongProfile')}</legend><label>{t('provider')}<input value={draft.strongProvider} onChange={event => { setText('strongProvider', event.currentTarget.value) }} /></label><label>{t('modelId')}<input value={draft.strongModel} onChange={event => { setText('strongModel', event.currentTarget.value) }} /></label><label>{t('reasoningEffort')}<input value={draft.strongReasoningEffort} onChange={event => { setText('strongReasoningEffort', event.currentTarget.value) }} /></label></fieldset> : null}
        </div>
        {draft.modelStrategy === 'risk-tiered' ? <><label className="ar-check"><input type="checkbox" checked={draft.escalateUncertainToStrong} onChange={() => { setDraft({ ...draft, escalateUncertainToStrong: !draft.escalateUncertainToStrong }) }} />{t('escalateUncertain')}</label><div className="ar-kind-grid" aria-label={t('strongKinds')}>{STRONG_KIND_OPTIONS.map(kind => <label key={kind}><input type="checkbox" checked={draft.strongReviewKinds.includes(kind)} onChange={() => { toggleStrongKind(kind) }} />{kind}</label>)}</div></> : null}
      </div>
      <details className="ar-card ar-advanced">
        <summary>{t('advanced')}</summary>
        <div className="ar-field-grid">
          {NUMERIC_FIELDS.map(field => (
            <label key={field}><span>{t(field)}</span><input type="number" min="1" value={draft[field]} onChange={event => { setNumber(field, event.currentTarget.value) }} /><small>{t(overridden(field) ? 'overridden' : 'inherited')}</small></label>
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
.ar-page{max-width:760px;padding:8px 4px 36px;color:var(--dsw-alias-label-primary)}.ar-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:18px}.ar-header h2{font-size:22px;margin:0 0 6px}.ar-header p,.ar-card p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}.ar-live{font:600 10px/1.8 ui-monospace,monospace;color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);border-radius:999px;padding:0 8px}.ar-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px;margin:12px 0}.ar-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:22px}.ar-toggle-row strong,.ar-card h3{display:block;margin:0 0 5px;font-size:14px}.ar-switch{width:44px;height:24px;border:0;border-radius:999px;padding:3px;background:var(--dsw-alias-border-l2);cursor:pointer}.ar-switch span{display:block;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}.ar-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.ar-switch[aria-checked=true] span{transform:translateX(20px)}.ar-select-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:10px 0}.ar-select-row select,.ar-profile-grid input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;background:var(--dsw-alias-bg-base);color:inherit}.ar-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ar-profile-grid fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:12px}.ar-profile-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;margin:8px 0}.ar-check{display:flex;align-items:center;gap:7px;margin-top:12px;font-size:12px}.ar-kind-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:10px;font-size:12px}.ar-kind-grid label{display:flex;align-items:center;gap:5px}.ar-advanced summary{cursor:pointer;font-weight:600}.ar-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.ar-field-grid label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px;font-size:12px}.ar-field-grid input{grid-column:1/3;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;background:var(--dsw-alias-bg-base);color:inherit}.ar-field-grid small{grid-column:1/3;color:var(--dsw-alias-label-secondary)}.ar-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.ar-actions button{border-radius:8px;padding:8px 15px;cursor:pointer}.ar-secondary{background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2)}.ar-primary{background:var(--dsw-alias-brand-primary);color:white;border:1px solid var(--dsw-alias-brand-primary)}.ar-actions button:disabled{opacity:.45;cursor:not-allowed}.ar-notice{font-size:12px;text-align:right}.ar-saved{color:var(--dsw-alias-state-success-primary)}.ar-failed{color:var(--dsw-alias-state-error-primary)}.ar-muted{color:var(--dsw-alias-label-secondary)}@media(max-width:680px){.ar-profile-grid,.ar-field-grid{grid-template-columns:1fr}.ar-kind-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
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
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'auto-review', order: 17, label: () => t('nav'), locale: LOCALE_NAMESPACE,
    inject: (): AutoReviewSettingsInjected => api,
  }, AutoReviewSettingsSection))
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
