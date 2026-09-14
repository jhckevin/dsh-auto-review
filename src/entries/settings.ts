import { guardedEntry } from '../guarded-entry.ts'
export default guardedEntry<void>('auto-review-settings', ['actionReview', 'settings', 'actionReviewDefaultsReady'], async () =>
  (await import('../settings-provider.js')).default)
