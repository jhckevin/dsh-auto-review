import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse, resolve } from 'node:path'

/** DSH releases with a completed Auto Review compatibility suite. */
export type SupportedDshVersion = '0.1.0-rc.6' | '0.1.1-rc.2' | '0.1.2-alpha.5'
export type DshCompatibilityChannel = 'rc6' | 'rc2' | 'alpha5'

export interface DshCompatibilityProfile {
  readonly channel: DshCompatibilityChannel
  readonly version: SupportedDshVersion
  readonly sessionEvents: 'events-array' | 'snapshot-events'
  readonly settingsNamespace: 'helper' | 'literal'
  readonly badgeInjection: 'shared-client' | 'host-observable'
}

export interface DshCompatibilityReport {
  readonly supported: boolean
  readonly profile?: DshCompatibilityProfile
  readonly versions: Readonly<Record<string, string | undefined>>
  readonly reason?: string
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ReviewCallId = string

export const SUPPORTED_DSH_PROFILES: Readonly<Record<SupportedDshVersion, DshCompatibilityProfile>> = Object.freeze({
  '0.1.0-rc.6': Object.freeze({
    channel: 'rc6', version: '0.1.0-rc.6', sessionEvents: 'events-array',
    settingsNamespace: 'helper', badgeInjection: 'shared-client',
  }),
  '0.1.1-rc.2': Object.freeze({
    channel: 'rc2', version: '0.1.1-rc.2', sessionEvents: 'events-array',
    settingsNamespace: 'helper', badgeInjection: 'shared-client',
  }),
  '0.1.2-alpha.5': Object.freeze({
    channel: 'alpha5', version: '0.1.2-alpha.5', sessionEvents: 'snapshot-events',
    settingsNamespace: 'literal', badgeInjection: 'host-observable',
  }),
})

const COHORT_PACKAGES = Object.freeze([
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-user-approval',
] as const)

type PackageResolver = ReturnType<typeof createRequire>

/**
 * pnpm may materialize a DSH plugin as a real directory rather than a peer-linked
 * virtual-store entry. In that layout the plugin-local resolver cannot see host
 * packages, although the DSH launcher can. Probe both resolution roots.
 */
function hostResolvers(): readonly PackageResolver[] {
  const resolvers: PackageResolver[] = [createRequire(import.meta.url)]
  const launcher = process.argv[1]
  if (typeof launcher === 'string' && launcher.length > 0 && existsSync(launcher)) {
    resolvers.push(createRequire(resolve(launcher)))
  }
  return resolvers
}

function packageManifestPath(packageName: string, resolver: PackageResolver): string | undefined {
  const entry = resolver.resolve(packageName)
  const root = parse(entry).root
  for (let cursor = dirname(entry); cursor !== root; cursor = dirname(cursor)) {
    const candidate = join(cursor, 'package.json')
    if (!existsSync(candidate)) continue
    const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: unknown }
    if (manifest.name === packageName) return candidate
  }
  return undefined
}

function resolvedVersion(packageName: string): string | undefined {
  const versions = new Set<string>()
  for (const resolver of hostResolvers()) {
    try {
      const manifestPath = packageManifestPath(packageName, resolver)
      if (manifestPath === undefined) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
      if (typeof manifest.version === 'string') versions.add(manifest.version)
    } catch {
      // Try the launcher resolution root before declaring the package missing.
    }
  }
  // A shadow package must never hide a conflicting launcher package.
  return versions.size === 0 ? undefined : [...versions].sort().join(' / ')
}

/** Classify a resolved host dependency cohort without consulting package-manager metadata. */
export function classifyDshHost(
  versions: Readonly<Record<string, string | undefined>>,
): DshCompatibilityReport {
  const missing = COHORT_PACKAGES.filter(name => versions[name] === undefined)
  if (missing.length > 0) {
    return Object.freeze({ supported: false, versions: Object.freeze({ ...versions }),
      reason: `missing host packages: ${missing.join(', ')}` })
  }
  const cohort = new Set(COHORT_PACKAGES.map(name => versions[name] as string))
  if (cohort.size !== 1) {
    return Object.freeze({ supported: false, versions: Object.freeze({ ...versions }),
      reason: `mixed DSH package cohort: ${[...cohort].sort().join(', ')}` })
  }
  const version = [...cohort][0]
  const profile = version !== undefined && Object.hasOwn(SUPPORTED_DSH_PROFILES, version)
    ? SUPPORTED_DSH_PROFILES[version as SupportedDshVersion] : undefined
  if (profile === undefined) {
    return Object.freeze({ supported: false, versions: Object.freeze({ ...versions }),
      reason: `unsupported DSH package cohort ${version}` })
  }
  return Object.freeze({ supported: true, profile, versions: Object.freeze({ ...versions }) })
}

/** Resolve the running host, not the package-lock used to build this plugin. */
export function detectDshHost(): DshCompatibilityReport {
  const versions = Object.fromEntries(COHORT_PACKAGES.map(name => [name, resolvedVersion(name)]))
  return classifyDshHost(versions)
}

/** Fail before Auto Review registers any mutable runtime state. */
export function assertSupportedDshHost(): DshCompatibilityProfile {
  const report = detectDshHost()
  if (report.supported && report.profile !== undefined) return report.profile
  const evidence = Object.entries(report.versions)
    .map(([name, version]) => `${name}=${version ?? 'missing'}`).join(', ')
  throw new Error(
    `auto-review: incompatible DeepSeek Harness host (${report.reason ?? 'unknown reason'}). `
    + `Supported cohorts: ${Object.keys(SUPPORTED_DSH_PROFILES).join(', ')}. Resolved: ${evidence}`,
  )
}

/** Normalize the immutable Session history APIs used by the three supported hosts. */
export function snapshotSessionEvents<T>(session: unknown): readonly T[] {
  const candidate = session as {
    snapshotEvents?: () => readonly T[]
    events?: readonly T[]
    seq?: number
    eventAt?: (index: number) => T
  }
  if (typeof candidate.snapshotEvents === 'function') return candidate.snapshotEvents()
  if (Array.isArray(candidate.events)) return candidate.events
  if (Number.isSafeInteger(candidate.seq) && typeof candidate.eventAt === 'function') {
    return Array.from({ length: candidate.seq as number }, (_, index) => candidate.eventAt?.(index) as T)
  }
  throw new Error('auto-review: the DSH Session event API does not match a supported host')
}
