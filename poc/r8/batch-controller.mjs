import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const argumentsMap = new Map()
for (let index = 2; index < process.argv.length; index += 2) argumentsMap.set(process.argv[index], process.argv[index + 1])
const output = resolve(String(argumentsMap.get('--output') || ''))
const port = Number(argumentsMap.get('--port'))
const token = String(argumentsMap.get('--token') || '')
const relativePath = relative(resolve(tmpdir()), output)
if (!isAbsolute(output) || !relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)
  || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(token)) {
  throw new Error('R8 batch controller requires an isolated temporary output, port and random token')
}
const runId = output.split(/[\\/]/).at(-1)
const kinds = ['following-list', 'creator-work-list', 'work-detail', 'comment-list']
let completed = false

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}
function scan(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((entry, index) => scan(entry, `${path}[${index}]`))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /(?:[?&](?:msToken|a_bogus|X-Bogus|token|signature)=|\bBearer\s+)/i.test(value)) {
      throw new Error(`sensitive value at ${path}`)
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (/(?:cookie|authorization|signature|raw(?:body|response)?|headers?|requesttemplate|sessiontoken|password|credential|mediaurl)/i.test(key)
      && !(key === 'rawResponsesPersisted' && child === false)) {
      throw new Error(`forbidden field at ${path}.${key}`)
    }
    scan(child, `${path}.${key}`)
  }
}
function safeId(value) { return value === null || (typeof value === 'string' && /^[A-Za-z0-9._-]{1,240}$/.test(value)) }
function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} fields invalid`)
}
function validReport(report) {
  scan(report)
  exactKeys(report, ['contract', 'runId', 'stage', 'startedAt', 'finishedAt', 'trigger', 'identity', 'routes', 'observer', 'safety'], 'report')
  if (report?.contract !== 'signaldesk-r8-batch-t1-report/v1' || report.runId !== runId
    || report.stage !== 'T1-discovery' || !Number.isFinite(Date.parse(report.startedAt))
    || !Number.isFinite(Date.parse(report.finishedAt)) || typeof report.trigger !== 'string'
    || !/^[A-Z0-9_-]{2,100}$|^completed$|^not-run$/.test(report.trigger)) throw new Error('report header invalid')
  exactKeys(report.identity, ['ownerSecUid', 'creatorUid', 'creatorSecUid', 'workId'], 'identity')
  if (!['ownerSecUid', 'creatorUid', 'creatorSecUid', 'workId'].every((key) => safeId(report.identity[key]))) {
    throw new Error('identity summary invalid')
  }
  if (!report.routes || Object.keys(report.routes).sort().join('|') !== [...kinds].sort().join('|')) throw new Error('route list invalid')
  exactKeys(report.observer, ['observedEndpointKinds', 'issueCodes', 'seedSource'], 'observer')
  if (!Array.isArray(report.observer.observedEndpointKinds)
    || report.observer.observedEndpointKinds.length > 6
    || report.observer.observedEndpointKinds.some((kind) => !/^[a-z-]{2,80}$/.test(kind))
    || !Array.isArray(report.observer.issueCodes) || report.observer.issueCodes.length > 20
    || report.observer.issueCodes.some((code) => !/^[A-Z0-9_-]{2,100}$/.test(code))
    || !['none', 'following-list', 'creator-work-list'].includes(report.observer.seedSource)) {
    throw new Error('observer summary invalid')
  }
  for (const kind of kinds) {
    const route = report.routes[kind]
    if (route?.status === 'blocked') {
      exactKeys(route, ['status', 'code', 'httpStatus'], `${kind} blocked route`)
      if (typeof route.code !== 'string' || !/^[A-Z0-9_-]{2,100}$/.test(route.code)
        || (route.httpStatus !== undefined && route.httpStatus !== null
          && (!Number.isSafeInteger(route.httpStatus) || route.httpStatus < 100 || route.httpStatus > 599))) {
        throw new Error(`${kind} code/status invalid`)
      }
      continue
    }
    exactKeys(route, ['status', 'endpointKind', 'schemaFingerprint', 'projectionSha256', 'itemCount',
      'paginationKnown', 'cursorField', 'hasMore', 'secondPage', 'secondPageCode'], `${kind} observed route`)
    if (route?.status !== 'observed' || route.endpointKind !== kind
      || !/^[a-f0-9]{64}$/.test(route.schemaFingerprint)
      || !/^[a-f0-9]{64}$/.test(route.projectionSha256)
      || !Number.isSafeInteger(route.itemCount) || route.itemCount < 0 || route.itemCount > 100
      || typeof route.paginationKnown !== 'boolean' || typeof route.hasMore !== 'boolean'
      || (route.cursorField !== null && !['cursor', 'max_cursor', 'offset', 'min_time', 'max_time'].includes(route.cursorField))
      || (route.secondPage !== undefined && !['observed', 'blocked', 'pagination-shape-unverified'].includes(route.secondPage))
      || (route.secondPageCode !== undefined && (route.secondPage !== 'blocked'
        || typeof route.secondPageCode !== 'string' || !/^[A-Z0-9_-]{2,100}$/.test(route.secondPageCode)))) {
      throw new Error(`${kind} observation invalid`)
    }
  }
  exactKeys(report.safety, ['formalDatabaseTouched', 'writeRequestsIssued', 'rawResponsesPersisted', 'sensitiveValuesPersisted'], 'safety')
  if (report.safety.formalDatabaseTouched !== false
    || report.safety.writeRequestsIssued !== false || report.safety.rawResponsesPersisted !== false
    || report.safety.sensitiveValuesPersisted !== false) throw new Error('safety declaration invalid')
  return report
}
function classification(report) {
  const missing = kinds.filter((kind) => report.routes[kind].status !== 'observed')
  const pagination = report.routes['following-list']
  const paginationReady = pagination.status === 'observed'
    && (pagination.hasMore === false || pagination.secondPage === 'observed')
  return { classification: missing.length === 0 ? 'T1_DISCOVERED' : 'T1_BLOCKED',
    missingEndpointKinds: missing, followingPaginationReady: paginationReady,
    readyForT2Review: missing.length === 0 && paginationReady }
}
function markdown(report, result) {
  return [
    '# Signal Desk R8 批量路线 T1 发现报告', '',
    `- Run: \`${runId}\``, `- 结果：**${result.classification}**`,
    '- 证据范围：接口、schema、只读 GET 与关注翻页；不是 24 条作品验收。',
    '- 正式 SQLite：未触碰', '- 媒体/ASR/OCR/云：未启动', '',
    `观察到的 endpoint：${report.observer.observedEndpointKinds.join(', ') || 'none'}`,
    `Observer issue：${report.observer.issueCodes.join(', ') || 'none'}`,
    `Owner seed：${report.observer.seedSource}`, '',
    '| Endpoint | 状态 | 数量 | 原因 |', '|---|---|---:|---|',
    ...kinds.map((kind) => `| ${kind} | ${report.routes[kind].status} | ${report.routes[kind].itemCount ?? 0} | ${report.routes[kind].code ?? '-'}${report.routes[kind].httpStatus ? ` (HTTP ${report.routes[kind].httpStatus})` : ''} |`),
    '', `关注翻页已确认：${result.followingPaginationReady ? '是' : '否'}`,
    `可进入 T2 审查：${result.readyForT2Review ? '是' : '否'}`, '',
    'T2/T3 不自动启动。', ''
  ].join('\n')
}
async function readJson(request) {
  const parts = []
  let size = 0
  for await (const part of request) {
    size += part.length
    if (size > 128 * 1024) throw new Error('report exceeds 128 KiB')
    parts.push(part)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    if (request.headers['x-signaldesk-r8-token'] !== token
      || request.headers['x-signaldesk-r8-client'] !== 'signaldesk-r8-batch-isolated-extension') {
      return json(response, 403, { error: 'controller authentication failed' })
    }
    const path = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname
    if (request.method === 'GET' && path === '/health') return json(response, 200, { ok: true, runId, completed })
    if (request.method !== 'POST' || path !== '/v1/report') return json(response, 404, { error: 'not found' })
    if (completed) return json(response, 409, { error: 'run already complete' })
    const report = validReport(await readJson(request))
    const result = classification(report)
    await writeFile(join(output, 't1-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify({ contract: 'signaldesk-r8-batch-manifest/v1',
      runId, stage: 'T1-discovery', ...result, formalDatabaseTouched: false,
      productionCapabilityEnabled: false }, null, 2)}\n`, { flag: 'wx' })
    await writeFile(join(output, 'acceptance-report.md'), markdown(report, result), { flag: 'wx' })
    completed = true
    json(response, 201, { accepted: true, ...result })
    setTimeout(() => server.close(), 1000)
  } catch (error) { json(response, 400, { error: String(error?.message || error) }) }
})
server.listen(port, '127.0.0.1', async () => {
  await writeFile(join(output, 'controller-session.json'), `${JSON.stringify({
    contract: 'signaldesk-r8-batch-controller-session/v1', runId,
    tokenSha256: createHash('sha256').update(token).digest('hex')
  }, null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(`R8 batch T1 controller ready: ${runId}\n`)
})
process.on('SIGINT', () => server.close())
