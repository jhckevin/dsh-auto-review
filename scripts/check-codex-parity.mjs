import { execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const EXPECTED_COMMIT = '9f97cb79eb15b38d24c552c56fe24e211ff9cf3a'
const REQUIRED_MANDATORY_PATHS = [
  'codex-rs/core/src/command_canonicalization.rs', 'codex-rs/core/src/exec_policy.rs',
  'codex-rs/core/src/guardian/mod.rs', 'codex-rs/core/src/hook_runtime.rs',
  'codex-rs/core/src/mcp_tool_call.rs', 'codex-rs/core/src/sandboxing/mod.rs',
  'codex-rs/core/src/session/session.rs', 'codex-rs/core/src/tools/hook_names.rs',
  'codex-rs/core/src/tools/runtimes/apply_patch.rs', 'codex-rs/core/src/tools/runtimes/unified_exec.rs',
  'codex-rs/core/src/tools/sandboxing.rs', 'codex-rs/protocol/src/approvals.rs',
  'codex-rs/protocol/src/config_types.rs', 'codex-rs/protocol/src/error.rs',
  'codex-rs/protocol/src/models.rs', 'codex-rs/protocol/src/openai_models.rs',
  'codex-rs/protocol/src/protocol.rs', 'codex-rs/protocol/src/request_permissions.rs',
]
const root = resolve(new URL('..', import.meta.url).pathname)
const release = process.argv.includes('--release')
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : process.argv[index + 1]
}
const upstreamRepo = resolve(arg('--upstream', process.env.CODEX_UPSTREAM_REPO ?? '/srv/pi-lab-dev/src/openai-codex-autoreview'))
const node = process.execPath
const failures = []
const isPlaceholder = (value) => typeof value !== 'string' || value.trim().length < 3 || /^(todo|tbd|none|null|placeholder|agent)$/i.test(value.trim())
const fileExists = async (path) => { try { await access(path); return true } catch { return false } }
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const repoPath = (value, at, requireTracked = release) => {
  if (isPlaceholder(value) || isAbsolute(value)) { failures.push(`${at} must be a non-placeholder repo-relative path`); return null }
  const absolute = resolve(root, value)
  const fromRoot = relative(root, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    failures.push(`${at} escapes the repository root`)
    return null
  }
  if (requireTracked) {
    try { git(root, 'ls-files', '--error-unmatch', '--', fromRoot) }
    catch { failures.push(`${at} is not tracked by git: ${value}`) }
  }
  return absolute
}
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const manifest = await json(join(root, 'docs/parity-manifest.json'))
const lockedInventory = await json(join(root, 'docs/codex-upstream-inventory.json'))

if (manifest.schemaVersion !== 2) failures.push('schemaVersion must equal 2')
if (manifest.baseline?.commit !== EXPECTED_COMMIT) failures.push(`baseline.commit must equal ${EXPECTED_COMMIT}`)
if (lockedInventory.commit !== EXPECTED_COMMIT) failures.push('inventory commit differs from baseline')
if (manifest.inventory?.path !== 'docs/codex-upstream-inventory.json') failures.push('manifest inventory.path is invalid')
if (manifest.inventory?.generator !== 'scripts/generate-codex-upstream-inventory.mjs') failures.push('manifest inventory.generator is invalid')
if (manifest.inventory?.candidateSemantics !== 'union(pathRule, contentPattern, mandatoryPaths)') failures.push('manifest inventory.candidateSemantics is invalid')
if (lockedInventory.selection?.candidateSemantics !== manifest.inventory?.candidateSemantics) failures.push('locked inventory candidateSemantics differs from manifest')
if (manifest.inventory?.lockedFiles !== lockedInventory.counts?.total) failures.push('manifest inventory.lockedFiles differs from locked inventory')
if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) failures.push('modules must be a non-empty array')
const mandatory = new Set(lockedInventory.selection?.mandatoryPaths ?? [])
for (const path of REQUIRED_MANDATORY_PATHS) {
  if (!mandatory.has(path)) failures.push(`mandatory approval-stage dependency is not declared: ${path}`)
  if (!(lockedInventory.files ?? []).some((file) => file.path === path)) failures.push(`mandatory approval-stage dependency is not inventoried: ${path}`)
}

