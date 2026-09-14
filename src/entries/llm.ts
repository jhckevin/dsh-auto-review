import type { LlmReviewerConfig } from '../types.ts'
import { guardedEntry } from '../guarded-entry.ts'
export default guardedEntry<LlmReviewerConfig>('auto-review-llm', ['actionReview', 'agents', 'systemPrompt', 'tools'],
  () => import('../llm-provider.js'), undefined, 'actionReviewDefaultsReady')
