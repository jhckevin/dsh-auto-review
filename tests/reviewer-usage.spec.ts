import { expect, it } from 'vitest'
import { collectReviewerUsage } from '../src/reviewer-usage.ts'
const usage = {inputTokens: 10, cacheReadTokens: 30, cacheWriteTokens: 0, outputTokens: 5, totalTokens: 45, reasoningTokens: 3}
const event = (type: string, data: object = {}) => ({type, data: {turn: 1, step: 0, ...data}})
it('counts cached input separately and never double-counts chunk, message or reasoning', () => {
  const result = collectReviewerUsage([event('step/start'), event('assistant/chunk', {chunk: {type: 'usage', usage}}), event('assistant/message', {usage})])
  expect(result).toMatchObject({modelCalls: 1, uncachedInputTokens: 10, cacheReadTokens: 30, outputTokens: 5, knownTokens: 45, missingUsageCalls: 0, incompleteTotalCalls: 0})
})
it('retains billed failed attempts before native retries', () => {
  const result = collectReviewerUsage([event('step/start'), event('assistant/chunk', {chunk: {type: 'usage', usage}}), event('llm/retry'), event('llm/retry-started'), event('assistant/message', {usage})])
  expect(result).toMatchObject({modelCalls: 2, knownTokens: 90})
})
it('marks missing and partial counters unknown instead of assuming zero cost', () => {
  expect(collectReviewerUsage([event('step/start')])).toMatchObject({missingUsageCalls: 1, incompleteTotalCalls: 1})
  expect(collectReviewerUsage([event('assistant/message', {usage: {inputTokens: 10, outputTokens: 5}})])).toMatchObject({unknownCacheCalls: 1, incompleteTotalCalls: 1, knownTokens: 15})
})
it('retains authoritative total even when cache split is not available', () => {
  expect(collectReviewerUsage([event('assistant/message', {usage: {inputTokens: 10, outputTokens: 5, totalTokens: 45}})])).toMatchObject({unknownCacheCalls: 1, incompleteTotalCalls: 0, knownTokens: 45})
})
