import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { inspectLicenseEvidence, inspectDevelopmentEvidence } from './src/evidence-gates.mjs';

const UPSTREAM='9f97cb79eb15b38d24c552c56fe24e211ff9cf3a';
const PLATFORM='@jhckevin/dsh-auto-review-bridge-linux-x64-gnu';
const HOST='@jhckevin/dsh-auto-review-bridge-host';
const MODULES=['evidence-gates.mjs','development-evidence.mjs','development-runner.mjs','development-mirrors.mjs','development-mirrors.json','development-rust-tools.mjs','license-evidence.py','launcher-evidence.py'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function canonicalRoot(root) {
  assert(typeof root==='string'&&isAbsolute(root)&&realpathSync(root)===root&&lstatSync(root).isDirectory(),'root must be an existing canonical absolute directory');
  return root;
}
export function readPackageFile(root,relative,max=16*1024*1024) {
  canonicalRoot(root);assert(typeof relative==='string'&&!isAbsolute(relative)&&relative.length<512);
  const parts=relative.split('/');assert(parts.every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\\')&&!p.includes('\0')),'unsafe package path');
  let path=root;for(const part of parts){path=join(path,part);assert(!lstatSync(path).isSymbolicLink(),'package symlink forbidden');}
  assert(lstatSync(path).isFile(),'package file must be regular');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const stat=fstatSync(fd);assert(stat.isFile()&&stat.size>0&&stat.size<=max,'invalid package file size/type');const bytes=readFileSync(fd);assert.equal(bytes.length,stat.size);return bytes;}finally{closeSync(fd);}
}
const json=(root,file)=>JSON.parse(readPackageFile(root,file,1024*1024));
export function verifyPackagePins(platformRoot,hostRoot,auditRoot) {
  for(const root of [platformRoot,hostRoot,auditRoot])canonicalRoot(root);
  const metadata=json(platformRoot,'package.json'),host=json(hostRoot,'package.json'),manifest=json(platformRoot,'artifact-manifest.json'),pins=json(hostRoot,'expected-provenance.json');
  assert.equal(metadata.name,PLATFORM);assert.equal(host.name,HOST);assert.equal(host.version,metadata.version);
  assert.equal(host.optionalDependencies?.[PLATFORM],metadata.version);
  assert.deepEqual(metadata,pins.package);assert.deepEqual(manifest,pins.manifest);
  assert.deepEqual(host,json(auditRoot,'packages/host/package.json'));
  assert.deepEqual(pins,json(auditRoot,'packages/host/expected-provenance.json'));
  for(const file of ['index.mjs','bridge-owner.mjs'])assert.equal(hash(readPackageFile(hostRoot,file)),hash(readPackageFile(auditRoot,'packages/host/'+file)),'host source differs from audited archive');
  assert.equal(manifest.upstreamCommit,UPSTREAM);assert.equal(manifest.platform,'linux-x64-gnu');assert.equal(manifest.minimumGlibc,'2.31');
  assert.equal(manifest.bridge.path,'bin/codex-approval-protocol-bridge');assert.equal(manifest.launcher.path,'bin/landlock-run');
  for(const spec of [manifest.bridge,manifest.launcher]){
    assert(Number.isSafeInteger(spec.size)&&spec.size>0&&spec.size<=16*1024*1024);assert(/^[a-f0-9]{64}$/.test(spec.sha256));
    const bytes=readPackageFile(platformRoot,spec.path);assert.equal(bytes.length,spec.size);assert.equal(hash(bytes),spec.sha256);
    assert(bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])),'native artifact is not ELF');
  }
  const patch=metadata.version==='0.1.0-rc.1'?'codex-bridge-v2.patch':'codex-bridge-development.patch';
  assert.equal(hash(readPackageFile(platformRoot,'provenance/'+patch)),manifest.patchSha256);
  assert.equal(hash(readPackageFile(auditRoot,patch)),manifest.patchSha256);
  assert.equal(hash(readPackageFile(platformRoot,'provenance/builder-dpkg.txt')),manifest.builderDpkgSha256);
  return {manifest,packageVersion:metadata.version};
}
function verifyAuditModules(auditRoot) {
  const mirror=fileURLToPath(new URL('./src/',import.meta.url));
  const canonical=realpathSync(mirror);
  for(const name of MODULES)assert.equal(hash(readPackageFile(auditRoot,name)),hash(readPackageFile(canonical,name)),'archive verifier differs from committed audit mirror: '+name);
}
export function smokeRequests(){return[
  {id:'h',session_id:'ci-native-smoke',method:'handshake'},
  ...['-9223372036854775808','9223372036854775807','9223372036854775808'].map((value,i)=>({id:'i'+i,session_id:'ci-native-smoke',method:'parse_core_exec',wire:`{"call_id":"ci-smoke","command":[],"cwd":"/work","parsed_cmd":[],"started_at_ms":${value}}`}))
];}
export function validateSmokeOutput(stdout,manifest){
  assert(stdout.endsWith('\n'),'truncated protocol output');const lines=stdout.trimEnd().split('\n');assert.equal(lines.length,4,'unexpected protocol frame count');
  const responses=lines.map(line=>JSON.parse(line)),requests=smokeRequests();
  responses.forEach((r,i)=>{assert.equal(r.id,requests[i].id);assert.equal(r.session_id,requests[i].session_id);});
  const hello=responses[0];assert.equal(hello.ok,true);assert.equal(hello.result.protocol,2);assert.equal(hello.result.irVersion,1);assert.equal(hello.result.upstreamCommit,UPSTREAM);assert.equal(hello.result.bridgePatchSha256,manifest.patchSha256);assert.equal(hello.result.os,'linux');assert.equal(hello.result.arch,'x86_64');
  assert.equal(hello.result.hardening.noNewPrivileges,true);assert.equal(hello.result.hardening.network,'seccomp-deny');
  assert.equal(hello.result.hardening.filesystem,'seccomp-deny-open-plus-launcher');assert.equal(hello.result.hardening.rlimits,true);
  for(const [i,value] of ['-9223372036854775808','9223372036854775807'].entries()){const r=responses[i+1];assert.equal(r.ok,true);assert.equal(r.result.ir.startedAtMs,value);assert(r.result.canonicalWire.includes('"started_at_ms":'+value));}
  assert.equal(responses[3].ok,false);assert.equal(responses[3].error.kind,'serde');
  return {passed:true,frames:4,scope:'packaged launcher/bridge handshake and i64 parsing smoke only; not full owner, sandbox or application acceptance'};
}
async function smoke(platformRoot,manifest){
  assert(process.platform==='linux'&&process.arch==='x64','native smoke requires Linux x86_64');
  const fds=[];
  try{
    for(const spec of [manifest.launcher,manifest.bridge]){
      readPackageFile(platformRoot,spec.path);const fd=openSync(join(platformRoot,spec.path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);fds.push(fd);
      assert(fstatSync(fd).isFile());assert.equal(fstatSync(fd).size,spec.size);assert.equal(hash(readFileSync(fd)),spec.sha256,'artifact changed before execution');
    }
    // Both executed files are the same descriptors whose bytes were checked.
    const child=spawn('/proc/self/fd/3',['--ro','/','--rw','/dev/null','--','/proc/self/fd/4'],{cwd:platformRoot,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe',...fds]});
    const chunks=[];let count=0,failure=null;
    const collect=(isOut,chunk)=>{count+=chunk.length;if(count>65536){failure??='native smoke output exceeded 64 KiB';child.kill('SIGKILL');}else if(isOut)chunks.push(chunk);};
    child.stdout.on('data',c=>collect(true,c));child.stderr.on('data',c=>collect(false,c));child.stdin.on('error',()=>{});
    const timer=setTimeout(()=>{failure??='native smoke exceeded 10 seconds';child.kill('SIGKILL');},10000);
    const exit=await new Promise(resolve=>{child.on('error',e=>{failure??=e.message;});child.on('close',(code,signal)=>resolve({code,signal}));child.stdin.end(smokeRequests().map(x=>JSON.stringify(x)).join('\n')+'\n');});
    clearTimeout(timer);assert.equal(failure,null);assert.equal(exit.code,0,'native smoke process failed');assert.equal(exit.signal,null);
    return validateSmokeOutput(Buffer.concat(chunks).toString('utf8'),manifest);
  }finally{for(const fd of fds)closeSync(fd);}
}
export async function verifyNativePackage(platformRoot,hostRoot,auditRoot){
  const pins=verifyPackagePins(platformRoot,hostRoot,auditRoot);
  verifyAuditModules(auditRoot);
  const license=inspectLicenseEvidence(platformRoot);assert.deepEqual(license.missing,[],'source-backed license materials incomplete');
  const development=inspectDevelopmentEvidence(platformRoot);assert(development.accepted,development.reason??'development evidence rejected');
  const launcherEvidence=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./src/launcher-evidence.py',import.meta.url)),'--platform-root',platformRoot],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}}));
  assert.equal(launcherEvidence.accepted,true);assert.equal(launcherEvidence.officialPackages,2);
  const nativeSmoke=await smoke(platformRoot,pins.manifest);
  return{status:'NATIVE-PACKAGE-SCOPED-ACCEPTANCE-PASS',packageVersion:pins.packageVersion,manifestSha256:hash(readPackageFile(platformRoot,'artifact-manifest.json')),binarySha256:pins.manifest.bridge.sha256,development,nativeSmoke,launcherEvidence,rustMaterialScope:'672 Rust components; separate from launcher source provenance',upstreamLicenseFilesMissing:license.upstreamLicenseFilesMissing,legalApproval:license.legalApproval,productionAcceptance:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{assert.equal(process.argv.length,5,'usage: node verify-native-package.mjs ABS_PLATFORM ABS_HOST ABS_MATCHING_AUDIT_ROOT');console.log(JSON.stringify(await verifyNativePackage(...process.argv.slice(2)),null,2));}
  catch(error){console.error(JSON.stringify({status:'NATIVE-PACKAGE-ACCEPTANCE-FAIL',reason:error.message}));process.exitCode=1;}
}
