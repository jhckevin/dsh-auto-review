import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type SVGProps } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ActionKind, AutoReviewIndicatorSnapshot, AutoReviewMetricsSnapshot, AutoReviewUiSettings } from '../types.ts'
import type { AutoReviewSettingsSnapshot } from '../settings-provider.ts'
import { ReviewStatusClient, type HostObservable } from './review-status.ts'

import { isAutoReviewInterruption } from '../denial-breaker.ts'

interface AutoReviewTurnOwner { readonly turn: { readonly end?: { readonly data: { readonly reason: unknown } } } }
interface AutoReviewTurnSlots {
  inject(name: 'conversation.chat.turnTail', register: () => unknown): unknown
  register(options: { name: 'conversation.chat.turnTail'; priority: number; select: (owner: AutoReviewTurnOwner) => object | null }, component: (props: AutoReviewTurnOwner) => ReactNode): unknown
}

/** Read only the durable cancellation reason, never assistant/tool text. */
export function autoReviewInterruptionDetail(reason: unknown): string | null {
  return isAutoReviewInterruption(reason) ? reason.reason.reason : null
}

/** Persistent native turn-tail notice; a replay needs no live review RPC. */
export function AutoReviewTurnInterruption({ turn }: AutoReviewTurnOwner): ReactNode {
  const detail = autoReviewInterruptionDetail(turn.end?.data.reason)
  if (detail === null) return null
  return <div role="status" data-auto-review-turn-interrupted="true" title={detail}
    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#b42318', borderLeft: '3px solid currentColor', padding: '8px 12px', margin: '8px 0' }}>
    <span aria-hidden="true" style={{ display: 'inline-flex', flex: '0 0 18px', width: 18, height: 18 }}>
      <ReviewerShieldIcon denied width={18} height={18} />
    </span>
    <div><strong>本轮操作已被自动审查终止 / This turn was interrupted by Auto Review.</strong>
      <details><summary>详情 / Details</summary><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail}</div></details>
    </div>
  </div>
}

const LOCALE_NAMESPACE = 'settings.autoReview'
const STYLE_ID = '@jhckevin/dsh-auto-review/webui'

interface CompatibleSlots {
  inject(name: string, register: () => unknown): unknown
  register<T>(options: unknown, component: (props: T) => ReactNode): unknown
}

type ClientContext = Context & { readonly slots: CompatibleSlots }

