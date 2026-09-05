import { ToolCallId } from './compat-fixtures.ts'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import ActionReviewRuntime from '../src/service.ts'
import { apply as applyPolicy, inject as policyInject } from '../src/policy.ts'

// Only remove a unique directory created by this test inside its workspace.
const root = mkdtempSync(join(process.cwd(), '.sandbox-e2e-'))
const workspace = join(root, 'workspace')
const outside = join(root, 'outside')
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  rmSync(root, { recursive: true, force: true })
})

function prepare(): void {
  mkdirSync(workspace, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'sentinel.txt'), 'unchanged')
  symlinkSync(outside, join(workspace, 'escape'))
}

describe('Linux x86 native sandbox composition', () => {
  it('keeps reviewed commands inside the native workspace boundary and blocks symlink escape', async () => {
    expect(process.platform).toBe('linux')
    expect(process.arch).toBe('x64')
    prepare()
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSandboxProvider, {})
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ActionReviewRuntime, { sandboxDefaultAllow: false })
    const policy = ctx.plugin({ inject: policyInject, apply: applyPolicy })
    await policy
    expect(ctx.get('sandboxPolicy')).toBeDefined()
    expect(policy.state).toBe(2)
    ctx.actionReview.registerReviewer({
      id: 'sandbox-e2e-reviewer',
      review: async () => ({
        schemaVersion: 1, outcome: 'approved', riskLevel: 'low', rationale: 'fixture', policyRuleIds: ['E2E'], uncertainty: '',
      }),
    })
    ctx.tools.register(defineTool({
      name: 'bash',
      description: 'sandboxed shell',
      parameters: { command: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const command = (args as { command: string }).command
        const confined = ctx?.sandbox.confine(['bash', '-c', command], { mode: 'workspace-write', workspaceRoot: workspace })
        if (confined === undefined) throw new Error('sandbox unavailable')
        expect(['full', 'partial']).toContain(confined.enforcement)
        const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { encoding: 'utf8', timeout: 30_000 })
        if (result.status !== 0) throw new Error(`sandboxed command failed (${String(result.status)}): ${result.stderr}`)
        return result.stdout
      },
    }))

    const signal = new AbortController().signal
    const allowed = await ctx.tools.execute({
      callId: ToolCallId('allowed'), name: 'bash', arguments: { command: `printf allowed > ${join(workspace, 'allowed.txt')}` }, signal,
    })
    expect(allowed).toMatchObject({ isError: false })
    expect(readFileSync(join(workspace, 'allowed.txt'), 'utf8')).toBe('allowed')

    const escaped = await ctx.tools.execute({
      callId: ToolCallId('escape'), name: 'bash', arguments: { command: `printf changed > ${join(workspace, 'escape', 'sentinel.txt')}` }, signal,
    })
    expect(escaped).toMatchObject({ isError: true })
    expect(readFileSync(join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
    expect(existsSync(join(outside, 'allowed.txt'))).toBe(false)
    expect(ctx.actionReview.metrics()).toMatchObject({ totalActions: 2, autoReviewed: 2, approved: 2, successfulActions: 1, failedActions: 1 })
  })
})
