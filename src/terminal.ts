/** Opt-in terminal notice adapter; not a full-screen TUI or a model message. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { stripVTControlCharacters } from 'node:util'
import { isAutoReviewInterruption } from './denial-breaker.ts'

export const name = 'auto-review-terminal'
export const inject = ['sessions']
export interface TerminalConfig { enabled?: boolean }
export const Config: z<TerminalConfig> = z.object({ enabled: z.boolean().default(true) })

/** Preserve readable reasons, never terminal escapes, line spoofing or bidi controls. */
export function terminalNoticeText(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .slice(0, 4096)
}

/** Mount this module explicitly in a terminal profile. Web profiles must not mount it. */
export function apply(ctx: Context, config: TerminalConfig): void {
  if (config.enabled === false) return
  const turns = new Map<string, Set<number>>()
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || !isAutoReviewInterruption(event.data.reason)) return
    const turn = event.data.turn
    let seen = turns.get(session.id)
    if (seen?.has(turn)) return
    if (!seen) turns.set(session.id, seen = new Set())
    seen.add(turn)
    process.stderr.write(`[Auto Review] 本轮操作已被自动审查终止 (session=${terminalNoticeText(session.id)}, turn=${turn})：${terminalNoticeText(event.data.reason.reason.reason)}\n`)
  })
  ctx.on('session/disposed', session => { turns.delete(session.id) })
  ctx.effect(() => () => { turns.clear() }, 'auto-review terminal: deduplication lifetime')
}
