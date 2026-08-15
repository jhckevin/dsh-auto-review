import { isAbsolute, relative, resolve } from 'node:path'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { sha256Json, toJsonValue } from './canonical.ts'
import type {
  ActionDisposition,
  ActionEnvelope,
  ActionKind,
  ResolvedRouterConfig,
  RouterConfig,
} from './types.ts'

const READ_TOOLS = new Set([
  'read_file', 'read_text_file', 'list_directory', 'directory_tree',
  'search_files', 'grep', 'glob', 'stat',
])
const WRITE_TOOLS = new Set([
  'write_file', 'edit_file', 'str_replace_editor', 'apply_patch', 'create_directory',
])
const PROCESS_TOOLS = new Set([
  'bash', 'shell', 'terminal', 'run_command', 'exec', 'process_start', 'run_code',
])
const NETWORK_TOOLS = new Set([
  'web_search', 'web_fetch', 'http_request', 'browser', 'download', 'upload',
])
const DESTRUCTIVE_TOOLS = new Set([
  'delete_file', 'remove_file', 'remove_directory', 'move_file', 'overwrite_file',
])
const PATH_KEYS = new Set([
  'path', 'file', 'filepath', 'file_path', 'target', 'destination', 'source',
  'cwd', 'workdir', 'directory', 'root',
])

interface Classification {
  kind: ActionKind
  disposition: ActionDisposition
  reason: string
}

function normalizeMarkers(values: readonly string[] | undefined, defaults: readonly string[]): readonly string[] {
  return Object.freeze((values ?? defaults).map(value => value.trim().toLocaleLowerCase()).filter(Boolean))
}

export function resolveRouterConfig(config: RouterConfig = {}): ResolvedRouterConfig {
  return Object.freeze({
    unknownTool: config.unknownTool ?? 'manual',
    allowWorkspaceReads: config.allowWorkspaceReads ?? true,
    allowWorkspaceWrites: config.allowWorkspaceWrites ?? true,
    productionMarkers: normalizeMarkers(config.productionMarkers, ['production', 'prod', 'live']),
    sensitiveMarkers: normalizeMarkers(config.sensitiveMarkers, ['.ssh', '.gnupg', '.aws', '.env']),
    hardDenyToolNames: Object.freeze([...(config.hardDenyToolNames ?? [])]),
  })
}

function extractPaths(value: unknown): string[] {
  const found: string[] = []
  const visit = (candidate: unknown, key?: string, depth = 0): void => {
    if (depth > 8) return
    if (typeof candidate === 'string') {
      if (key !== undefined && PATH_KEYS.has(key.toLocaleLowerCase()) && !candidate.includes('://')) found.push(candidate)
      return
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate.slice(0, 128)) visit(entry, key, depth + 1)
      return
    }
    if (candidate === null || typeof candidate !== 'object') return
    for (const [entryKey, entry] of Object.entries(candidate)) visit(entry, entryKey, depth + 1)
  }
  visit(value)
  return [...new Set(found)]
}

function pathSegments(path: string): string[] {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).map(segment => segment.toLocaleLowerCase())
}

function containsMarker(paths: readonly string[], markers: readonly string[]): boolean {
  return paths.some(path => {
    const segments = pathSegments(path)
    return markers.some(marker => segments.includes(marker) || path.toLocaleLowerCase().includes(`/${marker}/`))
  })
}

