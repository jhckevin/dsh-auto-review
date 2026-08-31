import { describe, expect, it } from 'vitest'
import {
  approvalCacheKeys,
  absolutePath,
  canonicalizeCommandForApproval,
  guardianApprovalRequestToJson,
  guardianAssessmentAction,
  guardianRequestTargetItemId,
  guardianRequestTurnId,
  intoGuardianRequest,
  i32,
  pathUri,
  permissionRequestPayload,
  u16,
  type ApprovalAction,
} from '../src/codex-parity/index.ts'

const exec: ApprovalAction = {
  type: 'exec_command', id: 'call-1', environmentId: 'local',
  command: ['/bin/bash', '-lc', 'cargo   test -p codex-core'],
  hookCommand: "bash -lc 'cargo test -p codex-core'", cwd: pathUri('file:///work'),
  sandboxPermissions: 'require_escalated', additionalPermissions: { network: { enabled: true } },
  justification: 'run integration tests', tty: false,
  proposedExecpolicyAmendment: { command: ['cargo', 'test'] },
}

describe('Codex 9f97cb79 command approval canonicalization', () => {
  it('canonicalizes word-only shell wrappers to the one inner command', () => {
    expect(canonicalizeCommandForApproval(exec.type === 'exec_command' ? exec.command : [])).toEqual([
      'cargo', 'test', '-p', 'codex-core',
    ])
    expect(canonicalizeCommandForApproval(['bash', '-lc', 'cargo test -p codex-core'])).toEqual([
      'cargo', 'test', '-p', 'codex-core',
    ])
  })

  it('canonicalizes complex bash and PowerShell wrappers to stable script keys', () => {
    const heredoc = "python3 <<'PY'\nprint('hello')\nPY"
    expect(canonicalizeCommandForApproval(['/bin/zsh', '-lc', heredoc])).toEqual([
      '__codex_shell_script__', '-lc', heredoc,
    ])
    expect(canonicalizeCommandForApproval(['zsh', '-lc', heredoc])).toEqual([
      '__codex_shell_script__', '-lc', heredoc,
    ])
    expect(canonicalizeCommandForApproval(['powershell.exe', '-NoProfile', '-Command', 'Write-Host hi'])).toEqual([
      '__codex_powershell_script__', 'Write-Host hi',
    ])
    expect(canonicalizeCommandForApproval(['powershell', '-Command', 'Write-Host hi'])).toEqual([
      '__codex_powershell_script__', 'Write-Host hi',
    ])
  })

  it('preserves non-shell commands and keeps shell sequences opaque', () => {
    expect(canonicalizeCommandForApproval(['cargo', 'fmt'])).toEqual(['cargo', 'fmt'])
    expect(canonicalizeCommandForApproval(['bash', '-lc', 'cargo test && cargo fmt'])).toEqual([
      '__codex_shell_script__', '-lc', 'cargo test && cargo fmt',
    ])
    expect(canonicalizeCommandForApproval(['bash', '-lc', 'cargo test\ncargo fmt'])).toEqual([
      '__codex_shell_script__', '-lc', 'cargo test\ncargo fmt',
    ])
    expect(canonicalizeCommandForApproval(['bash', '-lc', 'MODE=ci cargo test'])).toEqual([
      '__codex_shell_script__', '-lc', 'MODE=ci cargo test',
    ])
  })
})

