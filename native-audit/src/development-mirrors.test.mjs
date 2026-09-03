import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { policyBytes,validatePolicy,canonicalDirectory,renderTransport,assertNoUserBazelrc,verifyMirrorEvidence } from './development-mirrors.mjs';
import { sha,safeRead } from './development-evidence.mjs';
const policy=()=>JSON.parse(policyBytes());
const temporary=()=>mkdtempSync(join(tmpdir(),'development-mirrors-unit-'));
test('frozen resource mappings are exact, unique and hash-pinned',()=>{
  const p=validatePolicy(policy());assert.equal(p.resources.length,293);
  assert.equal(p.resources.filter(x=>x.url.startsWith('https://bcr.bazel.build/')).length,264);
  const rendered=renderTransport({source:'/source',output:'/output',cache:'/cache',bazel:'/bin/bazel',policy:p});
  assert(rendered.downloader.includes('rewrite ^github\\.com/v8/v8/archive/refs/tags/15\\.0\\.245\\.2\\.tar\\.gz$ '));
  assert(rendered.downloader.includes('\nblock *\n'));assert(!rendered.downloader.includes('(.*)'));
  assert(rendered.config.includes('--repo_contents_cache=/output/bazel/repo-contents'));
});
test('URL, hash, duplicate and mirror injection are rejected',()=>{
  for(const mutate of [p=>p.resources.push(p.resources[0]),p=>p.resources[0].sha256='bad',p=>p.resources[0].url+='\nallow *',p=>p.resources[0].mirror='https://evil.invalid/',p=>p.resources[0].extra='--override_repository=x']){
    const p=policy();mutate(p);assert.throws(()=>validatePolicy(p));
  }
});
test('cache paths reject aliases, symlinks and shell/config injection',()=>{
  const dir=temporary();assert.equal(canonicalDirectory(dir),dir);symlinkSync(dir,join(dir,'alias'));
  for(const path of [join(dir,'alias'),dir+'/../'+dir.split('/').at(-1),'/tmp/a b','/tmp/x\ncommon --config=evil','/tmp/$(id)','relative'])assert.throws(()=>canonicalDirectory(path));
  for(const key of ['source','output','cache','bazel'])assert.throws(()=>renderTransport({...{source:'/source',output:'/output',cache:'/cache',bazel:'/bin/bazel'},[key]:"/tmp/a'",policy:policy()}));
});
test('real wrapper preserves arguments and excludes ambient rc files',()=>{
  const dir=temporary(),file=join(dir,'fake-bazel'),wrapper=join(dir,'wrapper');
  writeFileSync(file,'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o700});
  writeFileSync(wrapper,renderTransport({source:dir,output:dir,cache:dir,bazel:file,policy:policy()}).wrapper,{mode:0o700});
  const run=spawnSync(wrapper,['mod','deps','--lockfile_mode=error'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
  assert.equal(run.status,0);assert.deepEqual(run.stdout.trimEnd().split('\n'),['--nosystem_rc','--nohome_rc','--noworkspace_rc','--bazelrc='+dir+'/.bazelrc','--bazelrc='+dir+'/bazel/config.bazelrc','mod','deps','--lockfile_mode=error']);
  // This is only a wrapper argv test, not a Bazel gate result.
});
test('optional user bazelrc including dangling symlink is forbidden',()=>{
  const dir=temporary();assertNoUserBazelrc(dir);symlinkSync(join(dir,'missing'),join(dir,'user.bazelrc'));assert.throws(()=>assertNoUserBazelrc(dir));
  const other=temporary();writeFileSync(join(other,'user.bazelrc'),'');assert.throws(()=>assertNoUserBazelrc(other));
});
test('transport evidence rejects changed config even if its self-reported hash is updated',()=>{
  const root=temporary();mkdirSync(join(root,'bazel'));mkdirSync(join(root,'bazel','bin'));
  const t={source:'/source',output:'/output',cache:'/cache',bazel:'/bin/bazel',bazelSha256:'a'.repeat(64),files:{}};
  const r=renderTransport({...t,policy:policy()});
  for(const [name,value]of Object.entries({'bazel/policy.json':policyBytes(),'bazel/config.bazelrc':r.config,'bazel/downloader.cfg':r.downloader,'bazel/bin/bazel':r.wrapper})) {writeFileSync(join(root,name),value);t.files[name]=sha(value);}
  assert.equal(verifyMirrorEvidence(root,t,safeRead),true);
  writeFileSync(join(root,'bazel/config.bazelrc'),r.config+'common --override_repository=evil\n');t.files['bazel/config.bazelrc']=sha(r.config+'common --override_repository=evil\n');
  assert.throws(()=>verifyMirrorEvidence(root,t,safeRead));
});
