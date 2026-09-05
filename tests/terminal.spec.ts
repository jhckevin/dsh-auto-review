import { sessionEvents } from './compat-fixtures.ts'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as terminal from '../src/terminal.ts'
import { AUTO_REVIEW_INTERRUPTION_PREFIX } from '../src/denial-breaker.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

async function setup(config: terminal.TerminalConfig = {}, mount = true) {
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  const fiber = mount ? await ctx.plugin(terminal, config) : undefined
  const session = ctx.sessions.create(SessionId('terminal-session'))
  return { ctx, session, write, fiber }
}

const interrupted = (message = 'denied=3; choose a safer authorized approach'): TurnEndReason => ({
  kind: 'aborted', reason: { kind: 'hook', reason: `${AUTO_REVIEW_INTERRUPTION_PREFIX} ${message}` },
})
function end(session: Session, turn: number, reason: TurnEndReason) {
  session.append('turn/start', { turn })
  return session.append('turn/end', { turn, reason })
}

describe('explicit terminal profile adapter using real Cordis/Session events', () => {
  it('prints the native hook reason to stderr without adding model messages', async () => {
    const { session, write } = await setup()
    end(session, 1, interrupted())
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toContain('本轮操作已被自动审查终止')
    expect(write.mock.calls[0]?.[0]).toContain('denied=3; choose a safer authorized approach')
    expect(sessionEvents(session).map(event => event.type)).toEqual(['turn/start', 'turn/end'])
  })

  it('does not print when the terminal module was not mounted', async () => {
    const { session, write } = await setup({}, false)
    end(session, 1, interrupted())
    expect(write).not.toHaveBeenCalled()
  })

  it('respects disabled configuration', async () => {
    const { session, write } = await setup({ enabled: false })
    end(session, 1, interrupted())
    expect(write).not.toHaveBeenCalled()
  })

  it('ignores user cancellation, unrelated hook reasons and completed turns', async () => {
    const { session, write } = await setup()
    end(session, 1, { kind: 'aborted', reason: { kind: 'user' } })
    end(session, 2, { kind: 'aborted', reason: { kind: 'hook', reason: 'other plugin' } })
    end(session, 3, { kind: 'completed' })
    expect(write).not.toHaveBeenCalled()
  })

  it('deduplicates the same session/turn but prints different sessions or turns', async () => {
    const { ctx, session, write } = await setup()
    const event = end(session, 1, interrupted())
    ctx.emit('session/event', session, event)
    expect(write).toHaveBeenCalledTimes(1)
    end(session, 2, interrupted())
    const second = ctx.sessions.create(SessionId('other-session'))
    end(second, 1, interrupted())
    expect(write).toHaveBeenCalledTimes(3)
  })

  it('unsubscribes on plugin disposal without stopping the session store', async () => {
    const { session, write, fiber } = await setup()
    end(session, 1, interrupted())
    await fiber!.dispose()
    end(session, 2, interrupted())
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('clears session bookkeeping when the host disposes a session', async () => {
    const { ctx, session, write } = await setup()
    const event = end(session, 1, interrupted())
    ctx.emit('session/disposed', session)
    ctx.emit('session/event', session, event)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('strips ANSI, OSC, control-line injection and bidi while retaining readable reason', async () => {
    const { session, write } = await setup()
    end(session, 1, interrupted('\u001b[31m拒绝\u001b[0m\u001b]52;c;clipboard\u0007\r\n伪行\u202e\u0000'))
    const output = String(write.mock.calls[0]?.[0])
    expect(output).toContain('拒绝')
    expect(output).not.toContain('clipboard')
    expect(output.slice(0, -1)).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202e]/u)
    expect(output.split('\n')).toHaveLength(2)
  })

  it('bounds the terminal reason independently of the persisted event', async () => {
    const { session, write } = await setup()
    const reason = interrupted('x'.repeat(10000))
    const event = end(session, 1, reason)
    expect(String(write.mock.calls[0]?.[0]).length).toBeLessThan(4300)
    expect(event.data.reason).toEqual(reason)
  })
})