describe('Codex 9f97cb79 ApprovalAction protocol goldens', () => {
  it('emits the exact exec permission payload, cache key, Guardian JSON and assessment', () => {
    expect(permissionRequestPayload(exec)).toEqual({
      toolName: 'Bash',
      toolInput: { command: "bash -lc 'cargo test -p codex-core'", description: 'run integration tests' },
    })
    expect(approvalCacheKeys(exec)).toEqual([{
      type: 'exec_command', environmentId: 'local', executable: '/bin/bash',
      command: ['cargo', 'test', '-p', 'codex-core'], cwd: 'file:///work', tty: false,
      sandboxPermissions: 'require_escalated', additionalPermissions: { network: { enabled: true }, file_system: null },
    }])
    const request = intoGuardianRequest(exec)
    expect(guardianApprovalRequestToJson(request)).toEqual({
      tool: 'exec_command', command: ['/bin/bash', '-lc', 'cargo   test -p codex-core'], cwd: '/work',
      sandbox_permissions: 'require_escalated', additional_permissions: { network: { enabled: true }, file_system: null },
      justification: 'run integration tests', tty: false,
    })
    expect(guardianAssessmentAction(request)).toEqual({
      type: 'command', source: 'unified_exec',
      command: "/bin/bash -lc 'cargo   test -p codex-core'", cwd: '/work',
    })
    expect(guardianRequestTargetItemId(request)).toBe('call-1')
    expect(guardianRequestTurnId(request, 'turn-default')).toBe('turn-default')
  })

  it('covers WriteStdin with its non-cacheable hook and Guardian forms', () => {
    const action: ApprovalAction = {
      type: 'write_stdin', id: 'parent', approvalId: 'approval-2', environmentId: 'env-1',
      processId: i32(42), input: 'yes\n', cwd: pathUri('file:///work'), tty: true,
      sandboxPermissions: 'use_default',
    }
    expect(permissionRequestPayload(action)).toEqual({
      toolName: 'write_stdin',
      toolInput: {
        session_id: 42, chars: 'yes\n', parent_call_id: 'parent', approval_id: 'approval-2',
        environment_id: 'env-1', cwd: 'file:///work', tty: true,
        sandbox_permissions: 'use_default', additional_permissions: null,
      },
    })
    expect(approvalCacheKeys(action)).toEqual([])
    const request = intoGuardianRequest(action)
    expect(guardianApprovalRequestToJson(request)).toEqual({
      tool: 'write_stdin', environment_id: 'env-1', session_id: 42, chars: 'yes\n',
      cwd: '/work', sandbox_permissions: 'use_default', tty: true,
    })
    expect(guardianAssessmentAction(request)).toEqual({
      type: 'write_stdin', approval_id: 'approval-2', process_id: '42', stdin: 'yes\n', cwd: 'file:///work',
    })
    expect(guardianRequestTargetItemId(request)).toBe('parent')
    expect(guardianRequestTurnId(request, 'turn-default')).toBe('turn-default')
  })

  it('covers Execve with source-specific Guardian tool naming', () => {
    const action: ApprovalAction = {
      type: 'execve', id: 'execve-1', approvalId: 'approval-3', environmentId: 'env-1',
      source: 'shell', program: absolutePath('/usr/bin/rm'), argv: ['rm', '-f', 'a b'],
      command: ['rm', '-f', 'a b'], cwd: absolutePath('/work'),
    }
    expect(permissionRequestPayload(action)).toEqual({
      toolName: 'Bash', toolInput: { command: "rm -f 'a b'" },
    })
    expect(approvalCacheKeys(action)).toEqual([])
    const request = intoGuardianRequest(action)
    expect(guardianApprovalRequestToJson(request)).toEqual({
      tool: 'shell', program: '/usr/bin/rm', argv: ['rm', '-f', 'a b'], cwd: '/work',
    })
    expect(guardianAssessmentAction(request)).toEqual({
      type: 'execve', source: 'shell', program: '/usr/bin/rm', argv: ['rm', '-f', 'a b'], cwd: '/work',
    })
  })

  it('covers ApplyPatch per-file cache keys and strips patch text from assessment', () => {
    const action: ApprovalAction = {
      type: 'apply_patch', id: 'patch-1', environmentId: 'env-1', cwd: pathUri('file:///work'),
      files: [pathUri('file:///work/a.ts'), pathUri('file:///work/b.ts')], patch: '*** Begin Patch\n*** End Patch',
      changes: {}, permissionsPreapproved: false,
    }
    expect(permissionRequestPayload(action)).toEqual({
      toolName: 'apply_patch', toolInput: { command: '*** Begin Patch\n*** End Patch' },
    })
    expect(approvalCacheKeys(action)).toEqual([
      { type: 'apply_patch', environmentId: 'env-1', path: 'file:///work/a.ts' },
      { type: 'apply_patch', environmentId: 'env-1', path: 'file:///work/b.ts' },
    ])
    const request = intoGuardianRequest(action)
    expect(guardianApprovalRequestToJson(request)).toEqual({
      tool: 'apply_patch', cwd: '/work', files: ['/work/a.ts', '/work/b.ts'], patch: '*** Begin Patch\n*** End Patch',
    })
    expect(guardianAssessmentAction(request)).toEqual({ type: 'apply_patch', cwd: '/work', files: ['/work/a.ts', '/work/b.ts'] })
  })

  it('covers MCP hook metadata and the reduced assessment action', () => {
    const action: ApprovalAction = {
      type: 'mcp_tool_call', id: 'mcp-1', server: 'github', toolName: 'create_issue',
      arguments: { title: 'Bug' }, connectorId: 'connector-1', connectorName: 'GitHub',
      connectorDescription: 'Repository connector', connectedAccountEmail: 'dev@example.test',
      toolTitle: 'Create issue', toolDescription: 'Creates an issue',
      annotations: { destructive_hint: false, open_world_hint: true, read_only_hint: false },
      hookToolName: 'mcp__github__create_issue', approvalPolicy: 'on-request', reviewer: 'auto_review',
      approvalMode: 'prompt', allowSessionRemember: true, allowPersistentApproval: false,
    }
    expect(permissionRequestPayload(action)).toEqual({
      toolName: 'mcp__github__create_issue', toolInput: { title: 'Bug' },
    })
    const request = intoGuardianRequest(action)
    expect(guardianApprovalRequestToJson(request)).toEqual({
      tool: 'mcp_tool_call', server: 'github', tool_name: 'create_issue', arguments: { title: 'Bug' },
      connector_id: 'connector-1', connector_name: 'GitHub', connector_description: 'Repository connector',
      connected_account_email: 'dev@example.test', tool_title: 'Create issue', tool_description: 'Creates an issue',
      annotations: { destructive_hint: false, open_world_hint: true, read_only_hint: false },
    })
    expect(guardianAssessmentAction(request)).toEqual({
      type: 'mcp_tool_call', server: 'github', tool_name: 'create_issue', connector_id: 'connector-1',
      connector_name: 'GitHub', tool_title: 'Create issue',
    })
  })

  it('covers network trigger camelCase and the network-access hook reason', () => {
    const action: ApprovalAction = {
      type: 'network_access', id: 'net-1', turnId: 'turn-1', environmentId: 'env-1',
      target: 'https://example.test:443', host: 'example.test', protocol: 'https', port: u16(443),
      trigger: {
        callId: 'call-1', toolName: 'exec_command', command: ['curl', 'https://example.test'],
        cwd: pathUri('file:///work'), sandboxPermissions: 'use_default', tty: false,
      },
      hookCommand: 'curl https://example.test', hookRunId: 'hook-1',
      command: ['curl', 'https://example.test'], cwd: absolutePath('/work'),
    }
    expect(permissionRequestPayload(action)).toEqual({
      toolName: 'Bash',
      toolInput: { command: 'curl https://example.test', description: 'network-access https://example.test:443' },
    })
    const request = intoGuardianRequest(action)
    expect(guardianApprovalRequestToJson(request)).toEqual({
      tool: 'network_access', target: 'https://example.test:443', host: 'example.test', protocol: 'https', port: 443,
      trigger: {
        callId: 'call-1', toolName: 'exec_command', command: ['curl', 'https://example.test'],
        cwd: '/work', sandboxPermissions: 'use_default', tty: false,
      },
    })
    expect(guardianAssessmentAction(request)).toEqual({
      type: 'network_access', target: 'https://example.test:443', host: 'example.test', protocol: 'https', port: 443,
    })
    expect(guardianRequestTargetItemId(request)).toBeUndefined()
    expect(guardianRequestTurnId(request, 'turn-default')).toBe('turn-1')
  })

  it('covers RequestPermissions null hook reason and omitted Guardian reason', () => {
    const action: ApprovalAction = {
      type: 'request_permissions', id: 'perm-1', turnId: 'turn-1', permissions: { network: { enabled: true } },
    }
    expect(permissionRequestPayload(action)).toEqual({
      toolName: 'request_permissions', toolInput: { reason: null, permissions: { network: { enabled: true }, file_system: null } },
    })
    const request = intoGuardianRequest(action)
    expect(guardianApprovalRequestToJson(request)).toEqual({
      tool: 'request_permissions', turn_id: 'turn-1', permissions: { network: { enabled: true }, file_system: null },
    })
    expect(guardianAssessmentAction(request)).toEqual({
      type: 'request_permissions', reason: null, permissions: { network: { enabled: true }, file_system: null },
    })
  })
})
