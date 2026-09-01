declare const absolutePathBrand: unique symbol
declare const pathUriBrand: unique symbol
declare const u16Brand: unique symbol
declare const i32Brand: unique symbol
declare const nonZeroUsizeBrand: unique symbol

export interface PosixAbsolutePathBytes {
  readonly kind: 'posix_absolute_path_bytes'
  readonly bytesBase64: string
}
export type AbsolutePath = (string & { readonly [absolutePathBrand]: true }) | PosixAbsolutePathBytes
export type PathUri = string & { readonly [pathUriBrand]: true }
export type U16 = number & { readonly [u16Brand]: true }
export type I32 = number & { readonly [i32Brand]: true }
export type NonZeroUsize = number & { readonly [nonZeroUsizeBrand]: true }
export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type SandboxPermissions = 'use_default' | 'require_escalated' | 'with_additional_permissions'
export type NetworkApprovalProtocol = 'http' | 'https' | 'socks5_tcp' | 'socks5_udp'
export type GuardianCommandSource = 'shell' | 'unified_exec'
export type ApprovalsReviewer = 'user' | 'auto_review'
export type AppToolApproval = 'auto' | 'prompt' | 'writes' | 'approve'
export type AskForApproval =
  | 'untrusted'
  | 'on-request'
  | 'never'
  | { granular: GranularApprovalConfig }

export interface GranularApprovalConfig {
  sandbox_approval: boolean
  rules: boolean
  skill_approval: boolean
  request_permissions: boolean
  mcp_elicitations: boolean
}

export interface NetworkPermissions { enabled?: boolean }
export type FileSystemAccessMode = 'read' | 'write' | 'deny'
export type FileSystemSpecialPath =
  | { kind: 'root' | 'minimal' | 'tmpdir' | 'slash_tmp' }
  | { kind: 'project_roots'; subpath?: string }
  | { kind: 'unknown'; path: string; subpath?: string }
export type FileSystemPath =
  | { type: 'path'; path: PathUri }
  | { type: 'glob_pattern'; pattern: string }
  | { type: 'special'; value: FileSystemSpecialPath }
export interface FileSystemSandboxEntry {
  path: FileSystemPath
  access: FileSystemAccessMode
  missing_path_behavior?: 'skip'
}
export type FileSystemPermissions =
  | { read?: AbsolutePath[]; write?: AbsolutePath[] }
  | { entries: FileSystemSandboxEntry[]; glob_scan_max_depth?: NonZeroUsize }
export interface PartialPermissionProfile {
  network?: NetworkPermissions
  file_system?: FileSystemPermissions
}
export type AdditionalPermissionProfile = PartialPermissionProfile
export type RequestPermissionProfile = PartialPermissionProfile
export type SerializedFileSystemSpecialPath = JsonObject & (
  | { kind: 'root' | 'minimal' | 'tmpdir' | 'slash_tmp' }
  | { kind: 'project_roots'; subpath?: string }
  | { kind: 'unknown'; path: string; subpath?: string }
)
export type SerializedFileSystemPath = JsonObject & (
  | { type: 'path'; path: string }
  | { type: 'glob_pattern'; pattern: string }
  | { type: 'special'; value: SerializedFileSystemSpecialPath }
)
export interface SerializedFileSystemSandboxEntry extends JsonObject {
  path: SerializedFileSystemPath
  access: FileSystemAccessMode
  missing_path_behavior?: 'skip'
}
export type SerializedFileSystemPermissions = JsonObject & (
  | { read?: string[]; write?: string[] }
  | { entries: SerializedFileSystemSandboxEntry[]; glob_scan_max_depth?: NonZeroUsize }
)
export interface SerializedNetworkPermissions extends JsonObject { enabled: boolean | null }
export interface SerializedPartialPermissionProfile extends JsonObject {
  network: SerializedNetworkPermissions | null
  file_system: SerializedFileSystemPermissions | null
}

