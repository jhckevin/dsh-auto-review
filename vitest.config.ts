import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { fs: { allow: [process.cwd(), ...(process.env.DSH_BADGE_PROOF_ROOT ? [process.env.DSH_BADGE_PROOF_ROOT] : [])] } },
  test: {
    // 原生 node:test 在独立归档/工作目录执行，不能由 Vitest 当成同类套件导入。
    // 保留全部插件测试；制品、归档与 node:test 由各自独立 CI 门禁覆盖。
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
})
