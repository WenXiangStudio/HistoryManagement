import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const output = resolve(String(args.get('--output') || ''))
const port = Number(args.get('--port'))
const token = String(args.get('--token') || '')
const ownerSecUid = String(args.get('--owner-sec-uid') || '')
const catalogPath = resolve(String(args.get('--catalog-path') || join(tmpdir(), 'signal-desk-r8', 'verified-catalog.sqlite')))
const insideTemp = relative(resolve(tmpdir()), output)
const catalogInsideTemp = relative(resolve(tmpdir()), catalogPath)
const ID = /^[A-Za-z0-9._-]{1,240}$/
const HASH = /^[a-f0-9]{64}$/
if (!isAbsolute(output) || !insideTemp || insideTemp.startsWith('..') || isAbsolute(insideTemp)
  || !catalogInsideTemp || catalogInsideTemp.startsWith('..') || isAbsolute(catalogInsideTemp)
  || !Number.isSafeInteger(port) || port < 1024 || port > 65535
  || !/^[a-f0-9]{64}$/.test(token) || !ID.test(ownerSecUid)) {
  throw new Error('homepage pilot requires isolated paths, port, token and verified owner')
}
const runId = output.split(/[\\/]/).at(-1)
const db = new DatabaseSync(catalogPath, { readOnly: true })
const owner = db.prepare('SELECT sec_uid FROM owners LIMIT 1').get()
if (owner?.sec_uid !== ownerSecUid) { db.close(); throw new Error('CATALOG_OWNER_MISMATCH') }
const creators = db.prepare(`SELECT uid,sec_uid AS secUid,nickname,profile_url AS profileUrl,
  following_state AS followingState FROM creators WHERE owner_sec_uid=?
  AND following_state IN ('active','stale') ORDER BY id`).all(ownerSecUid)
