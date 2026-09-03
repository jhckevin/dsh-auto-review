import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMirrorEvidence } from './development-mirrors.mjs';
import { CARGO_CONFIG_SHA, verifyCargoConfigEvidence, verifyRustToolEvidence } from './development-rust-tools.mjs';

export const UPSTREAM = '9f97cb79eb15b38d24c552c56fe24e211ff9cf3a';
export const CRATE = 'codex-approval-protocol-bridge-prototype';
export const REQUIRED = ['sibling *_tests.rs layout', 'just fmt', 'just fix -p', 'just test via nextest', 'bazel-lock-update for Cargo.lock changes'];
export const MAX_LOG = 64 * 1024 * 1024;
export const BASE_FILES = Object.freeze({
  'codex-rs/.cargo/config.toml': CARGO_CONFIG_SHA,
  '.bazelrc': 'a07acea70aa081625abda8370f06cf905e3871e9c93cf68d46b44591d5508273',
  'MODULE.bazel': 'e0a9b1abbbd5d29305dc37b45008b417445120fc4e4f4a487137c4be3a82fc6d',
  '.github/scripts/run_bazel_with_buildbuddy.py': '9bde86d11cfd4271dadc0b942d6b2d2cd90c59600b7e807b66a14eb49b5e1fff',
  'AGENTS.md': 'c3f80e8386eb170b00af1e21de40d770c4941e464915687e728e2d14a7e79480',
  'justfile': '21ade5df7707bad66b7cad8e1e5e7517443554769ab833be88bdd7d07669e6d7',
  'scripts/format.py': 'd930139145ba3e80a188c1b5734aa7fee6bad5687e610cb58bda016216a2f37d',
  'scripts/check-module-bazel-lock.sh': 'a6c3842bb9c884ebd31dd79b99949e7c66b0f82a594dda87797013db572dc180',
  'codex-rs/rust-toolchain.toml': '570656042681cfd8795403a455baf9a33035331a07db0645e866bbcea89a3d64',
});
export const PLAN = Object.freeze([
  { id: 'just-version', tool: 'just', args: ['--version'], cwd: '.' },
  { id: 'cargo-version', tool: 'cargo', args: ['--version'], cwd: 'codex-rs' },
  { id: 'rustc-version', tool: 'rustc', args: ['-vV'], cwd: 'codex-rs' },
  { id: 'nextest-version', tool: 'cargo', args: ['nextest', '--version'], cwd: 'codex-rs' },
  { id: 'bazel-version', tool: 'bazel', args: ['version', '--gnu_format'], cwd: '.' },
  { id: 'python-version', tool: 'python3', args: ['--version'], cwd: '.' },
  { id: 'test', tool: 'just', args: ['test', '-p', CRATE], cwd: 'codex-rs' },
  { id: 'fix', tool: 'just', args: ['fix', '-p', CRATE], cwd: 'codex-rs' },
  { id: 'fmt', tool: 'just', args: ['fmt'], cwd: 'codex-rs' },
  { id: 'bazel-lock-update', tool: 'just', args: ['bazel-lock-update'], cwd: '.' },
  { id: 'bazel-lock-check', tool: 'just', args: ['bazel-lock-check'], cwd: '.' },
]);
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeRead(root, relative, maximum = MAX_LOG) {
  assert.equal(typeof relative, 'string');
  assert(relative.length > 0 && !isAbsolute(relative) && !relative.includes('\\') && !relative.includes('\0'));
  const parts = relative.split('/');
  assert(parts.every(p => p && p !== '.' && p !== '..'));
  let path = realpathSync(root);
  for (const part of parts) {
    path = join(path, part);
    assert(!lstatSync(path).isSymbolicLink(), 'symlink evidence forbidden');
  }
  const stat = lstatSync(path);
  assert(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'invalid evidence size/type');
  const bytes = readFileSync(path);
  assert.equal(bytes.length, stat.size);
  return bytes;
}
export const json = (root, path) => JSON.parse(safeRead(root, path, 1024 * 1024));
export function implementationHashes() {
  const base = fileURLToPath(new URL('.', import.meta.url));
  return Object.fromEntries(['development-runner.mjs', 'development-evidence.mjs', 'development-mirrors.mjs', 'development-mirrors.json', 'development-rust-tools.mjs'].map(name => [name, sha(readFileSync(resolve(base, name)))]));
}