try {
  if (git(upstreamRepo, 'rev-parse', EXPECTED_COMMIT) !== EXPECTED_COMMIT) failures.push('exact upstream commit is unavailable')
  const temp = await mkdtemp(join(tmpdir(), 'codex-parity-'))
  const regeneratedPath = join(temp, 'inventory.json')
  execFileSync(node, [join(root, 'scripts/generate-codex-upstream-inventory.mjs'), '--repo', upstreamRepo, '--output', regeneratedPath], { stdio: 'pipe' })
  const regenerated = await json(regeneratedPath)
  if (JSON.stringify(regenerated) !== JSON.stringify(lockedInventory)) failures.push('locked inventory differs from regenerated pinned-tree inventory (path/classification/reason/blob/count drift)')
  if (lockedInventory.counts?.total < 99 || lockedInventory.files?.length !== lockedInventory.counts?.total) failures.push('inventory must lock at least 99 files and its count must be exact')
} catch (error) {
  failures.push(`upstream inventory regeneration failed: ${error.message}`)
}

const inventoryByPath = new Map((lockedInventory.files ?? []).map((file) => [file.path, file]))
const moduleIds = new Set((manifest.modules ?? []).map((module) => module.id))
const assignedCounts = new Map()
const allowedRoles = new Set(manifest.inventoryCoverage?.requiredRoles ?? [])
if ([...allowedRoles].sort().join(',') !== 'asset,na,ported,test') failures.push('inventoryCoverage.requiredRoles must be exactly asset, na, ported, test')
const consumedProofIds = new Set()
for (const file of lockedInventory.files ?? []) {
  if (!moduleIds.has(file.module)) failures.push(`inventory file has no declared module owner: ${file.path} -> ${file.module ?? '<missing>'}`)
  else assignedCounts.set(file.module, (assignedCounts.get(file.module) ?? 0) + 1)
  if (!allowedRoles.has(file.coverageRole)) failures.push(`inventory file has invalid coverageRole: ${file.path} -> ${file.coverageRole ?? '<missing>'}`)
  const expectedRole = file.classification === 'include-source' ? 'ported' : file.classification === 'include-test' ? 'test' : file.classification === 'include-asset' ? 'asset' : file.classification === 'na' ? 'na' : null
  if (file.coverageRole !== expectedRole) failures.push(`inventory classification/coverageRole mismatch: ${file.path}`)
  if (file.coverageRole === 'na') {
    const proof = manifest.inventoryCoverage?.naProofs?.[file.proofId]
    if (!proof) failures.push(`N/A inventory file has no centralized proof mapping: ${file.path} -> ${file.proofId ?? '<missing>'}`)
    else consumedProofIds.add(file.proofId)
  } else if (file.proofId) failures.push(`non-N/A inventory file unexpectedly has proofId: ${file.path}`)
}
for (const id of moduleIds) if (!assignedCounts.has(id)) failures.push(`manifest module owns no inventory file: ${id}`)
for (const [proofId, proof] of Object.entries(manifest.inventoryCoverage?.naProofs ?? {})) {
  if (!consumedProofIds.has(proofId)) failures.push(`N/A proof is not consumed by any inventory file: ${proofId}`)
  if (isPlaceholder(proof.path) || isPlaceholder(proof.anchor) || !/^[0-9a-f]{40}$/.test(proof.blob ?? '')) { failures.push(`N/A proof ${proofId} requires path/anchor/blob`); continue }
  const path = repoPath(proof.path, `inventoryCoverage.naProofs.${proofId}.path`)
  if (!path) continue
  if (!(await fileExists(path))) { failures.push(`N/A proof file does not exist: ${proofId}`); continue }
  if (git(root, 'hash-object', path) !== proof.blob) failures.push(`N/A proof blob mismatch: ${proofId}`)
  const content = await readFile(path, 'utf8')
  if (!content.includes(proof.anchor)) failures.push(`N/A proof anchor not found: ${proofId}`)
}
const sourceCache = new Map()
const upstreamSource = (path) => {
  const key = `${EXPECTED_COMMIT}:${path}`
  if (!sourceCache.has(key)) sourceCache.set(key, git(upstreamRepo, 'show', key))
  return sourceCache.get(key)
}
const checkReview = async (review, at) => {
  if (!review || review.decision !== 'pass') return failures.push(`${at}.decision must be pass`)
  if (isPlaceholder(review.agent)) failures.push(`${at}.agent must identify a real independent subagent`)
  if (!/^[0-9a-f]{40}$/.test(review.commit ?? '')) failures.push(`${at}.commit must be a full commit hash`)
  else { try { git(root, 'cat-file', '-e', `${review.commit}^{commit}`) } catch { failures.push(`${at}.commit does not exist`) } }
  if (isPlaceholder(review.evidencePath)) return failures.push(`${at}.evidencePath is required`)
  const evidence = repoPath(review.evidencePath, `${at}.evidencePath`)
  if (!evidence) return
  if (!(await fileExists(evidence))) return failures.push(`${at}.evidencePath does not exist`)
  const actual = git(root, 'hash-object', evidence)
  if (review.evidenceBlob !== actual) failures.push(`${at}.evidenceBlob does not match evidence file`)
}

