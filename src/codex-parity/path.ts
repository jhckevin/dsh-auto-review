import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AbsolutePath, PathUri, PosixAbsolutePathBytes } from './types.ts'

export const LOCAL_ENVIRONMENT_ID = 'local'

export class PathConversionError extends TypeError {
  override readonly name = 'PathConversionError'
}

export function absolutePath(value: string): AbsolutePath {
  // ISSUE-022A is a Linux x86 boundary: std::path::Path::is_absolute accepts
  // only a POSIX root here. Windows drive and UNC spellings are foreign paths.
  if (value.includes('\0') || !value.startsWith('/')) {
    throw new PathConversionError(`path is not absolute: ${value}`)
  }
  return value as AbsolutePath
}

export function pathUri(value: string): PathUri {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PathConversionError(`invalid file URI: ${value}`)
  }
  if (url.protocol !== 'file:') throw new PathConversionError(`invalid file URI scheme: ${url.protocol}`)
  if (url.username.length > 0 || url.password.length > 0) throw new PathConversionError('credentials are not allowed in path URIs')
  if (url.port.length > 0) throw new PathConversionError('ports are not allowed in path URIs')
  if (url.search.length > 0) throw new PathConversionError('query parameters are not allowed in path URIs')
  if (url.hash.length > 0) throw new PathConversionError('fragments are not allowed in path URIs')
  const decodedBytes = decodePercentEncodedPathBytes(url.pathname)
  if (decodedBytes.includes(0) && !isCanonicalOpaqueFallback(url)) {
    throw new PathConversionError(`file URI path contains NUL: ${value}`)
  }
  if (url.hostname === 'localhost') url.hostname = ''
  const drive = url.pathname.match(/^(\/*)([a-z])(?::|%3a)(\/|$)/iu)
  if (url.hostname.length === 0 && drive !== null) {
    const slashes = drive[1]!
    const driveLetter = drive[2]!
    const encodedColon = url.pathname.slice(slashes.length + 1, slashes.length + 4)
    const colon = encodedColon.toLowerCase() === '%3a' ? encodedColon : ':'
    url.pathname = `${slashes}${driveLetter.toUpperCase()}${colon}${url.pathname.slice(slashes.length + 1 + colon.length)}`
  }
  return url.href as PathUri
}

function decodePercentEncodedPathBytes(pathname: string): number[] {
  const bytes: number[] = []
  for (let index = 0; index < pathname.length;) {
    if (pathname[index] === '%' && /^[0-9a-f]{2}$/iu.test(pathname.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(pathname.slice(index + 1, index + 3), 16))
      index += 3
    } else {
      const encoded = Buffer.from(pathname[index]!, 'utf8')
      bytes.push(...encoded)
      index += 1
    }
  }
  return bytes
}

function opaqueFallbackBytes(url: URL): Uint8Array | undefined {
  const match = url.href.match(/^file:\/\/\/%00\/bad\/path\/([A-Za-z0-9_-]+)$/u)
  if (match === null) return undefined
  try {
    const encoded = match[1]!
    const bytes = Buffer.from(encoded, 'base64url')
    return bytes.length > 0 && bytes.toString('base64url') === encoded ? bytes : undefined
  } catch {
    return undefined
  }
}

function isCanonicalOpaqueFallback(url: URL): boolean { return opaqueFallbackBytes(url) !== undefined }

function strictUtf8(bytes: Uint8Array): string | undefined {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return undefined }
}

function opaqueAbsolutePath(bytes: Uint8Array): PosixAbsolutePathBytes {
  return { kind: 'posix_absolute_path_bytes', bytesBase64: Buffer.from(bytes).toString('base64url') }
}

export function isPosixAbsolutePathBytes(path: AbsolutePath): path is PosixAbsolutePathBytes {
  return typeof path !== 'string'
}

export function absolutePathToLossyString(path: AbsolutePath): string {
  return typeof path === 'string'
    ? path
    : new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(path.bytesBase64, 'base64url'))
}

/** Mirrors PathBuf's serde string boundary; non-UTF-8 paths fail closed. */
export function serializeAbsolutePath(path: AbsolutePath): string {
  if (typeof path === 'string') return path
  const decoded = strictUtf8(Buffer.from(path.bytesBase64, 'base64url'))
  if (decoded === undefined) throw new PathConversionError('path contains invalid UTF-8 characters')
  return decoded
}

function isWindowsUri(uri: PathUri): boolean {
  const url = new URL(uri)
  const opaque = opaqueFallbackBytes(url)
  if (opaque !== undefined) {
    if (opaque[0] === 0x2f || opaque.length % 2 !== 0) return false
    const text = new TextDecoder('utf-16le', { fatal: false }).decode(opaque)
    return /^[A-Za-z]:[\\/]/u.test(text) || /^[\\/]{2}/u.test(text)
  }
  return url.hostname.length > 0 || /^\/[A-Za-z](?:%3A|:)(?:\/|$)/iu.test(url.pathname)
}

function decodedPathnameLossy(uri: PathUri): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(decodePercentEncodedPathBytes(new URL(uri).pathname)))
}

