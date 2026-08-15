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
})
