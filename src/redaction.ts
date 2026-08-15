import type { JsonValue } from '@deepseek-ai/dsh-session'

const SECRET_KEY = /(?:api[_-]?key|token|secret|password|passwd|authorization|cookie|credential|private[_-]?key)/i
const SECRET_TEXT = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
]

export interface RedactionOptions {
  readonly maxStringBytes?: number
  readonly maxDepth?: number
  readonly maxArrayItems?: number
  readonly maxObjectKeys?: number
}

function trimUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let end = Math.min(value.length, maxBytes)
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) end -= 1
  return `${value.slice(0, end)}…[truncated]`
}

export function redactJson(value: JsonValue, options: RedactionOptions = {}): JsonValue {
  const maxStringBytes = options.maxStringBytes ?? 4096
  const maxDepth = options.maxDepth ?? 8
  const maxArrayItems = options.maxArrayItems ?? 64
  const maxObjectKeys = options.maxObjectKeys ?? 64

  const visit = (candidate: JsonValue, depth: number, key?: string): JsonValue => {
    if (key !== undefined && SECRET_KEY.test(key)) return '[REDACTED]'
    if (candidate === null || typeof candidate === 'number' || typeof candidate === 'boolean') return candidate
    if (typeof candidate === 'string') {
      let redacted = candidate
      for (const pattern of SECRET_TEXT) redacted = redacted.replace(pattern, '[REDACTED]')
      return trimUtf8(redacted, maxStringBytes)
    }
    if (depth >= maxDepth) return '[MAX_DEPTH]'
    if (Array.isArray(candidate)) {
      const result = candidate.slice(0, maxArrayItems).map(entry => visit(entry, depth + 1))
      if (candidate.length > maxArrayItems) result.push(`[${candidate.length - maxArrayItems} items omitted]`)
      return result
    }
    const result: Record<string, JsonValue> = {}
    const entries = Object.entries(candidate)
    for (const [entryKey, entry] of entries.slice(0, maxObjectKeys)) {
      result[entryKey] = visit(entry, depth + 1, entryKey)
    }
    if (entries.length > maxObjectKeys) result.__omitted__ = entries.length - maxObjectKeys
    return result
  }

  return visit(value, 0)
}
