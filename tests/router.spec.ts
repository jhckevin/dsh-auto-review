import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { ActionRouter } from '../src/router.ts'

const signal = new AbortController().signal

function exec(name: string, args: unknown): ToolExecution {
  return {
    callId: CallId('call-1'),
    rootCallId: CallId('call-1'),
    name,
    arguments: args,
    signal,
    token: Symbol('test'),
  } as ToolExecution
}

const sandbox = {
  mode: 'workspace-write' as const,
  workspaceRoot: '/workspace',
}

describe('ActionRouter', () => {
  it('keeps ordinary workspace reads and writes on the native fast path', () => {
    const router = new ActionRouter()
    expect(router.route(exec('read_file', { path: 'src/a.ts' }), sandbox)).toMatchObject({
      actionKind: 'workspace-read', disposition: 'inside-boundary',
    })
    expect(router.route(exec('write_file', { path: '/workspace/src/a.ts', content: 'x' }), sandbox)).toMatchObject({
      actionKind: 'workspace-write', disposition: 'inside-boundary',
    })
  })

  it('reviews process, network, sensitive and outside-workspace actions', () => {
    const router = new ActionRouter()
    expect(router.route(exec('bash', { command: 'npm publish' }), sandbox)).toMatchObject({
      actionKind: 'network', disposition: 'review',
    })
    expect(router.route(exec('web_fetch', { url: 'https://example.com' }), sandbox)).toMatchObject({
      actionKind: 'network', disposition: 'review',
    })
    expect(router.route(exec('read_file', { path: '/home/u/.ssh/id_ed25519' }), sandbox)).toMatchObject({
      actionKind: 'sensitive-read', disposition: 'review',
    })
    expect(router.route(exec('write_file', { path: '/etc/hosts', content: 'x' }), sandbox)).toMatchObject({
      actionKind: 'workspace-write', disposition: 'review',
    })
  })

  it('routes unknown extensions to manual and configured hard denies monotonically', () => {
    expect(new ActionRouter().route(exec('extension_magic', {}), sandbox)).toMatchObject({
      actionKind: 'extension-unknown', disposition: 'manual',
    })
    expect(new ActionRouter({ hardDenyToolNames: ['root_destroy'] })
      .route(exec('root_destroy', {}), sandbox)).toMatchObject({
        actionKind: 'hard-deny', disposition: 'hard-deny',
      })
  })

  it('binds the immutable action digest to arguments and sandbox boundary', () => {
    const router = new ActionRouter()
    const first = router.route(exec('bash', { command: 'echo one' }), sandbox)
    const same = router.route(exec('bash', { command: 'echo one' }), sandbox)
    const changed = router.route(exec('bash', { command: 'echo two' }), sandbox)
    expect(first.actionDigest).toBe(same.actionDigest)
    expect(first.actionDigest).not.toBe(changed.actionDigest)
    expect(first.actionId).toContain(first.actionDigest.slice(0, 16))
  })
})