if (!creators.length) { db.close(); throw new Error('NO_VERIFIED_CREATOR') }
let completed = false
function fail(message) { throw new Error(message) }
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) fail(`${label} invalid`)
}
function safeUrl(value, kind) {
  let url
  try { url = new URL(value) } catch { fail(`${kind} URL invalid`) }
  if (url.origin !== 'https://www.douyin.com' || url.search || url.hash || url.username || url.password) fail(`${kind} URL invalid`)
  if (kind === 'profile' && !/^\/user\/[A-Za-z0-9._-]{1,240}$/.test(url.pathname)) fail('profile URL invalid')
  if (kind === 'work' && !/^\/(?:video|note)\/[0-9]{8,30}$/.test(url.pathname)) fail('work URL invalid')
  return url.toString()
}
function proof(value, kind) {
  if (value === null) return
  exact(value, ['routeId','endpointKind','schemaFingerprint','projectionSha256','observedAt'], 'source proof')
  const expectedRoute = kind === 'creator-work-list' ? 'DY-WORKS-NETWORK' : 'DY-DETAIL-NETWORK'
  if (value.routeId !== expectedRoute || value.endpointKind !== kind
    || !HASH.test(value.schemaFingerprint) || !HASH.test(value.projectionSha256)
    || !Number.isFinite(Date.parse(value.observedAt))) fail('source proof invalid')
}
function scan(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((entry, index) => scan(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (/(?:cookie|authorization|signature|raw(?:body|response)?|headers?|requesttemplate|sessiontoken|password|credential|mediaurl)/i.test(key)) fail(`forbidden field at ${path}.${key}`)
      scan(entry, `${path}.${key}`)
    }
  } else if (typeof value === 'string' && /(?:[?&](?:msToken|a_bogus|X-Bogus|token|signature)=|\bBearer\s+)/i.test(value)) {
    fail(`sensitive value at ${path}`)
  }
}
function validate(report) {
  scan(report)
  exact(report, ['contract','runId','startedAt','finishedAt','result','observerIssueCodes','safety'], 'report')
  if (report.contract !== 'signaldesk-homepage-pilot-report/v1' || report.runId !== runId
    || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.finishedAt))) fail('report header invalid')
  exact(report.safety, ['formalDatabaseTouched','activeApiRequests','mediaProcessingStarted','externalProvidersCalled'], 'safety')
  if (report.safety.formalDatabaseTouched !== false || report.safety.activeApiRequests !== 0
    || report.safety.mediaProcessingStarted !== false || report.safety.externalProvidersCalled !== false) fail('safety declaration invalid')
  if (!Array.isArray(report.observerIssueCodes) || report.observerIssueCodes.length > 20
    || report.observerIssueCodes.some((code) => typeof code !== 'string' || !/^[A-Z0-9_-]{2,100}$/.test(code))) fail('observer issues invalid')
  const result = report.result
  exact(result, ['contract','creator','status','stage','navigationCount','activeApiRequests',
    'candidates','verifiedWork','workProof','detailProof','comments','replies','reason'], 'pilot result')
  if (result.contract !== 'signaldesk-homepage-pilot/v1'
    || !['verified','candidate-only','blocked'].includes(result.status)
    || !['profile','work-detail'].includes(result.stage)
    || !Number.isSafeInteger(result.navigationCount) || result.navigationCount < 0 || result.navigationCount > 3
    || result.activeApiRequests !== 0 || result.comments !== 'not-requested' || result.replies !== 'not-requested') fail('pilot scope invalid')
  exact(result.creator, ['uid','secUid','profileUrl'], 'creator')
  const creator = creators.find((entry) => entry.uid === result.creator.uid && entry.secUid === result.creator.secUid)
  if (!creator || safeUrl(result.creator.profileUrl, 'profile') !== creator.profileUrl) fail('creator is not in verified catalog')
  if (!Array.isArray(result.candidates) || result.candidates.length > 6) fail('candidate count invalid')
  for (const candidate of result.candidates) {
    exact(candidate, ['workId','url','status'], 'candidate')
    if (!ID.test(candidate.workId) || candidate.status !== 'page-visible-candidate'
      || !safeUrl(candidate.url, 'work').endsWith(`/${candidate.workId}`)) fail('candidate invalid')
  }
  proof(result.workProof, 'creator-work-list')
  proof(result.detailProof, 'work-detail')
  if (result.verifiedWork !== null) {
    exact(result.verifiedWork, ['workId','workIdKind','workIdSourcePath','authorId','authorSecId',
      'nickname','authorIdSourcePath','workType','title','description','publishedAt','durationMs','statistics'], 'verified work')
    exact(result.verifiedWork.statistics,
      ['likeCount','commentCount','collectCount','shareCount','playCount'], 'work statistics')
    const stats = Object.values(result.verifiedWork.statistics)
    if (stats.some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))
      || typeof result.verifiedWork.title !== 'string' || result.verifiedWork.title.length > 300
      || typeof result.verifiedWork.description !== 'string' || result.verifiedWork.description.length > 4000
      || typeof result.verifiedWork.nickname !== 'string' || result.verifiedWork.nickname.length > 200
      || !['video','image'].includes(result.verifiedWork.workType)
      || !ID.test(result.verifiedWork.workId)) fail('verified work projection invalid')
    if (result.status !== 'verified' || !result.workProof || !result.detailProof
      || result.verifiedWork.authorId !== creator.uid || result.verifiedWork.authorSecId !== creator.secUid
      || !result.candidates.some((item) => item.workId === result.verifiedWork.workId)) fail('verified work binding invalid')
  } else if (result.status === 'verified') fail('verified status requires work')
  if (result.reason !== null && (typeof result.reason !== 'string' || !/^[A-Z0-9_-]{3,100}$/.test(result.reason))) fail('reason invalid')
  return report
}
async function readJson(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 128 * 1024) fail('report too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}
await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    if (request.headers['x-signaldesk-r8-token'] !== token
      || request.headers['x-signaldesk-r8-client'] !== 'signaldesk-homepage-pilot-extension') {
      return json(response, 403, { error: 'controller authentication failed' })
    }
    const path = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname
    if (request.method === 'GET' && path === '/health') return json(response, 200, { ok: true, runId, completed })
    if (request.method === 'GET' && path === '/v1/catalog') return json(response, 200, { creators })
    if (request.method !== 'POST' || path !== '/v1/report') return json(response, 404, { error: 'not found' })
    if (completed) return json(response, 409, { error: 'run already complete' })
    const report = validate(await readJson(request))
    await writeFile(join(output, 'pilot-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    const summary = { contract: 'signaldesk-homepage-pilot-manifest/v1', runId,
      status: report.result.status, verifiedCount: report.result.status === 'verified' ? 1 : 0,
      candidateCount: report.result.candidates.length, navigationCount: report.result.navigationCount,
      activeApiRequests: 0, commentsRequested: false, formalDatabaseTouched: false }
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' })
    completed = true
    json(response, 201, { accepted: true, ...summary })
    setTimeout(() => server.close(() => db.close()), 1000)
  } catch (error) { json(response, 400, { error: String(error?.message || error) }) }
})
server.listen(port, '127.0.0.1', async () => {
  await writeFile(join(output, 'controller-session.json'), `${JSON.stringify({ runId,
    tokenSha256: createHash('sha256').update(token).digest('hex') }, null, 2)}\n`, { flag: 'wx' })
})
process.on('SIGINT', () => server.close(() => db.close()))
