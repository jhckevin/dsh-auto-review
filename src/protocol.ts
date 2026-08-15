import { CLOSED_REVIEW_OUTCOMES, RISK_LEVELS, type ReviewDecision } from './types.ts'

const KEYS = new Set([
  'schemaVersion',
  'outcome',
  'riskLevel',
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

export function parseReviewDecision(text: string): ReviewDecision {
  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch {
    throw new TypeError('auto-review response must be exactly one JSON object')
  }
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('auto-review response must be a JSON object')
  }
  const record = candidate as Record<string, unknown>
  const unknown = Object.keys(record).filter(key => !KEYS.has(key))
  if (unknown.length > 0) throw new TypeError(`auto-review response contains unknown key ${JSON.stringify(unknown[0])}`)
  if (record.schemaVersion !== 1) throw new TypeError('auto-review response schemaVersion must equal 1')
  if (!CLOSED_REVIEW_OUTCOMES.includes(record.outcome as never)) {
    throw new TypeError('auto-review response outcome is outside the closed vocabulary')
  }
  if (!RISK_LEVELS.includes(record.riskLevel as never)) {
    throw new TypeError('auto-review response riskLevel is outside the closed vocabulary')
  }
  if (!Array.isArray(record.policyRuleIds) || record.policyRuleIds.length > 16) {
    throw new TypeError('auto-review response policyRuleIds must be an array of at most 16 ids')
  }
  const policyRuleIds = record.policyRuleIds.map((entry, index) => boundedString(entry, `policyRuleIds[${index}]`, 80))
  const saferAlternative = record.saferAlternative === undefined
    ? undefined
    : boundedString(record.saferAlternative, 'saferAlternative', 2048)
  return Object.freeze({
    schemaVersion: 1,
    outcome: record.outcome as ReviewDecision['outcome'],
    riskLevel: record.riskLevel as ReviewDecision['riskLevel'],
    rationale: boundedString(record.rationale, 'rationale', 4096),
    policyRuleIds: Object.freeze(policyRuleIds),
    ...(saferAlternative === undefined ? {} : { saferAlternative }),
    uncertainty: boundedString(record.uncertainty, 'uncertainty', 2048, true),
  })
}
