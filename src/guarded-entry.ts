import type { Context, Plugin } from '@deepseek-ai/cordis'
import { symbols } from '@deepseek-ai/cordis'
import { detectDshHost, type DshCompatibilityReport } from './dsh-compat.ts'
import { beginActivation, defaultsReadyScope, activationHealthy, ACTIVATION_DENIAL } from './activation-health.ts'
import type {} from './service.ts'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

/** Unknown hosts must not import implementations or install approval hooks. */
export function guardedEntry<C>(
  name: string,
  dependencies: readonly string[],
  load: () => Promise<Plugin>,
  detect: () => DshCompatibilityReport = detectDshHost,
  readyService?: string,
) {
  return {
    name,
    async apply(parent: Context, config: C) {
      const status = beginActivation(parent, name)
      // The configuration barrier follows the same actionReview isolation domain.
      const ctx = parent.isolate('actionReviewDefaultsReady', defaultsReadyScope(parent))
      ctx.effect(() => () => status('stopped'))
      const report = detect()
      if (!report.supported) {
        status('unsupported', report.reason ?? 'unknown host')
        ctx.logger.warn(`Auto Review 已停用：${report.reason ?? '未知宿主'}。沿用 DSH 原生权限设置；Full Access 不会获得额外审查。不会调用 Reviewer。`)
        return
      }
      if (name === 'auto-review') ctx.inject(['tools'], owner => {
        // This outer scope survives an implementation import/apply failure.
        owner.tools.guard(exec => {
          const runtime = owner.get('actionReview')
          if (runtime?.config.mode === 'disabled' || (!runtime && (config as { mode?: string } | undefined)?.mode === 'disabled')) return
          if (activationHealthy(owner)) return
          if (runtime && !runtime.config.reviewFullAccess && owner.get('sandboxPolicy')?.resolve(
            exec.agent ? { session: exec.agent.session } : {},
          ).mode === 'danger-full-access') return
          return ACTIVATION_DENIAL
        })
      })
      let generation = 0
      const mount = async (owner: Context) => {
        const epoch = ++generation
        const store = owner.fiber.store
        const original = (value: unknown): unknown => value && (typeof value === 'object' || typeof value === 'function')
          ? (value as Record<symbol, unknown>)[symbols.original] ?? value : value
        const providers = dependencies.map(name => original(owner.get(name)))
        const sources = dependencies.map(name => {
          const fiber = store?.[name]?.fiber
          return { fiber, uid: fiber?.uid, store: fiber?.store }
        })
        const current = () => active && epoch === generation && owner.fiber.store === store
          && sources.every(source => source.fiber?.state === 2 && source.fiber.uid === source.uid && source.fiber.store === source.store)
          && dependencies.every((name, index) => original(owner.get(name)) === providers[index])
        let active = true
        owner.effect(() => () => { active = false; if (epoch === generation) status('waiting') })
        try {
          const plugin = await load()
          if (!current()) return
          const implementation = await owner.plugin(plugin, config)
          if (!current()) return
          if (implementation.state !== 2) { status('waiting', 'Implementation has unresolved dependencies.'); return }
          if (readyService) owner.provide(readyService, true)
          status('active', undefined, implementation)
        } catch (error) {
          if (!current()) return
          status('failed', 'Component initialization failed; see server log.')
          ctx.logger.error(`Auto Review ${name} 初始化失败；不会视为就绪。`, error)
        }
      }
      if (dependencies.length === 0) await mount(ctx)
      else ctx.inject([...dependencies], mount)
    },
  }
}
