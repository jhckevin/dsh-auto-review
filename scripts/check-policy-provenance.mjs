import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const expected = new Map([
  ['policies/codex/guardian-policy-template.md', 'f47fbb2bdba5e7528bfae7f5e2844a7d45a3a922fa74b718f22b22917376cfcf'],
  ['policies/codex/guardian-policy.md', 'e6b0cf0a2e1c4cabc0a37ac2a0bc424ddd7c89e85d049e32d281a8db6e8d3ce6'],
])

for (const [path, digest] of expected) {
  const content = await readFile(new URL(`../${path}`, import.meta.url))
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== digest) throw new Error(`${path} differs from the pinned upstream Guardian snapshot: ${actual}`)
}

process.stdout.write('Guardian policy provenance: OK\n')
