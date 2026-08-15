import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AutoReviewUiSettings } from '../types.ts'
import type { AutoReviewSettingsSnapshot } from '../settings-provider.ts'

const LOCALE_NAMESPACE = 'settings.autoReview'
const STYLE_ID = '@jhckevin/dsh-auto-review/webui'

const zh = {
  nav: '自动审批审查', title: 'Auto Review', subtitle: '仅对越出原生沙盒边界的动作调用独立审查模型。',
  enabled: '启用 Auto Review', enabledHint: '关闭后恢复原生人工审批；明确硬禁行为仍会直接拒绝。',
  model: '审查模型', flash: 'Flash（默认）', flashHint: '低延迟，适合动作关键路径。', pro: 'Pro', proHint: '更高审查能力，延迟与成本更高。',
  advanced: '高级参数', maxInputBytes: '最大证据字节', maxOutputTokens: '最大输出 token', timeoutMs: '超时（毫秒）',
  maxAttempts: '最多尝试次数', transcriptMaxEntries: '历史条目上限', transcriptMaxBytes: '历史字节上限',
  failureThreshold: '熔断失败阈值', breakerCooldownMs: '熔断冷却（毫秒）', save: '保存', reset: '恢复部署默认值',
  saved: '设置已保存并实时生效。', failed: '设置未能保存，请检查参数或连接。', inherited: '继承', overridden: '用户覆盖',
}
const en = {
  nav: 'Auto Review', title: 'Auto Review', subtitle: 'Use an isolated reviewer only for actions that cross the native sandbox boundary.',
  enabled: 'Enable Auto Review', enabledHint: 'When disabled, native manual approval resumes; explicit hard denials remain denied.',
  model: 'Reviewer model', flash: 'Flash (default)', flashHint: 'Low latency for the action critical path.', pro: 'Pro', proHint: 'Higher review capability with greater latency and cost.',
  advanced: 'Advanced parameters', maxInputBytes: 'Maximum evidence bytes', maxOutputTokens: 'Maximum output tokens', timeoutMs: 'Timeout (ms)',
  maxAttempts: 'Maximum attempts', transcriptMaxEntries: 'Transcript entry limit', transcriptMaxBytes: 'Transcript byte limit',
  failureThreshold: 'Failure breaker threshold', breakerCooldownMs: 'Breaker cooldown (ms)', save: 'Save', reset: 'Restore deployment defaults',
  saved: 'Settings saved and applied live.', failed: 'Settings could not be saved. Check the values or connection.', inherited: 'Inherited', overridden: 'User override',
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

interface PageSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value?: AutoReviewUiSettings
  readonly user?: Partial<AutoReviewUiSettings>
  readonly revision: number
  readonly writable: boolean
}

type Props = PropsRuntime<'settings.section'> & PropsLocale<'settings.autoReview'> & InjectFace<AutoReviewSettingsInjected>
type NumericField = Exclude<keyof AutoReviewUiSettings, 'enabled' | 'reviewerModel'>

const NUMERIC_FIELDS: readonly NumericField[] = [
  'maxInputBytes', 'maxOutputTokens', 'timeoutMs', 'maxAttempts', 'transcriptMaxEntries',
  'transcriptMaxBytes', 'failureThreshold', 'breakerCooldownMs',
]

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
  }) || draft.maxAttempts > 3 || draft.transcriptMaxEntries > 64, [draft])

  if (snapshot.status !== 'ready' || draft === undefined) {
    return <section className="ar-page" aria-busy="true"><p className="ar-muted">{snapshot.status === 'unavailable' ? t('failed') : 'Loading…'}</p></section>
  }

  const setNumber = (field: NumericField, text: string): void => {
    const value = Number(text)
    setNotice(undefined)
    setDraft(current => current === undefined ? current : { ...current, [field]: value })
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
      <div className="ar-card">
        <h3>{t('model')}</h3>
        <div className="ar-model-grid">
          {(['flash', 'pro'] as const).map(model => (
            <button key={model} type="button" className="ar-model" aria-pressed={draft.reviewerModel === model} onClick={() => { setNotice(undefined); setDraft({ ...draft, reviewerModel: model }) }}>
              <strong>{t(model)}</strong><span>{t(model === 'flash' ? 'flashHint' : 'proHint')}</span>
            </button>
          ))}
        </div>
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
.ar-page{max-width:760px;padding:8px 4px 36px;color:var(--dsw-alias-label-primary)}.ar-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:18px}.ar-header h2{font-size:22px;margin:0 0 6px}.ar-header p,.ar-card p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}.ar-live{font:600 10px/1.8 ui-monospace,monospace;color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);border-radius:999px;padding:0 8px}.ar-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px;margin:12px 0}.ar-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:22px}.ar-toggle-row strong,.ar-card h3{display:block;margin:0 0 5px;font-size:14px}.ar-switch{width:44px;height:24px;border:0;border-radius:999px;padding:3px;background:var(--dsw-alias-border-l2);cursor:pointer}.ar-switch span{display:block;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}.ar-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.ar-switch[aria-checked=true] span{transform:translateX(20px)}.ar-model-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.ar-model{display:flex;flex-direction:column;gap:5px;text-align:left;padding:14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer}.ar-model[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}.ar-model span{font-size:12px;color:var(--dsw-alias-label-secondary)}.ar-advanced summary{cursor:pointer;font-weight:600}.ar-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.ar-field-grid label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px;font-size:12px}.ar-field-grid input{grid-column:1/3;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;background:var(--dsw-alias-bg-base);color:inherit}.ar-field-grid small{grid-column:1/3;color:var(--dsw-alias-label-secondary)}.ar-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.ar-actions button{border-radius:8px;padding:8px 15px;cursor:pointer}.ar-secondary{background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2)}.ar-primary{background:var(--dsw-alias-brand-primary);color:white;border:1px solid var(--dsw-alias-brand-primary)}.ar-actions button:disabled{opacity:.45;cursor:not-allowed}.ar-notice{font-size:12px;text-align:right}.ar-saved{color:var(--dsw-alias-state-success-primary)}.ar-failed{color:var(--dsw-alias-state-error-primary)}.ar-muted{color:var(--dsw-alias-label-secondary)}@media(max-width:680px){.ar-model-grid,.ar-field-grid{grid-template-columns:1fr}}
`

/** Client services required by settings scopes and the settings slot. */
export const inject = ['slots', 'locale', 'connection', 'remote']

/** Register the Auto Review settings page without modifying Harness core UI code. */
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
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'auto-review', order: 17, label: () => t('nav'), locale: LOCALE_NAMESPACE,
    inject: (): AutoReviewSettingsInjected => api,
  }, AutoReviewSettingsSection))
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
