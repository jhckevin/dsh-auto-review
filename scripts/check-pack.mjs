import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url)
const temporary = await mkdtemp(join(tmpdir(), 'dsh-auto-review-pack-'))
try {
  async function pack(cwd) {
    const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', temporary], { cwd })
    const result = JSON.parse(stdout)
    if (!Array.isArray(result) || typeof result[0]?.filename !== 'string') throw new Error(`npm pack returned no artifact for ${cwd}`)
    return join(temporary, result[0].filename)
  }
  const artifact = await pack(root)
  const dependencyArtifacts = []
  // Before registry publication, callers supply the exact staged host/platform
  // tarballs. This is an offline artifact test, not a public-registry claim.
  const bridgeArtifacts = JSON.parse(process.env.DSH_BRIDGE_ARTIFACTS ?? '[]')
  if (!Array.isArray(bridgeArtifacts) || bridgeArtifacts.some(item => typeof item !== 'string')) {
    throw new Error('DSH_BRIDGE_ARTIFACTS must be a JSON array of staged tarball paths')
  }
  dependencyArtifacts.push(...bridgeArtifacts)
  const sourceManifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
  for (const field of ['name', 'version', 'dependencies', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines']) {
    assert.deepEqual(lock.packages[''][field], sourceManifest[field], `lock root ${field} mismatch`)
  }
  if (bridgeArtifacts.length) {
    const integritySet = new Set(await Promise.all(bridgeArtifacts.map(async file =>
      `sha512-${createHash('sha512').update(await readFile(file)).digest('base64')}`)))
    for (const name of ['dsh-auto-review-bridge-host', 'dsh-auto-review-bridge-linux-x64-gnu']) {
      assert.equal(integritySet.has(lock.packages[`node_modules/@jhckevin/${name}`].integrity), true, `staged ${name} differs from lock`)
    }
  }
  for (const dependency of [
    '@deepseek-ai/dsh-util-values',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/cosmokit',
    '@standard-schema/spec',
    'node-addon-api',
    'node-gyp-build',
    'tree-sitter',
    'tree-sitter-bash',
  ]) {
    dependencyArtifacts.push(await pack(new URL(`../node_modules/${dependency}/`, import.meta.url)))
  }
  const installRoot = join(temporary, 'consumer')
  await mkdir(installRoot)
  await writeFile(join(installRoot, 'package.json'), '{"private":true,"type":"module"}\n')
  await exec('npm', [
    'install', '--offline', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund',
    artifact, ...dependencyArtifacts,
  ], { cwd: installRoot, env: { ...process.env, npm_config_cache: join(temporary, 'empty-npm-cache') }, maxBuffer: 10 * 1024 * 1024 })
  const packageRoot = join(installRoot, 'node_modules/@jhckevin/dsh-auto-review')
  const packedRuntime = await import(new URL(`file://${join(packageRoot, 'lib/policy-corpus.js').replaceAll('\\', '/')}`))
  if (packedRuntime.GUARDIAN_POLICY_SECTIONS.length < 10) throw new Error('packed runtime failed to load Guardian policy corpus')
  const parityRuntime = await import(new URL(`file://${join(packageRoot, 'lib/codex-parity/index.js').replaceAll('\\\\', '/')}`))
  const expectedParityExports = [
    'ApprovalProtocolError', 'PathConversionError', 'absolutePath', 'absolutePathToLossyString', 'approvalCacheKeys', 'approvalRoute', 'canonicalizeCommandForApproval',
    'coreDecisionToV2CommandDecision',
    'effectiveExecApprovalId', 'effectiveExecAvailableDecisions',
    'formatGuardianActionPretty', 'guardianApprovalRequestToJson', 'guardianAssessmentAction',
    'guardianCwd', 'guardianRequestTargetItemId', 'guardianRequestTurnId', 'guardianReviewedAction',
    'guardianTruncateText', 'i32', 'inferredNativePathString', 'intoGuardianRequest', 'isPosixAbsolutePathBytes', 'losslessLegacyAppPathString', 'nonZeroUsize', 'parseShellLcPlainCommands',
    'parseCoreApprovalsReviewer', 'parseCoreApplyPatchApprovalRequestEvent', 'parseCoreAskForApproval', 'parseCoreFileChange', 'parseCoreReviewDecision',
    'parseV2ApprovalsReviewer', 'parseV2AskForApproval', 'parseV2FileChangeRequestApprovalParams',
    'pathUri', 'pathUriCacheIdentity', 'pathUriToAbsolutePath', 'permissionRequestPayload', 'serializeAbsolutePath', 'serializePermissionProfile', 'serializeRuntimePermissionProfile', 'shlexJoin', 'u16',
  ]
  if (JSON.stringify(Object.keys(parityRuntime).sort()) !== JSON.stringify(expectedParityExports.sort())) {
    throw new Error(`packed Codex parity exports mismatch: ${Object.keys(parityRuntime).sort().join(',')}`)
  }
  if (JSON.stringify(parityRuntime.canonicalizeCommandForApproval(['bash', '-lc', 'echo hi;'])) !== '[\"echo\",\"hi\"]') {
    throw new Error('packed Codex parity runtime failed to load native tree-sitter parser')
  }
  if (JSON.stringify(parityRuntime.canonicalizeCommandForApproval(['/bin/bash/', '-lc', 'echo hi'])) !== '[\"echo\",\"hi\"]'
    || JSON.stringify(parityRuntime.canonicalizeCommandForApproval(['bash/', '-lc', 'echo hi'])) !== '[\"bash/\",\"-lc\",\"echo hi\"]'
    || JSON.stringify(parityRuntime.canonicalizeCommandForApproval(['/bin/bash/.', '-lc', 'echo hi'])) !== '[\"echo\",\"hi\"]'
    || JSON.stringify(parityRuntime.canonicalizeCommandForApproval(['/bin/bash//.', '-lc', 'echo hi'])) !== '[\"echo\",\"hi\"]'
    || JSON.stringify(parityRuntime.canonicalizeCommandForApproval(['bash/.', '-lc', 'echo hi'])) !== '[\"bash/.\",\"-lc\",\"echo hi\"]'
    || JSON.stringify(parityRuntime.canonicalizeCommandForApproval(['/bin/bash/..', '-lc', 'echo hi'])) !== '[\"/bin/bash/..\",\"-lc\",\"echo hi\"]') {
    throw new Error('packed recursive shell file_stem boundary mismatch')
  }
  if (parityRuntime.pathUri('file:///d%3a/work') !== 'file:///D%3a/work') throw new Error('packed PathUri drive normalization mismatch')
  const packedOpaquePath = parityRuntime.pathUriToAbsolutePath(parityRuntime.pathUri('file:///tmp/non-utf8-%FF'))
  if (!parityRuntime.isPosixAbsolutePathBytes(packedOpaquePath) || parityRuntime.absolutePathToLossyString(packedOpaquePath) !== '/tmp/non-utf8-�') {
    throw new Error('packed non-UTF-8 PathUri byte preservation mismatch')
  }
  try { parityRuntime.serializeAbsolutePath(packedOpaquePath); throw new Error('packed non-UTF-8 path serialized lossily') } catch (error) {
    if (!(error instanceof parityRuntime.PathConversionError)) throw error
  }
  const packedDriveOpaque = parityRuntime.pathUriToAbsolutePath(parityRuntime.pathUri('file:///%00/bad/path/L0M6L3dvcmtzcGFjZQ'))
  if (!parityRuntime.isPosixAbsolutePathBytes(packedDriveOpaque) || parityRuntime.serializeAbsolutePath(packedDriveOpaque) !== '/C:/workspace') {
    throw new Error('packed opaque POSIX drive-shaped roundtrip mismatch')
  }
  try { parityRuntime.pathUriToAbsolutePath(parityRuntime.pathUri('file:///%00/bad/path/L3RtcC__')); throw new Error('packed forged opaque URI accepted') } catch (error) {
    if (!(error instanceof parityRuntime.PathConversionError)) throw error
  }
  try { parityRuntime.pathUri('file:///work?query=yes'); throw new Error('packed PathUri accepted query') } catch (error) {
    if (!(error instanceof parityRuntime.PathConversionError)) throw error
  }
  const packedAction = {
    type: 'exec_command', id: 'packed', environmentId: 'local', command: ['echo', 'hi'], hookCommand: 'echo hi',
    cwd: parityRuntime.pathUri('file:///work'), sandboxPermissions: 'use_default', tty: false,
  }
  const packedRequest = parityRuntime.intoGuardianRequest(packedAction)
  const packedJson = parityRuntime.guardianApprovalRequestToJson(packedRequest)
  if (packedJson.tool !== 'exec_command' || packedJson.cwd !== '/work' || packedJson.tty !== false) {
    throw new Error('packed Guardian request serialization mismatch')
  }
  const packedFallbackJson = parityRuntime.guardianApprovalRequestToJson(parityRuntime.intoGuardianRequest({
    ...packedAction,id:'packed-opaque-fallback',cwd:parityRuntime.pathUri('file:///%00/bad/path/L3RtcC__'),
  }))
  if (packedFallbackJson.cwd !== '/\0/bad/path/L3RtcC__') {
    throw new Error('packed Guardian local opaque fallback mismatch')
  }
  if (parityRuntime.approvalCacheKeys(packedAction)[0]?.cwd !== 'file:///work') throw new Error('packed cache-key path mismatch')
  const packedMcp = { type: 'mcp_tool_call', id: 'packed-mcp', server: 'srv', toolName: 'tool', arguments: null, hookToolName: 'mcp__srv__tool', approvalPolicy: 'on-request', reviewer: 'auto_review', approvalMode: 'prompt', allowSessionRemember: false, allowPersistentApproval: false }
  if (parityRuntime.permissionRequestPayload(packedMcp).toolInput !== null) throw new Error('packed MCP explicit null arguments were defaulted')
  if (parityRuntime.shlexJoin(['printf', 'a\0b']) !== '<command included NUL byte>') throw new Error('packed shlex NUL mismatch')
  if (parityRuntime.parseCoreApprovalsReviewer('guardian_subagent') !== 'auto_review'
    || parityRuntime.parseCoreAskForApproval('on-failure') !== 'on-request'
    || parityRuntime.approvalRoute('on-request', 'auto_review', false) !== 'guardian') {
    throw new Error('packed approval protocol behavior mismatch')
  }
  try {
    parityRuntime.parseV2AskForApproval('on-failure')
    throw new Error('packed v2 protocol accepted core-only on-failure alias')
  } catch (error) {
    if (!(error instanceof parityRuntime.ApprovalProtocolError)) throw error
  }
  if (JSON.stringify(parityRuntime.effectiveExecAvailableDecisions({ kind:'command', call_id:'packed', turn_id:'', started_at_ms:1, command:[], cwd:'/work', parsed_cmd:[] }))
    !== JSON.stringify(['approved','abort'])) {
    throw new Error('packed effective approval decision mismatch')
  }
  if (!parityRuntime.guardianTruncateText('🙂'.repeat(100), 8).truncated) throw new Error('packed UTF-8 truncation mismatch')
  for (const file of ['guardian-policy-template.md', 'guardian-policy.md']) {
    const content = await readFile(join(packageRoot, 'policies/codex', file), 'utf8')
    if (content.length < 8_000) throw new Error(`packed ${file} is missing or truncated`)
  }
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== '@jhckevin/dsh-auto-review') throw new Error('packed manifest identity mismatch')
  const hostRoot = join(installRoot, 'node_modules/@jhckevin/dsh-auto-review-bridge-host')
  const hostManifest = JSON.parse(await readFile(join(hostRoot, 'package.json'), 'utf8'))
  if (hostManifest.version !== manifest.dependencies['@jhckevin/dsh-auto-review-bridge-host']) {
    throw new Error('packed native bridge dependency is not exact')
  }
  const host = await import(new URL(`file://${join(hostRoot, 'index.mjs')}`))
  if (typeof host.createCodexApprovalBridge !== 'function') throw new Error('packed bridge has no scoped lifecycle factory')
  const lockRoot = join(temporary, 'lock-consumer')
  await mkdir(lockRoot)
  await writeFile(join(lockRoot, 'package.json'), JSON.stringify(sourceManifest))
  await writeFile(join(lockRoot, 'package-lock.json'), JSON.stringify(lock))
  // The staged install above seeds npm's integrity cache. This proves the lock
  // graph can install offline, not that unpublished registry URLs are live.
  await exec('npm', ['ci', '--offline', '--ignore-scripts', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund'],
    { cwd: lockRoot, maxBuffer: 10 * 1024 * 1024 })
  const lockedHost = JSON.parse(await readFile(join(lockRoot, 'node_modules/@jhckevin/dsh-auto-review-bridge-host/package.json'), 'utf8'))
  assert.equal(lockedHost.version, hostManifest.version)
  process.stdout.write(`Packed artifact clean offline import: OK (${manifest.version})\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
