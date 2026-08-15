import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import ActionReviewRuntime from '../src/service.ts'
import { apply as applyPolicy, inject as policyInject } from '../src/policy.ts'
import type { ReviewOutcome } from '../src/types.ts'

const signal = new AbortController().signal

function fakeAgent() {
  const events = [
    { type: 'turn/start', data: {} },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'Run the exact diagnostic command if needed.' }], source: { kind: 'user' } } },
  ] as unknown as SessionEvent[]
  const appended: Array<{ type: string; data: Record<string, unknown> }> = []
  const agent = {
    session: {
      id: 'session-auto-review',
      header: { cwd: '/workspace' },
      events,
      append: (type: string, data: Record<string, unknown>) => {
        const event = { type, data } as unknown as SessionEvent
        events.push(event)
        appended.push({ type, data })
        return event
      },
    },
  } as unknown as Agent
  return { agent, appended }
}

async function harness(reviewOutcome: ReviewOutcome = 'approved') {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: '/workspace' })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(ActionReviewRuntime)
  await ctx.plugin({ inject: policyInject, apply: applyPolicy }, { hardDenyToolNames: ['root_destroy'] })
  const reviewed: Array<{ authority: { currentUserRequest?: string } }> = []
  ctx.actionReview.registerReviewer({
    id: 'fixture',
    review: async (request) => {
      reviewed.push(request.action)
      return {
        schemaVersion: 1,
        outcome: reviewOutcome,
        riskLevel: 'medium',
        rationale: 'fixture grant',
        policyRuleIds: ['FIXTURE'],
        uncertainty: '',
      }
    },
  })
  let executions = 0
  const tool = (name: string) => defineTool({
    name,
    description: name,
    parameters: {
      path: { type: 'string' },
      command: { type: 'string' },
      sandbox_permissions: { type: 'string' },
      justification: { type: 'string' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const values = args as Record<string, unknown>
      if (typeof values.sandbox_permissions === 'string') {
        if (exec.agent === undefined) throw new Error('agent required')
        const outcome = await ctx.approval.request({
          agent: exec.agent,
          toolName: name,
          callId: exec.callId,
          reason: `escalate sandbox to ${values.sandbox_permissions}: ${String(values.justification ?? '')}`,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') throw new Error(`approval ${outcome}`)
      }
      executions += 1
      return 'ran'
    },
  })
  ctx.tools.register(tool('read_file'))
  ctx.tools.register(tool('bash'))
  ctx.tools.register(tool('root_destroy'))
  ctx.tools.register(tool('extension_magic'))
  return { ctx, executions: () => executions, reviewed }
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
    expect(denied.content[0]?.type === 'text' ? denied.content[0].text : '').toContain('hard policy denied')

    const unknown = await ctx.tools.execute({
      callId: CallId('unknown'), name: 'extension_magic', arguments: {}, signal,
    })
    expect(unknown).toMatchObject({ isError: true })
    expect(unknown.content[0]?.type === 'text' ? unknown.content[0].text : '').toContain('approval')
    expect(executions()).toBe(0)
  })

  it('bridges one approved review into exactly one native sandbox grant and closes the audit chain', async () => {
    const { ctx, executions, reviewed } = await harness('approved')
    const { agent, appended } = fakeAgent()
    let manualAnswers = 0
    ctx.on('approval/request', () => {
      manualAnswers += 1
      return Promise.resolve('rejected' as const)
    })
    const result = await ctx.tools.execute({
      callId: CallId('escalate'),
      name: 'bash',
      arguments: {
        command: 'echo ok',
        sandbox_permissions: 'danger-full-access',
        justification: 'run outside the workspace sandbox',
      },
      agent,
      signal,
    })
    expect(result).toMatchObject({ isError: false, value: 'ran' })
    expect(executions()).toBe(1)
    expect(manualAnswers).toBe(0)
    expect(reviewed[0]?.authority.currentUserRequest).toBe('Run the exact diagnostic command if needed.')
    expect(appended.map(event => event.type)).toEqual([
      'auto-review/routed',
      'auto-review/decision',
      'approval/asked',
      'approval/decided',
      'auto-review/result',
    ])
    expect(appended.find(event => event.type === 'approval/decided')?.data).toMatchObject({ outcome: 'allowed-once' })
    expect(appended.find(event => event.type === 'auto-review/result')?.data).toMatchObject({
      approvalPath: 'auto-review',
      reviewOutcome: 'approved',
      finalOutcome: 'success',
    })
  })

  it('delegates an uncertain escalation to the native human answerer once', async () => {
    const { ctx, executions } = await harness('manual')
    const { agent, appended } = fakeAgent()
    let manualAnswers = 0
    ctx.on('approval/request', () => {
      manualAnswers += 1
      return Promise.resolve('allowed-once' as const)
    })
    const result = await ctx.tools.execute({
      callId: CallId('manual-escalate'),
      name: 'bash',
      arguments: {
        command: 'echo ok',
        sandbox_permissions: 'danger-full-access',
        justification: 'run outside the workspace sandbox',
      },
      agent,
      signal,
    })
    expect(result).toMatchObject({ isError: false })
    expect(executions()).toBe(1)
    expect(manualAnswers).toBe(1)
    expect(appended.find(event => event.type === 'auto-review/result')?.data).toMatchObject({
      approvalPath: 'native-manual',
      reviewOutcome: 'manual',
      finalOutcome: 'success',
    })
  })

  it('denies an escalation before the tool body and records the final failure', async () => {
    const { ctx, executions } = await harness('denied')
    const { agent, appended } = fakeAgent()
    let manualAnswers = 0
    ctx.on('approval/request', () => {
      manualAnswers += 1
      return Promise.resolve('allowed-once' as const)
    })
    const result = await ctx.tools.execute({
      callId: CallId('denied-escalate'),
      name: 'bash',
      arguments: {
        command: 'echo ok',
        sandbox_permissions: 'danger-full-access',
        justification: 'run outside the workspace sandbox',
      },
      agent,
      signal,
    })
    expect(result).toMatchObject({ isError: true })
    expect(executions()).toBe(0)
    expect(manualAnswers).toBe(0)
    expect(appended.find(event => event.type === 'auto-review/result')?.data).toMatchObject({
      approvalPath: 'auto-review',
      reviewOutcome: 'denied',
      finalOutcome: 'error',
    })
  })
})
