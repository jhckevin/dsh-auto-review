import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,existsSync,cpSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {tmpdir} from 'node:os'

// Tests the official plugin add command against a separately provisioned host.
// This does not certify native execution, browser interactions, or model behavior.
const [artifactArg,hostArg,expected]=process.argv.slice(2)
assert(artifactArg&&hostArg&&expected,'Usage: node verify-unified-install.mjs TARBALL HOST_ROOT DSH_VERSION')
const artifact=resolve(artifactArg),host=resolve(hostArg)
assert(existsSync(artifact),'tarball missing')
const root=mkdtempSync(join(process.env.DSH_INSTALL_TEST_ROOT??tmpdir(),'ar-unified-'))
const cli=join(host,'node_modules/@deepseek-ai/dsh/lib/bin.js')
assert(existsSync(cli),'host CLI missing')
const env={...process.env,DSH_HOME:root,DSH_TELEMETRY_DISABLED:'1',PATH:join(host,'node_modules/.bin')+':'+process.env.PATH}
const run=args=>execFileSync(process.execPath,[cli,...args],{env,encoding:'utf8',timeout:90000})
writeFileSync(join(root,'install.log'),run(['plugin','--profile','web','add',artifact,'--registry=https://registry.npmjs.org/']))
const plugin=join(root,'profiles/web/node_modules/@jhckevin/dsh-auto-review')
const manifest=JSON.parse(readFileSync(join(plugin,'package.json'),'utf8'))
assert(manifest.peerDependencies['@deepseek-ai/dsh-agent'].split(' || ').includes(expected))
process.argv[1]=cli
const {detectDshHost}=await import(pathToFileURL(join(plugin,'lib/dsh-compat.js')))
const report=detectDshHost()
assert(report.supported,JSON.stringify(report))
assert.equal(report.profile.version,expected)
writeFileSync(join(root,'config.yml'),run(['--profile','web','--dump-config']))
const uiRoot=join(root,'ui-owner-fixture/node_modules')
mkdirSync(join(uiRoot,'@deepseek-ai'),{recursive:true})
for(const name of ['dsh-client-ui-tool','dsh-client-ui-settings-general']) {
  cpSync(join(host,'node_modules/@deepseek-ai',name),join(uiRoot,'@deepseek-ai',name),{recursive:true,dereference:true})
}
const {installUi}=await import(pathToFileURL(join(plugin,'scripts/install-ui.mjs')))
assert.equal(installUi(uiRoot,{check:true}).version,expected)
assert.equal(installUi(uiRoot).changed,2)
assert.equal(installUi(uiRoot).changed,0)
assert.equal(installUi(uiRoot,{restore:true}).changed,2)
writeFileSync(join(root,'remove.log'),run(['plugin','--profile','web','remove','@jhckevin/dsh-auto-review']))
const remaining=JSON.parse(readFileSync(join(root,'profiles/web/package.json'),'utf8'))
assert(!remaining.dependencies?.['@jhckevin/dsh-auto-review'],'remove left dependency')
assert(!remaining.dsh?.profile?.bundles?.includes('@jhckevin/dsh-auto-review'),'remove left active bundle')
const result={expected,pluginVersion:manifest.version,report,root,status:'PASS',scope:'official plugin add, host selection, configuration composition, matching UI install/idempotence/restore and profile removal',native:'NOT_TESTED',browser:'NOT_TESTED',model:'NOT_TESTED'}
writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
