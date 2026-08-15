import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AutoReviewAuditEnvelope, JsonlAuditConfig } from './types.ts'
import { sha256Json, toJsonValue } from './canonical.ts'

export const name = 'auto-review-audit-jsonl'
export const inject = ['actionReview']

export const Config: z<JsonlAuditConfig> = z.object({
  root: z.string().required(),
  fsync: z.boolean().default(true),
  replayMaxBytes: z.number().step(1).min(1).default(268435456),
})

function replay(root: string, maxBytes: number): AutoReviewAuditEnvelope[] {
  const records: AutoReviewAuditEnvelope[] = []
  let totalBytes = 0
  for (const name of readdirSync(root).filter(name => /^audit-.*\.jsonl$/u.test(name)).sort()) {
    const path = join(root, name)
    totalBytes += statSync(path).size
    if (totalBytes > maxBytes) throw new Error(`auto-review audit replay exceeds replayMaxBytes ${maxBytes}`)
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    let previousDigest: string | undefined
    for (const [index, line] of lines.entries()) {
      const value = JSON.parse(line) as Record<string, unknown>
      if (value.schemaVersion !== 1 || typeof value.recordDigest !== 'string') {
        throw new Error(`auto-review audit ${name}:${index + 1} has an invalid envelope`)
      }
      if (value.previousDigest !== previousDigest) {
        throw new Error(`auto-review audit ${name}:${index + 1} breaks the per-process digest chain`)
      }
      const unsigned = { ...value }
      delete unsigned.recordDigest
      if (sha256Json(toJsonValue(unsigned)) !== value.recordDigest) {
        throw new Error(`auto-review audit ${name}:${index + 1} has an invalid record digest`)
      }
      previousDigest = value.recordDigest
      records.push(value as unknown as AutoReviewAuditEnvelope)
    }
  }
  return records
}

export function apply(ctx: Context, config: JsonlAuditConfig): void {
  if (!isAbsolute(config.root)) throw new TypeError('auto-review audit root must be absolute')
  mkdirSync(config.root, { recursive: true, mode: 0o700 })
  const replayMaxBytes = config.replayMaxBytes ?? 268435456
  if (!Number.isSafeInteger(replayMaxBytes) || replayMaxBytes < 1) {
    throw new TypeError('auto-review audit replayMaxBytes must be a positive safe integer')
  }
  ctx.actionReview.restoreAudit(replay(config.root, replayMaxBytes))
  const path = join(config.root, `audit-${Date.now()}-${process.pid}-${randomUUID()}.jsonl`)
  const sync = config.fsync ?? true
  ctx.actionReview.registerAuditSink({
    id: 'jsonl-v1',
    write(record: AutoReviewAuditEnvelope): void {
      const fd = openSync(path, 'a', 0o600)
      try {
        writeSync(fd, `${JSON.stringify(record)}\n`, undefined, 'utf8')
        if (sync) fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    },
  })
}

export default { name, inject, Config, apply }