export type NetworkSandboxPolicy = 'restricted' | 'enabled'
export type ManagedFileSystemPermissions =
  | { type: 'restricted'; entries: FileSystemSandboxEntry[]; glob_scan_max_depth?: NonZeroUsize }
  | { type: 'unrestricted' }
export type PermissionProfile =
  | { type: 'managed'; file_system: ManagedFileSystemPermissions; network: NetworkSandboxPolicy }
  | { type: 'disabled' }
  | { type: 'external'; network: NetworkSandboxPolicy }

export interface ExecPolicyAmendment { command: string[] }
export interface GuardianMcpAnnotations {
  destructive_hint?: boolean
  open_world_hint?: boolean
  read_only_hint?: boolean
}
export interface GuardianNetworkAccessTrigger {
  callId: string
  toolName: string
  command: string[]
  cwd: PathUri
  sandboxPermissions: SandboxPermissions
  additionalPermissions?: AdditionalPermissionProfile
  justification?: string
  tty?: boolean
}

interface ActionBase<T extends string> { type: T; id: string }
export interface ExecCommandApprovalAction extends ActionBase<'exec_command'> {
  environmentId: string
  command: string[]
  hookCommand: string
  cwd: PathUri
  sandboxPermissions: SandboxPermissions
  additionalPermissions?: AdditionalPermissionProfile
  justification?: string
  tty: boolean
  proposedExecpolicyAmendment?: ExecPolicyAmendment
}
export interface WriteStdinApprovalAction extends ActionBase<'write_stdin'> {
  approvalId: string
  environmentId: string
  processId: I32
  input: string
  cwd: PathUri
  tty: boolean
  sandboxPermissions: SandboxPermissions
  additionalPermissions?: AdditionalPermissionProfile
}
export interface ExecveApprovalAction extends ActionBase<'execve'> {
  approvalId: string
  environmentId: string
  source: GuardianCommandSource
  program: AbsolutePath
  argv: string[]
  command: string[]
  cwd: AbsolutePath
  additionalPermissions?: AdditionalPermissionProfile
}
export interface ApplyPatchApprovalAction extends ActionBase<'apply_patch'> {
  environmentId: string
  cwd: PathUri
  files: PathUri[]
  patch: string
  changes: JsonObject
  permissionsPreapproved: boolean
}
export interface McpToolCallApprovalAction extends ActionBase<'mcp_tool_call'> {
  server: string
  toolName: string
  arguments?: JsonValue
  connectorId?: string
  connectorName?: string
  connectorDescription?: string
  connectedAccountEmail?: string
  toolTitle?: string
  toolDescription?: string
  annotations?: GuardianMcpAnnotations
  hookToolName: string
  approvalPolicy: AskForApproval
  reviewer: ApprovalsReviewer
  approvalMode: AppToolApproval
  allowSessionRemember: boolean
  allowPersistentApproval: boolean
}
export interface NetworkAccessApprovalAction extends ActionBase<'network_access'> {
  turnId: string
  environmentId: string
  target: string
  host: string
  protocol: NetworkApprovalProtocol
  port: U16
  trigger?: GuardianNetworkAccessTrigger
  hookCommand: string
  hookRunId: string
  command: string[]
  cwd: AbsolutePath
}
export interface RequestPermissionsApprovalAction extends ActionBase<'request_permissions'> {
  turnId: string
  reason?: string
  permissions: RequestPermissionProfile
}
export type ApprovalAction =
  | ExecCommandApprovalAction | WriteStdinApprovalAction | ExecveApprovalAction
  | ApplyPatchApprovalAction | McpToolCallApprovalAction | NetworkAccessApprovalAction
  | RequestPermissionsApprovalAction

export interface PermissionRequestPayload { toolName: string; toolInput: JsonValue }
export interface UnifiedExecApprovalKey {
  type: 'exec_command'
  environmentId: string
  executable?: string
  command: string[]
  cwd: PathUri
  tty: boolean
  sandboxPermissions: SandboxPermissions
  additionalPermissions: SerializedPartialPermissionProfile | null
}
export interface ApplyPatchApprovalKey { type: 'apply_patch'; environmentId: string; path: PathUri }
export type ApprovalCacheKey = UnifiedExecApprovalKey | ApplyPatchApprovalKey

