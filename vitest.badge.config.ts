import { defineConfig } from 'vitest/config'

const proofRoot = process.env['DSH_BADGE_PROOF_ROOT']
if (proofRoot === undefined) throw new Error('DSH_BADGE_PROOF_ROOT must point to the isolated patched upstream worktree')

export default defineConfig({
  server: { fs: { allow: [process.cwd(), proofRoot] } },
  test: { include: ['tests/dsh-alpha5-badge-owner.spec.tsx', 'tests/dsh-alpha5-settings-icon.spec.tsx'] },
})