const zh = {
  invalidSettings: '无法保存：数值须为正整数，尝试次数为 1–3、历史条目最多 64；启用的模型配置必须填写 Provider 和模型 ID。',
  saving: '正在保存…', pending: '有未保存的修改', active: '已启用', inactive: '已关闭', readOnly: '当前连接无设置写入权限', fullAccessNative: 'Full Access：使用原生审批流程。', fullAccessReview: 'Full Access：所有非硬禁动作进入审查。', loading: '正在加载…', badgeCompatibility: '兼容性提示：官方 Harness 尚无逐工具徽章与设置导航图标插槽。设置与审查可用；命令右侧审查/拒绝图标和设置选项卡 SVG 需要配套的 tool.call.badges 与 settings.section.icon 补丁，未安装时保留原生显示。',
  nav: '自动审批审查', title: 'Auto Review', subtitle: '独立审查，安全继续。',
  enabled: '启用 Auto Review', enabledHint: '关闭时使用 Harness 原生审批。',
  sandboxDefaultAllow: '原生沙盒内默认通过', sandboxDefaultAllowHint: '只读与工作区写入模式：安全动作免审，越界动作仍需审查。',
  reviewFullAccess: '审查 Full Access 动作', reviewFullAccessHint: 'Full Access 无沙盒。开启时全量审查；关闭时使用原生流程。',
  model: '审查模型', flash: 'Flash（默认）', flashHint: '低延迟，适合动作关键路径。', pro: 'Pro', proHint: '更高审查能力，延迟与成本更高。',
  modelStrategy: '模型策略', single: '单模型', riskTiered: '风险分级', primaryProfile: '常规模型', strongProfile: '高风险模型',
  modelStrategyHint: '按风险分级时，可为高风险动作指定另一模型。',
  primaryProfileHint: '使用 Harness 已配置的模型与凭据。', strongProfileHint: '仅在风险分级策略命中高风险类型或触发升级时使用。',
  provider: 'Provider 路由', modelId: '模型 ID', reasoningEffort: '推理强度',
  reasoningEffortHint: '可选；留空使用模型默认。',
  escalateUncertain: '不确定或高风险结论升级到高风险模型', strongKinds: '直接使用高风险模型的动作类型',
  escalateUncertainHint: '升级与重试共享同一总超时，不会绕过拒绝、沙盒或人工审批。', strongKindsHint: '勾选的类型跳过常规模型，直接交给高风险模型。',
  advanced: '高级参数', maxInputBytes: '最大证据字节', maxOutputTokens: '单次回复 token 上限', timeoutMs: '超时（毫秒）',
  maxAttempts: '最多尝试次数', transcriptMaxEntries: '历史条目上限', transcriptMaxBytes: '历史字节上限',
  failureThreshold: '熔断失败阈值', breakerCooldownMs: '熔断冷却（毫秒）', save: '保存', reset: '恢复默认',
  advancedHint: '这些值限制单次审查的证据、输出、重试和故障恢复开销；一般建议保留部署默认值。',
  maxInputBytesHint: '发送给 reviewer 的净化动作证据上限，不是主 Agent 的完整上下文。', maxOutputTokensHint: '限制每次回复，不是多轮审查总预算。', timeoutMsHint: '单个动作的总审查时限，包含重试和风险升级。', maxAttemptsHint: '仅在调用或协议失败时创建全新 reviewer session 重试，最多 3 次。',
  transcriptMaxEntriesHint: '最多携带多少条与当前动作有关的净化历史证据。', transcriptMaxBytesHint: '历史证据的总字节上限；不会扩张主 Agent 上下文。', failureThresholdHint: '连续 reviewer 故障达到此数时进入失效保护熔断。', breakerCooldownMsHint: '熔断后等待多久才允许再次探测 reviewer。',
  saved: '设置已保存并实时生效。', failed: '设置未能保存，请检查参数或连接。', inherited: '继承', overridden: '用户覆盖',
  reviewing: 'Auto Review 正在审查此工具调用', denied: 'Auto Review 已拒绝此工具调用',
  funnel: '运行统计', totalActions: '全部动作', insideBoundary: '原生沙盒内', autoReviewed: '进入审查', approved: '自动批准', deniedCount: '拒绝', manual: '人工处理',
  policyLookups: '策略检索调用', policyBytes: '策略返回字节',
  behavior: '查看当前权限行为', behaviorDisabled: 'Auto Review 已关闭：所有权限档位均完全使用 Harness 原生审批链。', behaviorDefault: '只读/工作区写入：沙盒内普通动作直接通过；越界、敏感和网络动作进入 Reviewer。', behaviorStrict: '只读/工作区写入：沙盒内动作也进入 Reviewer，但实际执行仍受原生沙盒约束。',
}
const en = {
  invalidSettings: 'Cannot save: use positive integers, 1–3 attempts and at most 64 history entries; active model profiles require both provider and model ID.',
  saving: 'Saving…', pending: 'Unsaved changes', active: 'Enabled', inactive: 'Disabled', readOnly: 'This connection cannot change settings', fullAccessNative: 'Full Access: native approval flow.', fullAccessReview: 'Full Access: all actions except hard denials are reviewed.', loading: 'Loading…', badgeCompatibility: 'Compatibility: official Harness has no per-tool badge or settings-navigation icon slots. Settings and review work; the command reviewing/denied glyph and settings-tab SVG require the accompanying tool.call.badges and settings.section.icon patches. Without them, native display is retained.',
  nav: 'Auto Review', title: 'Auto Review', subtitle: 'Route actions to an isolated reviewer according to the permission mode, native sandbox boundary, and active policy.',
  enabled: 'Enable Auto Review', enabledHint: 'When disabled, the extension leaves routing, approval, and denial entirely to the native Harness chain.',
  sandboxDefaultAllow: 'Allow native-sandbox actions by default', sandboxDefaultAllowHint: 'Applies only to read-only/workspace-write. Turning it off adds review without removing native confinement. Full Access uses the independent switch below.',
  reviewFullAccess: 'Review Full Access actions', reviewFullAccessHint: 'On by default. With no sandbox, all actions are reviewed except direct hard denials, regardless of sandbox default-allow. Turn off to leave this tier entirely native. This is a product extension, not an upstream Codex rule.',
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
  behavior: 'Current permission behavior', behaviorDisabled: 'Auto Review is off: every permission tier uses the native Harness approval chain only.', behaviorDefault: 'Read-only / Workspace Write: ordinary confined actions pass; boundary-crossing, sensitive, and network actions enter the reviewer.', behaviorStrict: 'Read-only / Workspace Write: confined actions are reviewed too, while execution remains restricted by the native sandbox.',
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
  readonly reviewStatus?: ReviewStatusClient
  readonly hooks?: { readonly reviewStatus: HostObservable<AutoReviewIndicatorSnapshot> }
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
      inject: (sessionId?: string) => AutoReviewBadgeInjected
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

interface AutoReviewNavSlots {
  inject(name: 'settings.section.icon', register: () => unknown): unknown
  register(options: { name: 'settings.section.icon'; key: string }, component: () => ReactNode): unknown
}

type Props = PropsRuntime<'settings.section'> & PropsLocale<'settings.autoReview'> & InjectFace<AutoReviewSettingsInjected>
type BadgeProps = AutoReviewBadgeOwner & PropsLocale<'settings.autoReview'> & InjectFace<AutoReviewBadgeInjected> & {
  readonly reviewStatus?: ReviewStatusClient
  readonly useReviewStatus?: <T>(selector: (snapshot: AutoReviewIndicatorSnapshot) => T) => T
}
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

function PollingAutoReviewCallBadge({ sessionId, callId, reviewStatus, t }: BadgeProps & { reviewStatus: ReviewStatusClient }): ReactNode {
  const subscribe = useCallback((listener: () => void) => reviewStatus.subscribe(sessionId, listener), [reviewStatus, sessionId])
  const getSnapshot = useCallback(() => reviewStatus.snapshot(sessionId), [reviewStatus, sessionId])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return renderAutoReviewCallBadge(snapshot, callId, t)
}

function ObservableAutoReviewCallBadge({ callId, useReviewStatus, t }: BadgeProps & { useReviewStatus: NonNullable<BadgeProps['useReviewStatus']> }): ReactNode {
  const snapshot = useReviewStatus(value => value)
  return renderAutoReviewCallBadge(snapshot, callId, t)
}

function renderAutoReviewCallBadge(
  snapshot: AutoReviewIndicatorSnapshot,
  callId: string,
  t: BadgeProps['t'],
): ReactNode {
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

export function AutoReviewCallBadge(props: BadgeProps): ReactNode {
  if (props.reviewStatus !== undefined) return <PollingAutoReviewCallBadge {...props} reviewStatus={props.reviewStatus} />
  if (props.useReviewStatus !== undefined) return <ObservableAutoReviewCallBadge {...props} useReviewStatus={props.useReviewStatus} />
  throw new Error('auto-review: badge owner provided no supported review-status injection')
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

export function AutoReviewSettingsSection({ read, update, reset: resetSettings, metrics: readMetrics, t }: Props): ReactNode {
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
    return <section className="ar-page" aria-busy={snapshot.status === 'loading'}><p className="ar-muted">{snapshot.status === 'unavailable' ? t('failed') : t('loading')}</p></section>
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.value)
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
    const patch = Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(snapshot.value?.[key as keyof AutoReviewUiSettings]),
    )) as Partial<AutoReviewUiSettings>
    if (Object.keys(patch).length === 0) return
    setSaving(true)
    setNotice(undefined)
    void update(patch, snapshot.revision).then(next => {
      setSnapshot(current => ({ ...current, status: 'ready', ...next }))
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
      setSnapshot(current => ({ ...current, status: 'ready', ...next }))
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
    <section className="ar-page" aria-busy={saving}>
      <header className="ar-header"><div className="ar-header-title"><AutoReviewLogo /><div><h2>{t('title')}</h2><p>{t('subtitle')}</p></div></div><span className="ar-live" role="status">{t(saving ? 'saving' : dirty ? 'pending' : snapshot.value?.enabled ? 'active' : 'inactive')}</span></header>
      <details className="ar-compat"><summary>工具图标与宿主适配 / UI compatibility</summary><p className="ar-help" data-auto-review-badge-compatibility="requires-owner-slot">{t('badgeCompatibility')}</p></details>

      {!snapshot.writable ? <p role="status">{t('readOnly')}</p> : null}
      <fieldset className="ar-controls" disabled={saving || !snapshot.writable}>
      <div className="ar-card ar-toggle-row">
        <div><strong>{t('enabled')}</strong><p>{t('enabledHint')}</p></div>
        <button className="ar-switch" type="button" role="switch" aria-label={t('enabled')} aria-checked={draft.enabled} onClick={() => { setNotice(undefined); setDraft({ ...draft, enabled: !draft.enabled }) }}><span /></button>
      </div>
      <details className="ar-card ar-behavior"><summary>{t('behavior')}</summary><p>{t(!draft.enabled ? 'behaviorDisabled' : draft.sandboxDefaultAllow ? 'behaviorDefault' : 'behaviorStrict')}</p>{draft.enabled ? <p>{t(draft.reviewFullAccess ? 'fullAccessReview' : 'fullAccessNative')}</p> : null}</details>
      <div className="ar-card ar-toggle-row">
        <div><strong>{t('sandboxDefaultAllow')}</strong><p>{t('sandboxDefaultAllowHint')}</p></div>
        <button className="ar-switch" type="button" role="switch" aria-label={t('sandboxDefaultAllow')} aria-checked={draft.sandboxDefaultAllow} disabled={!draft.enabled} onClick={() => { setNotice(undefined); setDraft({ ...draft, sandboxDefaultAllow: !draft.sandboxDefaultAllow }) }}><span /></button>
      </div>
      <div className="ar-card ar-toggle-row">
        <div><strong>{t('reviewFullAccess')}</strong><p>{t('reviewFullAccessHint')}</p></div>
        <button className="ar-switch" type="button" role="switch" aria-label={t('reviewFullAccess')} aria-checked={draft.reviewFullAccess} disabled={!draft.enabled} onClick={() => { setNotice(undefined); setDraft({ ...draft, reviewFullAccess: !draft.reviewFullAccess }) }}><span /></button>
      </div>
      <div className="ar-card">
        <h3>{t('model')}</h3>
        <div className="ar-setting-block"><label className="ar-select-row"><span>{t('modelStrategy')}</span><select value={draft.modelStrategy} onChange={event => { setNotice(undefined); setDraft({ ...draft, modelStrategy: event.currentTarget.value as AutoReviewUiSettings['modelStrategy'] }) }}><option value="single">{t('single')}</option><option value="risk-tiered">{t('riskTiered')}</option></select></label><p className="ar-help">{t('modelStrategyHint')}</p></div>
        <div className="ar-profile-grid">
          <fieldset><legend>{t('primaryProfile')}</legend><p className="ar-help">{t('primaryProfileHint')}</p><label>{t('provider')}<input value={draft.primaryProvider} onChange={event => { setText('primaryProvider', event.currentTarget.value) }} /></label><label>{t('modelId')}<input value={draft.primaryModel} onChange={event => { setText('primaryModel', event.currentTarget.value) }} /></label><label>{t('reasoningEffort')}<input value={draft.primaryReasoningEffort} onChange={event => { setText('primaryReasoningEffort', event.currentTarget.value) }} /><small className="ar-help">{t('reasoningEffortHint')}</small></label></fieldset>
          {draft.modelStrategy === 'risk-tiered' ? <fieldset><legend>{t('strongProfile')}</legend><p className="ar-help">{t('strongProfileHint')}</p><label>{t('provider')}<input value={draft.strongProvider} onChange={event => { setText('strongProvider', event.currentTarget.value) }} /></label><label>{t('modelId')}<input value={draft.strongModel} onChange={event => { setText('strongModel', event.currentTarget.value) }} /></label><label>{t('reasoningEffort')}<input value={draft.strongReasoningEffort} onChange={event => { setText('strongReasoningEffort', event.currentTarget.value) }} /><small className="ar-help">{t('reasoningEffortHint')}</small></label></fieldset> : null}
        </div>
        {draft.modelStrategy === 'risk-tiered' ? <><label className="ar-check"><input type="checkbox" checked={draft.escalateUncertainToStrong} onChange={() => { setNotice(undefined); setDraft({ ...draft, escalateUncertainToStrong: !draft.escalateUncertainToStrong }) }} />{t('escalateUncertain')}</label><p className="ar-help ar-indented-help">{t('escalateUncertainHint')}</p><div className="ar-kind-grid" aria-label={t('strongKinds')}>{STRONG_KIND_OPTIONS.map(kind => <label key={kind}><input type="checkbox" checked={draft.strongReviewKinds.includes(kind)} onChange={() => { toggleStrongKind(kind) }} />{kind}</label>)}</div><p className="ar-help">{t('strongKindsHint')}</p></> : null}
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
      </fieldset>
      {snapshot.metrics === undefined ? null : <details className="ar-statistics"><summary>{t('funnel')}</summary><AutoReviewFunnel metrics={snapshot.metrics} t={t} /></details>}
      {invalid ? <p className="ar-failed ar-validation" role="alert">{t('invalidSettings')}</p> : null}
      <footer className="ar-actions">
        <button type="button" className="ar-secondary" disabled={saving || !snapshot.writable} onClick={reset}>{t('reset')}</button>
        <button type="button" className="ar-primary" disabled={invalid || saving || !snapshot.writable || !dirty} onClick={save}>{t(saving ? 'saving' : 'save')}</button>
      </footer>
      {notice !== undefined ? <p className={`ar-notice ar-${notice}`} role="status">{t(notice)}</p> : null}
    </section>
  )
}

const CSS = `
.ar-controls{border:0;padding:0;margin:0;min-width:0}.ar-controls:disabled{opacity:.65}.ar-actions{position:sticky;bottom:0;background:var(--dsw-alias-bg-base);padding:12px 0;z-index:1}.ar-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.ar-header-title{display:flex;align-items:flex-start;gap:10px}.ar-product-logo{display:inline-grid;place-items:center;flex:0 0 auto;width:30px;height:30px;color:var(--dsw-alias-label-primary)}
.ar-help{display:block!important;margin-top:5px!important;color:var(--dsw-alias-label-secondary)!important;font-size:11px!important;line-height:1.45!important;font-weight:400!important}.ar-setting-block{margin:10px 0 14px}.ar-setting-block .ar-select-row{margin-bottom:0}.ar-indented-help{margin-left:23px!important}.ar-advanced-help{margin-top:9px!important}.ar-field-grid .ar-field-source{font-size:10px}.ar-field-grid .ar-help{margin-top:0!important}
.ar-page{max-width:760px;padding:8px 4px 36px;color:var(--dsw-alias-label-primary)}.ar-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:18px}.ar-header h2{font-size:22px;margin:0 0 6px}.ar-header p,.ar-card p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}.ar-live{font:600 10px/1.8 ui-monospace,monospace;color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);border-radius:999px;padding:0 8px}.ar-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px;margin:12px 0}.ar-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:22px}.ar-toggle-row strong,.ar-card h3{display:block;margin:0 0 5px;font-size:14px}.ar-switch{width:44px;height:24px;border:0;border-radius:999px;padding:3px;background:var(--dsw-alias-border-l2);cursor:pointer}.ar-switch span{display:block;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}.ar-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.ar-switch[aria-checked=true] span{transform:translateX(20px)}.ar-select-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:10px 0}.ar-select-row select,.ar-profile-grid input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;background:var(--dsw-alias-bg-base);color:inherit}.ar-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ar-profile-grid fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:12px}.ar-profile-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;margin:8px 0}.ar-check{display:flex;align-items:center;gap:7px;margin-top:12px;font-size:12px}.ar-kind-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:10px;font-size:12px}.ar-kind-grid label{display:flex;align-items:center;gap:5px}.ar-advanced summary{cursor:pointer;font-weight:600}.ar-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.ar-field-grid label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px;font-size:12px}.ar-field-grid input{grid-column:1/3;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px;background:var(--dsw-alias-bg-base);color:inherit}.ar-field-grid small{grid-column:1/3;color:var(--dsw-alias-label-secondary)}.ar-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.ar-actions button{border-radius:8px;padding:8px 15px;cursor:pointer}.ar-secondary{background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-l2)}.ar-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:1px solid var(--dsw-alias-button-primary-fill)}.ar-actions button:disabled{opacity:.45;cursor:not-allowed}.ar-notice{font-size:12px;text-align:right}.ar-saved{color:var(--dsw-alias-state-success-primary)}.ar-failed{color:var(--dsw-alias-state-error-primary)}.ar-muted{color:var(--dsw-alias-label-secondary)}@media(max-width:680px){.ar-profile-grid,.ar-field-grid{grid-template-columns:1fr}.ar-kind-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ar-funnel{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:12px}.ar-funnel div{display:flex;flex-direction:column;gap:3px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-base);text-align:center}.ar-funnel strong{font:700 18px/1.2 ui-monospace,monospace}.ar-funnel span{font-size:10px;color:var(--dsw-alias-label-secondary)}
.ar-funnel-meta{margin-top:10px!important;font-size:11px!important}
@media(max-width:680px){.ar-funnel{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ar-call-badge{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,currentColor 16%,transparent)}
.ar-call-badge[data-auto-review-state=reviewing]{animation:ar-review-pulse 1.15s ease-in-out infinite}
.ar-call-badge[data-auto-review-state=denied]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,var(--dsw-alias-bg-layer-1))}
@keyframes ar-review-pulse{0%,100%{opacity:.52}50%{opacity:1}}@media(prefers-reduced-motion:reduce){.ar-call-badge{animation:none!important}}

/* Compact settings: controls first; diagnostics and metrics are progressive disclosure. */
.ar-page{max-width:680px;margin:0 auto;padding:4px 0 20px;font-size:13px}
.ar-header{align-items:center;gap:12px;margin:0 0 20px}
.ar-header-title{align-items:center;min-width:0}
.ar-header h2{font-size:20px;line-height:1.3;letter-spacing:-.3px;margin:0}
.ar-header p{font-size:12px;margin-top:4px}
.ar-live{flex:0 0 auto;white-space:nowrap;min-width:48px;text-align:center;padding:2px 8px}
.ar-compat{font-size:11px;color:var(--dsw-alias-label-secondary);margin:0 0 14px}
.ar-controls>.ar-card{background:transparent;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;margin:0;padding:18px 0}
.ar-controls>.ar-toggle-row:first-child{padding-top:0}
.ar-toggle-row{gap:16px}
.ar-toggle-row>div{min-width:0}
.ar-toggle-row strong{font-size:13px;font-weight:550;margin-bottom:4px}
.ar-toggle-row p{font-size:12px;line-height:1.55;max-width:48em}
.ar-switch{flex:0 0 36px;width:36px;height:22px;padding:3px;background:var(--dsw-alias-border-l2,#64646c)}
.ar-switch span{width:16px;height:16px}
.ar-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,#6788ef)}
.ar-switch[aria-checked=true] span{transform:translateX(14px)}
.ar-switch[aria-checked=true] span{background:var(--dsw-alias-bg-base,#202024)}
.ar-controls>.ar-behavior{font-size:12px;padding:10px 0;color:var(--dsw-alias-label-secondary)}
.ar-behavior p{font-size:12px;margin:8px 0 0}
.ar-profile-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.ar-profile-grid fieldset{min-width:0;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ar-profile-grid input,.ar-select-row select,.ar-field-grid input{min-width:0;width:100%;height:34px;padding:6px 9px}
.ar-select-row select{width:auto;max-width:65%}
.ar-profile-grid label{margin:10px 0}
.ar-advanced summary,.ar-statistics>summary{font-size:12px;font-weight:500;cursor:pointer}
.ar-statistics{margin-top:18px;color:var(--dsw-alias-label-secondary)}
.ar-actions{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1);padding:12px 0 0}
.ar-actions button{font-size:12px;padding:7px 14px}
@media(max-width:600px){.ar-profile-grid,.ar-field-grid{grid-template-columns:1fr}.ar-header{gap:8px}.ar-header h2{font-size:18px}.ar-page{padding-inline:0}.ar-kind-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
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
    name: 'settings.section', id: 'auto-review', order: 17, label: () => t('nav'), locale: LOCALE_NAMESPACE,
    inject: (): AutoReviewSettingsInjected => api,
  } as const
  ctx.slots.inject('settings.section', () => ctx.slots.register(sectionRegistration, AutoReviewSettingsSection))
  const navSlots = ctx.slots as unknown as AutoReviewNavSlots
  navSlots.inject('settings.section.icon', () => navSlots.register({ name: 'settings.section.icon', key: 'auto-review' }, AutoReviewNavIcon))
  // The badge slot is absent from the official alpha.5 catalog. Its additive
  // owner patch is shipped separately; keep this compatibility
  // adapter local instead of globally augmenting SlotMap with a duplicate owner.
  const badgeSlots = ctx.slots as unknown as AutoReviewBadgeSlots
  badgeSlots.inject('tool.call.badges', () => badgeSlots.register({
    name: 'tool.call.badges', id: 'auto-review', order: 20, locale: LOCALE_NAMESPACE,
    inject: (sessionId): AutoReviewBadgeInjected => ({
      reviewStatus,
      ...(sessionId === undefined ? {} : { hooks: { reviewStatus: reviewStatus.source(sessionId) } }),
    }),
  }, AutoReviewCallBadge))
  const turnSlots = ctx.slots as unknown as AutoReviewTurnSlots
  turnSlots.inject('conversation.chat.turnTail', () => turnSlots.register({
    name: 'conversation.chat.turnTail',
    // Native turnTail is first-match: the safety notice precedes ordinary deliverables.
    priority: -100,
    select: owner => autoReviewInterruptionDetail(owner.turn.end?.data.reason) === null ? null : {},
  }, AutoReviewTurnInterruption))
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
