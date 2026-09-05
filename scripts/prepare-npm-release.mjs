import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const output = resolve(process.argv[2] ?? join(root, 'artifacts/npm'))
const temporary = mkdtempSync(join(tmpdir(), 'auto-review-npm-'))
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const repository = { type: 'git', url: 'git+https://github.com/jhckevin/dsh-auto-review.git' }

const addPublicMetadata = manifest => {
  manifest.repository = repository
  manifest.homepage = 'https://github.com/jhckevin/dsh-auto-review'
  manifest.bugs = { url: 'https://github.com/jhckevin/dsh-auto-review/issues' }
  manifest.publishConfig = { access: 'public', provenance: true }
  return manifest
}
const pack = (directory, output) => {
  const result = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], directory))[0]
  return join(output, result.filename)
}

try {
  mkdirSync(output, { recursive: true })
  const source = {
    platform: join(root, 'vendor/native-bridge/jhckevin-dsh-auto-review-bridge-linux-x64-gnu-0.1.0-rc.2.tgz'),
    host: join(root, 'vendor/native-bridge/jhckevin-dsh-auto-review-bridge-host-0.1.0-rc.2.tgz'),
  }
  const prepared = {}
  for (const kind of ['platform', 'host']) {
    const directory = join(temporary, kind)
    mkdirSync(directory)
    run('tar', ['-xzf', source[kind], '--strip-components=1', '-C', directory])
    const manifestPath = join(directory, 'package.json')
    const manifest = addPublicMetadata(JSON.parse(readFileSync(manifestPath, 'utf8')))
    if (kind === 'platform') manifest.libc = ['glibc']
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    if (kind === 'host') {
      const provenancePath = join(directory, 'expected-provenance.json')
      const expected = JSON.parse(readFileSync(provenancePath, 'utf8'))
      expected.package = JSON.parse(readFileSync(join(temporary, 'platform/package.json'), 'utf8'))
      writeFileSync(provenancePath, JSON.stringify(expected, null, 2) + '\n')
    }
    prepared[kind] = pack(directory, output)
  }
  const hostManifest = JSON.parse(run('tar', ['-xOf', prepared.host, 'package/package.json']))
  assert.equal(hostManifest.optionalDependencies['@jhckevin/dsh-auto-review-bridge-linux-x64-gnu'], '0.1.0-rc.2')
  const main = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(main.dependencies['@jhckevin/dsh-auto-review-bridge-host'], '0.1.0-rc.2')
  assert.deepEqual(main.dsh?.bundle, { patch: './cordis.patch.yml' })
  const mainArtifact = pack(root, output)
  const dshVersions = main.peerDependencies['@deepseek-ai/dsh-agent'].split(' || ')
  const channels = new Map([
    ['0.1.0-rc.6', 'rc6'],
    ['0.1.1-rc.2', 'rc2'],
    ['0.1.2-alpha.5', 'alpha5'],
  ])
  assert(dshVersions.length > 0 && dshVersions.every(version => channels.has(version)), 'unsupported DSH release cohort')
  if (dshVersions.length > 1) {
    const core = ['agent', 'llm', 'sandbox', 'sandbox-policy', 'session', 'settings', 'tools', 'user-approval', 'commands', 'api-remotes', 'client-connection', 'client-locale', 'client-ui-settings', 'client-ui-slots', 'typert-protocol', 'system-prompt']
    for (const suffix of core) {
      assert.deepEqual(main.peerDependencies['@deepseek-ai/dsh-' + suffix]?.split(' || '), dshVersions, 'peer cohort differs: ' + suffix)
    }
    assert.equal(main.peerDependencies['@deepseek-ai/dsh-client-runtime'], '0.1.0-rc.6 || 0.1.1-rc.2')
    for (const suffix of ['client-store', 'client-ui-renderer']) assert.equal(main.peerDependencies['@deepseek-ai/dsh-' + suffix], '0.1.2-alpha.5')
  }
  const distTag = dshVersions.length === 1 ? channels.get(dshVersions[0])
    : main.version.includes('-') ? 'beta' : 'latest'
  const release = {
    pluginVersion: main.version,
    dshVersion: dshVersions.at(-1),
    dshVersions,
    distTag,
    platform: prepared.platform,
    platformFile: prepared.platform.split('/').at(-1),
    host: prepared.host,
    hostFile: prepared.host.split('/').at(-1),
    main: mainArtifact,
    mainFile: mainArtifact.split('/').at(-1),
  }
  writeFileSync(join(output, 'npm-release.json'), JSON.stringify(release, null, 2) + '\n')
  console.log(JSON.stringify(release))
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
