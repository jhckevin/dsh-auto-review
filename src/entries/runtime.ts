import type { AutoReviewConfig } from '../types.ts'
import { guardedEntry } from '../guarded-entry.ts'
export default guardedEntry<AutoReviewConfig>('auto-review', [], async () =>
  (await import('../service.js')).ActionReviewRuntime)
