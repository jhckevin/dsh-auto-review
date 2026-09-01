import type { SerializedPartialPermissionProfile } from './types.ts'

export class ApprovalProtocolError extends Error {
  readonly kind = 'approval_protocol_error'
}

type JsonObject = Record<string, unknown>
const object = (value: unknown, label: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApprovalProtocolError(label + ' must be an object')
  }
  return value as JsonObject
}
const exactKeys = (value: JsonObject, allowed: readonly string[], label: string): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new ApprovalProtocolError(label + ' has unknown fields: ' + unknown.join(', '))
}
const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new ApprovalProtocolError(label + ' must be a string')
  return value
}
const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new ApprovalProtocolError(label + ' must be a boolean')
  return value
}

export type CoreApprovalsReviewer = 'user' | 'auto_review'
export function parseCoreApprovalsReviewer(value: unknown = 'user'): CoreApprovalsReviewer {
  if (value === 'user') return 'user'
  if (value === 'auto_review' || value === 'guardian_subagent') return 'auto_review'
  throw new ApprovalProtocolError('invalid core approvals reviewer')
}
export function parseV2ApprovalsReviewer(value: unknown): CoreApprovalsReviewer {
  if (value === undefined) throw new ApprovalProtocolError('v2 approvalsReviewer has no default')
  return parseCoreApprovalsReviewer(value)
}

export interface CoreGranularApprovalConfig {
  sandbox_approval: boolean
  rules: boolean
  skill_approval: boolean
  request_permissions: boolean
  mcp_elicitations: boolean
}
export type CoreAskForApproval =
  | 'untrusted'
  | 'on-request'
  | 'never'
  | { granular: CoreGranularApprovalConfig }