function insideWorkspace(path: string, workspaceRoot: string): boolean {
  const target = isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path)
  const offset = relative(resolve(workspaceRoot), target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

function shellCommand(arguments_: unknown): string {
  if (arguments_ === null || typeof arguments_ !== 'object') return ''
  const candidate = arguments_ as Record<string, unknown>
  return typeof candidate.command === 'string' ? candidate.command : ''
}

function classifyCommand(command: string): Classification | undefined {
  if (/(^|[;&|]\s*)(?:sudo\s+)?(?:chmod|chown|chgrp|setfacl)\b/i.test(command)) {
    return { kind: 'permission-change', disposition: 'review', reason: 'Shell command changes permissions or ownership.' }
  }
  if (/(^|[;&|]\s*)(?:sudo\s+)?(?:rm|rmdir|shred|mkfs|wipefs|dd)\b/i.test(command)) {
    return { kind: 'destructive', disposition: 'review', reason: 'Shell command can delete or overwrite data.' }
  }
  if (/\b(?:curl|wget|ssh|scp|rsync|git\s+(?:clone|fetch|pull|push)|npm\s+(?:install|publish)|pnpm\s+(?:install|publish)|pip\s+install)\b/i.test(command)) {
    return { kind: 'network', disposition: 'review', reason: 'Shell command can access the network or publish data.' }
  }
  return undefined
}

export class ActionRouter {
  readonly config: ResolvedRouterConfig

  constructor(config: RouterConfig = {}) {
    this.config = resolveRouterConfig(config)
  }

  route(exec: Readonly<ToolExecution>, sandbox: SandboxExecutionPolicy): ActionEnvelope {
    const arguments_ = toJsonValue(exec.arguments)
    const paths = Object.freeze(extractPaths(exec.arguments))
    const classification = this.classify(exec.name, exec.arguments, paths, sandbox.workspaceRoot)
    const digestInput = {
      schemaVersion: 1,
      callId: exec.callId,
      rootCallId: exec.rootCallId,
      toolName: exec.name,
      arguments: arguments_,
      sandbox: { mode: sandbox.mode, workspaceRoot: sandbox.workspaceRoot },
    }
    const actionDigest = sha256Json(toJsonValue(digestInput))
    return Object.freeze({
      schemaVersion: 1,
      actionId: `${exec.callId}:${actionDigest.slice(0, 16)}`,
      actionDigest,
      callId: exec.callId,
      rootCallId: exec.rootCallId,
      toolName: exec.name,
      arguments: arguments_,
      actionKind: classification.kind,
      disposition: classification.disposition,
      reason: classification.reason,
      sandbox: Object.freeze({ mode: sandbox.mode, workspaceRoot: sandbox.workspaceRoot }),
      paths,
    })
  }

  private classify(toolName: string, arguments_: unknown, paths: readonly string[], workspaceRoot: string): Classification {
    if (this.config.hardDenyToolNames.includes(toolName)) {
      return { kind: 'hard-deny', disposition: 'hard-deny', reason: 'Tool is listed in deployment hard-deny policy.' }
    }
    if (containsMarker(paths, this.config.sensitiveMarkers)) {
      return { kind: 'sensitive-read', disposition: 'review', reason: 'Action targets a configured sensitive path.' }
    }
    if (containsMarker(paths, this.config.productionMarkers)) {
      return { kind: 'production-change', disposition: 'review', reason: 'Action targets a configured production marker.' }
    }
    if (DESTRUCTIVE_TOOLS.has(toolName)) {
      return { kind: 'destructive', disposition: 'review', reason: 'Tool has destructive filesystem semantics.' }
    }
    if (PROCESS_TOOLS.has(toolName)) {
      return classifyCommand(shellCommand(arguments_))
        ?? { kind: 'process', disposition: 'review', reason: 'Process execution crosses the workspace action boundary.' }
    }
    if (NETWORK_TOOLS.has(toolName)) {
      return { kind: 'network', disposition: 'review', reason: 'Network access crosses the workspace action boundary.' }
    }
    const allInside = paths.length > 0 && paths.every(path => insideWorkspace(path, workspaceRoot))
    if (READ_TOOLS.has(toolName)) {
      if (this.config.allowWorkspaceReads && allInside) {
        return { kind: 'workspace-read', disposition: 'inside-boundary', reason: 'Read stays inside the session workspace.' }
      }
      return { kind: 'sensitive-read', disposition: 'review', reason: 'Read is outside the session workspace or has no bounded path.' }
    }
    if (WRITE_TOOLS.has(toolName)) {
      if (this.config.allowWorkspaceWrites && allInside) {
        return { kind: 'workspace-write', disposition: 'inside-boundary', reason: 'Non-destructive write stays inside the session workspace.' }
      }
      return { kind: 'workspace-write', disposition: 'review', reason: 'Write is outside the session workspace or has no bounded path.' }
    }
    return {
      kind: 'extension-unknown',
      disposition: this.config.unknownTool,
      reason: 'Unknown extension tool has no registered Auto Review action semantics.',
    }
  }
}
