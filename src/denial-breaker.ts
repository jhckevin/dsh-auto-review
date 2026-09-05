/** Stable, content-free marker carried by the native turn/end hook reason. */
export const AUTO_REVIEW_INTERRUPTION_PREFIX = '[AUTO_REVIEW_DENIAL_BREAKER]'

export interface DenialBreakerSnapshot {
  readonly consecutive: number
  readonly denied: number
  readonly window: number
}

export function denialInterruptionMessage(state: DenialBreakerSnapshot): string {
  return `${AUTO_REVIEW_INTERRUPTION_PREFIX} 本轮操作已被自动审查终止 / This turn was interrupted by Auto Review. consecutive=${state.consecutive}; denied=${state.denied}; window=${state.window}. 请检查拒绝原因，采用实质更安全的方案；缺少授权时向用户说明并请求授权。Do not retry the same denied effect or bypass policy.`
}

/** Only a host-produced native hook interruption qualifies, never assistant/tool text. */
export function isAutoReviewInterruption(value: unknown): value is {
  kind: 'aborted'; reason: { kind: 'hook'; reason: string }
} {
  if (value === null || typeof value !== 'object') return false
  const end = value as { kind?: unknown; reason?: unknown }
  if (end.kind !== 'aborted' || end.reason === null || typeof end.reason !== 'object') return false
  const cause = end.reason as { kind?: unknown; reason?: unknown }
  return cause.kind === 'hook' && typeof cause.reason === 'string'
    && cause.reason.startsWith(AUTO_REVIEW_INTERRUPTION_PREFIX + ' ')
}
