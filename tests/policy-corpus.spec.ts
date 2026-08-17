import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getGuardianPolicySections,
  guardianBootstrapPrompt,
  guardianPolicyOutline,
  GUARDIAN_POLICY_DIGESTS,
  GUARDIAN_POLICY_TEMPLATE,
  GUARDIAN_TENANT_POLICY,
  searchGuardianPolicy,
} from '../src/policy-corpus.ts'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('canonical Guardian policy corpus', () => {
  it('loads the verbatim packaged snapshots and reports stable digests', () => {
    expect(GUARDIAN_POLICY_DIGESTS).toEqual({
      template: sha256(readFileSync(new URL('../policies/codex/guardian-policy-template.md', import.meta.url), 'utf8')),
      policy: sha256(readFileSync(new URL('../policies/codex/guardian-policy.md', import.meta.url), 'utf8')),
    })
    expect(GUARDIAN_POLICY_TEMPLATE).toContain('# Evidence Handling')
    expect(GUARDIAN_TENANT_POLICY).toContain('### Data Exfiltration')
  })

  it('keeps the bootstrap bounded while progressively retrieving exact risk rules', () => {
    const bootstrap = guardianBootstrapPrompt()
    expect(bootstrap).toContain('# Outcome Policy')
    expect(bootstrap).not.toContain('### Credential Probing')
    const hits = searchGuardianPolicy('credential probing normal authentication', 4)
    expect(hits[0]?.title).toBe('Credential Probing')
    const sections = getGuardianPolicySections([hits[0]!.id])
    expect(sections[0]?.text).toContain('normal auth-service flow')
    expect(guardianPolicyOutline().some(section => section.title === 'Destructive Actions')).toBe(true)
  })

  it('rejects unknown ids and oversized fan-out', () => {
    expect(() => getGuardianPolicySections(['missing'])).toThrow(/unknown guardian policy section/)
    expect(() => getGuardianPolicySections(Array.from({ length: 9 }, () => 'x'))).toThrow(/1 to 8/)
  })
})