const parseGranular = (value: unknown): CoreGranularApprovalConfig => {
  const input = object(value, 'granular')
  exactKeys(input, ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations'], 'granular')
  return {
    sandbox_approval: boolean(input.sandbox_approval, 'granular.sandbox_approval'),
    rules: boolean(input.rules, 'granular.rules'),
    skill_approval: input.skill_approval === undefined ? false : boolean(input.skill_approval, 'granular.skill_approval'),
    request_permissions: input.request_permissions === undefined ? false : boolean(input.request_permissions, 'granular.request_permissions'),
    mcp_elicitations: boolean(input.mcp_elicitations, 'granular.mcp_elicitations'),
  }
}
export function parseCoreAskForApproval(value: unknown = 'on-request'): CoreAskForApproval {
  if (value === 'on-failure') return 'on-request'
  if (value === 'untrusted' || value === 'on-request' || value === 'never') return value
  const input = object(value, 'core ask_for_approval')
  exactKeys(input, ['granular'], 'core ask_for_approval')
  if (!Object.hasOwn(input, 'granular')) throw new ApprovalProtocolError('core ask_for_approval requires granular')
  return { granular: parseGranular(input.granular) }
}
export function parseV2AskForApproval(value: unknown): CoreAskForApproval {
  if (value === undefined || value === 'on-failure') {
    throw new ApprovalProtocolError('v2 askForApproval has no default or on-failure alias')
  }
  return parseCoreAskForApproval(value)
}

export interface NetworkApprovalContext { host: string; protocol: 'http' | 'https' | 'socks5_tcp' | 'socks5_udp' }
export interface NetworkPolicyAmendment { host: string; action: 'allow' | 'deny' }
export type CoreReviewDecision =
  | 'approved'
  | 'approved_for_session'
  | 'approved_mcp_policy_amendment'
  | 'timed_out'
  | 'abort'
  | { approved_execpolicy_amendment: { proposed_execpolicy_amendment: string[] } }
  | { network_policy_amendment: { network_policy_amendment: NetworkPolicyAmendment } }
  | { denied: { rejection: string } }

export function parseCoreReviewDecision(value: unknown): CoreReviewDecision {
  if (value === 'approved' || value === 'approved_for_session' || value === 'approved_mcp_policy_amendment' || value === 'timed_out' || value === 'abort') return value
  const input = object(value, 'review_decision')
  const variants = ['approved_execpolicy_amendment', 'network_policy_amendment', 'denied'].filter((key) => Object.hasOwn(input, key))
  if (variants.length !== 1 || Object.keys(input).length !== 1) throw new ApprovalProtocolError('review_decision must contain exactly one variant')
  const variant = variants[0]!
  const payload = object(input[variant], variant)
  if (variant === 'approved_execpolicy_amendment') {
    exactKeys(payload, ['proposed_execpolicy_amendment'], variant)
    const amendment = payload.proposed_execpolicy_amendment
    if (!Array.isArray(amendment) || !amendment.every((part) => typeof part === 'string')) throw new ApprovalProtocolError('execpolicy amendment must be string[]')
    return { approved_execpolicy_amendment: { proposed_execpolicy_amendment: [...amendment] as string[] } }
  }
  if (variant === 'network_policy_amendment') {
    exactKeys(payload, ['network_policy_amendment'], variant)
    const amendment = object(payload.network_policy_amendment, 'network_policy_amendment')
    exactKeys(amendment, ['host', 'action'], 'network_policy_amendment')
    if (amendment.action !== 'allow' && amendment.action !== 'deny') throw new ApprovalProtocolError('invalid network action')
    return { network_policy_amendment: { network_policy_amendment: { host: string(amendment.host, 'network host'), action: amendment.action } } }
  }
  exactKeys(payload, ['rejection'], 'denied')
  return { denied: { rejection: string(payload.rejection, 'denied.rejection') } }
}

export type V2CommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: NetworkPolicyAmendment } }
export function coreDecisionToV2CommandDecision(value: CoreReviewDecision): V2CommandExecutionApprovalDecision {
  if (value === 'approved') return 'accept'
  if (value === 'approved_for_session') return 'acceptForSession'
  if (value === 'abort') return 'cancel'
  if (typeof value === 'object' && 'approved_execpolicy_amendment' in value) {
    return { acceptWithExecpolicyAmendment: { execpolicy_amendment: value.approved_execpolicy_amendment.proposed_execpolicy_amendment } }
  }
  if (typeof value === 'object' && 'network_policy_amendment' in value) {
    return { applyNetworkPolicyAmendment: { network_policy_amendment: value.network_policy_amendment.network_policy_amendment } }
  }
  return 'decline'
}

export type CoreExecApprovalKind = 'command' | 'write_stdin'
export type CoreParsedCommand =
  | { type: 'read'; cmd: string; name: string; path: string }
  | { type: 'list_files'; cmd: string; path: string | null }
  | { type: 'search'; cmd: string; query: string | null; path: string | null }
  | { type: 'unknown'; cmd: string }
export interface CoreExecApprovalRequestEvent {
  kind: CoreExecApprovalKind
  call_id: string
  plugin_id?: string
  script_path?: string
  approval_id?: string
  turn_id: string
  environmentId?: string
  started_at_ms: number
  command: string[]
  cwd: string
  reason?: string
  network_approval_context?: NetworkApprovalContext
  proposed_execpolicy_amendment?: string[]
  proposed_network_policy_amendments?: NetworkPolicyAmendment[]
  additional_permissions?: SerializedPartialPermissionProfile
  available_decisions?: CoreReviewDecision[]
  parsed_cmd: CoreParsedCommand[]
}
export function effectiveExecApprovalId(event: CoreExecApprovalRequestEvent): string {
  return event.approval_id ?? event.call_id
}
export function effectiveExecAvailableDecisions(event: CoreExecApprovalRequestEvent): CoreReviewDecision[] {
  if (event.available_decisions !== undefined) return event.available_decisions.map(parseCoreReviewDecision)
  if (event.network_approval_context !== undefined) {
    const decisions: CoreReviewDecision[] = ['approved', 'approved_for_session']
    const amendment = event.proposed_network_policy_amendments?.find((candidate) => candidate.action === 'allow')
    if (amendment !== undefined) decisions.push({ network_policy_amendment: { network_policy_amendment: amendment } })
    decisions.push('abort')
    return decisions
  }
  if (event.additional_permissions !== undefined) return ['approved', 'abort']
  const decisions: CoreReviewDecision[] = ['approved']
  if (event.proposed_execpolicy_amendment !== undefined) decisions.push({ approved_execpolicy_amendment: { proposed_execpolicy_amendment: event.proposed_execpolicy_amendment } })
  decisions.push('abort')
  return decisions
}