export type GuardianApprovalRequest =
  | { type: 'exec_command'; id: string; command: string[]; cwd: AbsolutePath; sandboxPermissions: SandboxPermissions; additionalPermissions?: AdditionalPermissionProfile; justification?: string; tty: boolean }
  | { type: 'write_stdin'; id: string; approvalId: string; environmentId: string; processId: I32; input: string; cwd: PathUri; tty: boolean; sandboxPermissions: SandboxPermissions; additionalPermissions?: AdditionalPermissionProfile }
  | { type: 'execve'; id: string; source: GuardianCommandSource; program: string; argv: string[]; cwd: AbsolutePath; additionalPermissions?: AdditionalPermissionProfile }
  | { type: 'apply_patch'; id: string; cwd: AbsolutePath; files: AbsolutePath[]; patch: string }
  | { type: 'mcp_tool_call'; id: string; server: string; toolName: string; arguments?: JsonValue; connectorId?: string; connectorName?: string; connectorDescription?: string; connectedAccountEmail?: string; toolTitle?: string; toolDescription?: string; annotations?: GuardianMcpAnnotations }
  | { type: 'network_access'; id: string; turnId: string; target: string; host: string; protocol: NetworkApprovalProtocol; port: U16; trigger?: GuardianNetworkAccessTrigger }
  | RequestPermissionsApprovalAction

export type GuardianAssessmentAction =
  | { type: 'command'; source: GuardianCommandSource; command: string; cwd: AbsolutePath }
  | { type: 'execve'; source: GuardianCommandSource; program: string; argv: string[]; cwd: AbsolutePath }
  | { type: 'write_stdin'; approval_id: string; process_id: string; stdin: string; cwd: PathUri }
  | { type: 'apply_patch'; cwd: AbsolutePath; files: AbsolutePath[] }
  | { type: 'network_access'; target: string; host: string; protocol: NetworkApprovalProtocol; port: U16 }
  | { type: 'mcp_tool_call'; server: string; tool_name: string; connector_id: string | null; connector_name: string | null; tool_title: string | null }
  | { type: 'request_permissions'; reason: string | null; permissions: SerializedPartialPermissionProfile }

export type GuardianRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type GuardianUserAuthorization = 'unknown' | 'low' | 'medium' | 'high'
export type GuardianAssessmentOutcome = 'allow' | 'deny'
export type GuardianAssessmentStatus = 'in_progress' | 'approved' | 'denied' | 'timed_out' | 'aborted'
export type GuardianAssessmentDecisionSource = 'agent'
export interface GuardianAssessmentEvent {
  id: string
  target_item_id?: string
  plugin_id?: string
  script_path?: string
  turn_id: string
  started_at_ms: number
  completed_at_ms?: number
  status: GuardianAssessmentStatus
  risk_level?: GuardianRiskLevel
  user_authorization?: GuardianUserAuthorization
  rationale?: string
  decision_source?: GuardianAssessmentDecisionSource
  action: GuardianAssessmentAction
}

export type GuardianReviewedAction =
  | { type: 'shell'; sandbox_permissions: SandboxPermissions; additional_permissions: SerializedPartialPermissionProfile | null }
  | { type: 'unified_exec'; sandbox_permissions: SandboxPermissions; additional_permissions: SerializedPartialPermissionProfile | null; tty: boolean }
  | { type: 'write_stdin'; tty: boolean }
  | { type: 'execve'; source: GuardianCommandSource; program: string; additional_permissions: SerializedPartialPermissionProfile | null }
  | { type: 'apply_patch' }
  | { type: 'network_access'; protocol: NetworkApprovalProtocol; port: U16 }
  | { type: 'mcp_tool_call'; server: string; tool_name: string; connector_id: string | null; connector_name: string | null; tool_title: string | null }
  | { type: 'request_permissions' }

export interface FormattedGuardianAction { text: string; truncated: boolean }
