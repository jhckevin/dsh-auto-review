#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const [sourceArg, hostArg, outputArg, lightningArg] = process.argv.slice(2)
if (!sourceArg || !hostArg || !outputArg || !lightningArg) throw Error('Usage: node scripts/build-ui-owners.mjs SOURCE HOST_NODE_MODULES OUTPUT LIGHTNINGCSS_ENTRY')
const source = resolve(sourceArg), host = resolve(hostArg), output = resolve(outputArg)
const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
for (const name of ['ui-tool', 'ui-settings-general']) {
  const installed = JSON.parse(readFileSync(join(host, '@deepseek-ai/dsh-client-' + name, 'package.json'), 'utf8')).version
  if (installed !== version) throw Error('Source and installed host versions differ: ' + version + ' / ' + installed)
}
mkdirSync(output, { recursive: true })
let preset = readFileSync(join(source, 'packages/client/tsdown.client.ts'), 'utf8')
preset = preset.replace("from 'lightningcss'", 'from ' + JSON.stringify(resolve(lightningArg)))
preset = preset.replaceAll("from './modules/", "from '" + source + "/packages/client/modules/")
preset = preset.replaceAll("from './web/", "from '" + source + "/packages/client/web/")
preset = preset.replaceAll("from '../../scripts/", "from '" + source + "/scripts/")
preset = preset.replace("fileURLToPath(new URL('../..', import.meta.url))", JSON.stringify(source))
writeFileSync(join(output, 'preset.ts'), preset)
const config = `import { clientBundle } from './preset.ts'
export default ['ui-tool', 'ui-settings-general'].map(name => {
 const config = clientBundle('@deepseek-ai/dsh-client-' + name, [])({}).find(c => String(c.name).endsWith('/client'))
 return { ...config, sourcemap: false, entry: { client: ${JSON.stringify(source)} + '/packages/client/' + name + '/src/client/index.ts' },
 outDir: ${JSON.stringify(output)} + '/' + name,
 alias: Object.fromEntries(['host-apiproxy','file-reference','session','llm','tools','brand','util-workspace-path'].map(n => ['@deepseek-ai/dsh-' + n, ${JSON.stringify(host)} + '/@deepseek-ai/dsh-' + n])),
 inputOptions: { ...config.inputOptions, onwarn(warning, handler) { if (warning.code === 'UNRESOLVED_IMPORT') throw Error(warning.message); handler(warning) } } }
})
`
writeFileSync(join(output, 'build.config.ts'), config)
const result = spawnSync(process.execPath, ['node_modules/tsdown/dist/run.mjs', '--config', join(output, 'build.config.ts')], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('UI owners built for DSH ' + version)
