import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const root = resolve(new URL('..', import.meta.url).pathname)
const temporary = mkdtempSync(join(tmpdir(), 'auto-review-one-command-'))
const run = (command, args, cwd, env = process.env) => execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const unpack = (archive, directory) => {
  mkdirSync(directory)
  run('tar', ['-xzf', archive, '--strip-components=1', '-C', directory], root)
}
const pack = directory => {
  const result = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], directory))[0]
  return join(temporary, result.filename)
}

try {
  const preparedDir = join(temporary, 'prepared')
  mkdirSync(preparedDir)
  const prepared = JSON.parse(run('node', ['scripts/prepare-npm-release.mjs', preparedDir], root).split('\n').at(-1))
  assert(['rc6', 'rc2', 'alpha5', 'beta', 'latest'].includes(prepared.distTag))
  const hostDir = join(temporary, 'host')
  unpack(prepared.host, hostDir)
  const host = JSON.parse(readFileSync(join(hostDir, 'package.json'), 'utf8'))
  host.optionalDependencies['@jhckevin/dsh-auto-review-bridge-linux-x64-gnu'] = `file:${prepared.platform}`
  writeFileSync(join(hostDir, 'package.json'), JSON.stringify(host, null, 2) + '\n')
  const localHost = pack(hostDir)

  const mainDir = join(temporary, 'main')
  const mainArtifact = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root))[0].filename
  unpack(join(temporary, mainArtifact), mainDir)
  const main = JSON.parse(readFileSync(join(mainDir, 'package.json'), 'utf8'))
  main.dependencies['@jhckevin/dsh-auto-review-bridge-host'] = `file:${localHost}`
  writeFileSync(join(mainDir, 'package.json'), JSON.stringify(main, null, 2) + '\n')
  const localMain = pack(mainDir)

  const consumer = join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(join(consumer, 'package.json'), '{"private":true}\n')
  // Use a brand-new cache and the approved mirror. The test receives one main
  // package argument; npm must resolve every ordinary runtime dependency and
  // recursively install both bridge packages itself.
  const env = {
    ...process.env,
    npm_config_cache: join(temporary, 'cache'),
    npm_config_registry: process.env.NPM_TEST_REGISTRY ?? 'https://registry.npmmirror.com',
  }
  run('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', localMain], consumer, env)
  for (const name of ['dsh-auto-review', 'dsh-auto-review-bridge-host', 'dsh-auto-review-bridge-linux-x64-gnu']) {
    assert(JSON.parse(readFileSync(join(consumer, 'node_modules/@jhckevin', name, 'package.json'), 'utf8')).name.endsWith(name))
  }
  const scope = join(consumer, 'node_modules/@jhckevin')
  const expected = JSON.parse(readFileSync(join(scope, 'dsh-auto-review-bridge-host/expected-provenance.json'), 'utf8'))
  const platform = JSON.parse(readFileSync(join(scope, 'dsh-auto-review-bridge-linux-x64-gnu/package.json'), 'utf8'))
  assert(isDeepStrictEqual(expected.package, platform), 'host must pin the exact published platform package manifest')
  console.log(JSON.stringify({ status: 'PASS', installArguments: 1, recursivePackages: 3, provenancePin: 'exact' }))
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
