import { guardedEntry } from '../guarded-entry.ts'
export default guardedEntry<void>('auto-review-command', ['actionReview', 'commands'],
  () => import('../command.js'))
