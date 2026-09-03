import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, realpathSync, lstatSync, openSync, writeSync, closeSync, constants, accessSync } from 'node:fs';
import { join, resolve, isAbsolute, delimiter, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UPSTREAM, CRATE, REQUIRED, PLAN, BASE_FILES, MAX_LOG, sha, safeRead, implementationHashes } from './development-evidence.mjs';

export function cleanEnvironment(output, provided = process.env) {
  const env = { PATH: provided.PATH ?? '/usr/bin:/bin', HOME: join(output, 'home'), TMPDIR: join(output, 'tmp'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', CARGO_BUILD_JOBS: '1', CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0', CARGO_NET_OFFLINE: 'true', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.UV_DEFAULT_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple';
  assert(env.PATH.split(delimiter).every(p => p && isAbsolute(p)), 'PATH must contain absolute nonempty directories');
  for (const key of ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR']) {
    if (provided[key] !== undefined) {
      assert(isAbsolute(provided[key]), `${key} must be absolute`);
      env[key] = realpathSync(provided[key]);
    }
  }
  if (provided.RUSTUP_TOOLCHAIN !== undefined) {
    assert.equal(provided.RUSTUP_TOOLCHAIN, '1.96.0', 'only frozen artifact toolchain override is supported');
    env.RUSTUP_TOOLCHAIN = provided.RUSTUP_TOOLCHAIN;
  }
  env.CARGO_TARGET_DIR ??= join(output, 'target');
  return env;
}

export function bindPatchEnvironment(env, patchSha256) {
  assert(/^[a-f0-9]{64}$/.test(patchSha256), 'invalid frozen patch SHA');
  return { ...env, CODEX_BRIDGE_PATCH_SHA256: patchSha256 };
}

export function locateTool(name, env) {
  for (const directory of env.PATH.split(delimiter)) {
    const file = join(directory, name);
    try {
      accessSync(file, constants.X_OK);
      const canonical = realpathSync(file);
      assert(lstatSync(canonical).isFile());
      // Keep invocation basename (cargo/rustc can be rustup symlinks).
      return { path: file, canonical, sha256: sha(readFileSync(canonical)) };
    } catch { /* continue PATH search */ }
  }
  throw new Error(`required tool unavailable: ${name}`);
}

export function sourceSnapshot(source, env) {
  const git = args => execFileSync('git', ['--no-optional-locks', ...args], { cwd: source, env, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), UPSTREAM, 'source HEAD must be fixed upstream');
  assert.equal(git(['ls-files', '--others', '--exclude-standard']).length, 0, 'untracked source must be staged before execution');
  const patch = git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD']);
  const names = git(['diff', '--name-only', 'HEAD']).toString().trim().split('\n');
  assert(names.length > 0 && names.every(n => n === 'codex-rs/Cargo.toml' || n === 'codex-rs/Cargo.lock' || n === 'MODULE.bazel.lock' || n.startsWith('codex-rs/approval-protocol-bridge-prototype/')), 'out-of-scope source changes need a separate plan');
  const lock = safeRead(source, 'codex-rs/Cargo.lock');
  const baseFiles = {};
  for (const [name, digest] of Object.entries(BASE_FILES)) {
    baseFiles[name] = sha(safeRead(source, name));
    assert.equal(baseFiles[name], digest, `fixed workflow source changed: ${name}`);
  }
  return { state: { patchSha256: sha(patch), cargoLockSha256: sha(lock), changedFiles: names, baseFiles }, patch, lock };
}

export function checkLayout(source) {
  const main = safeRead(source, 'codex-rs/approval-protocol-bridge-prototype/src/main.rs');
  const tests = safeRead(source, 'codex-rs/approval-protocol-bridge-prototype/src/main_tests.rs');
  assert(/#\[cfg\(test\)\]\s*#\[path\s*=\s*"main_tests\.rs"\]\s*mod\s+tests\s*;/.test(main.toString()), 'main.rs must declare sibling main_tests.rs');
  assert(!/mod\s+tests\s*\{/.test(main.toString()), 'inline unit tests are not accepted');
  assert(/#\[test\]/.test(tests.toString()), 'unit tests missing');
  return { main, tests, record: { accepted: true, path: 'codex-rs/approval-protocol-bridge-prototype/src/main_tests.rs', mainSha256: sha(main), testsSha256: sha(tests) } };
}

// Also exported for small real-process tests. The CLI has no command override.
// Log overflow drains/discards excess and fails; it never kills Rust by PID.
export async function executeStep(executable, args, { cwd, env, logFile, id, maxLog = MAX_LOG }) {
  assert(Number.isSafeInteger(maxLog) && maxLog >= 1024 && maxLog <= MAX_LOG);
  const fd = openSync(logFile, 'wx', 0o600);
  let logBytes = 0, overflow = false, spawnError = null;
  const append = bytes => {
    bytes = Buffer.from(bytes);
    const room = maxLog - 256 - logBytes;
    if (bytes.length > room) overflow = true;
    const part = bytes.subarray(0, Math.max(0, room));
    if (part.length) {
      try { writeSync(fd, part); logBytes += part.length; }
      catch (error) { spawnError ??= `log write failed: ${error.message}`; overflow = true; }
    }
  };
  const startedMs = performance.now();
  let exitCode = null, signal = null;
  try {
    append(`DEVELOPMENT-STEP-BEGIN ${id}\n`);
    await new Promise(resolveDone => {
      let child;
      try { child = spawn(executable, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (error) { spawnError = error.message; append(`spawn error: ${error.message}\n`); resolveDone(); return; }
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', error => { spawnError = error.message; append(`spawn error: ${error.message}\n`); });
      child.on('close', (code, killedBy) => { exitCode = code; signal = killedBy; resolveDone(); });
    });
    const footer = Buffer.from(`\nDEVELOPMENT-STEP-END ${id} exit=${exitCode} signal=${signal}\n`);
    writeSync(fd, footer); logBytes += footer.length;
  } finally { closeSync(fd); }
  return { exitCode, signal, spawnError, overflow, startedMs, endedMs: performance.now(), logBytes, logSha256: sha(readFileSync(logFile)) };
}

export async function runDevelopment({ source, output, patchFile }) {
  assert(process.platform === 'linux' && process.arch === 'x64', 'Linux x86_64 only');
  assert(isAbsolute(source) && source === realpathSync(source), 'source must be canonical absolute directory');
  assert(isAbsolute(output) && output === resolve(output), 'output must be absolute');
  assert(realpathSync(resolve(output, '..')) === resolve(output, '..'), 'output parent must be canonical');
  assert(!output.startsWith(source + '/') && output !== source, 'output must be outside source');
  // mkdir without recursive refuses reuse and symlink targets; never delete evidence.
  mkdirSync(output, { mode: 0o700 });
  for (const name of ['logs', 'home', 'tmp', 'target']) mkdirSync(join(output, name), { mode: 0o700 });
  const result = { schemaVersion: 1, upstreamCommit: UPSTREAM, required: REQUIRED, implementation: implementationHashes(), status: 'running', failure: null, tools: {}, steps: [], sourceBefore: null, sourceAfter: null, layout: { accepted: false }, environmentSha256: null };
  const persist = () => writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  persist();
  try {
    // This compile-time field comes only from the supplied frozen patch bytes,
    // never an inherited user value. sourceSnapshot below must match the bytes.
    const env = bindPatchEnvironment(cleanEnvironment(output), sha(readFileSync(patchFile)));
    const environment = JSON.stringify(env, null, 2) + '\n';
    writeFileSync(join(output, 'environment.json'), environment, { flag: 'wx', mode: 0o600 });
    result.environmentSha256 = sha(environment);
    const before = sourceSnapshot(source, env);
    assert.equal(before.state.patchSha256, sha(readFileSync(patchFile)), 'frozen patch mismatch');
    result.sourceBefore = before.state;
    writeFileSync(join(output, 'source.patch'), before.patch, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(output, 'Cargo.lock'), before.lock, { flag: 'wx', mode: 0o600 });
    for (const name of Object.keys(BASE_FILES)) {
      const target = join(output, 'base', name);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, safeRead(source, name), { flag: 'wx', mode: 0o600 });
    }
    const layout = checkLayout(source);
    result.layout = layout.record;
    writeFileSync(join(output, 'layout-main.rs'), layout.main, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(output, 'layout-main_tests.rs'), layout.tests, { flag: 'wx', mode: 0o600 });
    for (const tool of new Set(PLAN.map(s => s.tool))) result.tools[tool] = locateTool(tool, env);
    persist();
    for (let i = 0; i < PLAN.length; i++) {
      const spec = PLAN[i];
      const sourceBefore = sourceSnapshot(source, env).state;
      assert.deepEqual(sourceBefore, result.sourceBefore, 'source drift before command');
      const tool = result.tools[spec.tool];
      assert.equal(sha(readFileSync(realpathSync(tool.path))), tool.sha256, 'tool changed before execution');
      const log = `logs/${String(i).padStart(2, '0')}-${spec.id}.log`;
      const step = await executeStep(tool.path, spec.args, { cwd: resolve(source, spec.cwd), env, logFile: join(output, log), id: spec.id });
      const sourceAfter = sourceSnapshot(source, env).state;
      result.steps.push({ spec, executable: tool.path, toolSha256: tool.sha256, log, sourceBefore, sourceAfter, ...step });
      result.sourceAfter = sourceAfter;
      persist();
      assert(step.exitCode === 0 && step.signal === null && step.spawnError === null && !step.overflow, `step failed: ${spec.id}`);
      assert.deepEqual(sourceAfter, result.sourceBefore, 'source changed: freeze new patch and rebuild before acceptance; tests are not automatically rerun');
    }
    result.status = 'completed';
  } catch (error) {
    result.status = 'failed';
    result.failure = error.message;
  } finally { persist(); }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, output, patchFile, ...extra] = process.argv.slice(2);
  if (!source || !output || !patchFile || extra.length) throw new Error('usage: node development-runner.mjs ABS_SOURCE NEW_ABS_OUTPUT FROZEN_PATCH');
  const result = await runDevelopment({ source, output, patchFile });
  console.log(JSON.stringify({ status: result.status, failure: result.failure, steps: result.steps.length, output }));
  process.exitCode = result.status === 'completed' ? 0 : 1;
}
