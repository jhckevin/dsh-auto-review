import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url)
const temporary = await mkdtemp(join(tmpdir(), 'dsh-auto-review-pack-'))
try {
  async function pack(cwd) {
    const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', temporary], { cwd })
    const result = JSON.parse(stdout)
    if (!Array.isArray(result) || typeof result[0]?.filename !== 'string') throw new Error(`npm pack returned no artifact for ${cwd}`)
    return join(temporary, result[0].filename)
  }
  const artifact = await pack(root)
  const dependencyArtifacts = []
  for (const dependency of [
    '@deepseek-ai/schemastery',
    '@deepseek-ai/cosmokit',
    '@standard-schema/spec',
  ]) {
    dependencyArtifacts.push(await pack(new URL(`../node_modules/${dependency}/`, import.meta.url)))
  }
  const installRoot = join(temporary, 'consumer')
  await mkdir(installRoot)
  await writeFile(join(installRoot, 'package.json'), '{"private":true,"type":"module"}\n')
  await exec('npm', [
    'install', '--offline', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund',
    artifact, ...dependencyArtifacts,
  ], { cwd: installRoot, maxBuffer: 10 * 1024 * 1024 })
  const packageRoot = join(installRoot, 'node_modules/@jhckevin/dsh-auto-review')
  const packedRuntime = await import(new URL(`file://${join(packageRoot, 'lib/policy-corpus.js').replaceAll('\\', '/')}`))
  if (packedRuntime.GUARDIAN_POLICY_SECTIONS.length < 10) throw new Error('packed runtime failed to load Guardian policy corpus')
  for (const file of ['guardian-policy-template.md', 'guardian-policy.md']) {
    const content = await readFile(join(packageRoot, 'policies/codex', file), 'utf8')
    if (content.length < 8_000) throw new Error(`packed ${file} is missing or truncated`)
  }
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== '@jhckevin/dsh-auto-review') throw new Error('packed manifest identity mismatch')
  process.stdout.write(`Packed artifact clean offline import: OK (${manifest.version})\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
