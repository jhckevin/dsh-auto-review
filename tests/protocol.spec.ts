import { describe, expect, it } from 'vitest'
import { parseReviewDecision } from '../src/protocol.ts'

describe('Auto Review protocol', () => {
  it('accepts exactly the closed v1 response shape', () => {
    expect(parseReviewDecision(JSON.stringify({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
      userAuthorization: 'high',
      rationale: 'Bounded workspace read.',
      policyRuleIds: ['AR-WORKSPACE-READ'],
      uncertainty: '',
    }))).toEqual({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
      userAuthorization: 'high',
      rationale: 'Bounded workspace read.',
      policyRuleIds: ['AR-WORKSPACE-READ'],
      uncertainty: '',
    })
  })

  it('recovers one closed JSON object from surrounding model prose', () => {
    expect(parseReviewDecision('Decision follows:\n{"outcome":"approved"}\nDone.')).toEqual({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
      userAuthorization: 'unknown',
      rationale: 'Auto-review returned a low-risk approval.',
      policyRuleIds: [],
      uncertainty: '',
    })
  })

  it('rejects malformed objects, extra keys and open-vocabulary outcomes', () => {
    expect(() => parseReviewDecision('```json\n{}\n```')).toThrow(/approved or denied/)
    expect(() => parseReviewDecision(JSON.stringify({
      schemaVersion: 1, outcome: 'approved', riskLevel: 'low', userAuthorization: 'high', rationale: 'x',
      policyRuleIds: [], uncertainty: '', extra: true,
    }))).toThrow(/unknown key/)
    expect(() => parseReviewDecision(JSON.stringify({
      schemaVersion: 1, outcome: 'probably', riskLevel: 'low', userAuthorization: 'high', rationale: 'x',
      policyRuleIds: [], uncertainty: '',
    }))).toThrow(/approved or denied/)
  })

  it('reserves manual and unavailable for synthetic runtime decisions', () => {
    expect(() => parseReviewDecision(JSON.stringify({ outcome: 'manual' }))).toThrow(/approved or denied/)
    expect(() => parseReviewDecision(JSON.stringify({ outcome: 'unavailable' }))).toThrow(/approved or denied/)
  })

  it.each([null, '', '   '])('normalizes an empty optional saferAlternative (%j) to omission', value => {
    expect(parseReviewDecision(JSON.stringify({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
      userAuthorization: 'high',
      rationale: 'Exact workspace-local action.',
      policyRuleIds: ['AR-ROUTE-PROCESS'],
      saferAlternative: value,
      uncertainty: '',
    }))).not.toHaveProperty('saferAlternative')
  })

  it('still rejects multiple JSON objects instead of selecting a favorable decision', () => {
    const decision = JSON.stringify({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
      userAuthorization: 'high',
      rationale: 'x',
      policyRuleIds: [],
      uncertainty: '',
    })
    expect(() => parseReviewDecision(`${decision}\n${decision}`)).toThrow(/one JSON object/)
  })
})
