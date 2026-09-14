import http from 'node:http'
const [socket, cohort] = process.argv.slice(2)
if (!socket || !['rc6', 'rc2', 'alpha5'].includes(cohort)) throw new Error('invalid CI gateway arguments')
http.createServer((req, res) => {
  if (req.url !== '/chat/completions' || req.method !== 'POST') { res.writeHead(404); res.end(); return }
  const headers = { 'content-type': 'application/json' }
  for (const name of ['x-deepseek-harness-session-id', 'x-deepseek-harness-compact']) {
    if (typeof req.headers[name] === 'string') headers[name] = req.headers[name]
  }
  const upstream = http.request({ socketPath: socket, path: '/' + cohort + req.url, method: 'POST',
    headers }, remote => {
    res.writeHead(remote.statusCode, { 'content-type': remote.headers['content-type'] ?? 'application/json' })
    remote.pipe(res)
  })
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('CI gateway unavailable') })
  res.on('close', () => { if (!res.writableEnded) upstream.destroy() })
  req.pipe(upstream)
}).listen(8099, '127.0.0.1', () => console.log('CI_FORWARD_READY'))
