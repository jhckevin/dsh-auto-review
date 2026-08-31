import { fileURLToPath } from 'node:url'
import type { AbsolutePath, PathUri } from './types.ts'

export const LOCAL_ENVIRONMENT_ID = 'local'

export class PathConversionError extends TypeError {
  override readonly name = 'PathConversionError'
}

export function absolutePath(value: string): AbsolutePath {
  if (value.includes('\0') || (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(value) && !value.startsWith('\\\\'))) {
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

function isCanonicalOpaqueFallback(url: URL): boolean {
  const match = url.href.match(/^file:\/\/\/%00\/bad\/path\/([A-Za-z0-9_-]+)$/u)
  if (match === null) return false
  try {
    const encoded = match[1]!
    const bytes = Buffer.from(encoded, 'base64url')
    return bytes.length > 0 && bytes.toString('base64url') === encoded
  } catch {
    return false
  }
}

function isWindowsUri(uri: PathUri): boolean {
  const url = new URL(uri)
  return url.hostname.length > 0 || /^\/[A-Za-z](?:%3A|:)(?:\/|$)/iu.test(url.pathname)
}

function decodedPathname(uri: PathUri): string {
  try {
    return decodeURIComponent(new URL(uri).pathname)
  } catch {
    throw new PathConversionError(`file URI path is not representable: ${uri}`)
  }
}

/** Linux-x86 PathUri::to_abs_path followed by Codex's local-environment fallback. */
export function guardianCwd(environmentId: string, cwd: PathUri): AbsolutePath {
  const url = new URL(cwd)
  if (!isWindowsUri(cwd)) {
    try {
      return absolutePath(fileURLToPath(url))
    } catch (error) {
      throw new PathConversionError(error instanceof Error ? error.message : `invalid local path: ${cwd}`)
    }
  }
  if (environmentId !== LOCAL_ENVIRONMENT_ID) {
    throw new PathConversionError(`file URI uses a foreign path convention: ${cwd}`)
  }
  if (url.hostname.length > 0) {
    throw new PathConversionError(`local cwd URI ${cwd} is not a host-native path`)
  }
  return absolutePath(decodedPathname(cwd))
}

/** PathUri::to_abs_path: unlike guardianCwd this never uses the local-environment fallback. */
export function pathUriToAbsolutePath(uri: PathUri): AbsolutePath {
  if (isWindowsUri(uri)) throw new PathConversionError(`file URI uses a foreign path convention: ${uri}`)
  try {
    return absolutePath(fileURLToPath(new URL(uri)))
  } catch (error) {
    throw new PathConversionError(error instanceof Error ? error.message : `invalid local path: ${uri}`)
  }
}

/** LegacyAppPathString::from(PathUri) using the URI-inferred convention. */
export function inferredNativePathString(uri: PathUri): string {
  const url = new URL(uri)
  const decoded = decodedPathname(uri)
  if (url.hostname.length > 0) return `\\\\${url.hostname}${decoded.replaceAll('/', '\\')}`
  const drive = decoded.match(/^\/([A-Za-z]:)(?:\/(.*))?$/u)
  if (drive !== null) return `${drive[1]}\\${(drive[2] ?? '').replaceAll('/', '\\')}`
  return decoded
}
