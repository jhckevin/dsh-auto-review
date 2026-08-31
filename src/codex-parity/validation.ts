import type { I32, NonZeroUsize, U16 } from './types.ts'

export function u16(value: number): U16 {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) throw new RangeError(`u16 out of range: ${value}`)
  return value as U16
}

export function i32(value: number): I32 {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    throw new RangeError(`i32 out of range: ${value}`)
  }
  return value as I32
}

export function nonZeroUsize(value: number): NonZeroUsize {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`value is not a NonZeroUsize: ${value}`)
  return value as NonZeroUsize
}
