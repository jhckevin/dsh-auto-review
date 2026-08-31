import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  absolutePath, canonicalizeCommandForApproval, guardianApprovalRequestToJson, i32,
  intoGuardianRequest, parseShellLcPlainCommands, pathUri, shlexJoin, u16,
  type ApprovalAction, type JsonObject,
} from '../src/codex-parity/index.ts'

interface Oracle {
  codex_commit: string
  source_blobs: Record<string, string>
  guardian_fixture_kind: string
  shell_corpus: Array<{ script: string; parsed: string[][] | null; canonical: string[] }>
  path_uri: Array<{ input: string; ok?: string; error?: string }>
  shlex: Array<{ argv: string[]; joined: string }>
  guardian_actions: Array<{ name: string; json: JsonObject }>
}

const oracle = JSON.parse(readFileSync(new URL('./oracle/codex-9f97cb79.json', import.meta.url), 'utf8')) as Oracle
const additional = { network: { enabled: true } } as const

function guardianAction(name: string): ApprovalAction {
  switch (name) {
    case 'exec_command/minimal': return { type:'exec_command',id:'1',environmentId:'local',command:['echo','hi'],hookCommand:'echo hi',cwd:pathUri('file:///work'),sandboxPermissions:'use_default',tty:false }
    case 'exec_command/options': return { type:'exec_command',id:'1',environmentId:'local',command:['curl','x'],hookCommand:'curl x',cwd:pathUri('file:///work'),sandboxPermissions:'with_additional_permissions',additionalPermissions:additional,justification:'network',tty:true }
    case 'write_stdin/minimal': return { type:'write_stdin',id:'2',approvalId:'2',environmentId:'local',processId:i32(7),input:'',cwd:pathUri('file:///work'),sandboxPermissions:'use_default',tty:false }
    case 'write_stdin/options': return { type:'write_stdin',id:'2',approvalId:'2',environmentId:'local',processId:i32(7),input:'yes\n',cwd:pathUri('file:///work'),sandboxPermissions:'with_additional_permissions',additionalPermissions:additional,tty:true }
    case 'execve/minimal': return { type:'execve',id:'3',approvalId:'3',environmentId:'local',source:'unified_exec',program:absolutePath('/bin/echo'),argv:['echo','hi'],command:['echo','hi'],cwd:absolutePath('/work') }
    case 'execve/options': return { type:'execve',id:'3',approvalId:'3',environmentId:'local',source:'shell',program:absolutePath('/bin/bash'),argv:['bash','-lc','echo hi'],command:['bash','-lc','echo hi'],cwd:absolutePath('/work'),additionalPermissions:additional }
    case 'apply_patch': return { type:'apply_patch',id:'4',environmentId:'local',cwd:pathUri('file:///work'),files:[pathUri('file:///work/a.ts')],patch:'*** Begin Patch\n*** End Patch',changes:{},permissionsPreapproved:false }
    case 'mcp/minimal': return { type:'mcp_tool_call',id:'5',server:'srv',toolName:'read',hookToolName:'mcp__srv__read',approvalPolicy:'on-request',reviewer:'auto_review',approvalMode:'prompt',allowSessionRemember:false,allowPersistentApproval:false }
    case 'mcp/options': return { type:'mcp_tool_call',id:'5',server:'srv',toolName:'write',arguments:{z:1,a:'x'},connectorId:'cid',connectorName:'conn',connectorDescription:'desc',connectedAccountEmail:'a@example.test',toolTitle:'Write',toolDescription:'writes',annotations:{destructive_hint:true,open_world_hint:false,read_only_hint:false},hookToolName:'mcp__srv__write',approvalPolicy:'on-request',reviewer:'auto_review',approvalMode:'prompt',allowSessionRemember:false,allowPersistentApproval:false }
    case 'network/minimal': return { type:'network_access',id:'6',turnId:'turn',environmentId:'local',target:'example.test:443',host:'example.test',protocol:'https',port:u16(443),hookCommand:'network',hookRunId:'run',command:[],cwd:absolutePath('/work') }
    case 'network/options': return { type:'network_access',id:'6',turnId:'turn',environmentId:'local',target:'example.test:443',host:'example.test',protocol:'https',port:u16(443),trigger:{callId:'call',toolName:'exec_command',command:['curl','https://example.test'],cwd:pathUri('file:///work'),sandboxPermissions:'with_additional_permissions',additionalPermissions:additional,justification:'fetch',tty:false},hookCommand:'network',hookRunId:'run',command:[],cwd:absolutePath('/work') }
    case 'request_permissions/minimal': return { type:'request_permissions',id:'7',turnId:'turn',permissions:{} }
    case 'request_permissions/options': return { type:'request_permissions',id:'7',turnId:'turn',reason:'write',permissions:{file_system:{write:[absolutePath('/work')]}} }
    default: throw new Error(`unknown oracle action: ${name}`)
  }
}

describe('machine-generated Codex 9f97cb79 Rust oracle', () => {
  it('is pinned and covers the full shell corpus', () => {
    expect(oracle.codex_commit).toBe('9f97cb79eb')
    expect(oracle.source_blobs['bash.rs']).toBe('ddd5807bfce5d1a54796e7a557b77d589be14d35')
    expect(oracle.shell_corpus).toHaveLength(54)
    for (const fixture of oracle.shell_corpus) {
      expect(parseShellLcPlainCommands(['bash','-lc',fixture.script]) ?? null, fixture.script).toEqual(fixture.parsed)
      expect(canonicalizeCommandForApproval(['bash','-lc',fixture.script]), fixture.script).toEqual(fixture.canonical)
    }
  })

  it('matches upstream PathUri acceptance and canonical spelling', () => {
    expect(oracle.path_uri).toHaveLength(8)
    for (const fixture of oracle.path_uri) {
      if (fixture.ok !== undefined) expect(pathUri(fixture.input)).toBe(fixture.ok)
      else expect(() => pathUri(fixture.input), fixture.input).toThrow()
    }
  })

  it('matches upstream shlex output including NUL fallback', () => {
    expect(oracle.shlex).toHaveLength(7)
    for (const fixture of oracle.shlex) expect(shlexJoin(fixture.argv)).toBe(fixture.joined)
  })

  it('matches blob-pinned source-derived Guardian DTO fixtures', () => {
    expect(oracle.guardian_fixture_kind).toBe('source-derived-private-serde-dto')
    expect(oracle.source_blobs['guardian/approval_request.rs']).toBe('786c3eedf0b40cf2a5ef1f0682b0bad0a7125792')
    expect(oracle.source_blobs['tools/approvals.rs']).toBe('5da0a46c74a9482f74158e7101ce7fc25403a2f5')
    expect(oracle.guardian_actions).toHaveLength(13)
    for (const fixture of oracle.guardian_actions) {
      expect(guardianApprovalRequestToJson(intoGuardianRequest(guardianAction(fixture.name))), fixture.name).toEqual(fixture.json)
    }
  })
})
