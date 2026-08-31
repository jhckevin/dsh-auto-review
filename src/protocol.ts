import { RISK_LEVELS, type ReviewDecision } from './types.ts'

const KEYS = new Set([
  'schemaVersion',
  'outcome',
  'riskLevel',
  'userAuthorization',
  'rationale',
  'policyRuleIds',
  'saferAlternative',
  'uncertainty',
])

function boundedString(value: unknown, name: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > max) {
    throw new TypeError(`auto-review response ${name} must be ${allowEmpty ? 'a' : 'a non-empty'} string <= ${max} characters`)
  }
  return value
}

export class ReviewProtocolError extends TypeError {
  override readonly name = 'ReviewProtocolError'
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Match Codex Guardian's deliberately thin recovery path: tolerate a single
    // JSON object surrounded by model prose, but never select between objects.
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first < 0 || last <= first) {
      throw new ReviewProtocolError('auto-review response must contain one JSON object')
    }
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {
      throw new ReviewProtocolError('auto-review response must contain one JSON object')
    }
  }
}

export function parseReviewDecision(text: string): ReviewDecision {
  const candidate = parseJsonObject(text)
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('auto-review response must be a JSON object')
  }
  const record = candidate as Record<string, unknown>
  const unknown = Object.keys(record).filter(key => !KEYS.has(key))
  if (unknown.length > 0) throw new TypeError(`auto-review response contains unknown key ${JSON.stringify(unknown[0])}`)
  if (record.schemaVersion !== undefined && record.schemaVersion !== 1) {
    throw new TypeError('auto-review response schemaVersion must equal 1 when present')
  }
  if (!['approved', 'denied'].includes(record.outcome as string)) {
    throw new TypeError('auto-review response outcome must be approved or denied')
  }
  const riskLevel = record.riskLevel ?? (record.outcome === 'approved' ? 'low' : 'high')
  if (!RISK_LEVELS.includes(riskLevel as never)) {
    throw new TypeError('auto-review response riskLevel is outside the closed vocabulary')
  }
  const userAuthorization = record.userAuthorization ?? 'unknown'
  if (!['unknown', 'low', 'medium', 'high'].includes(userAuthorization as string)) {
    throw new TypeError('auto-review response userAuthorization is outside the closed vocabulary')
  }
  const rawPolicyRuleIds = record.policyRuleIds ?? []
  if (!Array.isArray(rawPolicyRuleIds) || rawPolicyRuleIds.length > 16) {
    throw new TypeError('auto-review response policyRuleIds must be an array of at most 16 ids')
  }
  const policyRuleIds = rawPolicyRuleIds.map((entry, index) => boundedString(entry, `policyRuleIds[${index}]`, 80))
  const saferAlternative = record.saferAlternative === undefined
    || record.saferAlternative === null
    || (typeof record.saferAlternative === 'string' && record.saferAlternative.trim().length === 0)
    ? undefined
    : boundedString(record.saferAlternative, 'saferAlternative', 2048)
  return Object.freeze({
    schemaVersion: 1,
    outcome: record.outcome as ReviewDecision['outcome'],
    riskLevel: riskLevel as ReviewDecision['riskLevel'],
    userAuthorization: userAuthorization as NonNullable<ReviewDecision['userAuthorization']>,
    rationale: record.rationale === undefined
      ? record.outcome === 'approved'
        ? 'Auto-review returned a low-risk approval.'
        : 'Auto-review returned a denial without a rationale.'
      : boundedString(record.rationale, 'rationale', 4096),
    policyRuleIds: Object.freeze(policyRuleIds),
    ...(saferAlternative === undefined ? {} : { saferAlternative }),
    uncertainty: record.uncertainty === undefined
      ? ''
      : boundedString(record.uncertainty, 'uncertainty', 2048, true),
  })
}
