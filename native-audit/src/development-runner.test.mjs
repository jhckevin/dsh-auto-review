import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanEnvironment, bindPatchEnvironment, executeStep, checkLayout, runDevelopment } from './development-runner.mjs';
import { safeRead, inspectExecutedDevelopmentEvidence, verifyDevelopmentRun, implementationHashes, UPSTREAM, REQUIRED, PLAN, sha } from './development-evidence.mjs';

// Small disposable evidence fixtures only. No mocked just/cargo success is used
// as real upstream development evidence, and these tests never run Rust builds.
const temporary = () => mkdtempSync(join(tmpdir(), 'development-runner-unit-'));
test('Bazel version uses a command compatible with preceding controlled startup flags',()=>{
  assert.deepEqual(PLAN.find(s=>s.id==='bazel-version').args,['version','--gnu_format']);
});
test('formatter cache directory overrides are canonical only; all Rust toolchain overrides rejected',()=>{
  const cache=temporary();
  const env=cleanEnvironment(temporary(),{PATH:'/usr/bin:/bin',UV_CACHE_DIR:cache,DOTSLASH_CACHE:cache});
  assert.equal(env.UV_CACHE_DIR,cache);assert.equal(env.DOTSLASH_CACHE,cache);
  symlinkSync(cache,join(cache,'alias'));
  for(const key of ['UV_CACHE_DIR','DOTSLASH_CACHE']) for(const value of ['relative',join(cache,'alias'),'/tmp/cache\nconfig']) assert.throws(()=>cleanEnvironment(temporary(),{PATH:'/usr/bin:/bin',[key]:value}));
  for(const value of ['1.95.0','1.96.0','stable',''])assert.throws(()=>cleanEnvironment(temporary(),{PATH:'/usr/bin:/bin',RUSTUP_TOOLCHAIN:value}));
});
test('compile-time patch SHA is derived, not inherited, and uv mirror is fixed', () => {
  const env = cleanEnvironment(temporary(), { PATH: '/usr/bin:/bin', CODEX_BRIDGE_PATCH_SHA256: 'forged', UV_DEFAULT_INDEX: 'https://untrusted.invalid/simple' });
  assert.equal(env.CODEX_BRIDGE_PATCH_SHA256, undefined);
  assert.equal(env.UV_DEFAULT_INDEX, 'https://pypi.tuna.tsinghua.edu.cn/simple');
  const digest = sha('actual frozen patch fixture');
  assert.equal(bindPatchEnvironment(env, digest).CODEX_BRIDGE_PATCH_SHA256, digest);
  assert.equal(bindPatchEnvironment({ ...env, CODEX_BRIDGE_PATCH_SHA256: 'forged' }, digest).CODEX_BRIDGE_PATCH_SHA256, digest);
  for (const bad of ['', 'forged', 'a'.repeat(63), 'g'.repeat(64)]) assert.throws(() => bindPatchEnvironment(env, bad));
});
test('environment excludes credentials, proxies, injection flags and inherited HOME', () => {
  const dir = temporary();
  const env = cleanEnvironment(dir, { PATH: '/usr/bin:/bin', HOME: '/private', API_KEY: 'fixture', HTTPS_PROXY: 'fixture', NODE_OPTIONS: '--bad', LD_PRELOAD: '/bad', RUSTFLAGS: 'bad' });
  assert.equal(env.HOME, join(dir, 'home'));
  assert.equal(env.CARGO_BUILD_JOBS, '1');
  for (const key of ['API_KEY','HTTPS_PROXY','NODE_OPTIONS','LD_PRELOAD','RUSTFLAGS']) assert.equal(env[key], undefined);
  assert.throws(() => cleanEnvironment(dir, { PATH: '/usr/bin:' }));
  assert.throws(() => cleanEnvironment(dir, { PATH: './bin' }));
  assert.throws(() => cleanEnvironment(dir, { PATH: '/usr/bin', CARGO_HOME: 'relative' }));
});
test('real subprocess exit zero has complete stdout stderr and footer', async () => {
  const dir = temporary();
  const logFile = join(dir, 'log');
  const result = await executeStep(process.execPath, ['-e', 'process.stdout.write("actual-out");process.stderr.write("actual-err")'], { cwd: dir, env: { PATH: '/usr/bin:/bin' }, logFile, id: 'unit' });
  const log = readFileSync(logFile, 'utf8');
  assert.equal(result.exitCode, 0);
  assert.equal(result.spawnError, null);
  assert.equal(result.overflow, false);
  assert(log.includes('actual-out') && log.includes('actual-err'));
  assert(log.endsWith('DEVELOPMENT-STEP-END unit exit=0 signal=null\n'));
  assert.equal(result.logSha256, sha(log));
  assert.equal(result.logBytes, Buffer.byteLength(log));
});
test('real nonzero execution is preserved, not normalized to pass', async () => {
  const dir = temporary();
  const result = await executeStep(process.execPath, ['-e', 'console.error("actual-failure");process.exit(7)'], { cwd: dir, env: {}, logFile: join(dir, 'log'), id: 'unit' });
  assert.equal(result.exitCode, 7);
  assert(readFileSync(join(dir, 'log'), 'utf8').includes('actual-failure'));
});
test('missing executable is a recorded failure', async () => {
  const dir = temporary();
  const result = await executeStep(join(dir, 'absent'), [], { cwd: dir, env: {}, logFile: join(dir, 'log'), id: 'unit' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.spawnError, /ENOENT/);
});
test('large log is drained, bounded and marked failure', async () => {
  const dir = temporary();
  const result = await executeStep(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000));console.error("end")'], { cwd: dir, env: {}, logFile: join(dir, 'log'), id: 'unit', maxLog: 1024 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.overflow, true);
  assert(result.logBytes <= 1024);
});
test('existing log/evidence directories are never overwritten', async () => {
  const dir = temporary();
  const log = join(dir, 'log');
  writeFileSync(log, 'preserve');
  await assert.rejects(executeStep(process.execPath, [], { cwd: dir, env: {}, logFile: log, id: 'unit' }), /EEXIST/);
  assert.equal(readFileSync(log, 'utf8'), 'preserve');
  await assert.rejects(runDevelopment({ source: dir, output: dir, patchFile: log }), /outside source/);
});
test('safe evidence rejects traversal, symlink, empty, oversized and directory paths', () => {
  const dir = temporary();
  writeFileSync(join(dir, 'good'), 'good');
  writeFileSync(join(dir, 'empty'), '');
  symlinkSync(join(dir, 'good'), join(dir, 'link'));
  mkdirSync(join(dir, 'directory'));
  for (const name of ['../good','/absolute','x/../good','link','empty','directory','x\\y']) assert.throws(() => safeRead(dir, name));
  assert.throws(() => safeRead(dir, 'good', 3));
});
test('layout requires sibling actual tests, not inline module', () => {
  const dir = temporary();
  const src = join(dir, 'codex-rs/approval-protocol-bridge-prototype/src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'main.rs'), '#[cfg(test)]\nmod tests {}');
  writeFileSync(join(src, 'main_tests.rs'), '#[test]\nfn test_fixture() {}');
  assert.throws(() => checkLayout(dir), /sibling/);
  writeFileSync(join(src, 'main.rs'), '#[cfg(test)]\n#[path = "main_tests.rs"]\nmod tests;');
  assert.equal(checkLayout(dir).record.accepted, true);
  writeFileSync(join(src, 'main_tests.rs'), '// empty test file');
  assert.throws(() => checkLayout(dir), /missing/);
});
test('missing execution evidence is fail-closed, not a pending pass', () => {
  assert.equal(inspectExecutedDevelopmentEvidence(temporary()).accepted, false);
});
test('handwritten passed/status cannot satisfy actual records', () => {
  const dir = temporary();
  const manifest = { upstreamCommit: UPSTREAM, patchSha256: 'a'.repeat(64), cargoLockSha256: 'b'.repeat(64) };
  const base = { schemaVersion: 1, upstreamCommit: UPSTREAM, required: REQUIRED, implementation: implementationHashes(), status: 'completed', failure: null, sourceBefore: { patchSha256: manifest.patchSha256, cargoLockSha256: manifest.cargoLockSha256 }, sourceAfter: { patchSha256: manifest.patchSha256, cargoLockSha256: manifest.cargoLockSha256 }, steps: PLAN.map(spec => ({ spec, exitCode: 0 })) };
  for (const mutation of [{}, {status:'passed'}, {upstreamCommit:'bad'}, {implementation:{}}, {required:[]}, {sourceAfter:{}}]) {
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...base, ...mutation }));
    assert.throws(() => verifyDevelopmentRun(dir, manifest));
  }
});
