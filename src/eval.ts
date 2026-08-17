import type {
  AutoReviewAuditEnvelope,
  AutoReviewAuditPayloadMap,
  AutoReviewMetricsSnapshot,
  ReviewOutcome,
} from './types.ts'

export interface AutoReviewEvaluation {
  readonly metrics: AutoReviewMetricsSnapshot
  readonly completeActions: number
  readonly incompleteActionDigests: readonly string[]
  readonly anomalies: readonly string[]
}

interface MutableEvaluation {
  totalActions: number
  insideBoundary: number
  autoReviewed: number
  approved: number
  denied: number
  manual: number
  unavailable: number
  hardDenied: number
  successfulActions: number
  failedActions: number
  ticketRejected: number
  retriedDeniedAction: number
  retriedEquivalentEffect: number
  continuedWithDifferentAction: number
  stoppedAfterDenial: number
  latencyCount: number
  latencySum: number
  latencyMax: number
  readonly byActionKind: Map<string, number>
}

function incrementOutcome(state: MutableEvaluation, outcome: ReviewOutcome): void {
  switch (outcome) {
    case 'approved': state.approved += 1; break
    case 'denied': state.denied += 1; break
    case 'manual': state.manual += 1; break
    case 'unavailable': state.unavailable += 1; break
  }
}

/** Fold archived audit facts without loading a Harness runtime or contacting a model. */
export function evaluateAutoReviewAudit(records: readonly AutoReviewAuditEnvelope[]): AutoReviewEvaluation {
  const state: MutableEvaluation = {
    totalActions: 0, insideBoundary: 0, autoReviewed: 0, approved: 0, denied: 0,
    manual: 0, unavailable: 0, hardDenied: 0, successfulActions: 0, failedActions: 0,
    ticketRejected: 0, retriedDeniedAction: 0, retriedEquivalentEffect: 0, continuedWithDifferentAction: 0,
    stoppedAfterDenial: 0, latencyCount: 0, latencySum: 0, latencyMax: 0,
    byActionKind: new Map(),
  }
  const routed = new Set<string>()
  const completed = new Set<string>()
  const issuedTickets = new Set<string>()
  const anomalies: string[] = []

  for (const record of records) {
    switch (record.kind) {
      case 'routed': {
        const data = record.data as AutoReviewAuditPayloadMap['routed']
        state.totalActions += 1
        routed.add(data.actionDigest)
        if (data.disposition === 'inside-boundary') state.insideBoundary += 1
        if (data.disposition === 'hard-deny') state.hardDenied += 1
        state.byActionKind.set(data.actionKind, (state.byActionKind.get(data.actionKind) ?? 0) + 1)
        break
      }
      case 'decision': {
        const data = record.data as AutoReviewAuditPayloadMap['decision']
        state.autoReviewed += 1
        incrementOutcome(state, data.decision.outcome)
        state.latencyCount += 1
        state.latencySum += data.latencyMs
        state.latencyMax = Math.max(state.latencyMax, data.latencyMs)
        if (!routed.has(data.actionDigest)) anomalies.push(`decision-without-route:${data.actionDigest}`)
        break
      }
      case 'ticket': {
        const data = record.data as AutoReviewAuditPayloadMap['ticket']
        if (data.state === 'issued') issuedTickets.add(data.ticketId)
        if (data.state === 'consumed' && !issuedTickets.has(data.ticketId)) {
          anomalies.push(`ticket-consumed-without-issue:${data.ticketId}`)
        }
        if (data.state === 'rejected' || data.state === 'expired') state.ticketRejected += 1
        break
      }
      case 'result': {
        const data = record.data as AutoReviewAuditPayloadMap['result']
        completed.add(data.actionDigest)
        if (data.finalOutcome === 'success') state.successfulActions += 1
        else state.failedActions += 1
        if (!routed.has(data.actionDigest)) anomalies.push(`result-without-route:${data.actionDigest}`)
        break
      }
      case 'postDenial': {
        const data = record.data as AutoReviewAuditPayloadMap['postDenial']
        if (data.outcome === 'retried-denied-action') state.retriedDeniedAction += 1
        else if (data.outcome === 'retried-equivalent-effect') state.retriedEquivalentEffect += 1
        else if (data.outcome === 'continued-with-different-action') state.continuedWithDifferentAction += 1
        else state.stoppedAfterDenial += 1
        break
      }
      default:
        break
    }
  }

  const incompleteActionDigests = [...routed].filter(digest => !completed.has(digest)).sort()
  const approvalRate = state.autoReviewed === 0 ? 0 : state.approved / state.autoReviewed
  const effectiveAutomationRate = state.totalActions === 0 ? 0 : (state.insideBoundary + state.approved) / state.totalActions
  const metrics: AutoReviewMetricsSnapshot = Object.freeze({
    totalActions: state.totalActions,
    insideBoundary: state.insideBoundary,
    autoReviewed: state.autoReviewed,
    approved: state.approved,
    denied: state.denied,
    manual: state.manual,
    unavailable: state.unavailable,
    hardDenied: state.hardDenied,
    successfulActions: state.successfulActions,
    failedActions: state.failedActions,
    ticketRejected: state.ticketRejected,
    retriedDeniedAction: state.retriedDeniedAction,
    retriedEquivalentEffect: state.retriedEquivalentEffect,
    continuedWithDifferentAction: state.continuedWithDifferentAction,
    stoppedAfterDenial: state.stoppedAfterDenial,
    reviewerLatencyMs: Object.freeze({ count: state.latencyCount, mean: state.latencyCount === 0 ? 0 : state.latencySum / state.latencyCount, max: state.latencyMax }),
    approvalRate,
    effectiveAutomationRate,
    byActionKind: Object.freeze(Object.fromEntries([...state.byActionKind.entries()].sort(([left], [right]) => left < right ? -1 : 1))),
  })
  return Object.freeze({ metrics, completeActions: completed.size, incompleteActionDigests: Object.freeze(incompleteActionDigests), anomalies: Object.freeze(anomalies) })
}
