import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AutoReviewAuditEnvelope, JsonlAuditConfig } from './types.ts'

export const name = 'auto-review-audit-jsonl'
export const inject = ['actionReview']

export const Config: z<JsonlAuditConfig> = z.object({
  root: z.string().required(),
  fsync: z.boolean().default(true),
})

export function apply(ctx: Context, config: JsonlAuditConfig): void {
  if (!isAbsolute(config.root)) throw new TypeError('auto-review audit root must be absolute')
  mkdirSync(config.root, { recursive: true, mode: 0o700 })
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
