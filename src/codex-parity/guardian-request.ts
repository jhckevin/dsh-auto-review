import { shlexJoin } from './command-canonicalization.ts'
import { absolutePathToLossyString, guardianCwd, inferredNativePathString, pathUriToAbsolutePath, serializeAbsolutePath } from './path.ts'
import { serializePermissionProfile } from './permission-profile.ts'
import type {
  ApprovalAction, FormattedGuardianAction, GuardianApprovalRequest, GuardianAssessmentAction,
  GuardianReviewedAction, JsonObject, JsonValue,
} from './types.ts'

export const GUARDIAN_MAX_ACTION_STRING_TOKENS = 16_000

function omitUndefined(record: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined))
}

export function intoGuardianRequest(action: ApprovalAction): GuardianApprovalRequest {
  switch (action.type) {
    case 'exec_command': return {
      type: 'exec_command', id: action.id, command: [...action.command],
      cwd: guardianCwd(action.environmentId, action.cwd), sandboxPermissions: action.sandboxPermissions,
      ...(action.additionalPermissions === undefined ? {} : { additionalPermissions: action.additionalPermissions }),
      ...(action.justification === undefined ? {} : { justification: action.justification }), tty: action.tty,
    }
    case 'write_stdin': return { ...action }
    case 'execve': return {
      type: 'execve', id: action.id, source: action.source, program: absolutePathToLossyString(action.program),
      argv: [...action.argv], cwd: action.cwd,
      ...(action.additionalPermissions === undefined ? {} : { additionalPermissions: action.additionalPermissions }),
    }
    case 'apply_patch': return {
      type: 'apply_patch', id: action.id, cwd: guardianCwd(action.environmentId, action.cwd),
      files: action.files.map(pathUriToAbsolutePath), patch: action.patch,
    }
    case 'mcp_tool_call': return {
      type: 'mcp_tool_call', id: action.id, server: action.server, toolName: action.toolName,
      ...(action.arguments === undefined ? {} : { arguments: action.arguments }),
      ...(action.connectorId === undefined ? {} : { connectorId: action.connectorId }),
      ...(action.connectorName === undefined ? {} : { connectorName: action.connectorName }),
      ...(action.connectorDescription === undefined ? {} : { connectorDescription: action.connectorDescription }),
      ...(action.connectedAccountEmail === undefined ? {} : { connectedAccountEmail: action.connectedAccountEmail }),
      ...(action.toolTitle === undefined ? {} : { toolTitle: action.toolTitle }),
      ...(action.toolDescription === undefined ? {} : { toolDescription: action.toolDescription }),
      ...(action.annotations === undefined ? {} : { annotations: action.annotations }),
    }
    case 'network_access': return {
      type: 'network_access', id: action.id, turnId: action.turnId, target: action.target,
      host: action.host, protocol: action.protocol, port: action.port,
      ...(action.trigger === undefined ? {} : { trigger: action.trigger }),
    }
    case 'request_permissions': return { ...action }
  }
}

export function guardianApprovalRequestToJson(action: GuardianApprovalRequest): JsonObject {
  switch (action.type) {
    case 'exec_command': return omitUndefined({
      tool: 'exec_command', command: action.command, cwd: serializeAbsolutePath(action.cwd),
      sandbox_permissions: action.sandboxPermissions, additional_permissions: action.additionalPermissions === undefined ? undefined : serializePermissionProfile(action.additionalPermissions),
      justification: action.justification, tty: action.tty,
    })
    case 'write_stdin': return omitUndefined({
      tool: 'write_stdin', environment_id: action.environmentId, session_id: action.processId,
      chars: action.input, cwd: inferredNativePathString(action.cwd),
      sandbox_permissions: action.sandboxPermissions, additional_permissions: action.additionalPermissions === undefined ? undefined : serializePermissionProfile(action.additionalPermissions), tty: action.tty,
    })
    case 'execve': return omitUndefined({
      tool: action.source === 'shell' ? 'shell' : 'exec_command', program: action.program,
      argv: action.argv, cwd: serializeAbsolutePath(action.cwd), additional_permissions: action.additionalPermissions === undefined ? undefined : serializePermissionProfile(action.additionalPermissions),
    })
    case 'apply_patch': return { tool: 'apply_patch', cwd: serializeAbsolutePath(action.cwd), files: action.files.map(serializeAbsolutePath), patch: action.patch }
    case 'mcp_tool_call': return omitUndefined({
      tool: 'mcp_tool_call', server: action.server, tool_name: action.toolName, arguments: action.arguments,
      connector_id: action.connectorId, connector_name: action.connectorName,
      connector_description: action.connectorDescription, connected_account_email: action.connectedAccountEmail,
      tool_title: action.toolTitle, tool_description: action.toolDescription,
      annotations: action.annotations as JsonObject | undefined,
    })
    case 'network_access': {
      const trigger = action.trigger === undefined ? undefined : omitUndefined({
        callId: action.trigger.callId, toolName: action.trigger.toolName, command: action.trigger.command,
        cwd: inferredNativePathString(action.trigger.cwd), sandboxPermissions: action.trigger.sandboxPermissions,
        additionalPermissions: action.trigger.additionalPermissions === undefined ? undefined : serializePermissionProfile(action.trigger.additionalPermissions), justification: action.trigger.justification,
        tty: action.trigger.tty,
      })
      return omitUndefined({
        tool: 'network_access', target: action.target, host: action.host, protocol: action.protocol,
        port: action.port, trigger,
      })
    }
    case 'request_permissions': return omitUndefined({
      tool: 'request_permissions', turn_id: action.turnId, reason: action.reason, permissions: serializePermissionProfile(action.permissions),
    })
  }
}

