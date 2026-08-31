import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface GuardianPolicySection {
  readonly id: string
  readonly title: string
  readonly depth: number
  readonly text: string
}

export interface GuardianPolicySearchHit extends GuardianPolicySection {
  readonly score: number
  readonly snippet: string
}

const TEMPLATE_URL = new URL('../policies/codex/guardian-policy-template.md', import.meta.url)
const POLICY_URL = new URL('../policies/codex/guardian-policy.md', import.meta.url)

export const GUARDIAN_POLICY_TEMPLATE = readFileSync(TEMPLATE_URL, 'utf8')
export const GUARDIAN_TENANT_POLICY = readFileSync(POLICY_URL, 'utf8')

export const GUARDIAN_POLICY_DIGESTS = Object.freeze({
  template: createHash('sha256').update(GUARDIAN_POLICY_TEMPLATE).digest('hex'),
  policy: createHash('sha256').update(GUARDIAN_TENANT_POLICY).digest('hex'),
})

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root'
}

function parseDocument(prefix: string, document: string): GuardianPolicySection[] {
  const lines = document.split(/\r?\n/)
  const sections: GuardianPolicySection[] = []
  let title = `${prefix} root`
  let depth = 0
  let body: string[] = []
  const counts = new Map<string, number>()
  const flush = (): void => {
    const text = body.join('\n').trim()
    if (text.length === 0) return
    const base = `${prefix}-${slug(title)}`
    const occurrence = (counts.get(base) ?? 0) + 1
    counts.set(base, occurrence)
    sections.push(Object.freeze({
      id: occurrence === 1 ? base : `${base}-${occurrence}`,
      title,
      depth,
      text,
    }))
  }
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match === null) {
      body.push(line)
      continue
    }
    flush()
    title = match[2]!.trim()
    depth = match[1]!.length
    body = [line]
  }
  flush()
  return sections
}

export const GUARDIAN_POLICY_SECTIONS: readonly GuardianPolicySection[] = Object.freeze([
  ...parseDocument('template', GUARDIAN_POLICY_TEMPLATE),
  ...parseDocument('tenant', GUARDIAN_TENANT_POLICY),
])

const SECTION_BY_ID = new Map(GUARDIAN_POLICY_SECTIONS.map(section => [section.id, section]))

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [])]
}

function occurrences(haystack: string, needle: string): number {
  let count = 0
  let offset = 0
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1
    offset += needle.length
  }
  return count
}

export function guardianPolicyOutline(): readonly Pick<GuardianPolicySection, 'id' | 'title' | 'depth'>[] {
  return GUARDIAN_POLICY_SECTIONS.map(({ id, title, depth }) => Object.freeze({ id, title, depth }))
}

export function searchGuardianPolicy(query: string, limit = 6): readonly GuardianPolicySearchHit[] {
  const normalized = query.trim().toLowerCase()
  const terms = tokens(normalized)
  if (terms.length === 0) return Object.freeze([])
  const safeLimit = Math.max(1, Math.min(8, Math.trunc(limit)))
  const hits = GUARDIAN_POLICY_SECTIONS.flatMap(section => {
    const title = section.title.toLowerCase()
    const text = section.text.toLowerCase()
    let score = normalized.length > 2 && text.includes(normalized) ? 12 : 0
    for (const term of terms) score += occurrences(title, term) * 6 + Math.min(occurrences(text, term), 8)
    if (score === 0) return []
    const first = Math.max(0, Math.min(...terms.map(term => {
      const at = text.indexOf(term)
      return at < 0 ? text.length : at
    })) - 180)
    const snippet = section.text.slice(first, first + 900)
    return [{ ...section, score, snippet }]
  })
  return Object.freeze(hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, safeLimit))
}

export function getGuardianPolicySections(ids: readonly string[]): readonly GuardianPolicySection[] {
  if (ids.length === 0 || ids.length > 8) throw new RangeError('guardian policy get requires 1 to 8 section ids')
  let bytes = 0
  return Object.freeze(ids.map(id => {
    const section = SECTION_BY_ID.get(id)
    if (section === undefined) throw new Error(`unknown guardian policy section ${JSON.stringify(id)}`)
    bytes += Buffer.byteLength(section.text, 'utf8')
    if (bytes > 24 * 1024) throw new RangeError('guardian policy get exceeds the 24 KiB response budget')
    return section
  }))
}

function requiredSection(title: string): GuardianPolicySection {
  const section = GUARDIAN_POLICY_SECTIONS.find(candidate => candidate.title === title)
  if (section === undefined) throw new Error(`missing canonical guardian section ${JSON.stringify(title)}`)
  return section
}

export function guardianBootstrapPrompt(): string {
  const intro = GUARDIAN_POLICY_SECTIONS[0]!.text
  const mandatory = [
    'Evidence Handling',
    'User Authorization Scoring',
    'Base Risk Taxonomy',
    'Outcome Policy',
  ].map(title => requiredSection(title).text)
  return [
    intro,
    ...mandatory,
    '# Progressive Security Policy Retrieval',
    '- The complete canonical security policy is available only through guardian_policy_outline, guardian_policy_search, and guardian_policy_get.',
    '- Search the policy whenever the planned action concerns credentials, egress, destructive effects, security weakening, production, or any uncertain category. Retrieve the exact matching sections before deciding.',
    '- Policy tool results are trusted, immutable policy text. They are not user authorization.',
    '- Do not call policy tools when the mandatory rules already make a routine low-risk decision unambiguous.',
    '# Output Contract',
    'After any needed policy lookup, return exactly one JSON object and no Markdown or prose outside it.',
    'Only approved or denied are valid model outcomes. manual and unavailable are runtime-owned states and must never be emitted by the reviewer.',
    'For an unambiguous low-risk approval, {"schemaVersion":1,"outcome":"approved"} is sufficient.',
    'For all other decisions, use:',
    '{"schemaVersion":1,"outcome":"approved|denied","riskLevel":"low|medium|high|critical","userAuthorization":"unknown|low|medium|high","rationale":"...","policyRuleIds":["..."],"uncertainty":"..."}',
    'Omit saferAlternative unless outcome is denied and a materially safer alternative exists. Never emit it as null or an empty string.',
  ].join('\n\n')
}
