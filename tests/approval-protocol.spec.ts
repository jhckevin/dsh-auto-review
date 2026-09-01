import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  approvalRoute,
  coreDecisionToV2CommandDecision,
  effectiveExecAvailableDecisions,
  parseCoreApplyPatchApprovalRequestEvent,
  parseCoreApprovalsReviewer,
  parseCoreAskForApproval,
  parseCoreFileChange,
  parseCoreReviewDecision,
  parseV2ApprovalsReviewer,
  parseV2AskForApproval,
  parseV2FileChangeRequestApprovalParams,
  type CoreExecApprovalRequestEvent,
  type CoreReviewDecision,
} from '../src/codex-parity/index.ts'

type GoldenCase = { input: unknown; result: { ok?: unknown; error?: string } }
const core = JSON.parse(readFileSync(new URL('./oracle/codex-approval-protocol-9f97cb79.json', import.meta.url), 'utf8')) as {
  defaults: { askForApproval: unknown; approvalsReviewer: unknown }
  reviewer: GoldenCase[]; askForApproval: GoldenCase[]; reviewDecisions: { json: unknown }[]
  exec: { defaults: Record<string, unknown>; explicitEmpty: unknown }
  fileChange: GoldenCase[]; applyPatch: GoldenCase[]
}
const v2 = JSON.parse(readFileSync(new URL('./oracle/codex-approval-protocol-v2-9f97cb79.json', import.meta.url), 'utf8')) as {
  reviewer: GoldenCase[]; askForApproval: GoldenCase[]; fileChange: GoldenCase[]
  reviewDecisionMapping: { core: unknown; v2: unknown }[]
}
const permission = JSON.parse(readFileSync(new URL('./oracle/codex-permission-request-9f97cb79.json', import.meta.url), 'utf8')) as {
  parser: unknown[]; fold: Record<string, unknown>
}
const store = JSON.parse(readFileSync(new URL('./oracle/codex-approval-store-9f97cb79.json', import.meta.url), 'utf8')) as {
  store: Record<string, unknown[]>; route: { policy: unknown; reviewer: unknown; guardian: boolean }[]
}

const compareCase = (entry: GoldenCase, parser: (value: unknown) => unknown): void => {
  if (entry.result.error !== undefined) expect(() => parser(entry.input)).toThrow()
  else expect(parser(entry.input)).toEqual(entry.result.ok)
}

describe('fixed Codex core approval protocol oracle', () => {
  it('matches core defaults, aliases, granular defaults and invalid combinations', () => {
    expect(parseCoreAskForApproval()).toEqual(core.defaults.askForApproval)
    expect(parseCoreApprovalsReviewer()).toEqual(core.defaults.approvalsReviewer)
    for (const entry of core.reviewer) compareCase(entry, parseCoreApprovalsReviewer)
    for (const entry of core.askForApproval) compareCase(entry, parseCoreAskForApproval)
  })

  it('roundtrips all eight ReviewDecision variants', () => {
    for (const entry of core.reviewDecisions) expect(parseCoreReviewDecision(entry.json)).toEqual(entry.json)
  })

  it('matches absent, explicit-empty, network, amendment and permissions decision sets', () => {
    const base: CoreExecApprovalRequestEvent = { kind: 'command', call_id: 'call', turn_id: '', started_at_ms: 1, command: [], cwd: '/work', parsed_cmd: [] }
    expect(effectiveExecAvailableDecisions(base)).toEqual(core.exec.defaults.ordinary)
    expect(effectiveExecAvailableDecisions({ ...base, proposed_execpolicy_amendment: ['git'] })).toEqual(core.exec.defaults.execAmendment)
    expect(effectiveExecAvailableDecisions({ ...base, network_approval_context: { host: 'example.test', protocol: 'https' }, proposed_network_policy_amendments: [{ host: 'example.test', action: 'deny' }, { host: 'example.test', action: 'allow' }] })).toEqual(core.exec.defaults.network)
    expect(effectiveExecAvailableDecisions({ ...base, network_approval_context: { host: 'example.test', protocol: 'https' }, proposed_network_policy_amendments: [{ host: 'example.test', action: 'deny' }] })).toEqual(core.exec.defaults.networkDenyOnly)
    expect(effectiveExecAvailableDecisions({ ...base, additional_permissions: { network: null, file_system: null } })).toEqual(core.exec.defaults.additionalPermissions)
    expect(effectiveExecAvailableDecisions({ ...base, available_decisions: [] })).toEqual(core.exec.explicitEmpty)
  })

  it('matches FileChange and ApplyPatch serde including invalid shapes and path-map keys', () => {
    for (const entry of core.fileChange) compareCase(entry, parseCoreFileChange)
    for (const entry of core.applyPatch) compareCase(entry, parseCoreApplyPatchApprovalRequestEvent)
  })
})

describe('fixed Codex app-server v2 approval wire oracle', () => {
  it('keeps v2 no-default behavior separate from core', () => {
    expect(() => parseV2AskForApproval(undefined)).toThrow()
    expect(() => parseV2ApprovalsReviewer(undefined)).toThrow()
    for (const entry of v2.askForApproval) compareCase(entry, parseV2AskForApproval)
    for (const entry of v2.reviewer) compareCase(entry, parseV2ApprovalsReviewer)
  })

  it('maps unsupported core decisions to decline and preserves v2 nullable fields', () => {
    for (const entry of v2.reviewDecisionMapping) expect(coreDecisionToV2CommandDecision(parseCoreReviewDecision(entry.core) as CoreReviewDecision)).toEqual(entry.v2)
    for (const entry of v2.fileChange) compareCase(entry, parseV2FileChangeRequestApprovalParams)
  })
})

describe('fixed Codex B2 dependency truth', () => {
  it('locks the real PermissionRequest parser and fold surface without claiming runtime integration', () => {
    expect(permission.parser).toHaveLength(6)
    expect(permission.fold).toEqual({
      empty: null,
      allow: { allow: true },
      allowThenDeny: { deny: 'first deny' },
      firstDenyWins: { deny: 'first deny' },
    })
  })

  it('locks ApprovalStore session-only behavior and reviewer routing from codex-core', () => {
    expect(store.store.empty).toEqual([null, null])
    expect(store.store.partial).toEqual(['approved_for_session', null])
    expect(store.store.all).toEqual(['approved_for_session', 'approved_for_session'])
    expect(store.store.nonSession).toEqual(['approved_for_session', 'approved'])
    for (const entry of store.route) {
      const policy = entry.policy === 'granular'
        ? { granular: { sandbox_approval: true, rules: true, skill_approval: false, request_permissions: false, mcp_elicitations: true } }
        : entry.policy
      expect(approvalRoute(parseCoreAskForApproval(policy), parseCoreApprovalsReviewer(entry.reviewer), false))
        .toBe(entry.guardian ? 'guardian' : 'user')
    }
  })
})
