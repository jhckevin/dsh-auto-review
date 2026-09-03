import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { evaluateAutoReviewAudit } from '../src/eval.ts'
import type { AutoReviewAuditEnvelope } from '../src/types.ts'

function envelope(sequence: number, kind: AutoReviewAuditEnvelope['kind'], data: unknown): AutoReviewAuditEnvelope {
  return {
    schemaVersion: 1,
    processInstanceId: 'fixture',
    sequence,
    kind,
    data,
    recordDigest: `${sequence}`.padStart(64, '0'),
  } as AutoReviewAuditEnvelope
}

describe('offline Auto Review evaluation', () => {
  it('reconstructs the action funnel and detects broken correlations', () => {
    const digest = 'd'.repeat(64)
    const records = [
      envelope(1, 'routed', {
        schemaVersion: 1, actionId: 'a', actionDigest: digest, callId: ToolCallId('c'), rootCallId: ToolCallId('c'),
        toolName: 'bash', actionKind: 'process', disposition: 'review', resolverId: 'builtin', sandboxMode: 'workspace-write', pathCount: 0, routedAt: 1,
      }),
      envelope(2, 'decision', {
        schemaVersion: 1, actionId: 'a', actionDigest: digest, toolName: 'bash', actionKind: 'process', disposition: 'review', turn: 1,
        mode: 'enforcing', reviewer: 'fixture', decision: { schemaVersion: 1, outcome: 'approved', riskLevel: 'low', rationale: 'ok', policyRuleIds: ['X'], uncertainty: '' },
        startedAt: 2, finishedAt: 9, latencyMs: 7,
      }),
      envelope(3, 'ticket', {
        state: 'consumed', ticketId: 'missing', actionId: 'a', actionDigest: digest, policyDigest: 'p', boundaryDigest: 'b', callId: ToolCallId('c'), grant: 'auto-review', at: 10,
      }),
      envelope(4, 'result', {
        schemaVersion: 1, actionId: 'a', actionDigest: digest, callId: ToolCallId('c'), rootCallId: ToolCallId('c'), toolName: 'bash', actionKind: 'process', disposition: 'review',
        approvalPath: 'auto-review', reviewOutcome: 'approved', finalOutcome: 'success', resultDigest: 'r', routedAt: 1, finishedAt: 11,
      }),
    ]
    const evaluation = evaluateAutoReviewAudit(records)
    expect(evaluation.metrics).toMatchObject({ totalActions: 1, autoReviewed: 1, approved: 1, successfulActions: 1, approvalRate: 1 })
    expect(evaluation.completeActions).toBe(1)
    expect(evaluation.incompleteActionDigests).toEqual([])
    expect(evaluation.anomalies).toEqual(['ticket-consumed-without-issue:missing'])
  })
})
