import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const root = '/srv/pi-lab-dev/ci-issue34-20260914'
const approved = JSON.parse(fs.readFileSync(root + '/ARCHIVE-VALID.json'))
assert.equal(approved.sha256, createHash('sha256').update(fs.readFileSync(approved.archive)).digest('hex'))
const docker = args => execFileSync('docker', ['-H', 'unix://' + root + '/docker.sock', ...args]).toString()
const archived = JSON.parse(fs.readFileSync(root + '/evidence-final/containers.json'))
const live = docker(['ps', '-aq', '--no-trunc', '--filter', 'label=acceptance=issue34-20260914']).trim().split('\n').filter(Boolean)
assert.deepEqual(live.sort(), archived.map(x => x.Id).sort(), 'Container set changed after archival')
const states = JSON.parse(docker(['inspect', ...live]))
for (const c of states) {
  assert.equal(c.Config.Labels.acceptance, 'issue34-20260914')
  assert(c.Name.startsWith('/ar34-'))
  assert.equal(c.State.Running, false)
}
const pid = Number(fs.readFileSync(root + '/gateway/pid', 'utf8').trim())
if (fs.existsSync('/proc/' + pid + '/cmdline')) {
  const cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8')
  assert(cmd.includes('ci-flash-gateway.mjs'), 'Gateway PID was reused')
  process.kill(pid, 'SIGTERM')
}
docker(['rm', ...live])
assert.equal(docker(['ps', '-aq', '--filter', 'label=acceptance=issue34-20260914']).trim(), '')
execFileSync('systemctl', ['stop', 'ar-issue34-docker'])
const result = { at: new Date().toISOString(), removedContainers: states.length,
  oomContainers: states.filter(x => x.State.OOMKilled).map(x => x.Name),
  paidGatewayStopped: true, dedicatedDaemonStopped: true, mainDaemonUntouched: true,
  retained: 'sanitized archive, raw local evidence, source worktree and test images/cache' }
fs.writeFileSync(root + '/CLEANUP-VERIFIED.json', JSON.stringify(result, null, 2), { mode: 0o644 })
console.log(JSON.stringify(result))
