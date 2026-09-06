/** DSH 原生事件账本：缓存与未缓存输入分桶，usage chunk 与最终 message 不重复相加。 */
export interface ReviewerUsage {
  modelCalls: number
  missingUsageCalls: number
  unknownCacheCalls: number
  incompleteTotalCalls: number
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  knownTokens: number
}
export function emptyReviewerUsage(): ReviewerUsage {
  return {modelCalls: 0, missingUsageCalls: 0, unknownCacheCalls: 0, incompleteTotalCalls: 0,
    uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, knownTokens: 0}
}
const object = (x: unknown): Record<string, unknown> => x !== null && typeof x === 'object' ? x as Record<string, unknown> : {}
const count = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0
export function collectReviewerUsage(events: readonly unknown[]): ReviewerUsage {
  const attempts = new Map<string, unknown>()
  const generations = new Map<string, number>()
  for (const raw of events) {
    const event = object(raw), data = object(event.data)
    const base = `${String(data.turn)}:${String(data.step)}`
    if (event.type === 'llm/retry-started') generations.set(base, (generations.get(base) ?? 0) + 1)
    const key = base + ':' + (generations.get(base) ?? 0)
    if (event.type === 'step/start' || event.type === 'llm/retry-started') attempts.set(key, undefined)
    if (event.type === 'assistant/chunk' && object(data.chunk).type === 'usage') attempts.set(key, object(data.chunk).usage)
    if (event.type === 'assistant/message') {
      if (data.usage !== undefined) attempts.set(key, data.usage)
      else if (!attempts.has(key)) attempts.set(key, undefined)
    }
  }
  const result = emptyReviewerUsage()
  for (const sample of attempts.values()) {
    result.modelCalls++
    const usage = object(sample)
    if (!count(usage.inputTokens) || !count(usage.outputTokens)) {
      result.missingUsageCalls++; result.unknownCacheCalls++; result.incompleteTotalCalls++; continue
    }
    const read = count(usage.cacheReadTokens) ? usage.cacheReadTokens : 0
    const write = count(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0
    const known = usage.inputTokens + read + write + usage.outputTokens
    result.uncachedInputTokens += usage.inputTokens
    result.outputTokens += usage.outputTokens
    result.cacheReadTokens += read; result.cacheWriteTokens += write
    const completeCache = count(usage.cacheReadTokens) && count(usage.cacheWriteTokens)
    if (!completeCache) result.unknownCacheCalls++
    const exact = count(usage.totalTokens) && usage.totalTokens >= known && (!completeCache || usage.totalTokens === known)
    if (exact) result.knownTokens += usage.totalTokens as number
    else {
      result.knownTokens += known
      if (!completeCache || usage.totalTokens !== undefined) result.incompleteTotalCalls++
    }
  }
  return result
}
