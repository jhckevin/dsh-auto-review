import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const policyBytes = () => readFileSync(new URL('./development-mirrors.json', import.meta.url));
export function canonicalDirectory(path) {
  assert(typeof path === 'string' && /^\/[A-Za-z0-9_./+-]+$/.test(path), 'cache/path must use safe absolute characters');
  assert(isAbsolute(path) && path === realpathSync(path) && lstatSync(path).isDirectory(), 'cache/path must be canonical directory');
  return path;
}
export function validatePolicy(policy) {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.upstreamCommit, '9f97cb79eb15b38d24c552c56fe24e211ff9cf3a');
  assert(/^[a-f0-9]{64}$/.test(policy.moduleLockSha256));
  assert(Array.isArray(policy.resources) && policy.resources.length > 0);
  const seen = new Set();
  for (const item of policy.resources) {
    assert.deepEqual(Object.keys(item).sort(), ['mirror','sha256','url']);
    assert(/^[a-f0-9]{64}$/.test(item.sha256));
    assert(/^https:\/\/(bcr\.bazel\.build|github\.com|static\.rust-lang\.org)\/[A-Za-z0-9_./+-]+$/.test(item.url));
    assert(!seen.has(item.url), 'duplicate resource URL'); seen.add(item.url);
    const expected = item.url.startsWith('https://bcr.bazel.build/')
      ? 'https://gh-proxy.com/https://raw.githubusercontent.com/bazelbuild/bazel-central-registry/main/' + item.url.slice('https://bcr.bazel.build/'.length)
      : item.url.startsWith('https://static.rust-lang.org/')
        ? item.url.replace('https://static.rust-lang.org/', 'https://rsproxy.cn/')
        : 'https://gh-proxy.com/' + item.url;
    assert(item.mirror === expected || (item.url.startsWith('https://github.com/') && item.mirror === 'https://ghfast.top/' + item.url), 'unapproved mirror mapping');
  }
  return policy;
}
const exactPattern = url => '^' + url.slice('https://'.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
export function renderTransport({ source, output, cache, bazel, policy }) {
  validatePolicy(policy);
  for (const value of [source,output,cache,bazel]) assert(/^\/[A-Za-z0-9_./+-]+$/.test(value), 'unsafe template path');
  const config = [
    'startup --batch', 'startup --host_jvm_args=-Xmx512m', `startup --output_user_root=${output}/bazel/output-root`,
    'common --jobs=1', `common --downloader_config=${output}/bazel/downloader.cfg`,
    `common --repository_cache=${cache}`, `common --repo_contents_cache=${output}/bazel/repo-contents`,
    `common --disk_cache=${output}/bazel/disk-cache`, '',
  ].join('\n');
  const downloader = [
    ...policy.resources.map(item => `rewrite ${exactPattern(item.url)} ${item.mirror.slice('https://'.length)}`),
    'allow gh-proxy.com', 'allow ghfast.top', 'allow rsproxy.cn', 'block *',
    'all_blocked_message Frozen development mirror policy rejects unassessed resource.', '',
  ].join('\n');
  const wrapper = `#!/bin/sh\nexec '${bazel}' --nosystem_rc --nohome_rc --noworkspace_rc --bazelrc='${source}/.bazelrc' --bazelrc='${output}/bazel/config.bazelrc' "$@"\n`;
  return { config, downloader, wrapper };
}
export function assertNoUserBazelrc(source) {
  // Upstream has exactly this optional import. Never accept user-defined flags.
  assert(!existsSync(join(source, 'user.bazelrc')), 'user.bazelrc is forbidden in controlled workflow');
  try { lstatSync(join(source, 'user.bazelrc')); assert.fail('dangling user.bazelrc forbidden'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function prepareMirrors({ source, output, cache, bazel }) {
  canonicalDirectory(source); canonicalDirectory(output); canonicalDirectory(cache);
  assertNoUserBazelrc(source);
  const bytes = policyBytes(), policy = validatePolicy(JSON.parse(bytes));
  assert.equal(digest(readFileSync(join(source,'MODULE.bazel.lock'))), policy.moduleLockSha256, 'mirror policy lock drift');
  const lock = JSON.parse(readFileSync(join(source,'MODULE.bazel.lock')));
  const expected = Object.entries(lock.registryFileHashes).map(([url,sha256]) => ({url,sha256})).sort((a,b)=>a.url.localeCompare(b.url));
  const actual = policy.resources.filter(r=>r.url.startsWith('https://bcr.bazel.build/')).map(({url,sha256})=>({url,sha256})).sort((a,b)=>a.url.localeCompare(b.url));
  assert.deepEqual(actual,expected,'registry mirror policy must cover exactly pinned metadata');
  const rendered = renderTransport({source,output,cache,bazel,policy});
  mkdirSync(join(output,'bazel'),{mode:0o700}); mkdirSync(join(output,'bazel','bin'),{mode:0o700});
  const files = { 'bazel/policy.json': bytes, 'bazel/config.bazelrc': rendered.config, 'bazel/downloader.cfg':rendered.downloader, 'bazel/bin/bazel':rendered.wrapper };
  const hashes={};
  for (const [name,value] of Object.entries(files)) { writeFileSync(join(output,name),value,{flag:'wx',mode:name.endsWith('/bazel')?0o700:0o600}); hashes[name]=digest(value); }
  return { source, output, cache, bazel, bazelSha256:digest(readFileSync(realpathSync(bazel))), files:hashes };
}
export function verifyMirrorEvidence(root, transport, readSafe) {
  assert(transport && typeof transport==='object', 'missing mirror evidence');
  const policy=validatePolicy(JSON.parse(policyBytes()));
  assert.equal(digest(readSafe(root,'bazel/policy.json')),digest(policyBytes()),'mirror policy changed');
  const rendered=renderTransport({...transport,policy});
  const expected={ 'bazel/policy.json':policyBytes(), 'bazel/config.bazelrc':rendered.config, 'bazel/downloader.cfg':rendered.downloader, 'bazel/bin/bazel':rendered.wrapper };
  assert.deepEqual(Object.keys(transport.files).sort(),Object.keys(expected).sort());
  for(const [file,bytes] of Object.entries(expected)) { assert.equal(transport.files[file],digest(bytes)); assert.equal(digest(readSafe(root,file)),digest(bytes)); }
  assert(/^[a-f0-9]{64}$/.test(transport.bazelSha256));
  return true;
}
