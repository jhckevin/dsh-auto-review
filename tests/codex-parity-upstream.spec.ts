import { describe, expect, it } from 'vitest'
import {
  absolutePath, canonicalizeCommandForApproval, formatGuardianActionPretty,
  guardianCwd, guardianReviewedAction, guardianTruncateText, i32,
  inferredNativePathString, intoGuardianRequest, pathUri,
  parseShellLcPlainCommands, shlexJoin, u16,
  type ApprovalAction,
} from '../src/codex-parity/index.ts'

describe('Codex shell-command corpus differential boundaries', () => {
  it.each([
    ['ls -1', [['ls', '-1']]],
    ['echo "hello world"', [['echo', 'hello world']]],
    ["echo 'hi there'", [['echo', 'hi there']]],
    ['rg -g"*.py" needle', [['rg', '-g*.py', 'needle']]],
    ['git commit -m "line1\nline2"', [['git', 'commit', '-m', 'line1\nline2']]],
    ['ls && pwd; echo \'hi there\' | wc -l', [['ls'], ['pwd'], ['echo', 'hi there'], ['wc', '-l']]],
  ])('matches upstream word-only AST lowering for %s', (script, expected) => {
    expect(parseShellLcPlainCommands(['bash', '-lc', script])).toEqual(expected)
  })

  it.each([
    'echo hi > out',
    'echo $(pwd)',
    'echo $HOME',
    '(echo hi)',
    'FOO=bar cargo test',
    'case "$x" in a) echo a;; esac',
    'for x in a; do echo "$x"; done',
    'echo `pwd`',
  ])('keeps disallowed tree-sitter construct opaque: %s', script => {
    expect(parseShellLcPlainCommands(['bash', '-lc', script])).toBeUndefined()
    expect(canonicalizeCommandForApproval(['bash', '-lc', script])).toEqual([
      '__codex_shell_script__', '-lc', script,
    ])
  })

  it('matches the upstream one-command tail-semicolon and multi-command behavior', () => {
    expect(canonicalizeCommandForApproval(['/bin/bash', '-lc', 'echo hi;'])).toEqual(['echo', 'hi'])
    expect(canonicalizeCommandForApproval(['/bin/bash', '-lc', 'echo hi\necho bye'])).toEqual([
      '__codex_shell_script__', '-lc', 'echo hi\necho bye',
    ])
  })
})

describe('Codex shlex 1.3 try_join parity', () => {
  it.each([
    [['echo', 'hello'], 'echo hello'],
    [['echo', 'hello world'], "echo 'hello world'"],
    [[''], "''"],
    [["a'b"], '"a\'b"'],
    [['a$b'], "'a$b'"],
    [['ümlaut'], "'ümlaut'"],
  ])('quotes %j as %s', (tokens, expected) => expect(shlexJoin(tokens)).toBe(expected))

  it('uses the exact Codex fallback if any token contains NUL', () => {
    expect(shlexJoin(['printf', 'a\0b'])).toBe('<command included NUL byte>')
  })
})

describe('Codex Linux PathUri and absolute-path boundaries', () => {
  it('converts POSIX PathUri and LegacyAppPath strings without leaking URI spelling', () => {
    const uri = pathUri('file:///work/a%20b')
    expect(guardianCwd('remote-env', uri)).toBe('/work/a b')
    expect(inferredNativePathString(uri)).toBe('/work/a b')
  })

  it('rejects foreign remote paths but preserves Codex local-environment fallback', () => {
    const windows = pathUri('file:///C:/work/repo')
    expect(() => guardianCwd('remote-env', windows)).toThrow(/foreign path convention/)
    expect(guardianCwd('local', windows)).toBe('/C:/work/repo')
    expect(inferredNativePathString(windows)).toBe('C:\\work\\repo')
  })

  it('rejects non-file URI, relative absolute path and out-of-range integers', () => {
    expect(() => pathUri('https://example.test/work')).toThrow(/scheme/)
    expect(() => absolutePath('relative/file')).toThrow(/not absolute/)
    expect(() => u16(65_536)).toThrow(/u16/)
    expect(() => i32(2_147_483_648)).toThrow(/i32/)
  })

  it('matches PathUri metadata, NUL, localhost, and drive normalization', () => {
    expect(() => pathUri('file:///work?query=yes')).toThrow(/query/)
    expect(() => pathUri('file:///work#fragment')).toThrow(/fragment/)
    expect(() => pathUri('file:///work/%00/plain')).toThrow(/NUL/)
    expect(pathUri('file:///%00/bad/path/L3RtcC9h')).toBe('file:///%00/bad/path/L3RtcC9h')
    expect(pathUri('file://localhost/work')).toBe('file:///work')
    expect(pathUri('file:///c:/work')).toBe('file:///C:/work')
    expect(pathUri('file:///d%3a/work')).toBe('file:///D%3a/work')
  })

  it('does not apply guardian cwd fallback to apply_patch files', () => {
    expect(() => intoGuardianRequest({
      type: 'apply_patch', id: 'patch-foreign', environmentId: 'local', cwd: pathUri('file:///C:/work'),
      files: [pathUri('file:///C:/work/a.ts')], patch: '', changes: {}, permissionsPreapproved: false,
    })).toThrow(/foreign path convention/)
    expect(() => intoGuardianRequest({
      type: 'apply_patch', id: 'patch-mixed', environmentId: 'local', cwd: pathUri('file:///C:/work'),
      files: [pathUri('file:///work/a.ts')], patch: '', changes: {}, permissionsPreapproved: false,
    })).not.toThrow()
  })
})

