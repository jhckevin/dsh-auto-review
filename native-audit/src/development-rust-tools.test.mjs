import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cargoConfigPaths,inspectCargoConfigs,verifyCargoConfigEvidence,verifyRustToolEvidence,assertRustToolsUnchanged,RUST_TOOLS,CARGO_CONFIG_SHA } from './development-rust-tools.mjs';
import { sha } from './development-evidence.mjs';
const temporary=()=>mkdtempSync(join(tmpdir(),'rust-tool-binding-unit-'));
test('effective Cargo paths include both names, source cwd ancestors and explicit Cargo home',()=>{
  const env={CARGO_HOME:'/cache',HOME:'/output/home'},paths=cargoConfigPaths('/workspace/source','/runs/output',env);
  for(const p of ['/workspace/source/codex-rs/.cargo/config.toml','/workspace/source/.cargo/config','/workspace/.cargo/config.toml','/.cargo/config','/runs/.cargo/config.toml','/cache/config','/cache/config.toml'])assert(paths.includes(p));
  assert.equal(paths.length,new Set(paths).size);
});
test('external config, dangling config and symlink config directory fail closed without parsing content',()=>{
  for(const kind of ['file','dangling','directory-link']) {
    const root=temporary(),cache=join(root,'a-cache');mkdirSync(cache);
    if(kind==='file')writeFileSync(join(cache,'config.toml'),'[alias]\ntest="malicious"\n');
    if(kind==='dangling')symlinkSync(join(root,'missing'),join(cache,'config'));
    if(kind==='directory-link'){mkdirSync(join(root,'z-source'));symlinkSync(join(root,'missing'),join(root,'z-source','.cargo'));}
    assert.throws(()=>inspectCargoConfigs(join(root,'z-source'),join(root,'z-output'),{CARGO_HOME:cache,HOME:root}),/forbidden/);
  }
});
test('Cargo evidence cannot omit an ancestor or approve arbitrary configuration hash',()=>{
  const env={CARGO_HOME:'/cache',HOME:'/output/home'},record={source:'/source',output:'/output'};
  record.files=cargoConfigPaths(record.source,record.output,env).map(path=>({path,sha256:path==='/source/codex-rs/.cargo/config.toml'?CARGO_CONFIG_SHA:null}));
  verifyCargoConfigEvidence(record,env);
  const omitted=structuredClone(record);omitted.files.shift();assert.throws(()=>verifyCargoConfigEvidence(omitted,env));
  record.files[0].sha256='a'.repeat(64);assert.throws(()=>verifyCargoConfigEvidence(record,env));
});
test('actual tool file mutation fails even when dispatcher is unchanged',()=>{
  const root=temporary(),file=join(root,'rustc'),resolver=join(root,'rustup');writeFileSync(file,'actual compiler');writeFileSync(resolver,'dispatcher');
  const record={resolver:{path:resolver,sha256:sha('dispatcher')},tools:{rustc:{path:file,sha256:sha('actual compiler')}}};assertRustToolsUnchanged(record);writeFileSync(file,'changed compiler');assert.throws(()=>assertRustToolsUnchanged(record));
});
test('Rust evidence binds all six exact tool paths, hashes, queries and execution PATH',()=>{
  const bin='/rustup/toolchains/1.95.0-x86_64-unknown-linux-gnu/bin',record={toolchain:'1.95.0',bin,resolver:{path:'/bin/rustup',sha256:'a'.repeat(64)},tools:{}};
  for(const name of RUST_TOOLS)record.tools[name]={path:join(bin,name),sha256:'b'.repeat(64),query:['which','--toolchain','1.95.0',name]};
  const env={PATH:'/output/bazel/bin:'+bin+':/usr/bin'},tools={cargo:record.tools.cargo,rustc:record.tools.rustc};verifyRustToolEvidence(record,env,tools);
  const missing=structuredClone(record);delete missing.tools['clippy-driver'];assert.throws(()=>verifyRustToolEvidence(missing,env,tools));
  assert.throws(()=>verifyRustToolEvidence(record,{PATH:'/old/compiler:'+env.PATH},tools));
  assert.throws(()=>verifyRustToolEvidence(record,env,{...tools,cargo:{path:'/dispatcher',sha256:'b'.repeat(64)}}));
});
