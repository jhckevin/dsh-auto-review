import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const COMMIT = '9f97cb79eb15b38d24c552c56fe24e211ff9cf3a'
const CONTENT_PATTERN = ['GuardianReviewer', 'GuardianAssessmentEvent', 'GuardianReviewEvidence', 'GuardianApprovalRequest', 'ApprovalAction', 'AutoReview', 'auto_review'].join('|')
const MANDATORY_PATHS = [
  'codex-rs/core/src/command_canonicalization.rs',
  'codex-rs/core/src/exec_policy.rs',
  'codex-rs/core/src/guardian/mod.rs',
  'codex-rs/core/src/hook_runtime.rs',
  'codex-rs/core/src/mcp_tool_call.rs',
  'codex-rs/core/src/sandboxing/mod.rs',
  'codex-rs/core/src/session/session.rs',
  'codex-rs/core/src/tools/hook_names.rs',
  'codex-rs/core/src/tools/runtimes/apply_patch.rs',
  'codex-rs/core/src/tools/runtimes/unified_exec.rs',
  'codex-rs/core/src/tools/sandboxing.rs',
  'codex-rs/core/src/tools/sandboxing_tests.rs',
  'codex-rs/core/src/guardian/review.rs',
  'codex-rs/hooks/src/engine/output_parser.rs',
  'codex-rs/hooks/src/events/permission_request.rs',
  'codex-rs/app-server-protocol/src/protocol/v2/item.rs',
  'codex-rs/app-server-protocol/src/protocol/v2/shared.rs',
  'codex-rs/protocol/src/approvals.rs',
  'codex-rs/protocol/src/config_types.rs',
  'codex-rs/protocol/src/error.rs',
  'codex-rs/protocol/src/models.rs',
  'codex-rs/protocol/src/openai_models.rs',
  'codex-rs/protocol/src/protocol.rs',
  'codex-rs/protocol/src/request_permissions.rs'
]
const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : args[index + 1]
}
const repo = resolve(valueAfter('--repo', process.env.CODEX_UPSTREAM_REPO ?? '/srv/pi-lab-dev/src/openai-codex-autoreview'))
const output = resolve(valueAfter('--output', new URL('../docs/codex-upstream-inventory.json', import.meta.url).pathname))
const git = (...gitArgs) => execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8' }).trim()

if (git('rev-parse', COMMIT) !== COMMIT) throw new Error(`missing exact upstream commit ${COMMIT}`)
const tree = git('ls-tree', '-r', '--name-only', COMMIT).split('\n').filter(Boolean)
const pathMatches = tree.filter((path) =>
  /(^|\/)(guardian|guardian-v2|guardian-context)(\/|\.|_|-)/i.test(path)
  || /(^|\/)(approvals|auto_review|auto-review|auto_review_denials)(\/|\.|_)/i.test(path)
  || /approval_request|command_canonicalization/.test(path),
)
let contentMatches = []
try {
  contentMatches = git('grep', '-l', '-E', CONTENT_PATTERN, COMMIT, '--', 'codex-rs/**/*.rs')
    .split('\n').filter(Boolean).map((line) => line.replace(new RegExp(`^${COMMIT}:`), ''))
} catch (error) {
  if (error.status !== 1) throw error
}