describe('Codex Guardian recursive formatting and analytics', () => {
  it('sorts every object level before pretty JSON', () => {
    const action: ApprovalAction = {
      type: 'mcp_tool_call', id: 'mcp-sort', server: 'server', toolName: 'tool',
      arguments: { z: { y: 1, a: 2 }, a: true }, hookToolName: 'mcp__server__tool',
      approvalPolicy: 'on-request', reviewer: 'auto_review', approvalMode: 'prompt',
      allowSessionRemember: false, allowPersistentApproval: false,
    }
    const formatted = formatGuardianActionPretty(intoGuardianRequest(action))
    expect(formatted.truncated).toBe(false)
    expect(formatted.text.indexOf('"a"')).toBeLessThan(formatted.text.indexOf('"z"'))
    expect(formatted.text.indexOf('"a": 2')).toBeLessThan(formatted.text.indexOf('"y": 1'))
  })

  it('recursively truncates UTF-8 string fields with the upstream XML marker', () => {
    const long = '前缀🙂'.repeat(20_000) + '结尾'
    const direct = guardianTruncateText(long, 20)
    expect(direct.truncated).toBe(true)
    expect(direct.text).toContain('<truncated omitted_approx_tokens="')
    expect(direct.text).toMatch(/结尾$/u)

    const action: ApprovalAction = {
      type: 'apply_patch', id: 'patch-long', environmentId: 'local', cwd: pathUri('file:///work'),
      files: [], patch: long, changes: {}, permissionsPreapproved: false,
    }
    const formatted = formatGuardianActionPretty(intoGuardianRequest(action))
    expect(formatted.truncated).toBe(true)
    expect(formatted.text).toContain('<truncated omitted_approx_tokens=')
    expect(Buffer.byteLength(formatted.text)).toBeLessThan(Buffer.byteLength(long))
  })

  it('maps all seven request variants to Codex analytics variants', () => {
    const actions: ApprovalAction[] = [
      {
        type: 'exec_command', id: '1', environmentId: 'local', command: ['true'], hookCommand: 'true',
        cwd: pathUri('file:///work'), sandboxPermissions: 'use_default', tty: false,
      },
      {
        type: 'write_stdin', id: '2', approvalId: 'a', environmentId: 'local', processId: i32(1),
        input: '', cwd: pathUri('file:///work'), tty: true, sandboxPermissions: 'use_default',
      },
      {
        type: 'execve', id: '3', approvalId: 'a', environmentId: 'local', source: 'shell',
        program: absolutePath('/bin/true'), argv: ['true'], command: ['true'], cwd: absolutePath('/work'),
      },
      {
        type: 'apply_patch', id: '4', environmentId: 'local', cwd: pathUri('file:///work'), files: [],
        patch: '', changes: {}, permissionsPreapproved: false,
      },
      {
        type: 'mcp_tool_call', id: '5', server: 's', toolName: 't', hookToolName: 'mcp__s__t',
        approvalPolicy: 'on-request', reviewer: 'auto_review', approvalMode: 'prompt',
        allowSessionRemember: false, allowPersistentApproval: false,
      },
      {
        type: 'network_access', id: '6', turnId: 't', environmentId: 'local', target: 'x', host: 'x',
        protocol: 'https', port: u16(443), hookCommand: 'curl x', hookRunId: 'h', command: ['curl', 'x'], cwd: absolutePath('/work'),
      },
      { type: 'request_permissions', id: '7', turnId: 't', permissions: {} },
    ]
    expect(actions.map(action => guardianReviewedAction(intoGuardianRequest(action)).type)).toEqual([
      'unified_exec', 'write_stdin', 'execve', 'apply_patch', 'mcp_tool_call', 'network_access', 'request_permissions',
    ])
  })
})
