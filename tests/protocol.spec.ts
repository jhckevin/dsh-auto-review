import { describe, expect, it } from 'vitest'
import { parseReviewDecision } from '../src/protocol.ts'

describe('Auto Review protocol', () => {
  it('accepts exactly the closed v1 response shape', () => {
    expect(parseReviewDecision(JSON.stringify({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
      rationale: 'Bounded workspace read.',
      policyRuleIds: ['AR-WORKSPACE-READ'],
      uncertainty: '',
    }))).toEqual({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
      rationale: 'Bounded workspace read.',
      policyRuleIds: ['AR-WORKSPACE-READ'],
      uncertainty: '',
    })
  })

  it('rejects Markdown, extra keys and open-vocabulary outcomes', () => {
    expect(() => parseReviewDecision('```json\n{}\n```')).toThrow(/exactly one JSON object/)
    expect(() => parseReviewDecision(JSON.stringify({
      schemaVersion: 1, outcome: 'approved', riskLevel: 'low', rationale: 'x',
      policyRuleIds: [], uncertainty: '', extra: true,
    }))).toThrow(/unknown key/)
    expect(() => parseReviewDecision(JSON.stringify({
      schemaVersion: 1, outcome: 'probably', riskLevel: 'low', rationale: 'x',
      policyRuleIds: [], uncertainty: '',
    }))).toThrow(/closed vocabulary/)
  })

  it.each([null, '', '   '])('normalizes an empty optional saferAlternative (%j) to omission', value => {
    expect(parseReviewDecision(JSON.stringify({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'low',
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
      rationale: 'x',
      policyRuleIds: [],
      uncertainty: '',
    })
    expect(() => parseReviewDecision(`${decision}\n${decision}`)).toThrow(/exactly one JSON object/)
  })
})
