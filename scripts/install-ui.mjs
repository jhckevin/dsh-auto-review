#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** Preflight every known artifact; refuse unknown versions or locally modified UI. */
export function installUi(hostRoot, { restore = false, check = false } = {}) {
  const base = realpathSync(hostRoot)
  const catalog = JSON.parse(readFileSync(join(root, 'ui/manifest.json'), 'utf8'))
  const cohorts = catalog.cohorts ?? [catalog]
  const owner = cohorts[0]?.files[0]?.package
  if (!owner) throw Error('Packaged UI manifest is empty.')
  const version = JSON.parse(readFileSync(join(base, '@deepseek-ai', owner, 'package.json'), 'utf8')).version
  const manifest = cohorts.find(entry => entry.dshVersion === version)
  if (!manifest) throw Error('Unsupported UI version: ' + version + '. No files changed.')
  const plan = manifest.files.map(file => {
    const pkg = join(base, '@deepseek-ai', file.package)
    const metadata = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))
    if (metadata.version !== manifest.dshVersion) throw Error('Unsupported UI version: ' + metadata.version + '. No files changed.')
    const target = realpathSync(join(pkg, 'lib/client.js'))
    if (!target.startsWith(base + sep)) throw Error('UI resolves outside the selected installation. No files changed.')
    const bytes = readFileSync(target), hash = digest(bytes)
    const replacement = readFileSync(join(root, file.artifact))
    if (digest(replacement) !== file.patchedSha256) throw Error('Packaged UI integrity check failed.')
    const backup = target + '.auto-review-original'
    if (hash !== file.originalSha256 && hash !== file.patchedSha256) throw Error('Locally modified UI: ' + file.package + '. Refusing to overwrite.')
    if (existsSync(backup) && digest(readFileSync(backup)) !== file.originalSha256) throw Error('Backup integrity check failed.')
    if (restore && hash === file.patchedSha256 && !existsSync(backup)) throw Error('Original UI backup is missing.')
    return { target, backup, bytes, mode: statSync(target).mode, next: restore ? (existsSync(backup) ? readFileSync(backup) : bytes) : replacement }
  })
  if (check) return { changed: 0, checked: plan.length, version: manifest.dshVersion }
  const changed = []
  function atomic(target, bytes, mode) {
    const tmp = target + '.auto-review-' + process.pid + '.tmp'
    let created = false
    try { writeFileSync(tmp, bytes, { flag: 'wx', mode }); created = true; renameSync(tmp, target) }
    finally { if (created && existsSync(tmp)) unlinkSync(tmp) }
  }
  try {
    for (const file of plan) {
      if (file.bytes.equals(file.next)) continue
      if (!readFileSync(file.target).equals(file.bytes)) throw Error('UI changed during installation. Stop DSH and retry.')
      if (!restore && !existsSync(file.backup)) writeFileSync(file.backup, file.bytes, { flag: 'wx', mode: file.mode })
      atomic(file.target, file.next, file.mode)
      changed.push(file)
    }
  } catch (error) {
    for (const file of changed.reverse()) atomic(file.target, file.bytes, file.mode)
    throw error
  }
  return { changed: changed.length, checked: plan.length, version: manifest.dshVersion }
}

function detectHost() {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const bin = join(dir, 'dsh')
    if (!existsSync(bin)) continue
    const require = createRequire(realpathSync(bin))
    try {
      const file = require.resolve('@deepseek-ai/dsh-client-ui-tool/package.json')
      const candidate = resolve(dirname(file), '../..')
      if (existsSync(join(candidate, '@deepseek-ai/dsh-client-ui-settings-general'))) return candidate
    } catch { /* The next CLI may belong to the selected DSH installation. */ }
  }
  throw Error('Cannot locate DSH. Pass --dsh-root /path/to/dsh/node_modules.')
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]
      if (arg === '--dsh-root') { index++; continue }
      if (!['--help', '--check', '--restore'].includes(arg)) throw Error('Unknown argument: ' + arg)
    }
    if (args.includes('--help')) {
      console.log('dsh-auto-review-ui [--dsh-root /path/to/node_modules] [--check|--restore]\nStop DSH first. Installs matching, hash-pinned UI owners only; preserves an original backup. Supports DSH 0.1.0-rc.6, 0.1.1-rc.2, 0.1.2-alpha.5.')
    } else {
      const pos = args.indexOf('--dsh-root')
      if (pos >= 0 && (!args[pos + 1] || args[pos + 1].startsWith('--'))) throw Error('--dsh-root requires a directory.')
      const result = installUi(pos >= 0 ? args[pos + 1] : detectHost(), { restore: args.includes('--restore'), check: args.includes('--check') })
      console.log(JSON.stringify(result))
      console.log('Restart DSH and refresh the browser. Backend permissions are unchanged.')
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