for (const path of MANDATORY_PATHS) if (!tree.includes(path)) throw new Error(`mandatory approval dependency is absent at pinned commit: ${path}`)
const candidates = [...new Set([...pathMatches, ...contentMatches, ...MANDATORY_PATHS])].sort()
const classify = (path) => {
  if (/\/tui\//.test(path)) return { classification: 'na', reason: 'target has WebUI rather than Codex TUI; lifecycle semantics still require a mapped module proof' }
  if (/(^|\/)BUILD\.bazel$/.test(path)) return { classification: 'na', reason: 'Bazel metadata is not used by the pnpm extension build; source inclusion remains locked' }
  if (/(_tests?\.rs|\/tests\/|\/snapshots\/|\.snap$)/.test(path)) return { classification: 'include-test', reason: 'upstream executable or snapshot conformance evidence' }
  if (/\.(md|toml)$/.test(path)) return { classification: 'include-asset', reason: 'upstream policy, prompt, or package metadata' }
  return { classification: 'include-source', reason: 'upstream runtime, protocol, configuration, or integration surface' }
}
const moduleFor = (path, classification) => {
  if (classification === 'na') return 'app-server-ui-tui'
  if (/(_tests?\.rs|\/tests\/|\/snapshots\/|\.snap$)/.test(path)) return 'upstream-test-inventory'
  if (/guardian-context\//.test(path)) return 'guardian-context'
  if (/ext\/guardian-v2\/src\/sync_reviewer/.test(path)) return 'guardian-v2-sync-reviewer'
  if (/ext\/guardian-v2\/src\/async_scorer|protocol\/src\/openai_models\/guardian_v2/.test(path)) return 'guardian-v2-async-scorer'
  if (/guardian\/approval_request\.rs/.test(path)) return 'guardian-action-format'
  if (/guardian\/prompt\.rs|assets\/guardian|classifier_instructions|policy_template\.md/.test(path)) return 'guardian-prompt'
  if (/guardian\/review_session/.test(path)) return 'guardian-review-session'
  if (/guardian\/metrics\.rs/.test(path)) return 'metrics-events'
  if (/guardian\/(review|mod)\.rs/.test(path)) return 'guardian-review'
  if (/guardian_review_evidence|user_authorization/.test(path)) return 'guardian-review-evidence'
  if (/protocol\/src\/(approvals|protocol|config_types|error|models|openai_models|request_permissions)\.rs/.test(path)) return 'approval-protocol'
  if (/mcp|network_approval|request_permissions/.test(path)) return 'mcp-network-permissions'
  if (/command_canonicalization/.test(path)) return 'approval-action-and-cache'
  if (/app-server|\/tui\//.test(path)) return 'app-server-ui-tui'
  return 'approval-stage'
}
const files = candidates.map((path) => {
  const row = git('ls-tree', COMMIT, '--', path).split(/\s+/)
  if (row.length < 4 || row[1] !== 'blob') throw new Error(`expected blob for ${path}`)
  const classified = classify(path)
  return {
    path,
    blob: row[2],
    ...classified,
    module: moduleFor(path, classified.classification),
    coverageRole: classified.classification === 'include-test' ? 'test' : classified.classification === 'include-asset' ? 'asset' : classified.classification === 'na' ? 'na' : 'ported',
    ...(classified.classification === 'na' ? { proofId: /BUILD\.bazel$/.test(path) ? 'bazel-build-na' : 'codex-tui-na' } : {}),
  }
})
const inventory = {
  schemaVersion: 1,
  repository: 'openai/codex',
  commit: COMMIT,
  selection: {
    pathRule: 'guardian/guardian-v2/guardian-context, approvals/auto_review names, approval_request, command_canonicalization',
    contentPattern: CONTENT_PATTERN,
    mandatoryPaths: MANDATORY_PATHS,
    mandatorySemantics: 'direct local approval-stage dependencies imported by core/src/tools/approvals.rs plus the protocol types it consumes',
    candidateSemantics: 'union(pathRule, contentPattern, mandatoryPaths)',
    deletionProtection: 'validator regenerates this union from the pinned git tree and requires exact path, classification, reason, and blob equality',
  },
  counts: files.reduce((counts, file) => ({ ...counts, total: counts.total + 1, [file.classification]: (counts[file.classification] ?? 0) + 1 }), { total: 0 }),
  files,
  nonPublic: [{ id: 'arc', classification: 'excluded-non-public', reason: 'Public Codex comments reference earlier ARC blocking, but the pinned public git tree contains no ARC decision implementation to port or hash.' }],
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`)
console.log(`wrote ${files.length} locked upstream files to ${output}`)