export type CoreFileChange =
  | { type: 'add'; content: string }
  | { type: 'delete'; content: string }
  | { type: 'update'; unified_diff: string; move_path: string | null }
export function parseCoreFileChange(value: unknown): CoreFileChange {
  const input = object(value, 'core file change')
  if (input.type === 'add') return { type: 'add', content: string(input.content, 'file change content') }
  if (input.type === 'delete') return { type: 'delete', content: string(input.content, 'file change content') }
  if (input.type === 'update') {
    return {
      type: 'update',
      unified_diff: string(input.unified_diff, 'file change unified_diff'),
      move_path: input.move_path === undefined || input.move_path === null ? null : string(input.move_path, 'file change move_path'),
    }
  }
  throw new ApprovalProtocolError('core file change has missing or unknown type')
}
export interface CoreApplyPatchApprovalRequestEvent {
  call_id: string
  turn_id: string
  started_at_ms: number
  changes: Record<string, CoreFileChange>
  reason?: string
  grant_root?: string
}
export function parseCoreApplyPatchApprovalRequestEvent(value: unknown): CoreApplyPatchApprovalRequestEvent {
  const input = object(value, 'core apply patch approval request')
  const changes = object(input.changes, 'changes')
  if (!Number.isSafeInteger(input.started_at_ms)) throw new ApprovalProtocolError('started_at_ms must be a safe i64 integer')
  const result: CoreApplyPatchApprovalRequestEvent = {
    call_id: string(input.call_id, 'call_id'),
    turn_id: input.turn_id === undefined ? '' : string(input.turn_id, 'turn_id'),
    started_at_ms: input.started_at_ms as number,
    changes: Object.fromEntries(Object.entries(changes).map(([path, change]) => [path, parseCoreFileChange(change)])),
  }
  if (input.reason !== undefined && input.reason !== null) result.reason = string(input.reason, 'reason')
  if (input.grant_root !== undefined && input.grant_root !== null) result.grant_root = string(input.grant_root, 'grant_root')
  return result
}
export interface V2FileChangeRequestApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  startedAtMs: number
  reason: string | null
  grantRoot: string | null
}
export function parseV2FileChangeRequestApprovalParams(value: unknown): V2FileChangeRequestApprovalParams {
  const input = object(value, 'v2 file change request')
  exactKeys(input, ['threadId', 'turnId', 'itemId', 'startedAtMs', 'reason', 'grantRoot'], 'v2 file change request')
  if (!Number.isSafeInteger(input.startedAtMs)) throw new ApprovalProtocolError('startedAtMs must be a safe i64 integer')
  return {
    threadId: string(input.threadId, 'threadId'),
    turnId: string(input.turnId, 'turnId'),
    itemId: string(input.itemId, 'itemId'),
    startedAtMs: input.startedAtMs as number,
    reason: input.reason === undefined || input.reason === null ? null : string(input.reason, 'reason'),
    grantRoot: input.grantRoot === undefined || input.grantRoot === null ? null : string(input.grantRoot, 'grantRoot'),
  }
}

export type ApprovalRoute = 'user' | 'guardian'
export function approvalRoute(policy: CoreAskForApproval, reviewer: CoreApprovalsReviewer, strict: boolean): ApprovalRoute {
  if (strict) return 'guardian'
  return reviewer === 'auto_review' && (policy === 'on-request' || typeof policy === 'object') ? 'guardian' : 'user'
}
