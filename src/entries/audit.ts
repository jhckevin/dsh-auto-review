import type { JsonlAuditConfig } from '../types.ts'
import { guardedEntry } from '../guarded-entry.ts'
export default guardedEntry<JsonlAuditConfig>('auto-review-audit', ['actionReview'],
  () => import('../audit-jsonl.js'))
