import { losslessLegacyAppPathString, pathUriToAbsolutePath } from './path.ts'
import type { JsonObject, JsonValue, PartialPermissionProfile, PermissionProfile, SerializedPartialPermissionProfile } from './types.ts'

function serializeRawEntry(entry: Extract<NonNullable<PartialPermissionProfile['file_system']>, { entries: unknown }>['entries'][number]): JsonObject {
  return {
    path: entry.path.type === 'path'
      ? { type: 'path', path: losslessLegacyAppPathString(entry.path.path) }
      : entry.path,
    access: entry.access,
    ...(entry.missing_path_behavior === undefined ? {} : { missing_path_behavior: entry.missing_path_behavior }),
  } as unknown as JsonObject
}

function serializeFileSystem(fileSystem: NonNullable<PartialPermissionProfile['file_system']>): JsonObject {
  if (!('entries' in fileSystem)) return { ...fileSystem } as unknown as JsonObject
  if (fileSystem.glob_scan_max_depth === undefined) {
    const read: string[] = []
    const write: string[] = []
    let legacy = true
    for (const entry of fileSystem.entries) {
      if (entry.path.type !== 'path' || entry.access === 'deny') { legacy = false; break }
      try {
        const absolute = pathUriToAbsolutePath(entry.path.path)
        ;(entry.access === 'read' ? read : write).push(absolute)
      } catch { legacy = false; break }
    }
    if (legacy) return {
      ...(read.length === 0 ? {} : { read }),
      ...(write.length === 0 ? {} : { write }),
    }
  }
  const entries = fileSystem.entries.map(serializeRawEntry) as unknown as JsonValue[]
  return { entries, ...(fileSystem.glob_scan_max_depth === undefined ? {} : { glob_scan_max_depth: fileSystem.glob_scan_max_depth }) }
}

/** Mirrors Additional/RequestPermissionProfile serde, including legacy FS collapse. */
export function serializePermissionProfile(profile: PartialPermissionProfile): SerializedPartialPermissionProfile {
  return {
    network: profile.network === undefined
      ? null
      : { enabled: profile.network.enabled === undefined ? null : profile.network.enabled },
    file_system: profile.file_system === undefined ? null : serializeFileSystem(profile.file_system),
  }
}

/** Mirrors protocol/models.rs tagged active PermissionProfile serialization. */
export function serializeRuntimePermissionProfile(profile: PermissionProfile): JsonObject {
  switch (profile.type) {
    case 'disabled': return { type: 'disabled' }
    case 'external': return { type: 'external', network: profile.network }
    case 'managed': return {
      type: 'managed',
      file_system: profile.file_system.type === 'unrestricted'
        ? { type: 'unrestricted' }
        : {
            type: 'restricted',
            entries: profile.file_system.entries.map(serializeRawEntry) as unknown as JsonValue[],
            ...(profile.file_system.glob_scan_max_depth === undefined ? {} : { glob_scan_max_depth: profile.file_system.glob_scan_max_depth }),
          },
      network: profile.network,
    }
  }
}
