import type { RouterConfig } from '../types.ts'
import { guardedEntry } from '../guarded-entry.ts'
export default guardedEntry<RouterConfig>('auto-review-policy', ['actionReview', 'tools', 'sandboxPolicy', 'approval'],
  () => import('../policy.js'))
