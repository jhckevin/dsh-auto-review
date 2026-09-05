import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const [artifact,version]=process.argv.slice(2)
const families=JSON.parse(readFileSync(new URL('./public-dsh-family.json',import.meta.url),'utf8'))
assert(artifact&&families[version],'Usage: node test-unified-host.mjs TARBALL DSH_VERSION')
const root=mkdtempSync(join(tmpdir(),'ar-host-'))
const dependencies={'@deepseek-ai/cordis':'4.0.2','@deepseek-ai/cordis-plugin-group':'1.0.2',react:'18.3.1',pnpm:'10.15.0'}
const overrides={}
for(const name of families[version]){dependencies[name]=version;overrides[name]='$'+name}
writeFileSync(join(root,'package.json'),JSON.stringify({name:'private-auto-review-host',private:true,dependencies,overrides}))
execFileSync('npm',['install','--prefix',root,'--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{stdio:'inherit',timeout:300000})
execFileSync(process.execPath,[new URL('./verify-unified-install.mjs',import.meta.url).pathname,artifact,root,version],{stdio:'inherit',timeout:120000})
