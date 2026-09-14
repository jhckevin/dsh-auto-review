// Summarize only this isolated acceptance root. Never export API keys or raw prompts.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root = resolve(process.argv[2] || '')
assert(root.endsWith('/ci-issue34-20260914'), 'Explicit acceptance root required')
const read = file => JSON.parse(readFileSync(file, 'utf8'))
const jsonl = text => text.trim().split('\n').filter(Boolean).map(JSON.parse)
const ledger = jsonl(readFileSync(join(root, 'gateway/requests.jsonl'), 'utf8'))
const totals = read(join(root, 'gateway/totals.json'))
const result = { generatedAt: new Date().toISOString(), accounting: 'provider input + output, all attempts and all test stages; cache is a subset of input', cohorts: {} }
const bump = (map, key) => { map[key] = (map[key] || 0) + 1 }
function walk(dir) { return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : [] }
for (const [cohort, folder] of [['rc6', 'rc6-exact2'], ['rc2', 'rc2'], ['alpha5', 'alpha5-exact2']]) {
  const dir = join(root, folder), home = join(dir, 'work/user/.dsh')
  const rows = ledger.filter(x => x.cohort === cohort)
  const usage = { requests: rows.length, input: 0, output: 0, total: 0, cacheInput: 0, unknownUsage: 0, statuses: {}, stages: {}, roles: {} }
  for (const x of rows) {
    bump(usage.statuses, x.httpStatus)
    if (!x.usage) { usage.unknownUsage++; continue }
    for (const k of ['input', 'output', 'total', 'cacheInput']) usage[k] += x.usage[k] || 0
    for (const [map, key] of [[usage.stages, x.session], [usage.roles, x.role]]) {
      const u = map[key] ||= { requests: 0, input: 0, output: 0, total: 0, cacheInput: 0, latencyMs: 0 }
      u.requests++; for (const k of ['input', 'output', 'total', 'cacheInput']) u[k] += x.usage[k] || 0
      u.latencyMs += x.elapsedMs || 0
    }
  }
  assert.equal(usage.total, totals[cohort], 'ledger differs from budget total')
  usage.cacheHitInputRatio = usage.input ? usage.cacheInput / usage.input : null
  usage.withinRequestedRange = usage.total >= 900000 && usage.total <= 1100000
  const traces = []
  for (const file of walk(join(home, 'sessions')).filter(f => f.endsWith('.jsonl.zstd'))) {
    // Node's single-frame synchronous decoder alone silently reads only the header.
    // zstd -dc handles the entire concatenated frame stream and validates its end.
    const events = jsonl(execFileSync('zstd', ['-dc', file], { maxBuffer: 100 * 1024 * 1024 }).toString())
    const header = events.find(x => x.type === 'session')
    const summary = { id: header.id, role: header.id.startsWith('auto-review-') ? 'reviewer' : 'main',
      relativeFile: file.slice(root.length + 1), bytes: readFileSync(file).length,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
      rows: events.length, eventTypes: {}, tools: {}, compactions: 0, turnEnds: [] }
    for (const e of events) {
      bump(summary.eventTypes, e.type)
      if (e.type === 'tool/call') bump(summary.tools, e.data.name)
      if (/compact.*(end|complete)|compaction$/.test(e.type)) summary.compactions++
      if (e.type === 'turn/end') summary.turnEnds.push(e.data.reason)
    }
    const times = events.flatMap(e => Number.isFinite(e.time) ? [e.time] : Number.isFinite(e.time0) ? [e.time0] : [])
    if (times.length) summary.wallMs = Math.max(...times) - Math.min(...times)
    traces.push(summary)
  }
  const audit = { kinds: {}, approvalPaths: {}, outcomes: {}, actionKinds: {}, decisions: {}, policyRetrieval: {}, usageRecords: [] }
  for (const file of walk(join(home, 'auto-review/audit')).filter(f => f.endsWith('.jsonl'))) {
    for (const row of jsonl(readFileSync(file, 'utf8'))) {
      bump(audit.kinds, row.kind)
      if (row.kind === 'result') { bump(audit.approvalPaths, row.data.approvalPath); bump(audit.outcomes, row.data.finalOutcome) }
      if (row.kind === 'routed') bump(audit.actionKinds, row.data.actionKind)
      if (row.kind === 'decision') bump(audit.decisions, row.data.decision.outcome)
      if (row.kind === 'reviewer-usage') {
        audit.usageRecords.push({ session: row.data.reviewerSessionId, status: row.data.status, cleanupFailed: row.data.cleanupFailed, usage: row.data.usage })
        for (const [k, v] of Object.entries(row.data.policyRetrieval || {})) if (typeof v === 'number') audit.policyRetrieval[k] = (audit.policyRetrieval[k] || 0) + v
      }
    }
  }
  const white = jsonl(readFileSync(join(dir, 'whitebox-results/whitebox/decisions.jsonl'), 'utf8')).map(x => ({ id: x.id, outcome: x.decision.outcome, expected: x.expected, matches: x.matches, elapsedMs: x.elapsedMs, saferAlternative: x.decision.saferAlternative || null }))
  result.cohorts[cohort] = { usage, traces, audit, whitebox: { cases: white, passed: white.filter(x => x.matches).length, total: white.length }, loop: read(join(dir, 'loop-results/loop/result.json')) }
}
mkdirSync(join(root, 'analysis'), { recursive: true })
writeFileSync(join(root, 'analysis/summary.json'), JSON.stringify(result, null, 2))
const compact = Object.fromEntries(Object.entries(result.cohorts).map(([c, x]) => [c, {
  usage: x.usage, whitebox: x.whitebox.passed + '/' + x.whitebox.total,
  loop: x.loop.pass, audit: x.audit.kinds, approvalPaths: x.audit.approvalPaths,
  decisions: x.audit.decisions, traces: x.traces.length,
  mainTools: x.traces.filter(t => t.role === 'main').map(t => t.tools),
}]))
console.log(JSON.stringify(compact, null, 2))
