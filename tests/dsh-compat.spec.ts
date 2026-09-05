import { describe, expect, it } from 'vitest'
import { classifyDshHost, snapshotSessionEvents } from '../src/dsh-compat.ts'

const packages = [
  '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-sandbox-policy', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-user-approval',
]

function cohort(version: string): Record<string, string> {
  return Object.fromEntries(packages.map(name => [name, version]))
}

describe('DSH host compatibility', () => {
  it.each([
    ['0.1.0-rc.6', 'rc6'], ['0.1.1-rc.2', 'rc2'], ['0.1.2-alpha.5', 'alpha5'],
  ])('accepts the exact %s cohort', (version, channel) => {
    const report = classifyDshHost(cohort(version))
    expect(report.supported).toBe(true)
    expect(report.profile?.channel).toBe(channel)
  })

  it('fails closed for mixed dependency cohorts', () => {
    const versions = cohort('0.1.1-rc.2')
    versions['@deepseek-ai/dsh-session'] = '0.1.2-alpha.5'
    const report = classifyDshHost(versions)
    expect(report.supported).toBe(false)
    expect(report.reason).toContain('mixed DSH package cohort')
  })

  it('fails closed for unknown and incomplete hosts', () => {
    for (const version of ['__proto__', 'constructor', 'toString', '0.1.1-rc.2 / 0.1.2-alpha.5']) {
      expect(classifyDshHost(cohort(version)).supported).toBe(false)
    }
    expect(classifyDshHost(cohort('0.1.3-alpha.1')).reason).toContain('unsupported')
    const versions: Record<string, string | undefined> = cohort('0.1.1-rc.2')
    delete versions['@deepseek-ai/dsh-tools']
    expect(classifyDshHost(versions).reason).toContain('missing host packages')
  })

  it('normalizes legacy and alpha Session history APIs', () => {
    expect(snapshotSessionEvents<number>({ events: [1, 2] })).toEqual([1, 2])
    expect(snapshotSessionEvents<number>({ snapshotEvents: () => [3, 4] })).toEqual([3, 4])
    expect(snapshotSessionEvents<number>({ seq: 2, eventAt: (index: number) => index + 5 })).toEqual([5, 6])
  })
})
