import { expect, it } from 'vitest'
import { UiCapabilities, REQUIRED_UI_SLOTS } from '../src/client/capabilities.ts'
it('reports missing declarations and follows hot declaration removal/recovery', () => {
  const tracker = new UiCapabilities(); let changes = 0
  const off = tracker.subscribe(() => {changes++})
  expect(tracker.snapshot()).toContain('tool.call.badges')
  for (const slot of REQUIRED_UI_SLOTS) tracker.set(slot, true)
  expect(tracker.snapshot()).toBe('')
  tracker.set('tool.call.badges', false)
  expect(tracker.snapshot()).toBe('tool.call.badges')
  tracker.set('tool.call.badges', true)
  expect(tracker.snapshot()).toBe('')
  off(); tracker.set('tool.call.badges', false)
  expect(changes).toBe(5)
})