// Validates source-bound execution records. The CI/executor filesystem remains a
// trust boundary: hashes are not signatures against a malicious same-UID operator.
export function verifyDevelopmentRun(root, manifest) {
  const result = json(root, 'result.json');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.upstreamCommit, UPSTREAM);
  assert.equal(manifest.upstreamCommit, UPSTREAM);
  assert.deepEqual(result.required, REQUIRED);
  assert.deepEqual(result.implementation, implementationHashes());
  assert.equal(result.status, 'completed');
  assert.equal(result.failure, null);
  assert.equal(result.sourceBefore.patchSha256, manifest.patchSha256);
  assert.equal(result.sourceBefore.cargoLockSha256, manifest.cargoLockSha256);
  assert.deepEqual(result.sourceBefore.baseFiles, BASE_FILES);
  for (const [name, digest] of Object.entries(BASE_FILES)) assert.equal(sha(safeRead(root, `base/${name}`)), digest);
  assert.deepEqual(result.sourceAfter, result.sourceBefore, 'source changed during execution; freeze/rebuild required');
  assert.equal(sha(safeRead(root, 'source.patch')), manifest.patchSha256);
  assert.equal(sha(safeRead(root, 'Cargo.lock')), manifest.cargoLockSha256);
  assert.equal(sha(safeRead(root, 'environment.json')), result.environmentSha256);
  const environment = json(root, 'environment.json');
  verifyCargoConfigEvidence(result.cargoConfiguration,environment);
  assert.equal(result.cargoConfiguration.source,result.transport.source);
  assert.equal(result.cargoConfiguration.output,result.transport.output);
  verifyRustToolEvidence(result.rustToolchain,environment,result.tools);
  verifyMirrorEvidence(root, result.transport, safeRead);
  assert.equal(environment.HOME, join(result.transport.output,'home'));
  assert.equal(environment.TMPDIR, join(result.transport.output,'tmp'));
  assert.equal(environment.PATH.split(':')[0], join(result.transport.output,'bazel','bin'));
  assert.equal(result.tools.bazel.path, join(result.transport.output,'bazel','bin','bazel'));
  assert.equal(result.tools.bazel.sha256, result.transport.files['bazel/bin/bazel']);
  assert.equal(result.tools.bazelUnderlying.path, result.transport.bazel);
  assert.equal(result.tools.bazelUnderlying.sha256, result.transport.bazelSha256);
  assert(isAbsolute(result.tools.bazelUnderlying.canonical));
  assert.equal(environment.CARGO_BUILD_JOBS, '1');
  assert.equal(environment.CARGO_INCREMENTAL, '0');
  assert.equal(environment.CARGO_PROFILE_DEV_DEBUG, '0');
  assert.equal(environment.CARGO_PROFILE_TEST_DEBUG, '0');
  assert.equal(environment.CARGO_NET_OFFLINE, 'true');
  assert.equal(environment.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(environment.CODEX_BRIDGE_PATCH_SHA256, manifest.patchSha256);
  assert.equal(environment.UV_DEFAULT_INDEX, 'https://pypi.tuna.tsinghua.edu.cn/simple');
  const allowed = new Set(['PATH','HOME','TMPDIR','LANG','LC_ALL','CARGO_HOME','RUSTUP_HOME','CARGO_TARGET_DIR','CARGO_BUILD_JOBS','CARGO_INCREMENTAL','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_TEST_DEBUG','CARGO_NET_OFFLINE','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_NO_REPLACE_OBJECTS','CODEX_BRIDGE_PATCH_SHA256','UV_DEFAULT_INDEX','UV_CACHE_DIR','DOTSLASH_CACHE']);
  for (const key of ['UV_CACHE_DIR','DOTSLASH_CACHE']) if(environment[key]!==undefined) assert(/^\/[A-Za-z0-9_./+-]+$/.test(environment[key]),'invalid tool-cache evidence path');
  assert(Object.keys(environment).every(key => allowed.has(key)), 'unexpected inherited environment');
  assert.equal(environment.RUSTUP_TOOLCHAIN, undefined, 'artifact toolchain override is diagnostic, not strict upstream development acceptance');
  assert.equal(result.layout.accepted, true);
  assert.equal(result.layout.path, `codex-rs/approval-protocol-bridge-prototype/src/main_tests.rs`);
  assert.equal(sha(safeRead(root, 'layout-main.rs')), result.layout.mainSha256);
  assert.equal(sha(safeRead(root, 'layout-main_tests.rs')), result.layout.testsSha256);
  const main = safeRead(root, 'layout-main.rs').toString('utf8');
  const tests = safeRead(root, 'layout-main_tests.rs').toString('utf8');
  assert(/#\[cfg\(test\)\]\s*#\[path\s*=\s*"main_tests\.rs"\]\s*mod\s+tests\s*;/.test(main), 'missing sibling test module');
  assert(!/mod\s+tests\s*\{/.test(main), 'inline test module');
  assert(/#\[test\]/.test(tests), 'no actual unit tests');
  assert(Array.isArray(result.steps) && result.steps.length === PLAN.length, 'incomplete commands');
  let lastEnd = 0;
  for (let i = 0; i < PLAN.length; i++) {
    const step = result.steps[i];
    assert.deepEqual(step.spec, PLAN[i], 'command/argument/order drift');
    assert.equal(step.exitCode, 0);
    assert.equal(step.signal, null);
    assert.equal(step.spawnError, null);
    assert.equal(step.overflow, false);
    assert(Number.isFinite(step.startedMs) && step.startedMs >= lastEnd);
    assert(Number.isFinite(step.endedMs) && step.endedMs >= step.startedMs);
    lastEnd = step.endedMs;
    assert.deepEqual(step.sourceBefore, result.sourceBefore);
    assert.deepEqual(step.sourceAfter, result.sourceBefore);
    assert.equal(step.log, `logs/${String(i).padStart(2, '0')}-${PLAN[i].id}.log`);
    const log = safeRead(root, step.log);
    assert.equal(log.length, step.logBytes);
    assert.equal(sha(log), step.logSha256);
    const text = log.toString('utf8');
    assert(text.startsWith(`DEVELOPMENT-STEP-BEGIN ${PLAN[i].id}\n`));
    assert(text.endsWith(`\nDEVELOPMENT-STEP-END ${PLAN[i].id} exit=0 signal=null\n`));
    if (PLAN[i].id === 'rustc-version') {
      assert(/^rustc 1\.95\.0 /m.test(text), 'fixed upstream Rust 1.95.0 was not executed');
      assert(text.includes(`rustc ${manifest.rustc}\n`), 'executed rustc differs from artifact provenance');
    }
    if (PLAN[i].id === 'nextest-version') assert(/^cargo-nextest \d+\.\d+\.\d+/m.test(text), 'nextest version missing');
    assert.equal(step.toolSha256, result.tools[PLAN[i].tool].sha256);
    assert.equal(step.executable, result.tools[PLAN[i].tool].path);
    assert(isAbsolute(step.executable) && /^[a-f0-9]{64}$/.test(step.toolSha256));
  }
  return { accepted: true, scope: 'fixed bridge upstream development workflow only', steps: result.steps.length };
}

export function inspectExecutedDevelopmentEvidence(platformRoot) {
  try {
    const manifest = json(platformRoot, 'artifact-manifest.json');
    safeRead(platformRoot, 'provenance/development-execution/result.json', 1024 * 1024);
    // The fixed directory is not selectable by untrusted JSON metadata.
    const evidence = resolve(platformRoot, 'provenance/development-execution');
    assert(!lstatSync(evidence).isSymbolicLink());
    return verifyDevelopmentRun(evidence, manifest);
  } catch (error) {
    return { accepted: false, reason: `UPSTREAM-DEVELOPMENT-GATE-FAIL: ${error.message}` };
  }
}
