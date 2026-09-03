import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const channels = [
  { channel: 'rc6', dsh: '0.1.0-rc.6', plugin: '0.5.5-rc.3', ref: 'compat/rc6-native-rc2' },
  { channel: 'rc2', dsh: '0.1.1-rc.2', plugin: '0.5.6-rc.4', ref: 'main' },
  { channel: 'alpha5', dsh: '0.1.2-alpha.5', plugin: '0.5.7-alpha.3', ref: 'compat/alpha5-native-alpha2' },
]
if (process.argv[2] === '--matrix') {
  console.log(JSON.stringify({ include: channels }))
  process.exit(0)
}
const channel = channels.find(row => row.channel === process.argv[2])
assert.ok(channel, 'Usage: node scripts/check-compat-channel.mjs rc6|rc2|alpha5|--matrix')
const root = process.cwd()
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
assert.equal(pkg.version, channel.plugin)
for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(pkg[section] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, channel.dsh, name)
  }
}
const dsh = Object.entries(lock.packages).filter(([name]) => /(?:^|\/)node_modules\/@deepseek-ai\/dsh-[^/]+$/.test(name))
assert.ok(dsh.length > 0)
for (const [name, row] of dsh) assert.equal(row.version, channel.dsh, name)
const artifacts = ['host', 'linux-x64-gnu'].map(suffix => {
  const name = `@jhckevin/dsh-auto-review-bridge-${suffix}`
  const file = resolve('vendor/native-bridge', `jhckevin-dsh-auto-review-bridge-${suffix}-0.1.0-rc.2.tgz`)
  assert.equal(lock.packages[`node_modules/${name}`].integrity,
    `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`)
  return file
})
const reportDir = resolve(process.env.DSH_COMPAT_REPORT_DIR ?? 'compatibility-report')
mkdirSync(reportDir, { recursive: true })
const results = []
for (const step of ['check', 'policy:check', 'pack:verify']) {
  const started = Date.now()
  const result = spawnSync('npm', ['run', step], {
    cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, DSH_BRIDGE_ARTIFACTS: JSON.stringify(artifacts) },
  })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  writeFileSync(join(reportDir, step.replace(':', '-') + '.log'), output)
  results.push({ step, exitCode: result.status, signal: result.signal,
    error: result.error?.message, durationMs: Date.now() - started,
    testSummary: output.split('\n').filter(line => /^\s*(Test Files|Tests)\s/.test(line)) })
  if (result.status !== 0) break
}
const report = { ...channel, dshLockedPackages: dsh.length, results,
  sourceGatePassed: results.length === 3 && results.every(row => row.exitCode === 0),
  coldInstallation: 'NOT_EXERCISED', nativeProtectedExecution: 'NOT_EXERCISED',
  browserHotInstallation: 'NOT_EXERCISED', fullGuardian: 'NOT_IMPLEMENTED',
  note: 'Skipped UI tests remain visible in testSummary and are not counted as passed.' }
writeFileSync(join(reportDir, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!report.sourceGatePassed) process.exitCode = 1
