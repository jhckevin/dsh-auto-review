import { existsSync, readFileSync, realpathSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specifier = "name: '@jhckevin/dsh-auto-review/entries/runtime'"
const pathEntry = "name: './lib/entries/runtime.js'"
const originalPatchSha256 = '7e4b99516e499ef75ecb2b7ddf13b8c3de559c7e310cc4082601423842c10b4c'

/** alpha5's native bundle anchoring supports paths, but its client scanner excludes package subpaths. */
export function prepareProfileUi(version, { profileRoot, check = false, restore = false } = {}) {
  if (version !== '0.1.2-alpha.5') return { applicable: false }
  const profile = resolve(profileRoot || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles/web'))
  const installed = join(profile, 'node_modules/@jhckevin/dsh-auto-review')
  if (!existsSync(join(installed, 'package.json'))) throw Error('Cannot find the installed Auto Review web profile. Pass --profile-root /path/to/.dsh/profiles/web. No profile changed.')
  const pkgRoot = realpathSync(installed)
  if (!pkgRoot.startsWith(realpathSync(profile) + sep)) throw Error('Shared plugin installation is not adapted automatically. Use an isolated profile installation.')
  // A name in an overlay is a match assertion, not a rename: never silently lose a disabled/config override.
  const dshHome = dirname(dirname(profile))
  for (const overlay of [join(profile, 'cordis.patch.yml'), join(dshHome, 'cordis.patch.yml')]) {
    if (!existsSync(overlay)) continue
    const contents = readFileSync(overlay, 'utf8').split(/\r\n?|\n/).filter(line => !line.trimStart().startsWith('#')).join('\n').trim()
    // Do not guess YAML semantics (escapes, aliases, custom tags or include chains).
    // Fresh profiles have an empty list; customized compositions require explicit migration.
    if (contents !== '' && contents !== '[]') {
      throw Error('Custom overlay requires manual migration before alpha5 client discovery: ' + overlay + '. Preserve disabled/config overrides and remove stale name assertions. No profile changed.')
    }
  }
  const packaged = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const actual = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
  if (actual.name !== packaged.name || actual.version !== packaged.version) throw Error('UI installer and installed plugin versions differ. Update both to the same version. No profile changed.')
  const expected = readFileSync(join(root, 'cordis.patch.yml'), 'utf8').replace(pathEntry, specifier)
  if (createHash('sha256').update(expected).digest('hex') !== originalPatchSha256) throw Error('Packaged bundle patch integrity failed. No profile changed.')
  if (expected.split(specifier).length !== 2) throw Error('Ambiguous packaged runtime entry. No profile changed.')
  const adapted = expected.replace(specifier, pathEntry)
  const target = join(pkgRoot, 'cordis.patch.yml')
  if (realpathSync(target) !== target) throw Error('Unexpected symlink for bundle patch. No profile changed.')
  const before = readFileSync(target, 'utf8')
  if (before !== expected && before !== adapted) throw Error('Locally modified Auto Review bundle patch. Refusing to overwrite.')
  const backup = target + '.auto-review-original'
  if (existsSync(backup) && readFileSync(backup, 'utf8') !== expected) throw Error('Bundle patch backup integrity failed.')
  if (check) return { applicable: true, adapted: before === adapted, changed: false, profile }
  const next = restore ? expected : adapted
  if (next === before) return { applicable: true, adapted: !restore, changed: false, profile }
  const mode = statSync(target).mode
  const tmp = target + '.auto-review-' + process.pid + '.tmp'
  let created = false
  try {
    if (readFileSync(target, 'utf8') !== before) throw Error('Bundle changed during installation. Stop DSH and retry.')
    if (!existsSync(backup)) writeFileSync(backup, expected, { flag: 'wx', mode })
    writeFileSync(tmp, next, { flag: 'wx', mode }); created = true
    renameSync(tmp, target)
  } finally { if (created && existsSync(tmp)) unlinkSync(tmp) }
  return { applicable: true, adapted: !restore, changed: true, profile }
}
