import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentFactory, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  CallId,
  createMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply as applyProvider } from '../src/llm-provider.ts'
import ActionReviewRuntime from '../src/service.ts'
import type { ActionEnvelope } from '../src/types.ts'

const action: ActionEnvelope = Object.freeze({
  schemaVersion: 1,
  actionId: 'call:deadbeef',
  actionDigest: 'd'.repeat(64),
  policyDigest: 'e'.repeat(64),
  boundaryDigest: 'f'.repeat(64),
  callId: CallId('call'),
  rootCallId: CallId('call'),
  toolName: 'bash',
  arguments: { command: 'echo ok', token: 'sk-secret' },
  actionKind: 'process',
  disposition: 'review',
  reason: 'process',
  resolverId: 'builtin',
  effects: [{ type: 'process.exec', commandDigest: 'a'.repeat(64) }],
  policy: { mode: 'enforcing', resolverId: 'builtin', disposition: 'review', ruleIds: ['TEST'] },
  boundary: { sandboxMode: 'workspace-write', workspaceRoot: '/workspace', realpathVerified: false },
  sandbox: { mode: 'workspace-write', workspaceRoot: '/workspace' },
  paths: [],
  authority: {
    sessionId: 'parent',
    turn: 3,
    currentUserRequest: 'Run the diagnostic.',
    transcript: [{ role: 'user', trust: 'trusted-user-intent', text: 'Run the diagnostic.' }],
  },
})

const approved = JSON.stringify({
  schemaVersion: 1,
  outcome: 'approved',
  riskLevel: 'low',
  rationale: 'The exact diagnostic is authorized.',
  policyRuleIds: ['TEST'],
  uncertainty: '',
})

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ReviewAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [{ id: 'low' as never, name: 'Low' }],
        defaultEffort: 'low' as never,
      },
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* textResponse(approved)
  }
}

function assistantEvent(text: string): SessionEvent {
  return {
    seq: 0,
    time: 1,
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'fixture-provider', model: 'fixture-reviewer' },
      }),
    },
  } as SessionEvent
}

async function fixture(outputs: string[], fixtureOptions: { hang?: boolean; timeoutMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ActionReviewRuntime)
  let creates = 0
  let disposes = 0
  let setupCalls = 0
  const prompts: string[] = []
  const factory: AgentFactory = {
    async createAgent(ownerCtx, options): Promise<AgentHandle> {
      const output = outputs[Math.min(creates, outputs.length - 1)] ?? approved
      creates += 1
      if (options.setup !== undefined) {
        setupCalls += 1
      }
      const events: SessionEvent[] = [assistantEvent(output)]
      const agent = {
        id: options.sessionId,
        options: options.agentOptions ?? {},
        session: { id: options.sessionId, events, header: { cwd: options.meta?.cwd } },
        followup(message: { content: Array<{ type: string; text?: string }> }) {
          prompts.push(message.content.map(block => block.type === 'text' ? block.text ?? '' : '').join(''))
        },
        whenIdle: fixtureOptions.hang === true ? () => new Promise<void>(() => undefined) : async () => undefined,
      } as unknown as Agent
      return {
        agent,
        dispose: async () => { disposes += 1 },
      }
    },
    async resumeAgent(): Promise<AgentHandle> {
      throw new Error('not used')
    },
  }
  ctx.agents.setFactory(factory)
  applyProvider(ctx, {
    provider: 'fixture-provider',
    model: 'fixture-reviewer',
    reasoningEffort: 'low',
    maxInputBytes: 65536,
    maxOutputTokens: 512,
    timeoutMs: fixtureOptions.timeoutMs ?? 5000,
    maxAttempts: 3,
    retryDelayMs: 0,
  })
  return { ctx, stats: () => ({ creates, disposes, setupCalls, prompts }) }
}

describe('isolated reviewer agent provider', () => {
  it('creates and disposes a dedicated no-tool Agent/Session for one review', async () => {
    const { ctx, stats } = await fixture([approved])
    const decision = await ctx.actionReview.review(action, undefined, new AbortController().signal)
    expect(decision.outcome).toBe('approved')
    const state = stats()
    expect(state).toMatchObject({ creates: 1, disposes: 1, setupCalls: 1 })
    expect(state.prompts[0]).toContain('trusted-user-intent')
    expect(state.prompts[0]).not.toContain('sk-secret')
    expect(ctx.agents.roots()).toEqual([])
  })

  it('uses a fresh session for each retry and stops after a valid closed decision', async () => {
    const { ctx, stats } = await fixture(['not-json', approved])
    const decision = await ctx.actionReview.review(action, undefined, new AbortController().signal)
    expect(decision.outcome).toBe('approved')
    expect(stats()).toMatchObject({ creates: 2, disposes: 2, setupCalls: 2 })
  })

  it('bounds an uncooperative reviewer by the total timeout and disposes its Agent', async () => {
    const { ctx, stats } = await fixture([approved], { hang: true, timeoutMs: 20 })
    const decision = await ctx.actionReview.review(action, undefined, new AbortController().signal)
    expect(decision.outcome).toBe('unavailable')
    expect(decision.policyRuleIds).toEqual(['AR-FAIL-CLOSED'])
    expect(stats()).toMatchObject({ creates: 1, disposes: 1 })
  })

  it('propagates caller cancellation to the waiting boundary and disposes its Agent', async () => {
    const { ctx, stats } = await fixture([approved], { hang: true, timeoutMs: 5000 })
    const controller = new AbortController()
    const review = ctx.actionReview.review(action, undefined, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort(new Error('cancelled by fixture'))
    const decision = await review
    expect(decision.outcome).toBe('unavailable')
    expect(stats()).toMatchObject({ creates: 1, disposes: 1 })
  })

  it('runs through the real AgentLoop with an empty tool surface and isolated prompt', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: 'Main coding agent persona that must not reach the reviewer.' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(ActionReviewRuntime)
    const adapter = new ReviewAdapter()
    ctx.llm.registerAdapter(['fixture-provider'], adapter)
    applyProvider(ctx, {
      provider: 'fixture-provider',
      model: 'fixture-reviewer',
      reasoningEffort: 'low',
      maxInputBytes: 65536,
      maxOutputTokens: 512,
      timeoutMs: 5000,
      maxAttempts: 1,
      retryDelayMs: 0,
    })

    await expect(ctx.actionReview.review(action, undefined, new AbortController().signal))
      .resolves.toMatchObject({ outcome: 'approved' })
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.tools ?? []).toEqual([])
    expect(adapter.requests[0]?.system).toContain('isolated Auto Review decision component')
    expect(adapter.requests[0]?.system).not.toContain('Main coding agent persona')
    expect(adapter.requests[0]?.provider).toBe('fixture-provider')
    expect(adapter.requests[0]?.model).toBe('fixture-reviewer')
    expect(String(adapter.requests[0]?.reasoningEffort)).toBe('low')
    expect(ctx.agents.roots()).toEqual([])
    expect(ctx.sessions.list()).toEqual([])
  })
})
