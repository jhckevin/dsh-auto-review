import { isAbsolute, relative, resolve } from 'node:path'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { sha256Json, toJsonValue } from './canonical.ts'
import type {
  ActionEffect,
  ActionDisposition,
  ActionClassification,
  ActionEnvelope,
  ActionKind,
  ResolvedRouterConfig,
  RouterConfig,
} from './types.ts'

const READ_TOOLS = new Set([
  'read', 'read_file', 'read_text_file', 'list_directory', 'directory_tree',
  'search_files', 'grep', 'glob', 'stat', 'read_image',
])
const WRITE_TOOLS = new Set([
  'write', 'edit', 'write_file', 'edit_file', 'str_replace_editor', 'apply_patch', 'create_directory',
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
const CONTROL_TOOLS = new Set([
  'ask_user_question', 'todo_write',
])
const ESCALATION_TOOLS = new Set([
  'bash', 'pwsh', 'write', 'edit', 'write_file', 'edit_file',
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

function sensitiveCommandPaths(command: string, markers: readonly string[]): readonly string[] {
  const candidates = [...command.matchAll(/(?:^|[\s'"=@])((?:~|\/)[^\s'"<>|;&]+)/gu)]
    .map(match => match[1]?.replace(/[),]+$/u, ''))
    .filter((path): path is string => path !== undefined && path.length > 0)
  return Object.freeze([...new Set(candidates.filter(path => containsMarker([path], markers)))])
}

function contentText(value: unknown, depth = 0): string {
  if (depth > 12 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(entry => contentText(entry, depth + 1)).filter(Boolean).join('\n')
  if (typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  return 'content' in record ? contentText(record.content, depth + 1) : ''
}

function transcriptOf(exec: Readonly<ToolExecution>): ActionEnvelope['authority'] {
  const session = exec.agent?.session
  if (session === undefined) return Object.freeze({ transcript: Object.freeze([]) })
  let currentUserRequest: string | undefined
  let turn: number | undefined
  const transcript: Array<ActionEnvelope['authority']['transcript'][number]> = []
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'turn/start' && turn === undefined) {
      const candidate = (event.data as { turn?: unknown }).turn
      if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) turn = candidate
    }
    if (transcript.length >= 12) continue
    if (event?.type === 'user/message') {
      const text = contentText(event.data.content).trim()
      if (text.length === 0) continue
      const isDirectUser = event.data.source.kind === 'user'
      if (isDirectUser && currentUserRequest === undefined) {
        currentUserRequest = text.length <= 8192 ? text : text.slice(text.length - 8192)
      }
      transcript.push(Object.freeze({
        role: 'user',
        trust: isDirectUser ? 'trusted-user-intent' : 'untrusted-tool-output',
        text: text.slice(-4096),
      }))
      continue
    }
    if (event?.type === 'assistant/message') {
      const text = contentText((event.data as { content?: unknown }).content).trim()
      if (text.length > 0) transcript.push(Object.freeze({ role: 'assistant', trust: 'untrusted-model', text: text.slice(-4096) }))
      continue
    }
    if (event?.type === 'tool/result') {
      const text = contentText((event.data as { content?: unknown }).content).trim()
      if (text.length > 0) transcript.push(Object.freeze({ role: 'tool', trust: 'untrusted-tool-output', text: text.slice(-4096) }))
    }
  }
  return Object.freeze({
    sessionId: session.id,
    ...(turn === undefined ? {} : { turn }),
    ...(currentUserRequest === undefined ? {} : { currentUserRequest }),
    transcript: Object.freeze(transcript.reverse()),
  })
}

function requestedEscalation(
  toolName: string,
  arguments_: unknown,
): ActionEnvelope['requestedEscalation'] | undefined {
  if (!ESCALATION_TOOLS.has(toolName) || arguments_ === null || typeof arguments_ !== 'object') return undefined
  const value = arguments_ as Record<string, unknown>
  if (typeof value.sandbox_permissions !== 'string') return undefined
  return Object.freeze({
    mode: value.sandbox_permissions,
    justification: typeof value.justification === 'string' ? value.justification : '',
  })
}

function commandContainsSensitiveMarker(command: string, markers: readonly string[]): boolean {
  const normalized = command.replaceAll('\\', '/').toLocaleLowerCase()
  return markers.some(marker => {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (marker === '.env') {
      return new RegExp(`(?:^|[\\s'\"=:/])${escaped}(?:$|[\\s'\"/])`, 'i').test(normalized)
    }
    return normalized.includes(`/${marker}/`)
      || new RegExp(`(?:^|[\\s'\"=])(?:~?/)?${escaped}/`, 'i').test(normalized)
      || new RegExp(`/${escaped}(?:$|[\\s'\"<>])`, 'i').test(normalized)
  })
}

function productionCommandTargets(command: string): readonly string[] {
  const values: string[] = []
  for (const match of command.matchAll(/(?:^|\s)(?:--context|--namespace|-n|--filename|-f)(?:=|\s+)([^\s'"]+)/gu)) {
    if (match[1] !== undefined) values.push(match[1])
  }
  return Object.freeze([...new Set(values)])
}

function classifyCommand(
  command: string,
  sensitiveMarkers: readonly string[],
  productionMarkers: readonly string[],
): Classification | undefined {
  if (/(^|[;&|]\s*)(?:sudo\s+)?(?:chmod|chown|chgrp|setfacl)\b/i.test(command)) {
    return { kind: 'permission-change', disposition: 'review', reason: 'Shell command changes permissions or ownership.' }
  }
  if (/(^|[;&|]\s*)(?:sudo\s+)?(?:rm|rmdir|shred|mkfs|wipefs|dd)\b/i.test(command)) {
    return { kind: 'destructive', disposition: 'review', reason: 'Shell command can delete or overwrite data.' }
  }
  if (commandContainsSensitiveMarker(command, sensitiveMarkers)) {
    return { kind: 'sensitive-read', disposition: 'review', reason: 'Shell command references a configured sensitive path.' }
  }
  if (/(^|[;&|]\s*)(?:sudo\s+)?(?:\S*\/)?kubectl\b/i.test(command)) {
    const targets = productionCommandTargets(command)
    if (targets.some(target => productionMarkers.some(marker => target.toLocaleLowerCase().includes(marker)))) {
      return { kind: 'production-change', disposition: 'review', reason: 'Shell command targets a configured production Kubernetes context or namespace.' }
    }
  }
  if (/(^|[;&|]\s*)(?:sudo\s+)?(?:curl|wget|ssh|scp|rsync|git\s+(?:clone|fetch|pull|push)|npm\s+(?:install|publish)|pnpm\s+(?:install|publish)|pip\s+install)\b/i.test(command)) {
    return { kind: 'network', disposition: 'review', reason: 'Shell command can access the network or publish data.' }
  }
  return undefined
}

function networkTargets(arguments_: unknown): readonly string[] {
  const values: string[] = []
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 6) return
    if (typeof value === 'string') {
      for (const match of value.matchAll(/(?:https?|ssh):\/\/[^\s'"`]+/gi)) values.push(match[0])
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 64)) visit(entry, depth + 1)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const entry of Object.values(value)) visit(entry, depth + 1)
  }
  visit(arguments_)
  return Object.freeze([...new Set(values)].slice(0, 64))
}

function effectsFor(
  classification: Classification,
  toolName: string,
  arguments_: unknown,
  paths: readonly string[],
  contributed?: readonly ActionEffect[],
): readonly ActionEffect[] {
  if (contributed !== undefined) return Object.freeze([...contributed])
  const command = shellCommand(arguments_)
  const targets = networkTargets(arguments_)
  switch (classification.kind) {
    case 'workspace-read': return Object.freeze([{ type: 'fs.read', paths }])
    case 'workspace-write': return Object.freeze([{ type: 'fs.write', paths, destructive: false }])
    case 'sensitive-read': return Object.freeze([
      { type: 'credential.read', paths },
      ...(targets.length === 0 ? [] : [{ type: 'network.connect' as const, targets }]),
    ])
    case 'destructive': return Object.freeze([{ type: 'fs.write', paths, destructive: true }])
    case 'permission-change': return Object.freeze([{ type: 'permission.change', paths }])
    case 'production-change': {
      const commandTargets = productionCommandTargets(command)
      return Object.freeze([{ type: 'production.change', targets: commandTargets.length === 0 ? paths : commandTargets }])
    }
    case 'network': return Object.freeze([{ type: 'network.connect', targets }])
    case 'process':
    case 'sandbox-escalation': return Object.freeze([{
      type: 'process.exec',
      commandDigest: sha256Json(toJsonValue(command)),
      ...(arguments_ !== null && typeof arguments_ === 'object' && typeof (arguments_ as Record<string, unknown>).cwd === 'string'
        ? { cwd: (arguments_ as Record<string, string>).cwd }
        : {}),
    }])
    case 'extension-unknown': return Object.freeze([{ type: 'opaque', reason: `No security descriptor is registered for ${toolName}.` }])
    case 'hard-deny': return Object.freeze([{ type: 'opaque', reason: 'Deployment policy hard-denies this tool.' }])
    default: return Object.freeze([{ type: 'external.tool', name: toolName }])
  }
}

function normalizedCommandShape(command: string): string {
  const tokens: string[] = []
  let token = ''
  let quote: 'single' | 'double' | undefined
  let escaped = false
  const push = (): void => {
    if (token.length > 0) tokens.push(token)
    token = ''
  }
  for (const character of command) {
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single'
      continue
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double'
      continue
    }
    if (quote === undefined && /\s/u.test(character)) {
      push()
      continue
    }
    if (quote === undefined && /[;&|<>]/u.test(character)) {
      push()
      tokens.push(character)
      continue
    }
    token += character
  }
  if (escaped || quote !== undefined) return command.trim().replace(/\s+/g, ' ')
  push()
  return JSON.stringify(tokens)
}

function normalizedEffectBasis(effect: ActionEffect, command: string): unknown {
  const normalizePaths = (paths: readonly string[]): readonly string[] => Object.freeze(
    [...new Set(paths.map(path => path.replaceAll('\\\\', '/').replace(/\/{2,}/g, '/')))].sort(),
  )
  switch (effect.type) {
    case 'process.exec': return {
      type: effect.type,
      commandShape: normalizedCommandShape(command),
      ...(effect.cwd === undefined ? {} : { cwd: effect.cwd.replaceAll('\\\\', '/') }),
    }
    case 'fs.read': return {
      type: effect.type, paths: normalizePaths(effect.paths),
      ...(effect.paths.length === 0 ? { commandShape: normalizedCommandShape(command) } : {}),
    }
    case 'fs.write': return {
      type: effect.type, paths: normalizePaths(effect.paths), destructive: effect.destructive,
      ...(effect.paths.length === 0 ? { commandShape: normalizedCommandShape(command) } : {}),
    }
    case 'credential.read': return {
      type: effect.type, paths: normalizePaths(effect.paths),
      ...(effect.paths.length === 0 ? { commandShape: normalizedCommandShape(command) } : {}),
    }
    case 'permission.change': return {
      type: effect.type, paths: normalizePaths(effect.paths),
      ...(effect.paths.length === 0 ? { commandShape: normalizedCommandShape(command) } : {}),
    }
    case 'network.connect': return {
      type: effect.type, targets: [...new Set(effect.targets.map(target => target.toLocaleLowerCase()))].sort(),
      ...(effect.targets.length === 0 ? { commandShape: normalizedCommandShape(command) } : {}),
    }
    case 'production.change': return { type: effect.type, targets: [...new Set(effect.targets)].sort() }
    case 'external.tool': return { type: effect.type, name: effect.name }
    case 'opaque': return { type: effect.type, reason: effect.reason }
  }
}

export class ActionRouter {
  readonly config: ResolvedRouterConfig

  constructor(config: RouterConfig = {}) {
    this.config = resolveRouterConfig(config)
  }

  route(
    exec: Readonly<ToolExecution>,
    sandbox: SandboxExecutionPolicy,
    contributed?: {
      readonly resolverId: string
      readonly classification: ActionClassification
      readonly effects?: readonly ActionEffect[]
      readonly ruleIds?: readonly string[]
    },
    mode: ActionEnvelope['policy']['mode'] = 'enforcing',
    sandboxDefaultAllow = true,
  ): ActionEnvelope {
    const arguments_ = toJsonValue(exec.arguments)
    const command = shellCommand(exec.arguments)
    const paths = Object.freeze([
      ...new Set([
        ...extractPaths(exec.arguments),
        ...sensitiveCommandPaths(command, this.config.sensitiveMarkers),
      ]),
    ])
    const authority = transcriptOf(exec)
    const escalation = requestedEscalation(exec.name, exec.arguments)
    const selectedContribution = contributed !== undefined
      && !this.config.hardDenyToolNames.includes(exec.name)
      && escalation === undefined
      ? contributed
      : undefined
    const describedClassification: Classification = selectedContribution !== undefined
      ? {
          kind: selectedContribution.classification.actionKind,
          disposition: selectedContribution.classification.disposition,
          reason: selectedContribution.classification.reason,
        }
      : this.classify(exec.name, exec.arguments, paths, sandbox, escalation, sandboxDefaultAllow)
    // Product policy, not an upstream Codex sandbox boundary: Full Access has
    // no confinement, so even contributed/manual actions require review.
    const classification: Classification = sandbox.mode === 'danger-full-access' && describedClassification.disposition !== 'hard-deny'
      ? { ...describedClassification, disposition: 'review', reason: `${describedClassification.reason} Full Access requires review because no native sandbox confines execution.` }
      : !sandboxDefaultAllow && describedClassification.disposition === 'inside-boundary'
      ? { ...describedClassification, disposition: 'review', reason: `${describedClassification.reason} Native sandbox default-allow is disabled.` }
      : describedClassification
    const resolverId = selectedContribution?.resolverId ?? 'builtin'
    const effects = effectsFor(classification, exec.name, exec.arguments, paths, selectedContribution === undefined ? undefined : contributed?.effects)
    const policy = Object.freeze({
      mode,
      sandboxDefaultAllow,
      resolverId,
      disposition: classification.disposition,
      ruleIds: Object.freeze([
        ...(selectedContribution === undefined ? [] : contributed?.ruleIds ?? []),
        classification.disposition === 'hard-deny' ? 'AR-HARD-DENY' : `AR-ROUTE-${classification.kind.toUpperCase()}`,
      ]),
    })
    const boundary = Object.freeze({
      sandboxMode: sandbox.mode,
      workspaceRoot: sandbox.workspaceRoot,
      realpathVerified: false,
    })
    const actionDigest = sha256Json(toJsonValue({
      schemaVersion: 1,
      toolName: exec.name,
      arguments: arguments_,
      effects,
      ...(escalation === undefined ? {} : { requestedEscalation: escalation }),
    }))
    const effectDigest = sha256Json(toJsonValue({
      actionKind: classification.kind,
      effects: effects.map(effect => normalizedEffectBasis(effect, shellCommand(exec.arguments))),
      ...(escalation === undefined ? {} : { requestedEscalation: escalation }),
    }))
    const policyDigest = sha256Json(toJsonValue(policy))
    const boundaryDigest = sha256Json(toJsonValue({ ...boundary, paths }))
    return Object.freeze({
      schemaVersion: 1,
      actionId: `${exec.callId}:${actionDigest.slice(0, 16)}`,
      actionDigest,
      effectDigest,
      policyDigest,
      boundaryDigest,
      callId: exec.callId,
      rootCallId: exec.rootCallId,
      toolName: exec.name,
      arguments: arguments_,
      actionKind: classification.kind,
      disposition: classification.disposition,
      reason: classification.reason,
      resolverId,
      effects,
      policy,
      boundary,
      sandbox: Object.freeze({ mode: sandbox.mode, workspaceRoot: sandbox.workspaceRoot }),
      paths,
      authority,
      ...(escalation === undefined ? {} : { requestedEscalation: escalation }),
    })
  }

  private classify(
    toolName: string,
    arguments_: unknown,
    paths: readonly string[],
    sandbox: SandboxExecutionPolicy,
    escalation: ActionEnvelope['requestedEscalation'],
    sandboxDefaultAllow: boolean,
  ): Classification {
    if (this.config.hardDenyToolNames.includes(toolName)) {
      return { kind: 'hard-deny', disposition: 'hard-deny', reason: 'Tool is listed in deployment hard-deny policy.' }
    }
    if (escalation !== undefined) {
      return { kind: 'sandbox-escalation', disposition: 'review', reason: 'Action asks to widen the native sandbox for this call.' }
    }
    if (CONTROL_TOOLS.has(toolName)) {
      return { kind: 'process', disposition: 'inside-boundary', reason: 'Built-in conversation control action has no external side effect.' }
    }
    if (containsMarker(paths, this.config.sensitiveMarkers)) {
      return { kind: 'sensitive-read', disposition: 'review', reason: 'Action targets a configured sensitive path.' }
    }
    if (containsMarker(paths, this.config.productionMarkers)) {
      return { kind: 'production-change', disposition: 'review', reason: 'Action targets a configured production marker.' }
    }
    if (PROCESS_TOOLS.has(toolName)) {
      const elevated = classifyCommand(shellCommand(arguments_), this.config.sensitiveMarkers, this.config.productionMarkers)
      if (elevated?.kind === 'network' || elevated?.kind === 'sensitive-read' || elevated?.kind === 'production-change') return elevated
      if (sandboxDefaultAllow) {
        return { kind: elevated?.kind ?? 'process', disposition: 'inside-boundary', reason: 'Process remains confined by the native sandbox for this call.' }
      }
      return elevated ?? { kind: 'process', disposition: 'review', reason: 'Native sandbox default-allow is disabled for process execution.' }
    }
    if (NETWORK_TOOLS.has(toolName)) {
      return { kind: 'network', disposition: 'review', reason: 'Network access crosses the workspace action boundary.' }
    }
    const allInside = paths.length > 0 && paths.every(path => insideWorkspace(path, sandbox.workspaceRoot))
    if (DESTRUCTIVE_TOOLS.has(toolName)) {
      if (sandboxDefaultAllow && sandbox.mode !== 'read-only' && allInside) {
        return { kind: 'destructive', disposition: 'inside-boundary', reason: 'Destructive filesystem action remains confined to the native workspace boundary.' }
      }
      if (sandbox.mode === 'read-only' && allInside) {
        return { kind: 'destructive', disposition: 'review', reason: 'Native read-only mode does not permit destructive workspace changes.' }
      }
      return { kind: 'destructive', disposition: 'review', reason: 'Destructive filesystem action is outside the default native sandbox fast path.' }
    }
    if (READ_TOOLS.has(toolName)) {
      if (sandboxDefaultAllow && this.config.allowWorkspaceReads && allInside) {
        return { kind: 'workspace-read', disposition: 'inside-boundary', reason: 'Read stays inside the session workspace.' }
      }
      return { kind: 'sensitive-read', disposition: 'review', reason: 'Read is outside the session workspace or has no bounded path.' }
    }
    if (WRITE_TOOLS.has(toolName)) {
      if (sandboxDefaultAllow && sandbox.mode !== 'read-only' && this.config.allowWorkspaceWrites && allInside) {
        return { kind: 'workspace-write', disposition: 'inside-boundary', reason: 'Non-destructive write stays inside the session workspace.' }
      }
      if (sandbox.mode === 'read-only' && allInside) {
        return { kind: 'workspace-write', disposition: 'review', reason: 'Native read-only mode does not permit workspace writes.' }
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
