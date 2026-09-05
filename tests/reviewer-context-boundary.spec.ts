import { expect, it } from 'vitest'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { ActionRouter } from '../src/router.ts'

it('excludes private reasoning while retaining user-visible evidence and older direct scope', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Only inspect this workspace.' }] } },
    ...Array.from({ length: 16 }, (_, n) => ({ type: 'assistant/message', data: { message: { content: [
      { type: 'reasoning', text: 'PRIVATE_REASONING_MUST_NOT_LEAVE_' + n },
      { type: 'text', text: 'Public update ' + n },
    ] } } })),
  ]
  const router = new ActionRouter()
  // Immutable log projection fixture: exercise both supported session reader APIs.
  for (const session of [{ id: 'test', events }, { id: 'test', snapshotEvents: () => events }]) {
    const action = router.route({
      token: Symbol('context'), callId: 'context', rootCallId: 'context',
      name: 'bash', arguments: { command: 'node --version' }, signal: new AbortController().signal,
      agent: { session },
    } as unknown as ToolExecution, { mode: 'workspace-write', workspaceRoot: '/workspace' })
    expect(action.authority.currentUserRequest).toBe('Only inspect this workspace.')
    expect(action.authority.transcript).toHaveLength(12)
    expect(JSON.stringify(action.authority)).not.toContain('PRIVATE_REASONING')
    expect(JSON.stringify(action.authority)).toContain('Public update 15')
  }
})
