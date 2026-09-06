import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps settings actions in document flow without an opaque overlay', () => {
  const source = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  const rules = [...source.matchAll(/\.ar-actions\{([^}]+)\}/g)].map(match => match[1]).join(';')
  expect(rules).toContain('position:static')
  expect(rules).toContain('background:transparent')
  expect(rules).not.toMatch(/position:(sticky|fixed|absolute)|z-index:|bottom:/)
  expect(source.indexOf('<footer className="ar-actions">')).toBeGreaterThan(source.indexOf('</fieldset>\n      {snapshot.metrics'))
})
