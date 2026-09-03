// 发行制品由 CI 的真实构建产生；不复写已发布版本，不把打包当安全认证。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
assert.match(pkg.version, /^\d+\.\d+\.\d+-(rc|alpha)\.\d+$/)
const distribution = resolve('artifacts/distribution')
mkdirSync(distribution, { recursive: true })
assert.equal(readdirSync(distribution).length, 0, 'refuse to mix distribution generations')
const run = (name, args, cwd = root) => execFileSync(name, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
assert.equal(run('git', ['status', '--porcelain', '--untracked-files=normal']), '', 'source must be committed and clean before distribution')
const sourceCommit = run('git', ['rev-parse', 'HEAD'])
const sourceTree = run('git', ['rev-parse', 'HEAD^{tree}'])
const pack = cwd => JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', distribution], cwd))[0].filename
const main = pack(root)
const bridge = readdirSync('vendor/native-bridge').filter(name => name.endsWith('.tgz')).sort()
assert.equal(bridge.length, 2, 'exactly host and platform are required')
for (const name of bridge) copyFileSync(join('vendor/native-bridge', name), join(distribution, name))
const dependencies = ['@deepseek-ai/dsh-util-values', '@deepseek-ai/schemastery', '@deepseek-ai/cosmokit', '@standard-schema/spec', 'node-addon-api', 'node-gyp-build', 'tree-sitter', 'tree-sitter-bash']
const runtime = dependencies.map(name => pack(join(root, 'node_modules', name)))
const members = [main, ...bridge, ...runtime]
run('tar', ['-czf', join(distribution, `auto-review-${pkg.version}-offline-candidate.tar.gz`), '-C', distribution, ...members])
copyFileSync('docs/INSTALL-CANDIDATE.md', join(distribution, 'INSTALL.md'))
copyFileSync('docs/GITHUB-PREVIEW.md', join(distribution, 'PREVIEW.md'))
copyFileSync('scripts/prepare-preview-install.mjs', join(distribution, 'prepare-preview-install.mjs'))
copyFileSync('scripts/public-dsh-family.json', join(distribution, 'public-dsh-family.json'))
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const receipt = {
  schemaVersion: 1,
  package: { name: pkg.name, version: pkg.version, peers: pkg.peerDependencies },
  sourceCommit,
  sourceTree,
  lockSha256: sha('package-lock.json'),
  node: process.version,
  npm: run('npm', ['--version']),
  workflowRun: process.env.GITHUB_RUN_ID ? `https://github.com/jhckevin/dsh-auto-review/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  scope: 'source build, types, behavior tests, policy provenance and packed consumer; not full native/production certification',
  fullNativeReleaseGate: 'not-certified-by-this-workflow',
  artifacts: members.map(name => ({ name, sha256: sha(join(distribution, name)) })),
}
assert.equal(run('git', ['rev-parse', 'HEAD']), sourceCommit, 'source commit changed during packaging')
assert.equal(run('git', ['rev-parse', 'HEAD^{tree}']), sourceTree, 'source tree changed during packaging')
assert.equal(run('git', ['status', '--porcelain', '--untracked-files=normal']), '', 'source changed during packaging')
writeFileSync(join(distribution, 'build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
const files = readdirSync(distribution).sort()
writeFileSync(join(distribution, 'SHA256SUMS'), files.map(name => `${sha(join(distribution, name))}  ${name}`).join('\n') + '\n')
console.log(JSON.stringify({ version: pkg.version, files: files.length + 1, sourceCommit: receipt.sourceCommit }))
