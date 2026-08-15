import { describe, expect, it } from 'vitest'
import * as audit from '../src/audit-jsonl.ts'
import * as provider from '../src/llm-provider.ts'
import * as policy from '../src/policy.ts'

describe('Cordis Loader namespace shape', () => {
  it.each([
    ['audit-jsonl', audit],
    ['llm-provider', provider],
    ['policy', policy],
  ])('%s keeps name, inject and apply visible to unwrapExports', (_name, plugin) => {
    expect('default' in plugin).toBe(false)
    expect(plugin).toHaveProperty('name')
    expect(plugin).toHaveProperty('inject')
    expect(plugin).toHaveProperty('apply')
  })

  it('settings-provider uses the canonical default Service-class shape', async () => {
    const settings = await import('../src/settings-provider.ts')
    expect(settings.default).toBe(settings.AutoReviewSettingsBridge)
    expect(settings).not.toHaveProperty('apply')
  })
})
