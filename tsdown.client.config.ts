import type { UserConfig } from 'tsdown'

const client = (id: string, filename: string): UserConfig => ({
  name: `${id}/client`,
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [
    'react', 'react/jsx-runtime', '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
  ],
  outputOptions: {
    entryFileNames: filename,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

export default [
  client('@jhckevin/dsh-auto-review', 'client.js'),
  client('@jhckevin/dsh-auto-review/entries/runtime', 'client-guarded.js'),
] satisfies UserConfig[]
