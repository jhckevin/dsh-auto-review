import { writeFileSync } from 'node:fs'
export const inject = ['loader']
export async function apply(ctx) {
  const health = await import('/work/user/.dsh/profiles/web/node_modules/@jhckevin/dsh-auto-review/lib/activation-health.js')
  const sample = () => {
    const rows = [...ctx.loader.entries()].filter(entry => entry.options.id?.startsWith('auto-review'))
      .map(entry => ({ id: entry.options.id, state: entry.fiber?.state, error: String(entry.error ?? '') }))
    const services = Object.fromEntries(['actionReview', 'actionReviewSettings', 'settings', 'agents', 'tools', 'sandboxPolicy'].map(name => [name, !!ctx.get(name)]))
    writeFileSync('/work/results/observed.json', JSON.stringify({
      at: new Date().toISOString(), rows, services,
      healthy: health.activationHealthy(ctx), activation: health.activationStatus(ctx),
    }, null, 2))
  }
  const timer = setInterval(sample, 250)
  ctx.effect(() => () => clearInterval(timer))
}
