import { canonicalizeCommandForApproval, shlexJoin } from './command-canonicalization.ts'
import type {
  ApprovalAction,
  ApprovalCacheKey,
  JsonObject,
  PermissionRequestPayload,
} from './types.ts'

export function permissionRequestPayload(action: ApprovalAction): PermissionRequestPayload {
  switch (action.type) {
    case 'exec_command': {
      const toolInput: JsonObject = { command: action.hookCommand }
      if (action.justification !== undefined) toolInput.description = action.justification
      return { toolName: 'bash', toolInput }
    }
    case 'write_stdin':
      return {
        toolName: 'write_stdin',
        toolInput: {
          session_id: action.processId,
          chars: action.input,
          parent_call_id: action.id,
          approval_id: action.approvalId,
          environment_id: action.environmentId,
          cwd: action.cwd,
          tty: action.tty,
          sandbox_permissions: action.sandboxPermissions,
          additional_permissions: (action.additionalPermissions ?? null) as unknown as JsonObject | null,
        },
      }
    case 'execve':
      return { toolName: 'bash', toolInput: { command: shlexJoin(action.command) } }
    case 'apply_patch':
      return { toolName: 'apply_patch', toolInput: { command: action.patch } }
    case 'mcp_tool_call':
      return { toolName: action.hookToolName, toolInput: action.arguments ?? {} }
    case 'network_access':
      return {
        toolName: 'bash',
        toolInput: { command: action.hookCommand, description: `network-access ${action.target}` },
      }
    case 'request_permissions':
      return {
        toolName: 'request_permissions',
        toolInput: { reason: action.reason ?? null, permissions: action.permissions as unknown as JsonObject },
      }
  }
}

export function approvalCacheKeys(action: ApprovalAction): ApprovalCacheKey[] {
  switch (action.type) {
    case 'exec_command':
      return [{
        type: 'exec_command',
        environmentId: action.environmentId,
        ...(action.command[0] === undefined ? {} : { executable: action.command[0] }),
        command: canonicalizeCommandForApproval(action.command),
        cwd: action.cwd,
        tty: action.tty,
        sandboxPermissions: action.sandboxPermissions,
        ...(action.additionalPermissions === undefined ? {} : { additionalPermissions: action.additionalPermissions }),
      }]
    case 'apply_patch':
      return action.files.map(path => ({ type: 'apply_patch', environmentId: action.environmentId, path }))
    case 'execve':
    case 'mcp_tool_call':
    case 'network_access':
    case 'request_permissions':
    case 'write_stdin':
      return []
  }
}
