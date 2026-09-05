import type { ReviewCallId } from '../src/dsh-compat.ts'
import { snapshotSessionEvents } from '../src/dsh-compat.ts'

/** Cross-version test constructor for DSH's string-branded call identity. */
export function ToolCallId(value: string): ReviewCallId & any {
  return value as ReviewCallId & any
}

/** Read a session log through the same compatibility seam as production. */
export function sessionEvents<T = any>(session: unknown, start = 0): readonly T[] {
  return snapshotSessionEvents<T>(session).slice(start)
}
