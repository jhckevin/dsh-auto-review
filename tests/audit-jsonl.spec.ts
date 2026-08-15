import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ActionReviewRuntime from '../src/service.ts'
import { apply, inject } from '../src/audit-jsonl.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('JSONL audit sink', () => {
  it('writes a private hash-linked record through an effect-scoped provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-auto-review-audit-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(ActionReviewRuntime)
    const fiber = await ctx.plugin({ inject, apply }, { root, fsync: true })
    ctx.actionReview.recordAudit('breaker', { state: 'opened', failures: 3, until: 9 }, 'session-1')
    const files = await import('node:fs/promises').then(fs => fs.readdir(root))
    expect(files).toHaveLength(1)
    const path = join(root, files[0] as string)
    const record = JSON.parse((await readFile(path, 'utf8')).trim()) as Record<string, unknown>
    expect(record).toMatchObject({ schemaVersion: 1, sequence: 1, kind: 'breaker', sessionId: 'session-1' })
    expect(record.recordDigest).toMatch(/^[a-f0-9]{64}$/)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await fiber.dispose()
    expect(() => ctx.actionReview.recordAudit('breaker', { state: 'closed', failures: 0 }, 'session-1')).not.toThrow()
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(1)
  })
})
