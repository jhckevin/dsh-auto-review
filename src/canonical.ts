import { createHash } from 'node:crypto'
import type { JsonValue } from './dsh-compat.ts'

function canonicalValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('action arguments contain a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key] as JsonValue)}`).join(',')}}`
}

export function canonicalJson(value: JsonValue): string {
  return canonicalValue(value)
}

export function sha256Json(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('action arguments must be lossless JSON')
    return value
  }
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (typeof value !== 'object') throw new TypeError('action arguments must be lossless JSON')
  const result: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) throw new TypeError(`action arguments contain undefined at ${key}`)
    result[key] = toJsonValue(entry)
  }
  return result
}
