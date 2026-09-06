import {cpSync, existsSync, mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// 独立宿主依赖中的真实 Loop；模型答案受控，不冒充付费自主模型验收。
const host = resolve(process.argv[2] ?? '.')
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(host, 'node_modules/@deepseek-ai/dsh-agent'))) throw Error('A prepared DSH host is required.')
if (!existsSync(join(host, 'node_modules/vitest/vitest.mjs'))) {
  execFileSync('npm', ['install', '--prefix', host, '--no-save', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com', 'vitest@3.2.7', 'react-dom@18.3.1'], {stdio:'inherit',timeout:300000})
}
const root = join(host, 'auto-review-runtime-tests')
if (existsSync(root)) throw Error('Runtime test directory already exists; use a fresh host.')
mkdirSync(root)
for (const name of ['src', 'tests', 'package.json', 'tsconfig.json', 'vitest.config.ts']) cpSync(join(source, name), join(root, name), {recursive:true})
execFileSync(process.execPath, [join(host, 'node_modules/vitest/vitest.mjs'), 'run', '--root', root,
  'tests/denial-hard-stop-loop.spec.ts', 'tests/terminal.spec.ts', 'tests/turn-interruption-ui.spec.tsx'], {stdio:'inherit',timeout:120000})
