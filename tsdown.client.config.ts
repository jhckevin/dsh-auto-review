import type { UserConfig } from 'tsdown'

const id = '@jhckevin/dsh-auto-review'

export default {
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
    '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-runtime/client',
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig
