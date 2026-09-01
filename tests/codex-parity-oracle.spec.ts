import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  absolutePath, approvalCacheKeys, canonicalizeCommandForApproval, formatGuardianActionPretty,
  guardianApprovalRequestToJson, guardianAssessmentAction, guardianReviewedAction, i32, inferredNativePathString,
  intoGuardianRequest, nonZeroUsize, parseShellLcPlainCommands, pathUri, pathUriCacheIdentity, pathUriToAbsolutePath, permissionRequestPayload,
  PathConversionError, serializePermissionProfile, serializeRuntimePermissionProfile, shlexJoin, u16,
  type ApprovalAction, type FileSystemPath, type JsonObject, type JsonValue, type PartialPermissionProfile, type PermissionProfile,
} from '../src/codex-parity/index.ts'

interface Oracle {
  codex_commit: string
  source_blobs: Record<string, string>
  shell_corpus: Array<{ script: string; parsed: string[][] | null }>
  path_uri: Array<{ input: string; ok?: string; error?: string; to_abs_path?: { Ok?: string; Err?: string } }>
  shlex: Array<{ argv: string[]; joined: string }>
}

const oracle = JSON.parse(readFileSync(new URL('./oracle/codex-9f97cb79.json', import.meta.url), 'utf8')) as Oracle
interface GuardianOracleFixture {
  name: string
  json: JsonObject
  assessment: JsonObject
  reviewed: JsonObject
  formatted: { text: string; truncated: boolean }
  permissionRequestPayload: { tool_name: string; tool_input: JsonValue }
  cacheKeys: JsonObject[]
}
interface GuardianOracle {
  generator: string
  sourceCommit: string
  canonicalization: {
    shellCorpus: Array<{ input: string[]; canonical: string[] }>
    wrapperBoundaries: Array<{ input: string[]; canonical: string[] }>
  }
  guardian: GuardianOracleFixture[]
  permissionProfiles: Array<{ name: string; json: JsonObject }>
  partialPermissionProfiles: {
    fixtures: Array<{ name: string; input: JsonObject; json: JsonObject }>
    serializationErrors: Array<{ name: string; error: string }>
  }
  pathUri: {
    windowsEquality: Array<{ left: string; right: string; equal: boolean }>
    cacheKeyPreservesUri: JsonObject[]
    opaquePosix: { uri: string; bytesBase64: string; recoveredBytesBase64: string; lossy: string }
    ordinaryNonUtf8: { uri: string; recoveredBytesBase64: string; lossy: string }
    guardianCwdSerialization: { writeStdin: JsonObject; network: JsonObject }
    validUtf8OpaqueError: string
  }
  conversionErrors: Array<{ name: string; error: string }>
}
const guardianOracle = JSON.parse(readFileSync(new URL('./oracle/codex-guardian-9f97cb79.json', import.meta.url), 'utf8')) as GuardianOracle
const additional = { network: { enabled: true } } as const

type RawOracleFileSystem = {
  read?: string[]
  write?: string[]
  entries?: Array<{ path: ({ type:'path';path:string } | Exclude<FileSystemPath,{type:'path'}>); access:'read'|'write'|'deny'; missing_path_behavior?:'skip' }>
  glob_scan_max_depth?: number
}

function oraclePathUri(raw: string) {
  if (raw.startsWith('file:')) return pathUri(raw)
  if (raw.startsWith('/')) return pathUri(`file://${raw}`)
  if (/^[A-Za-z]:[\\/]/u.test(raw)) return pathUri(`file:///${raw.replaceAll('\\','/')}`)
  throw new Error(`unsupported oracle path: ${raw}`)
}

function partialProfileFromOracle(input: JsonObject): PartialPermissionProfile {
  const raw = input as unknown as { network?: {enabled?:boolean}; file_system?: RawOracleFileSystem }
  const fileSystem = raw.file_system
  return {
    ...(raw.network === undefined ? {} : { network: raw.network }),
    ...(fileSystem === undefined ? {} : { file_system: fileSystem.entries === undefined ? {
      ...(fileSystem.read === undefined ? {} : { read:fileSystem.read.map(absolutePath) }),
      ...(fileSystem.write === undefined ? {} : { write:fileSystem.write.map(absolutePath) }),
    } : {
      entries:fileSystem.entries.map(entry => ({
        ...entry,
        path:entry.path.type === 'path' ? { type:'path' as const,path:oraclePathUri(entry.path.path) } : entry.path,
      })),
      ...(fileSystem.glob_scan_max_depth === undefined ? {} : { glob_scan_max_depth:nonZeroUsize(fileSystem.glob_scan_max_depth) }),
    } }),
  }
}

function guardianAction(name: string): ApprovalAction {
  switch (name) {
    case 'exec_command/minimal': return { type:'exec_command',id:'exec-min',environmentId:'local',command:['echo','hi'],hookCommand:'echo hi',cwd:pathUri('file:///work'),sandboxPermissions:'use_default',tty:false }
    case 'exec_command/options': return { type:'exec_command',id:'exec-opt',environmentId:'local',command:['curl','https://example.test'],hookCommand:'curl https://example.test',cwd:pathUri('file:///work'),sandboxPermissions:'with_additional_permissions',additionalPermissions:additional,justification:'network',tty:true }
    case 'write_stdin/minimal': return { type:'write_stdin',id:'stdin-min',approvalId:'approval-min',environmentId:'local',processId:i32(7),input:'',cwd:pathUri('file:///work'),sandboxPermissions:'use_default',tty:false }
    case 'write_stdin/options': return { type:'write_stdin',id:'stdin-opt',approvalId:'approval-opt',environmentId:'local',processId:i32(8),input:'yes\n',cwd:pathUri('file:///work/sub'),sandboxPermissions:'with_additional_permissions',additionalPermissions:additional,tty:true }
    case 'execve/minimal': return { type:'execve',id:'3',approvalId:'3',environmentId:'local',source:'unified_exec',program:absolutePath('/bin/echo'),argv:['echo','hi'],command:['echo','hi'],cwd:absolutePath('/work') }
    case 'execve/options': return { type:'execve',id:'3',approvalId:'3',environmentId:'local',source:'shell',program:absolutePath('/bin/bash'),argv:['bash','-lc','echo hi'],command:['bash','-lc','echo hi'],cwd:absolutePath('/work'),additionalPermissions:additional }
    case 'apply_patch/minimal': return { type:'apply_patch',id:'4',environmentId:'local',cwd:pathUri('file:///work'),files:[],patch:'*** Begin Patch\n*** End Patch',changes:{},permissionsPreapproved:false }
    case 'apply_patch/options': return { type:'apply_patch',id:'4',environmentId:'local',cwd:pathUri('file:///work'),files:[pathUri('file:///work/a.ts'),pathUri('file:///tmp/b.ts')],patch:'*** Begin Patch\n*** Update File: /work/a.ts\n*** End Patch',changes:{},permissionsPreapproved:false }
    case 'mcp/minimal': return { type:'mcp_tool_call',id:'5',server:'srv',toolName:'read',hookToolName:'mcp__srv__read',approvalPolicy:'on-request',reviewer:'auto_review',approvalMode:'prompt',allowSessionRemember:false,allowPersistentApproval:false }
    case 'mcp/options': return { type:'mcp_tool_call',id:'5',server:'srv',toolName:'write',arguments:{z:1,a:'x'},connectorId:'cid',connectorName:'conn',connectorDescription:'desc',connectedAccountEmail:'a@example.test',toolTitle:'Write',toolDescription:'writes',annotations:{destructive_hint:true,open_world_hint:false,read_only_hint:false},hookToolName:'mcp__srv__write',approvalPolicy:'on-request',reviewer:'auto_review',approvalMode:'prompt',allowSessionRemember:false,allowPersistentApproval:false }
    case 'network/minimal': return { type:'network_access',id:'net-min',turnId:'turn-min',environmentId:'local',target:'example.test:443',host:'example.test',protocol:'https',port:u16(443),hookCommand:'curl https://example.test',hookRunId:'hook-min',command:['curl','https://example.test'],cwd:absolutePath('/work') }
    case 'network/options': return { type:'network_access',id:'net-opt',turnId:'turn-opt',environmentId:'local',target:'example.test:443',host:'example.test',protocol:'https',port:u16(443),trigger:{callId:'call',toolName:'exec_command',command:['curl','https://example.test'],cwd:pathUri('file:///work'),sandboxPermissions:'with_additional_permissions',additionalPermissions:additional,justification:'fetch',tty:false},hookCommand:'curl https://example.test',hookRunId:'hook-opt',command:['curl','https://example.test'],cwd:absolutePath('/work') }
    case 'request_permissions/minimal': return { type:'request_permissions',id:'7',turnId:'turn-min',permissions:{} }
    case 'request_permissions/options': return { type:'request_permissions',id:'7',turnId:'turn-opt',reason:'network',permissions:{network:{enabled:true}} }
    default: throw new Error(`unknown oracle action: ${name}`)
  }
}

function serializedPermissionRequestPayload(action: ApprovalAction): JsonObject {
  const payload = permissionRequestPayload(action)
  return { tool_name: payload.toolName, tool_input: payload.toolInput }
}

function serializedCacheKeys(action: ApprovalAction): JsonObject[] {
  return approvalCacheKeys(action).map(key => key.type === 'exec_command' ? {
    environment_id: key.environmentId,
    ...(key.executable === undefined ? {} : { executable: key.executable }),
    command: key.command,
    cwd: key.cwd,
    tty: key.tty,
    sandbox_permissions: key.sandboxPermissions,
    additional_permissions: key.additionalPermissions,
  } : { environment_id:key.environmentId,path:key.path })
}

describe('machine-generated Codex 9f97cb79 Rust oracle', () => {
  it('is pinned and covers the full shell corpus', () => {
    expect(oracle.codex_commit).toBe('9f97cb79eb15b38d24c552c56fe24e211ff9cf3a')
    expect(oracle.source_blobs['bash.rs']).toBe('ddd5807bfce5d1a54796e7a557b77d589be14d35')
    expect(oracle.source_blobs['path_uri/lib.rs']).toBe('3eb754bf6e28b52f57bfd4a39a260e0e426d0971')
    expect(oracle.shell_corpus).toHaveLength(54)
    for (const fixture of oracle.shell_corpus) {
      expect(parseShellLcPlainCommands(['bash','-lc',fixture.script]) ?? null, fixture.script).toEqual(fixture.parsed)
    }
  })

  it('matches real codex-core command canonicalization for the corpus and wrapper boundaries', () => {
    expect(guardianOracle.canonicalization.shellCorpus).toHaveLength(54)
    expect(guardianOracle.canonicalization.wrapperBoundaries).toHaveLength(4)
    for (const fixture of [
      ...guardianOracle.canonicalization.shellCorpus,
      ...guardianOracle.canonicalization.wrapperBoundaries,
    ]) expect(canonicalizeCommandForApproval(fixture.input), fixture.input.join(' ')).toEqual(fixture.canonical)
  })

  it('matches upstream PathUri acceptance and canonical spelling', () => {
    expect(oracle.path_uri).toHaveLength(8)
    for (const fixture of oracle.path_uri) {
      if (fixture.ok !== undefined) {
        const parsed = pathUri(fixture.input)
        expect(parsed).toBe(fixture.ok)
        if (fixture.to_abs_path?.Ok !== undefined) expect(pathUriToAbsolutePath(parsed)).toBe(fixture.to_abs_path.Ok)
        if (fixture.to_abs_path?.Err !== undefined) expect(() => pathUriToAbsolutePath(parsed), fixture.input).toThrow()
      } else expect(() => pathUri(fixture.input), fixture.input).toThrow()
    }
  })

  it('matches upstream shlex output including NUL fallback', () => {
    expect(oracle.shlex).toHaveLength(7)
    for (const fixture of oracle.shlex) expect(shlexJoin(fixture.argv)).toBe(fixture.joined)
  })

  it('matches the real fixed-commit private Guardian implementation', () => {
    expect(guardianOracle.generator).toBe('codex-core::guardian::oracle_export')
    expect(guardianOracle.sourceCommit).toBe('9f97cb79eb15b38d24c552c56fe24e211ff9cf3a')
    expect(guardianOracle.guardian).toHaveLength(14)
    for (const fixture of guardianOracle.guardian) {
      const action = guardianAction(fixture.name)
      expect(serializedPermissionRequestPayload(action), `${fixture.name}: permission payload`).toEqual(fixture.permissionRequestPayload)
      expect(serializedCacheKeys(action), `${fixture.name}: cache keys`).toEqual(fixture.cacheKeys)
      const request = intoGuardianRequest(action)
      expect(guardianApprovalRequestToJson(request), `${fixture.name}: json`).toEqual(fixture.json)
      expect(guardianAssessmentAction(request), `${fixture.name}: assessment`).toEqual(fixture.assessment)
      expect(guardianReviewedAction(request), `${fixture.name}: reviewed`).toEqual(fixture.reviewed)
      expect(formatGuardianActionPretty(request), `${fixture.name}: formatted`).toEqual(fixture.formatted)
    }
  })

  it('matches fixed-commit fail-closed conversion errors by kind and message', () => {
    const actions: Record<string, ApprovalAction> = {
      'exec_command/foreign_remote_cwd': { type:'exec_command',id:'foreign-cwd',environmentId:'remote',command:['pwd'],hookCommand:'pwd',cwd:pathUri('file:///C:/workspace'),sandboxPermissions:'use_default',tty:false },
      'apply_patch/foreign_file': { type:'apply_patch',id:'foreign-patch',environmentId:'local',cwd:pathUri('file:///work'),files:[pathUri('file:///C:/workspace/a.ts')],patch:'*** Begin Patch\n*** End Patch',changes:{},permissionsPreapproved:false },
    }
    expect(guardianOracle.conversionErrors).toHaveLength(2)
    for (const fixture of guardianOracle.conversionErrors) {
      try {
        intoGuardianRequest(actions[fixture.name]!)
        throw new Error(`expected ${fixture.name} conversion to fail closed`)
      } catch (error) {
        expect(error, fixture.name).toBeInstanceOf(PathConversionError)
        expect((error as Error).message, fixture.name).toBe(fixture.error)
      }
    }
  })

  it('matches all active PermissionProfile serde fixtures from codex-protocol', () => {
    const profiles: Record<string, PermissionProfile> = {
      default:{ type:'managed',network:'restricted',file_system:{ type:'restricted',entries:[] } },
      read_only:{ type:'managed',network:'restricted',file_system:{ type:'restricted',entries:[{ path:{ type:'special',value:{ kind:'root' } },access:'read' }] } },
      disabled:{ type:'disabled' },
      external_enabled:{ type:'external',network:'enabled' },
      managed_unrestricted:{ type:'managed',network:'enabled',file_system:{ type:'unrestricted' } },
    }
    expect(guardianOracle.permissionProfiles).toHaveLength(5)
    for (const fixture of guardianOracle.permissionProfiles) {
      expect(serializeRuntimePermissionProfile(profiles[fixture.name]!), fixture.name).toEqual(fixture.json)
    }
  })

  it('matches real PartialPermissionProfile normalization and serialization failures', () => {
    expect(guardianOracle.partialPermissionProfiles.fixtures).toHaveLength(6)
    for (const fixture of guardianOracle.partialPermissionProfiles.fixtures) {
      expect(serializePermissionProfile(partialProfileFromOracle(fixture.input)), fixture.name).toEqual(fixture.json)
    }
    expect(guardianOracle.partialPermissionProfiles.serializationErrors).toHaveLength(1)
    for (const fixture of guardianOracle.partialPermissionProfiles.serializationErrors) {
      expect(() => serializePermissionProfile({ file_system:{ entries:[{
        path:{ type:'path',path:pathUri('file:///tmp/non-utf8-%FF') },access:'deny',
      }],glob_scan_max_depth:nonZeroUsize(1) } }), fixture.name).toThrow(fixture.error)
    }
  })

  it('matches real PathUri equality, byte recovery, cache serde, and Guardian cwd seams', () => {
    for (const fixture of guardianOracle.pathUri.windowsEquality) {
      expect(pathUriCacheIdentity(pathUri(fixture.left)) === pathUriCacheIdentity(pathUri(fixture.right)), `${fixture.left} == ${fixture.right}`).toBe(fixture.equal)
    }
    const cacheCwd = pathUri(guardianOracle.pathUri.windowsEquality[0]!.left)
    const cacheAction: ApprovalAction = { type:'exec_command',id:'path-cache',environmentId:'remote',command:['pwd'],hookCommand:'pwd',cwd:cacheCwd,sandboxPermissions:'use_default',tty:false }
    expect(serializedCacheKeys(cacheAction)).toEqual(guardianOracle.pathUri.cacheKeyPreservesUri)

    const opaque = guardianOracle.pathUri.opaquePosix
    expect(pathUriToAbsolutePath(pathUri(opaque.uri))).toEqual({ kind:'posix_absolute_path_bytes',bytesBase64:opaque.recoveredBytesBase64 })
    expect(opaque.recoveredBytesBase64).toBe(opaque.bytesBase64)
    expect(inferredNativePathString(pathUri(opaque.uri))).toBe(opaque.lossy)
    const ordinary = guardianOracle.pathUri.ordinaryNonUtf8
    expect(pathUriToAbsolutePath(pathUri(ordinary.uri))).toEqual({ kind:'posix_absolute_path_bytes',bytesBase64:ordinary.recoveredBytesBase64 })
    expect(inferredNativePathString(pathUri(ordinary.uri))).toBe(ordinary.lossy)
    expect(() => pathUriToAbsolutePath(pathUri('file:///%00/bad/path/L3RtcC9h'))).toThrow(guardianOracle.pathUri.validUtf8OpaqueError)

    const writeAction: ApprovalAction = { type:'write_stdin',id:'path-write',approvalId:'path-approval',environmentId:'local',processId:i32(9),input:'',cwd:pathUri(ordinary.uri),tty:false,sandboxPermissions:'use_default' }
    expect(guardianApprovalRequestToJson(intoGuardianRequest(writeAction))).toEqual(guardianOracle.pathUri.guardianCwdSerialization.writeStdin)
    const networkAction: ApprovalAction = { type:'network_access',id:'path-network',turnId:'path-turn',environmentId:'local',target:'example.test:443',host:'example.test',protocol:'https',port:u16(443),trigger:{ callId:'path-call',toolName:'exec_command',command:['curl'],cwd:pathUri(ordinary.uri),sandboxPermissions:'use_default' },hookCommand:'curl',hookRunId:'path-hook',command:['curl'],cwd:absolutePath('/work') }
    expect(guardianApprovalRequestToJson(intoGuardianRequest(networkAction))).toEqual(guardianOracle.pathUri.guardianCwdSerialization.network)
  })
})
