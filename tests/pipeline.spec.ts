import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ActionReviewRuntime from '../src/service.ts'
import { apply as applyPolicy, inject as policyInject } from '../src/policy.ts'

const signal = new AbortController().signal

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: '/workspace' })
  await ctx.plugin(ActionReviewRuntime)
  await ctx.plugin({ inject: policyInject, apply: applyPolicy }, { hardDenyToolNames: ['root_destroy'] })
  ctx.actionReview.registerReviewer({
    id: 'fixture',
    review: async () => ({
      schemaVersion: 1,
      outcome: 'approved',
      riskLevel: 'medium',
      rationale: 'fixture grant',
      policyRuleIds: ['FIXTURE'],
      uncertainty: '',
    }),
  })
  let executions = 0
  const tool = (name: string) => defineTool({
    name,
    description: name,
    parameters: { path: { type: 'string' }, command: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      executions += 1
      return 'ran'
    },
  })
  ctx.tools.register(tool('read_file'))
  ctx.tools.register(tool('bash'))
  ctx.tools.register(tool('root_destroy'))
  ctx.tools.register(tool('extension_magic'))
  return { ctx, executions: () => executions }
}

describe('native tools pipeline composition', () => {
  it('preserves the workspace fast path and reviews process execution', async () => {
    const { ctx, executions } = await harness()
    await expect(ctx.tools.execute({
      callId: CallId('read'), name: 'read_file', arguments: { path: 'src/a.ts' }, signal,
    })).resolves.toMatchObject({ isError: false, value: 'ran' })
    await expect(ctx.tools.execute({
      callId: CallId('bash'), name: 'bash', arguments: { command: 'echo ok' }, signal,
    })).resolves.toMatchObject({ isError: false, value: 'ran' })
    expect(executions()).toBe(2)
  })

  it('keeps hard denial monotonic and unknown extensions fail closed to manual', async () => {
    const { ctx, executions } = await harness()
    const denied = await ctx.tools.execute({
      callId: CallId('hard'), name: 'root_destroy', arguments: {}, signal,
    })
    expect(denied).toMatchObject({ isError: true })
    expect(denied.content[0]).toMatchObject({ text: expect.stringContaining('hard policy denied') })

    const unknown = await ctx.tools.execute({
      callId: CallId('unknown'), name: 'extension_magic', arguments: {}, signal,
    })
    expect(unknown).toMatchObject({ isError: true })
    expect(unknown.content[0]).toMatchObject({ text: expect.stringContaining('manual approval') })
    expect(executions()).toBe(0)
  })
})