/** Linux-x86 PathUri::to_abs_path followed by Codex's local-environment fallback. */
export function guardianCwd(environmentId: string, cwd: PathUri): AbsolutePath {
  const url = new URL(cwd)
  try { return pathUriToAbsolutePath(cwd) } catch (error) {
    if (environmentId !== LOCAL_ENVIRONMENT_ID) throw error
  }
  try { return absolutePath(fileURLToPath(url)) } catch {
    throw new PathConversionError(`local cwd URI ${cwd} is not a host-native path`)
  }
}

/** PathUri::to_abs_path: unlike guardianCwd this never uses the local-environment fallback. */
export function pathUriToAbsolutePath(uri: PathUri): AbsolutePath {
  const url = new URL(uri)
  const opaque = opaqueFallbackBytes(url)
  if (opaque !== undefined) {
    if (opaque[0] !== 0x2f) throw new PathConversionError(`'${uri}' is invalid on 'linux'`)
    // A canonical fallback only round-trips through PathUri::from_abs_path when
    // the native bytes cannot use an ordinary URI spelling (non-UTF-8 or NUL).
    if (strictUtf8(opaque) !== undefined && !opaque.includes(0)) {
      throw new PathConversionError(`'${uri}' is invalid on 'linux'`)
    }
    return opaqueAbsolutePath(opaque)
  }
  if (isWindowsUri(uri)) throw new PathConversionError(`'${uri}' is invalid on 'linux'`)
  const bytes = Uint8Array.from(decodePercentEncodedPathBytes(url.pathname))
  const decoded = strictUtf8(bytes)
  if (decoded === undefined) return opaqueAbsolutePath(bytes)
  return absolutePath(decoded)
}

/** LegacyAppPathString::from(PathUri) using the URI-inferred convention. */
export function inferredNativePathString(uri: PathUri): string {
  const url = new URL(uri)
  const opaque = opaqueFallbackBytes(url)
  if (opaque !== undefined) {
    if (opaque[0] === 0x2f) return new TextDecoder('utf-8', { fatal: false }).decode(opaque)
    if (opaque.length % 2 === 0) {
      const text = new TextDecoder('utf-16le', { fatal: false }).decode(opaque)
      if (/^[A-Za-z]:[\\/]/u.test(text) || /^[\\/]{2}/u.test(text)) return text
    }
    return uri
  }
  const decoded = decodedPathnameLossy(uri)
  if (url.hostname.length > 0) return `\\\\${url.hostname}${decoded.replaceAll('/', '\\')}`
  const drive = decoded.match(/^\/([A-Za-z]:)(?:\/(.*))?$/u)
  if (drive !== null) return `${drive[1]}\\${(drive[2] ?? '').replaceAll('/', '\\')}`
  return decoded
}

/** Stable string stand-in for PathUri's Windows ASCII-case-folded Eq/Hash. */
export function pathUriCacheIdentity(uri: PathUri): string {
  if (!isWindowsUri(uri)) return uri
  const url = new URL(uri)
  if (isCanonicalOpaqueFallback(url) || url.pathname.split('/').some(segment => {
    const bytes = decodePercentEncodedPathBytes(segment)
    return bytes.includes(0x2f) || bytes.includes(0x5c)
  })) return uri
  const folded = Uint8Array.from(decodePercentEncodedPathBytes(url.pathname), byte =>
    byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte)
  return `windows:${url.hostname}:${Buffer.from(folded).toString('base64url')}`
}

/** Raw permission seams require LegacyAppPathString -> PathUri lossless roundtrip. */
export function losslessLegacyAppPathString(uri: PathUri): string {
  const raw = inferredNativePathString(uri)
  let roundTrip: PathUri
  if (isWindowsUri(uri)) {
    const unc = raw.match(/^\\\\([^\\]+)\\(.*)$/u)
    const drive = raw.match(/^([A-Za-z]):[\\/](.*)$/u)
    if (unc !== null) roundTrip = pathUri(`file://${unc[1]}/${unc[2]!.replaceAll('\\', '/')}`)
    else if (drive !== null) roundTrip = pathUri(`file:///${drive[1]}:/${drive[2]!.replaceAll('\\', '/')}`)
    else throw new PathConversionError('permission path cannot be represented losslessly')
  } else {
    roundTrip = pathUri(pathToFileURL(raw).href)
  }
  if (pathUriCacheIdentity(roundTrip) !== pathUriCacheIdentity(uri)) {
    throw new PathConversionError('permission path cannot be represented losslessly')
  }
  return raw
}
