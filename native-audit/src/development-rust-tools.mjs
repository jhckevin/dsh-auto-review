import assert from 'node:assert/strict';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const CARGO_CONFIG_SHA = 'b8ae1cea341beb2d4a3c8fb81f97a96f4aee1fd53f769c57f140dfe949806a80';
export const RUST_TOOLS = ['cargo','rustc','cargo-clippy','clippy-driver','cargo-fmt','rustfmt'];
function maybeStat(file) { try { return lstatSync(file); } catch(error) { if(error.code==='ENOENT')return null;throw error; } }
export function cargoConfigPaths(source,output,env) {
  const directories=new Set();
  for(let start of [source,join(source,'codex-rs'),output]) {
    assert(isAbsolute(start));
    for(;;) { directories.add(join(start,'.cargo'));const parent=dirname(start);if(parent===start)break;start=parent; }
  }
  directories.add(env.CARGO_HOME ?? join(env.HOME,'.cargo'));
  return [...directories].flatMap(p=>[join(p,'config'),join(p,'config.toml')]).sort();
}
export function inspectCargoConfigs(source,output,env) {
  const expected=join(source,'codex-rs','.cargo','config.toml');
  const files=cargoConfigPaths(source,output,env).map(path=>{
    const parent=maybeStat(dirname(path));assert(!parent?.isSymbolicLink(),'Cargo configuration directory symlink forbidden');
    const stat=maybeStat(path);
    if(path!==expected){ assert(stat===null,'ambient Cargo configuration forbidden: '+path);return{path,sha256:null}; }
    assert(stat?.isFile()&&!stat.isSymbolicLink()&&stat.size<=4096,'fixed Cargo config missing/invalid');
    const digest=sha(readFileSync(path));assert.equal(digest,CARGO_CONFIG_SHA,'fixed upstream Cargo config changed');return{path,sha256:digest};
  });
  return{source,output,files};
}
export function verifyCargoConfigEvidence(record,env) {
  assert.deepEqual(record.files,cargoConfigPaths(record.source,record.output,env).map(path=>({path,sha256:path===join(record.source,'codex-rs','.cargo','config.toml')?CARGO_CONFIG_SHA:null})));
}
export function resolveRustTools(rustup,env,source) {
  const tools={};
  for(const name of RUST_TOOLS) {
    const args=['which','--toolchain','1.95.0',name];
    const path=execFileSync(rustup.path,args,{env,cwd:source,maxBuffer:8192,timeout:10000}).toString().trim();
    assert(isAbsolute(path)&&path===realpathSync(path),'resolved Rust tool must be canonical');
    assert(lstatSync(path).isFile(),'resolved Rust tool must be a regular file');
    tools[name]={path,sha256:sha(readFileSync(path)),query:args};
  }
  const bin=dirname(tools.rustc.path);
  assert(bin.endsWith('/toolchains/1.95.0-x86_64-unknown-linux-gnu/bin'),'unexpected actual Rust toolchain');
  assert(RUST_TOOLS.every(name=>tools[name].path===join(bin,name)),'Rust tools must use the same fixed bin directory');
  return{toolchain:'1.95.0',bin,resolver:rustup,tools};
}
export function assertRustToolsUnchanged(record) {
  for(const tool of [record.resolver,...Object.values(record.tools)]) assert.equal(sha(readFileSync(realpathSync(tool.path))),tool.sha256,'actual Rust tool changed');
}
export function verifyRustToolEvidence(record,env,tools) {
  assert.equal(record.toolchain,'1.95.0');
  assert(isAbsolute(record.bin)&&record.bin.endsWith('/toolchains/1.95.0-x86_64-unknown-linux-gnu/bin'));
  assert.deepEqual(Object.keys(record.tools).sort(),[...RUST_TOOLS].sort());
  for(const name of RUST_TOOLS) {
    const tool=record.tools[name];assert.equal(tool.path,join(record.bin,name));assert(/^[a-f0-9]{64}$/.test(tool.sha256));
    assert.deepEqual(tool.query,['which','--toolchain','1.95.0',name]);
  }
  assert.equal(env.PATH.split(':')[1],record.bin);
  for(const name of ['cargo','rustc']) {assert.equal(tools[name].path,record.tools[name].path);assert.equal(tools[name].sha256,record.tools[name].sha256);}
  assert(isAbsolute(record.resolver.path)&&/^[a-f0-9]{64}$/.test(record.resolver.sha256));
}
