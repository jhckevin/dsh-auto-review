import http from 'node:http'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, chmodSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export function usageFromProvider(value) {
  if (!value || !Number.isSafeInteger(value.prompt_tokens) || !Number.isSafeInteger(value.completion_tokens)) return null
  const input = value.prompt_tokens, output = value.completion_tokens
  if (input < 0 || output < 0 || !Number.isSafeInteger(input + output) ||
      value.total_tokens !== undefined && value.total_tokens !== input + output) return null
  const firstCache = value.prompt_tokens_details?.cached_tokens
  const secondCache = value.prompt_cache_hit_tokens
  if (firstCache !== undefined && secondCache !== undefined && firstCache !== secondCache) return null
  const cache = firstCache ?? secondCache ?? null
  if (cache !== null && !Number.isSafeInteger(cache)) return null
  if (cache !== null && (cache < 0 || cache > input)) return null
  const reasoning = value.completion_tokens_details?.reasoning_tokens ?? null
  if (reasoning !== null && (!Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > output)) return null
  return { input, output, total: input + output, cacheInput: cache,
    uncachedInput: cache === null ? null : input - cache,
    reasoningOutput: reasoning }
}

function durableJson(file, value) {
  const temporary = file + '.next'
  const fd = openSync(temporary, 'w', 0o600)
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, file)
  const directory = openSync(dirname(file), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

/** Host-side CI accounting. No secret or outbound network is granted to DSH tools. */
export function createGateway({ root, key, fetchImpl = fetch, upstream = 'https://api.deepseek.com', limit = 1100000 }) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const ledger = join(root, 'requests.jsonl')
  const prior = existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
  const totals = Object.fromEntries(['rc6', 'rc2', 'alpha5'].map(cohort =>
    [cohort, prior.filter(row => row.cohort === cohort).reduce((n, row) => n + (row.usage?.total ?? 0), 0)]))
  let sequence = prior.length, waiting = 0, tail = Promise.resolve()
  const failures = {}
  const stop = (cohort, reason) => writeFileSync(join(root, cohort + '.STOP'), reason + '\n', { mode: 0o600 })
  const wal = join(root, 'inflight.json')
  if (existsSync(wal)) {
    const pending = JSON.parse(readFileSync(wal, 'utf8'))
    if (!['rc6', 'rc2', 'alpha5'].includes(pending.cohort) || !/^\d{6,}$/.test(pending.id)) throw new Error('Invalid accounting reservation')
    const settled = prior.find(row => row.id === pending.id && row.cohort === pending.cohort)
    if (!settled) {
      stop(pending.cohort, 'UNRECONCILED_PROVIDER_RESERVATION')
      throw new Error('Unreconciled provider reservation: gateway cannot start before manual accounting reconciliation.')
    }
  }
  const server = http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/(rc6|rc2|alpha5)\/chat\/completions$/)
    const fail = (status, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message, type: 'ci_gate' } })) }
    if (req.method !== 'POST' || !match) return fail(404, 'Only Flash chat completions are available.')
    const cohort = match[1]
    if (waiting >= 8) return fail(503, 'CI queue bound exceeded.')
    waiting++
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    waiting--
    if (res.destroyed) { release(); return }
    let active
    try { active = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) } catch { release(); return fail(503, 'No active CI session.') }
    if (active.cohort !== cohort || existsSync(join(root, cohort + '.STOP'))) { release(); return fail(402, 'CI session stopped or inactive.') }
    let record, responseStatus, usage = null, pending = '', response = '', streamDone = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('CI upstream deadline')), 180000)
    const started = process.hrtime.bigint()
    try {
      const chunks = []
      let bytes = 0
      for await (const part of req) {
        bytes += part.length
        if (bytes > 1500000) { fail(413, 'CI input bound exceeded.'); return }
        chunks.push(part)
      }
      const input = Buffer.concat(chunks)
      const body = JSON.parse(input.toString('utf8'))
      if (body.model !== 'deepseek-v4-flash') { fail(400, 'CI allows deepseek-v4-flash only.'); return }
      const textOnly = Array.isArray(body.messages) && body.messages.every(message =>
        message.content == null || typeof message.content === 'string' ||
        Array.isArray(message.content) && message.content.every(part => part.type === 'text' && typeof part.text === 'string'))
      if (!textOnly || body.n !== undefined && body.n !== 1 || body.audio || body.modalities ||
          body.max_tokens !== undefined && body.max_completion_tokens !== undefined) {
        fail(400, 'CI requires text-only single-completion requests and one output cap.'); return
      }
      const maxOutput = body.max_tokens ?? body.max_completion_tokens
      if (!Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > 16384) { fail(400, 'Set max_tokens to 1..16384.'); return }
      // UTF-8 request bytes conservatively bound text-token input; one request at a time.
      const reservedTokens = input.length + maxOutput + 4096
      if (totals[cohort] + reservedTokens > limit) {
        stop(cohort, 'BUDGET_RESERVATION_LIMIT'); fail(402, 'The next request cannot fit in the remaining token budget.'); return
      }
      const id = String(++sequence).padStart(6, '0')
      const tools = (body.tools ?? []).map(tool => tool.function?.name ?? '')
      const nativeSession = req.headers['x-deepseek-harness-session-id']
      const sessionId = typeof nativeSession === 'string' && nativeSession.length <= 160 ? nativeSession : null
      const compaction = req.headers['x-deepseek-harness-compact'] === '1'
      const role = compaction ? 'compaction' : sessionId?.startsWith('auto-review-') ? 'reviewer'
        : sessionId ? 'main-or-auxiliary' : tools.some(name => /^guardian_policy_/.test(name)) ? 'reviewer-inferred' : 'unknown'
      record = { id, cohort, session: active.session, sessionId, role, roleEvidence: sessionId ? 'native DSH session header; join session ledger' : 'request tool schema only', model: body.model,
        at: new Date().toISOString(), requestBytes: input.length, reservedTokens, hardBudget: limit,
        requestSha256: createHash('sha256').update(input).digest('hex') }
      if (body.stream) body.stream_options = { ...body.stream_options, include_usage: true }
      writeFileSync(join(root, id + '.request.json'), JSON.stringify(body).split(key).join('[REDACTED]'), { mode: 0o600 })
      durableJson(wal, { id, cohort, reservedTokens, state: 'inflight' })
      const remote = await fetchImpl(upstream + '/chat/completions', {
        method: 'POST', headers: { 'authorization': 'Bearer ' + key, 'content-type': 'application/json',
          ...(sessionId ? { 'x-deepseek-harness-session-id': sessionId } : {}),
          ...(compaction ? { 'x-deepseek-harness-compact': '1' } : {}) },
        body: JSON.stringify(body), signal: controller.signal,
      })
      responseStatus = remote.status
      record.httpStatus = responseStatus
      res.writeHead(remote.status, { 'content-type': remote.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' })
      res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('DSH cancelled request')) })
      const decoder = new TextDecoder()
      const consume = text => {
        response += text
        if (response.length > 8000000) throw new Error('CI response bound exceeded')
        pending += text
        let newline
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trim()
          pending = pending.slice(newline + 1)
          if (line === 'data: [DONE]') streamDone = true
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try { const event = JSON.parse(line.slice(6)); if (event.usage) usage = usageFromProvider(event.usage) } catch {}
          }
        }
      }
      for await (const part of remote.body) {
        consume(decoder.decode(part, { stream: true }))
        if (!res.destroyed) res.write(part)
      }
      consume(decoder.decode() + '\n')
      if (!body.stream) { try { usage = usageFromProvider(JSON.parse(response).usage) } catch {} }
      if (!res.destroyed) res.end()
      failures[cohort] = remote.ok ? 0 : (failures[cohort] ?? 0) + 1
      if (remote.ok && (!usage || body.stream && !streamDone)) stop(cohort, 'INCOMPLETE_PROVIDER_RESPONSE')
      if ([401, 402, 403].includes(remote.status) || failures[cohort] >= 3) stop(cohort, 'PROVIDER_FAILURE_' + remote.status)
    } catch (error) {
      // SDKs may close after the complete SSE trailer rather than wait for EOF.
      // Only a terminal marker AND authoritative usage make this a completed call.
      const completed = responseStatus === 200 && streamDone && usage !== null
      if (!completed) stop(cohort, 'INCOMPLETE_PROVIDER_REQUEST')
      if (record) {
        if (completed) { record.clientClosedAfterCompletion = true; failures[cohort] = 0 }
        else record.error = String(error?.name ?? 'Error')
      }
      if (completed) { if (!res.destroyed) res.end() }
      else if (!res.headersSent) fail(502, 'CI provider request failed; stopped to preserve accounting.')
      else res.destroy()
    } finally {
      clearTimeout(timeout)
      if (record) {
        record.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
        record.usage = usage
        totals[cohort] += usage?.total ?? 0
        record.cohortTotal = totals[cohort]
        if ((usage?.total ?? 0) > record.reservedTokens || totals[cohort] > limit) {
          record.budgetAssumptionViolated = true
          stop(cohort, 'PROVIDER_USAGE_EXCEEDED_RESERVATION')
        }
        writeFileSync(join(root, record.id + '.response.txt'), response.split(key).join('[REDACTED]'), { mode: 0o600 })
        appendFileSync(ledger, JSON.stringify(record) + '\n', { mode: 0o600 })
        const fd = openSync(ledger, 'r')
        try { fsyncSync(fd) } finally { closeSync(fd) }
        durableJson(wal, { id: record.id, cohort, state: 'settled' })
        writeFileSync(join(root, 'totals.json'), JSON.stringify(totals), { mode: 0o600 })
      }
      release()
    }
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, keyFile, socket] = process.argv.slice(2)
  if (!root || !keyFile || !socket) throw new Error('usage: gateway ROOT KEY_FILE SOCKET')
  const key = readFileSync(keyFile, 'utf8').trim()
  if (!/^sk-[a-zA-Z0-9]+$/.test(key)) throw new Error('invalid key format')
  if (existsSync(socket)) throw new Error('Refusing to replace an existing gateway socket')
  const server = createGateway({ root, key })
  server.listen(socket, () => { chmodSync(socket, 0o666); console.log('CI_GATEWAY_READY') })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit()))
}
