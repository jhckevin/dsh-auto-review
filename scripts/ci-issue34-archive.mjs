import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root = '/srv/pi-lab-dev/ci-issue34-20260914'
assert.equal(fs.realpathSync(root), root)
const out = root + '/evidence-final'
assert.equal(fs.existsSync(out), false, 'Archive destination must be new')
fs.mkdirSync(out, { mode: 0o700 })
const docker = args => execFileSync('docker', ['-H', 'unix://' + root + '/docker.sock', ...args], { maxBuffer: 64 * 1024 * 1024 })
const ids = docker(['ps', '-aq', '--filter', 'label=acceptance=issue34-20260914']).toString().trim().split('\n').filter(Boolean)
const inspections = JSON.parse(docker(['inspect', ...ids]))
assert(inspections.length > 0)
for (const c of inspections) {
  assert.equal(c.Config.Labels.acceptance, 'issue34-20260914')
  assert(c.Name.startsWith('/ar34-'))
  assert.equal(c.State.Running, false, 'Stop test containers before archival')
}
const scrub = text => text.replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]')
  .replace(/(token=)[A-Za-z0-9_-]{12,}/g, '$1[REDACTED]')
  .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1[REDACTED]')
const manifest = []
const put = (relative, bytes) => {
  const file = path.join(out, relative)
  assert(file.startsWith(out + '/'))
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' })
  manifest.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
put('containers.json', Buffer.from(scrub(JSON.stringify(inspections, null, 2))))
for (const c of inspections) {
  let log
  try { log = execFileSync('docker', ['-H', 'unix://' + root + '/docker.sock', 'logs', c.Id], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) { log = Buffer.concat([error.stdout || Buffer.alloc(0), error.stderr || Buffer.alloc(0)]) }
  put('container-logs/' + c.Name.slice(1) + '.stdout.log', Buffer.from(scrub(log.toString())))
  // Docker writes container stderr on this process's stderr even when exit=0.
  const result = (await import('node:child_process')).spawnSync('docker', ['-H', 'unix://' + root + '/docker.sock', 'logs', c.Id], { maxBuffer: 64 * 1024 * 1024 })
  put('container-logs/' + c.Name.slice(1) + '.stderr.log', Buffer.from(scrub(result.stderr?.toString() || '')))
}
const skipDirs = new Set(['node_modules', 'npm-cache', '.secrets', '.cache', '.git', 'docker-data', 'docker-exec', 'evidence-final', 'evidence-attempt1', 'alpha132-inventory-review'])
const fileAllowed = rel => !/credentials|deepseek\.key|\/api\.sock|\.tgz$|\.tar|\.lock$|\/pnpm-lock\.yaml$|\/package-lock\.json$/.test(rel)
let count = 0
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue
    const file = path.join(dir, e.name), rel = path.relative(root, file)
    if (e.isDirectory()) { if (!skipDirs.has(e.name) && !e.name.startsWith('dsh-source-')) walk(file); continue }
    if (!e.isFile() || !fileAllowed(rel) || file.includes('/packages/')) continue
    const size = fs.statSync(file).size
    if (size > 100 * 1024 * 1024) throw Error('Unexpected oversized evidence: ' + rel)
    let bytes = fs.readFileSync(file)
    if (rel.endsWith('.jsonl.zstd')) {
      const decoded = execFileSync('zstd', ['-dc', file], { maxBuffer: 128 * 1024 * 1024 }).toString()
      if (scrub(decoded) !== decoded) throw Error('Secret-like material in compressed trace requires redaction; content withheld: ' + rel)
    } else if (/\.(jsonl?|ya?ml|log|md|mjs|txt|py|sh)$/.test(rel) || !e.name.includes('.')) bytes = Buffer.from(scrub(bytes.toString()))
    put('run/' + rel, bytes); count++
  }
}
walk(root)
put('manifest.json', Buffer.from(JSON.stringify({ at: new Date().toISOString(), files: manifest, containers: inspections.length }, null, 2)))
const archive = root + '/issue34-evidence-final.tar.zst'
assert.equal(fs.existsSync(archive), false)
execFileSync('tar', ['--zstd', '-cf', archive, '-C', root, 'evidence-final'])
execFileSync('zstd', ['-t', archive])
const result = { containers: inspections.length, evidenceFiles: count, archive, bytes: fs.statSync(archive).size,
  sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), apiKeysIncluded: false }
fs.writeFileSync(root + '/ARCHIVE-VALID.json', JSON.stringify(result, null, 2), { mode: 0o600 })
console.log(JSON.stringify(result))