const ids = new Set()
for (const [index, module] of (manifest.modules ?? []).entries()) {
  const at = `modules[${index}](${module.id ?? '?'})`
  if (isPlaceholder(module.id)) failures.push(`${at}.id is required`)
  if (ids.has(module.id)) failures.push(`${at}.id is duplicated`)
  ids.add(module.id)
  for (const field of ['upstreamPaths', 'upstreamSymbols', 'portPaths', 'portSymbols', 'tests', 'remediationCommits']) {
    if (!Array.isArray(module[field])) failures.push(`${at}.${field} must be an array`)
  }
  if ((module.upstreamPaths?.length ?? 0) === 0) failures.push(`${at}.upstreamPaths must not be empty`)
  if ((module.upstreamSymbols?.length ?? 0) === 0) failures.push(`${at}.upstreamSymbols must not be empty`)
  for (const path of module.upstreamPaths ?? []) {
    const inventory = inventoryByPath.get(path)
    if (!inventory) failures.push(`${at}.upstreamPaths contains untracked or nonexistent path ${path}`)
    else {
      try { if (git(upstreamRepo, 'rev-parse', `${EXPECTED_COMMIT}:${path}`) !== inventory.blob) failures.push(`${at} upstream blob drift: ${path}`) }
      catch { failures.push(`${at} upstream path is absent: ${path}`) }
    }
  }
  for (const symbol of module.upstreamSymbols ?? []) {
    if (!symbol || !module.upstreamPaths?.includes(symbol.path) || isPlaceholder(symbol.symbol)) failures.push(`${at}.upstreamSymbols entry must name a tracked module path and symbol`)
    else { try { if (!upstreamSource(symbol.path).includes(symbol.symbol)) failures.push(`${at} upstream symbol not found: ${symbol.path} :: ${symbol.symbol}`) } catch { failures.push(`${at} could not inspect upstream symbol: ${symbol.path}`) } }
  }
  if (!['blocked', 'in_progress', 'implemented', 'reviewed', 'complete', 'na'].includes(module.status)) failures.push(`${at}.status is invalid`)
  if (!release) continue
  if (module.status === 'na') {
    if (!module.naProof || isPlaceholder(module.naProof.reason) || isPlaceholder(module.naProof.evidencePath)) failures.push(`${at}.naProof requires reason and evidencePath`)
    else {
      const proofPath = repoPath(module.naProof.evidencePath, `${at}.naProof.evidencePath`)
      if (!proofPath) continue
      if (!(await fileExists(proofPath))) failures.push(`${at}.naProof evidence does not exist`)
      else if (module.naProof.evidenceBlob !== git(root, 'hash-object', proofPath)) failures.push(`${at}.naProof evidenceBlob mismatch`)
      if (!/^[0-9a-f]{40}$/.test(module.naProof.commit ?? '')) failures.push(`${at}.naProof commit must be a full hash`)
    }
    continue
  }
  if (module.status !== 'complete') failures.push(`${at} is ${module.status}, expected complete or na`)
  for (const path of module.portPaths ?? []) {
    const absolute = repoPath(path, `${at}.portPath`)
    if (absolute && !(await fileExists(absolute))) failures.push(`${at}.portPath does not exist: ${path}`)
  }
  if ((module.portPaths?.length ?? 0) === 0) failures.push(`${at}.portPaths is required for release`)
  for (const symbol of module.portSymbols ?? []) {
    if (!symbol || !module.portPaths?.includes(symbol.path) || isPlaceholder(symbol.symbol)) failures.push(`${at}.portSymbols entry must name a portPath and symbol`)
    else {
      const path = repoPath(symbol.path, `${at}.portSymbols.path`)
      if (path && await fileExists(path)) { const content = await readFile(path, 'utf8'); if (!content.includes(symbol.symbol)) failures.push(`${at} port symbol not found: ${symbol.path} :: ${symbol.symbol}`) }
    }
  }
  if ((module.portSymbols?.length ?? 0) === 0) failures.push(`${at}.portSymbols is required for release`)
  if ((module.tests?.length ?? 0) === 0) failures.push(`${at}.tests is required for release`)
  for (const test of module.tests ?? []) {
    if (!test || isPlaceholder(test.fqn) || isPlaceholder(test.sourcePath) || !['passed', 'na'].includes(test.status)) { failures.push(`${at}.tests entry requires fqn/sourcePath/status`); continue }
    const path = repoPath(test.sourcePath, `${at}.tests.sourcePath`)
    if (!path) continue
    if (!(await fileExists(path))) { failures.push(`${at} test source does not exist: ${test.sourcePath}`); continue }
    const blob = git(root, 'hash-object', path)
    if (blob !== test.sourceBlob) failures.push(`${at} test source blob mismatch: ${test.sourcePath}`)
    const content = await readFile(path, 'utf8')
    const leaf = test.fqn.split(/::|\s+/).filter(Boolean).at(-1)
    if (!leaf || !content.includes(leaf)) failures.push(`${at} test FQN is not discoverable in source: ${test.fqn}`)
    if (test.status === 'na' && isPlaceholder(test.naProof)) failures.push(`${at} N/A test requires naProof`)
  }
  await checkReview(module.initialReview, `${at}.initialReview`)
  await checkReview(module.reReview, `${at}.reReview`)
  if (module.initialReview?.agent === module.reReview?.agent) failures.push(`${at} initial and re-review agents must differ`)
  for (const commit of module.remediationCommits ?? []) {
    if (!/^[0-9a-f]{40}$/.test(commit)) failures.push(`${at} remediation commit must be a full hash`)
    else { try { git(root, 'cat-file', '-e', `${commit}^{commit}`) } catch { failures.push(`${at} remediation commit does not exist: ${commit}`) } }
  }
  if ((module.remediationCommits?.length ?? 0) === 0) {
    const proof = module.noRemediationProof
    if (!proof || isPlaceholder(proof.reason) || isPlaceholder(proof.evidencePath) || !/^[0-9a-f]{40}$/.test(proof.reviewCommit ?? '')) failures.push(`${at} requires remediationCommits or a non-placeholder noRemediationProof`)
    else {
      const proofPath = repoPath(proof.evidencePath, `${at}.noRemediationProof.evidencePath`)
      if (!proofPath) continue
      if (!(await fileExists(proofPath))) failures.push(`${at}.noRemediationProof evidence does not exist`)
      else if (proof.evidenceBlob !== git(root, 'hash-object', proofPath)) failures.push(`${at}.noRemediationProof evidenceBlob mismatch`)
      try { git(root, 'cat-file', '-e', `${proof.reviewCommit}^{commit}`) } catch { failures.push(`${at}.noRemediationProof reviewCommit does not exist`) }
    }
  }
}

if (failures.length) {
  console.error('Codex parity manifest validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else console.log(`Codex parity manifest ${release ? 'release gate' : 'source/inventory gate'} passed for ${manifest.modules.length} modules and ${lockedInventory.counts.total} locked upstream files.`)
