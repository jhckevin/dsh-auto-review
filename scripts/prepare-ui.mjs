import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { installUi } from './install-ui.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 三个宿主的 owner 制品均已冻结于此版本；设置 UI 随主包更新。
// 内容哈希才是最终信任依据，下载失败或不匹配不得修改宿主。
const releaseRoot = 'https://raw.githubusercontent.com/jhckevin/dsh-auto-review/v0.6.0/'
const maxBytes = 8 * 1024 * 1024

export async function prepareUi(hostRoot, options = {}, fetcher = fetch) {
  const checked = installUi(hostRoot, { ...options, check: true })
  if (options.check || options.restore) return installUi(hostRoot, options)
  const catalog = JSON.parse(readFileSync(join(root, 'ui/manifest.json'), 'utf8'))
  const cohort = (catalog.cohorts ?? [catalog]).find(item => item.dshVersion === checked.version)
  if (cohort.files.every(file => createHash('sha256').update(readFileSync(join(hostRoot, '@deepseek-ai', file.package, 'lib/client.js'))).digest('hex') === file.patchedSha256)) {
    return { ...checked, downloadedBytes: 0 }
  }
  const artifacts = new Map()
  let downloadedBytes = 0
  for (const file of cohort.files) {
    if (!/^ui\/(rc6|rc2|alpha5)\/ui-(tool|settings-general)\.js$/.test(file.artifact)) throw Error('Invalid artifact path.')
    let bytes
    if (existsSync(join(root, file.artifact))) {
      bytes = readFileSync(join(root, file.artifact))
    } else {
      const mirror = process.env.DSH_AUTO_REVIEW_DOWNLOAD_MIRROR
      if (mirror) {
        const url = new URL(mirror)
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !mirror.endsWith('/')) throw Error('Download mirror must be an HTTPS prefix ending in / without credentials, query or fragment.')
      }
      const response = await fetcher((mirror ?? '') + releaseRoot + file.artifact, { signal: AbortSignal.timeout(30000), redirect: 'error' })
      if (!response.ok || !response.body) throw Error('UI download failed: HTTP ' + response.status + '. No files changed.')
      const reader = response.body.getReader(), chunks = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) throw Error('UI download exceeds size limit. No files changed.')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      bytes = Buffer.concat(chunks)
      downloadedBytes += bytes.length
    }
    if (createHash('sha256').update(bytes).digest('hex') !== file.patchedSha256) throw Error('UI download integrity check failed. No files changed.')
    artifacts.set(file.artifact, bytes)
  }
  // 下载结束后再次预检；所有文件完整才进入原子替换，沿用备份与回滚。
  return { ...installUi(hostRoot, { ...options, artifacts }), downloadedBytes }
}