function utf8Length(text: string): number { return Buffer.byteLength(text, 'utf8') }
function utf8Prefix(text: string, budget: number): string {
  let bytes = 0
  let output = ''
  for (const character of text) {
    const size = utf8Length(character)
    if (bytes + size > budget) break
    output += character
    bytes += size
  }
  return output
}
function utf8Suffix(text: string, budget: number): string {
  let bytes = 0
  const output: string[] = []
  for (const character of [...text].reverse()) {
    const size = utf8Length(character)
    if (bytes + size > budget) break
    output.push(character)
    bytes += size
  }
  return output.reverse().join('')
}

export function guardianTruncateText(text: string, tokenCap: number): { text: string; truncated: boolean } {
  const maxBytes = Math.max(0, tokenCap) * 4
  const originalBytes = utf8Length(text)
  if (originalBytes <= maxBytes) return { text, truncated: false }
  const omittedTokens = Math.ceil(Math.max(0, originalBytes - maxBytes) / 4)
  const marker = `<truncated omitted_approx_tokens="${omittedTokens}" />`
  const markerBytes = utf8Length(marker)
  if (maxBytes <= markerBytes) return { text: marker, truncated: true }
  const available = maxBytes - markerBytes
  const prefixBudget = Math.floor(available / 2)
  const suffixBudget = available - prefixBudget
  return { text: `${utf8Prefix(text, prefixBudget)}${marker}${utf8Suffix(text, suffixBudget)}`, truncated: true }
}

function truncateGuardianActionValue(value: JsonValue): { value: JsonValue; truncated: boolean } {
  if (typeof value === 'string') {
    const result = guardianTruncateText(value, GUARDIAN_MAX_ACTION_STRING_TOKENS)
    return { value: result.text, truncated: result.truncated }
  }
  if (Array.isArray(value)) {
    let truncated = false
    const output = value.map(entry => {
      const result = truncateGuardianActionValue(entry)
      truncated ||= result.truncated
      return result.value
    })
    return { value: output, truncated }
  }
  if (value !== null && typeof value === 'object') {
    let truncated = false
    const output: JsonObject = {}
    for (const key of Object.keys(value).sort()) {
      const result = truncateGuardianActionValue(value[key] as JsonValue)
      truncated ||= result.truncated
      output[key] = result.value
    }
    return { value: output, truncated }
  }
  return { value, truncated: false }
}

export function formatGuardianActionPretty(action: GuardianApprovalRequest): FormattedGuardianAction {
  const result = truncateGuardianActionValue(guardianApprovalRequestToJson(action))
  return { text: JSON.stringify(result.value, null, 2), truncated: result.truncated }
}

export function guardianAssessmentAction(action: GuardianApprovalRequest): GuardianAssessmentAction {
  switch (action.type) {
    case 'exec_command': return { type: 'command', source: 'unified_exec', command: shlexJoin(action.command), cwd: action.cwd }
    case 'write_stdin': return { type: 'write_stdin', approval_id: action.approvalId, process_id: String(action.processId), stdin: action.input, cwd: action.cwd }
    case 'execve': return { type: 'execve', source: action.source, program: action.program, argv: [...action.argv], cwd: action.cwd }
    case 'apply_patch': return { type: 'apply_patch', cwd: action.cwd, files: [...action.files] }
    case 'network_access': return { type: 'network_access', target: action.target, host: action.host, protocol: action.protocol, port: action.port }
    case 'mcp_tool_call': return {
      type: 'mcp_tool_call', server: action.server, tool_name: action.toolName,
      connector_id: action.connectorId ?? null,
      connector_name: action.connectorName ?? null,
      tool_title: action.toolTitle ?? null,
    }
    case 'request_permissions': return { type: 'request_permissions', reason: action.reason ?? null, permissions: serializePermissionProfile(action.permissions) }
  }
}

export function guardianReviewedAction(action: GuardianApprovalRequest): GuardianReviewedAction {
  switch (action.type) {
    case 'exec_command': return {
      type: 'unified_exec', sandbox_permissions: action.sandboxPermissions,
      additional_permissions: action.additionalPermissions === undefined ? null : serializePermissionProfile(action.additionalPermissions), tty: action.tty,
    }
    case 'write_stdin': return { type: 'write_stdin', tty: action.tty }
    case 'execve': return {
      type: 'execve', source: action.source, program: action.program,
      additional_permissions: action.additionalPermissions === undefined ? null : serializePermissionProfile(action.additionalPermissions),
    }
    case 'apply_patch': return { type: 'apply_patch' }
    case 'network_access': return { type: 'network_access', protocol: action.protocol, port: action.port }
    case 'mcp_tool_call': return {
      type: 'mcp_tool_call', server: action.server, tool_name: action.toolName,
      connector_id: action.connectorId ?? null,
      connector_name: action.connectorName ?? null,
      tool_title: action.toolTitle ?? null,
    }
    case 'request_permissions': return { type: 'request_permissions' }
  }
}

export function guardianRequestTargetItemId(action: GuardianApprovalRequest): string | undefined {
  return action.type === 'network_access' ? undefined : action.id
}
export function guardianRequestTurnId(action: GuardianApprovalRequest, defaultTurnId: string): string {
  return action.type === 'network_access' || action.type === 'request_permissions' ? action.turnId : defaultTurnId
}
