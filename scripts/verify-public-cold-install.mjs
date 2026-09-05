/** No private peer ancestor, lifecycle scripts, model API or native trust bypass. */
import assert from 'node:assert/strict'
import {spawn,spawnSync,execFileSync} from 'node:child_process'
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,copyFileSync,lstatSync} from 'node:fs'
import {resolve,join,dirname,isAbsolute} from 'node:path'
const channels={rc6:['0.1.0-rc.6'],rc2:['0.1.1-rc.2'],alpha5:['0.1.2-alpha.5']}
const [channel,artifactArg,rootArg]=process.argv.slice(2)
assert.ok(channels[channel]&&artifactArg&&rootArg,'Usage: node verify-public-cold-install.mjs rc6|rc2|alpha5 ARTIFACT_DIR NEW_ROOT')
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64')
const [dsh]=channels[channel],artifacts=resolve(artifactArg),root=resolve(rootArg)
const family=JSON.parse(readFileSync(new URL('./public-dsh-family.json',import.meta.url)))[dsh]
assert.ok(Array.isArray(family)&&family.length>0)
const maxKiB=Number(process.env.DSH_COLD_MAX_KIB??409600)
assert.ok(Number.isSafeInteger(maxKiB)&&maxKiB>0&&maxKiB<=819200,'invalid disk bound')
const resume=process.argv[5]==='--resume-fixture'
assert.ok(isAbsolute(root)&&(!existsSync(root)||resume),'NEW_ROOT must not exist')
if(resume){const p=JSON.parse(readFileSync(join(root,'package.json')));assert.equal(p.name,'private-autoreview-public-cold');assert.equal(p.dependencies['@deepseek-ai/dsh'],dsh)}
const packages=readdirSync(artifacts).filter(n=>n.endsWith('.tgz')).map(file=>({file,pkg:JSON.parse(execFileSync('tar',['-xOf',join(artifacts,file),'package/package.json'],{encoding:'utf8'}))}))
const plugin=packages.find(p=>p.pkg.name==='@jhckevin/dsh-auto-review');assert.ok(plugin);const version=plugin.pkg.version;assert.ok(plugin.pkg.peerDependencies['@deepseek-ai/dsh-agent'].split(' || ').includes(dsh))
assert.ok(packages.some(p=>p.pkg.name==='@jhckevin/dsh-auto-review-bridge-host'))
assert.ok(packages.some(p=>p.pkg.name==='@jhckevin/dsh-auto-review-bridge-linux-x64-gnu'))
mkdirSync(join(root,'vendor'),{recursive:true});mkdirSync(join(root,'home'),{recursive:true})
const dependencies={'@deepseek-ai/dsh':dsh,'@deepseek-ai/cordis':'4.0.2',react:'18.3.1'}
for(const name of family)dependencies[name]=dsh
for(const [name,range]of Object.entries(plugin.pkg.peerDependencies??{})){
 if(name.startsWith('@deepseek-ai/dsh-')){if(family.includes(name)&&range.split(' || ').includes(dsh))dependencies[name]=dsh}
 else if(!(name in dependencies))dependencies[name]=range
}
const overrides={}
for(const name of family)overrides[name]='$'+name
for(const {file,pkg}of packages){copyFileSync(join(artifacts,file),join(root,'vendor',file));dependencies[pkg.name]='file:vendor/'+file;overrides[pkg.name]='$'+pkg.name}
const manifest={name:'private-autoreview-public-cold',private:true,type:'module',dependencies,overrides}
if(!resume)writeFileSync(join(root,'package.json'),JSON.stringify(manifest,null,2)+'\n')
const env={PATH:dirname(process.execPath)+':'+(process.env.PATH??'/usr/bin:/bin'),HOME:join(root,'home'),DSH_HOME:join(root,'home'),NODE_OPTIONS:'--max-old-space-size=1536',DSH_TELEMETRY_DISABLED:'1',LANG:'C.UTF-8'}
if(process.env.DSH_COLD_NPM_CACHE)env.npm_config_cache=resolve(process.env.DSH_COLD_NPM_CACHE)
function run(args,label){const p=spawnSync('npm',args,{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});writeFileSync(join(root,label+'.log'),(p.stdout??'')+(p.stderr??''));assert.equal(p.status,0,label+' failed: '+p.error?.message);const kb=Number(execFileSync('du',['-sk',join(root,'node_modules')],{encoding:'utf8'}).split(/\s/)[0]);assert.ok(kb<=maxKiB,'node_modules exceeded configured disk bound');return kb}
const flags=['--legacy-peer-deps','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmmirror.com']
let kb=resume?Number(execFileSync('du',['-sk',join(root,'node_modules')],{encoding:'utf8'}).split(/\s/)[0]):run(['install',...flags],'install')
// DSH's own caret dependencies may otherwise select another prerelease.
const initialLock=JSON.parse(readFileSync(join(root,'package-lock.json')))
const pinned=JSON.parse(readFileSync(join(root,'package.json')))
for(const name of Object.keys(initialLock.packages)){
 const match=name.match(/(?:^|\/)node_modules\/(@deepseek-ai\/dsh(?:-[^/]+)?)$/)
 if(match){assert.ok(family.includes(match[1]),'unexpected DSH family member '+match[1]);pinned.dependencies[match[1]]=dsh;pinned.overrides[match[1]]='$'+match[1]}
}
writeFileSync(join(root,'package.json'),JSON.stringify(pinned,null,2)+'\n')
kb=run(['install',...flags],'pin-dsh-family')
const rounds=[]
for(let round=0;round<5;round++){
 const currentLock=JSON.parse(readFileSync(join(root,'package-lock.json'))),currentPackage=JSON.parse(readFileSync(join(root,'package.json')))
 let newPins=false
 for(const path of Object.keys(currentLock.packages)){
  const match=path.match(/(?:^|\/)node_modules\/(@deepseek-ai\/dsh(?:-[^/]+)?)$/)
  if(match&&!Object.hasOwn(currentPackage.dependencies,match[1])){assert.ok(family.includes(match[1]),'unexpected DSH family member '+match[1]);currentPackage.dependencies[match[1]]=dsh;currentPackage.overrides[match[1]]='$'+match[1];newPins=true}
 }
 if(newPins){writeFileSync(join(root,'package.json'),JSON.stringify(currentPackage,null,2)+'\n');kb=run(['install',...flags],'pin-dsh-round-'+round);assert.ok(round<4,'family pin closure exceeded 5 rounds');continue}
 const missing=new Map()
 for(const file of Object.keys(currentLock.packages).filter(name=>/(?:^|\/)node_modules\/@deepseek-ai\/[^/]+$/.test(name))){
  if(!existsSync(join(root,file,'package.json')))continue
  const p=JSON.parse(readFileSync(join(root,file,'package.json'),'utf8'))
  for(const[name,range]of Object.entries(p.peerDependencies??{})){
   if(p.peerDependenciesMeta?.[name]?.optional||existsSync(join(root,'node_modules',name,'package.json')))continue
   assert.ok(name.startsWith('@deepseek-ai/'),'unreviewed peer namespace '+name)
   const target=name.startsWith('@deepseek-ai/dsh-')?dsh:name==='@deepseek-ai/cordis-plugin-group'?'1.0.2':range
   if(name.startsWith('@deepseek-ai/dsh-'))assert.ok(family.includes(name),'unexpected DSH peer '+name)
   if(missing.has(name))assert.equal(missing.get(name),target,'conflicting peer '+name)
   missing.set(name,target)
  }
 }
 if(!missing.size)break
 const specs=[...missing].map(([name,range])=>name+'@'+range)
 kb=run(['install','--save-exact',...flags,...specs],'peer-round-'+round);rounds.push({round,specs})
 assert.ok(round<4,'peer closure exceeded 5 rounds')
}
writeFileSync(join(root,'peer-rounds.json'),JSON.stringify(rounds,null,2))
const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'))
for(const[name,p]of Object.entries(lock.packages)){if(/(?:^|\/)node_modules\/@deepseek-ai\/dsh-[^/]+$/.test(name))assert.equal(p.version,dsh,name)}
assert.equal(readdirSync(join(root,'node_modules/@deepseek-ai')).filter(n=>lstatSync(join(root,'node_modules/@deepseek-ai',n)).isSymbolicLink()).length,0)
const cli=join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),patch=join(root,'node_modules/@jhckevin/dsh-auto-review/cordis.patch.yml')
for(const args of [['--help'],['--profile','web','--patch',patch,'--dump-config']]){const r=spawnSync(process.execPath,[cli,...args],{cwd:root,env,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024});writeFileSync(join(root,args.length===1?'help.log':'dump-config.log'),(r.stdout??'')+(r.stderr??''));assert.equal(r.status,0,'CLI bootstrap')}
writeFileSync(join(root,'observer.mjs'),`import{writeFileSync}from'node:fs';export const inject=['loader'];export function apply(ctx){const timer=setInterval(()=>{const rows=[...ctx.loader.entries()].filter(e=>e.options.id?.startsWith('auto-review')).map(e=>({id:e.options.id,state:e.fiber?.state,error:String(e.error??'')}));const services=['actionReview','actionReviewSettings','settings','agents','tools','sandboxPolicy','commands'].map(k=>[k,!!ctx.get(k)]);writeFileSync(new URL('./status.json',import.meta.url),JSON.stringify({rows,services}));},100);ctx.effect(()=>()=>clearInterval(timer));}`)
writeFileSync(join(root,'observer.yml'),JSON.stringify([{insert:[{id:'cold-install-observer',name:join(root,'observer.mjs')}]}]))
const child=spawn(process.execPath,[cli,'--profile','web','--patch',patch,'--patch',join(root,'observer.yml'),'--host','127.0.0.1','--port','0',...(channel==='rc6'?[]:['--no-open'])],{cwd:root,env,stdio:['ignore','pipe','pipe']})
let out='',err='',report={channel,dsh,version,nodeModulesKiB:kb,nativeExecution:'NOT_EXERCISED',browser:'NOT_EXERCISED',modelAPI:'NOT_EXERCISED',status:'FAIL'}
child.stdout.on('data',b=>{out+=b;writeFileSync(join(root,'web.stdout.log'),out.replace(/(https?:\/\/[^\s?]+)\?[^\s)]+/g,'$1?[REDACTED]'))});child.stderr.on('data',b=>{err+=b;writeFileSync(join(root,'web.stderr.log'),err)})
const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})))
try{
 const deadline=Date.now()+45000
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error('web exited '+child.exitCode)
  const match=out.match(/dsh web: (http:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s]*)/)
  if(match&&existsSync(join(root,'status.json'))){const status=JSON.parse(readFileSync(join(root,'status.json')));if(status.rows.length===6&&status.rows.every(r=>r.state===2)&&status.services.every(([,ok])=>ok)){let res=await fetch(match[1],{signal:AbortSignal.timeout(5000),redirect:'manual'});let authentication;if(channel==='alpha5'){const url=new URL(match[1]);const unauthed=await fetch(url.origin,{signal:AbortSignal.timeout(5000)});assert.equal(unauthed.status,401);assert.ok([302,303].includes(res.status));const cookie=res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const target=new URL(res.headers.get('location'),url);assert.equal(target.origin,url.origin);authentication={unauthenticatedStatus:unauthed.status,exchangeStatus:res.status};res=await fetch(target,{headers:{cookie},signal:AbortSignal.timeout(5000),redirect:'manual'})}assert.equal(res.status,200);report={...report,status:'PASS',...status,http:res.status,authentication,pid:child.pid};break}}
  await new Promise(r=>setTimeout(r,100))
 }
 assert.equal(report.status,'PASS','web activation timed out')
}catch(e){report.error=String(e);process.exitCode=1}finally{
 child.kill('SIGTERM');let timer
 report.exit=await Promise.race([exited,new Promise(r=>{timer=setTimeout(()=>{child.kill('SIGKILL');r({forced:true})},5000)})]);clearTimeout(timer)
 writeFileSync(join(root,'summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
 if(report.exit.code!==0)process.exitCode=1
}
