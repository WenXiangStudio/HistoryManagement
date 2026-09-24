import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { VerifiedCreatorCatalog } from './verified-catalog.mjs'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const output = resolve(String(args.get('--output') || ''))
const port = Number(args.get('--port'))
const token = String(args.get('--token') || '')
const ownerSecUid = String(args.get('--owner-sec-uid') || '')
const relativePath = relative(resolve(tmpdir()), output)
if (!isAbsolute(output) || !relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)
  || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(token)
  || !/^[A-Za-z0-9._-]{1,240}$/.test(ownerSecUid)) {
  throw new Error('T2 controller requires an isolated temporary output, port and random token')
}
const runId = output.split(/[\\/]/).at(-1)
let completed = false
const ID = /^[A-Za-z0-9._-]{1,240}$/
const HASH = /^[a-f0-9]{64}$/
const ROUTE_IDS = new Map([
  ['following-list','DY-FOLLOW-NETWORK'], ['creator-work-list','DY-WORKS-NETWORK'],
  ['work-detail','DY-DETAIL-NETWORK'], ['comment-list','DY-COMMENT-NETWORK'],
  ['comment-reply-list','DY-REPLY-NETWORK']
])
const catalogPath = String(args.get('--catalog-path') || join(resolve(tmpdir()), 'signal-desk-r8', 'verified-catalog.sqlite'))

function fail(message) { throw new Error(message) }
function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(`${label} invalid`); return value }
function record(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} invalid`); return value }
function exact(value, keys, label) {
  record(value, label)
  if (Object.keys(value).some((key) => !keys.includes(key))) fail(`${label} has unregistered fields`)
}
function scan(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /(?:[?&](?:msToken|a_bogus|X-Bogus|token|signature)=|\bBearer\s+)/i.test(value)) fail(`sensitive value at ${path}`)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (/(?:cookie|authorization|signature|raw(?:body|response)?|headers?|requesttemplate|sessiontoken|password|credential|mediaurl)/i.test(key)
      && !(key === 'rawResponsesPersisted' && child === false)) fail(`forbidden field at ${path}.${key}`)
    scan(child, `${path}.${key}`)
  }
}
function source(value) {
  record(value, 'source')
  if (value.routeId !== ROUTE_IDS.get(value.endpointKind)
    || !HASH.test(value.schemaFingerprint) || !HASH.test(value.projectionSha256)
    || !Number.isFinite(value.durationMs) || value.durationMs < 0) fail('source proof invalid')
}
function diagnostic(value) {
  if (value === null) return
  exact(value, ['endpointKind','routeId','stage','pageIndex','targetId','requestCursorField',
    'rootCommentId',
    'requestCursorCategory','responseCursorField','responseCursorCategory','hasMore','returnedCount',
    'duplicateIdCount','httpStatus','platformStatusCategory','schemaFingerprint',
    'projectionSha256','durationMs','retryCount','retryAfterSeconds',
    'observedField','targetField','observedId','observedRootCommentId',
    'observedParentCommentId','observedRootField','observedParentField',
    'relationshipFieldConflict'], 'diagnostic')
  if (!ROUTE_IDS.has(value.endpointKind)
    || (value.routeId !== undefined && value.routeId !== ROUTE_IDS.get(value.endpointKind))
    || !['request','transport','http','http-or-json','platform-status','schema','pagination','identity'].includes(value.stage)
    || (value.pageIndex !== undefined && (!Number.isSafeInteger(value.pageIndex) || value.pageIndex < 0 || value.pageIndex > 500))
    || (value.targetId !== null && value.targetId !== undefined && !ID.test(value.targetId))
    || (value.rootCommentId !== null && value.rootCommentId !== undefined && !ID.test(value.rootCommentId))
    || (value.observedId !== undefined && !ID.test(value.observedId))
    || ![null,undefined,'cursor','max_cursor','offset','min_time','max_time'].includes(value.requestCursorField)
    || ![null,undefined,'cursor','max_cursor','offset','min_time','max_time'].includes(value.responseCursorField)
    || (value.requestCursorCategory !== undefined && !['initial','advanced'].includes(value.requestCursorCategory))
    || (value.responseCursorCategory !== undefined && !['missing','same','forward','backward','unclassified','same-offset-derived-next'].includes(value.responseCursorCategory))
    || (value.hasMore !== undefined && value.hasMore !== null && typeof value.hasMore !== 'boolean')
    || (value.returnedCount !== undefined && value.returnedCount !== null && (!Number.isSafeInteger(value.returnedCount) || value.returnedCount < 0 || value.returnedCount > 100))
    || (value.duplicateIdCount !== undefined && (!Number.isSafeInteger(value.duplicateIdCount) || value.duplicateIdCount < 0 || value.duplicateIdCount > 100))
    || (value.httpStatus !== undefined && value.httpStatus !== null && (!Number.isSafeInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599))
    || (value.retryAfterSeconds !== undefined && value.retryAfterSeconds !== null && (!Number.isSafeInteger(value.retryAfterSeconds) || value.retryAfterSeconds < 0 || value.retryAfterSeconds > 3600))
    || (value.observedField !== undefined && !['author.uid','author.sec_uid'].includes(value.observedField))
    || (value.targetField !== undefined && !['creator.uid','creator.secUid'].includes(value.targetField))
    || (value.observedRootCommentId !== undefined && value.observedRootCommentId !== null && !ID.test(value.observedRootCommentId))
    || (value.observedParentCommentId !== undefined && value.observedParentCommentId !== null && !ID.test(value.observedParentCommentId))
    || (value.observedRootField !== undefined && value.observedRootField !== null
      && !['root_comment_id','reply_id'].includes(value.observedRootField))
    || (value.observedParentField !== undefined && value.observedParentField !== null
      && !['reply_to_comment_id','parent_comment_id'].includes(value.observedParentField))
    || (value.relationshipFieldConflict !== undefined && typeof value.relationshipFieldConflict !== 'boolean')) fail('diagnostic fields invalid')
  for (const key of ['schemaFingerprint','projectionSha256']) {
    if (value[key] !== null && value[key] !== undefined && !HASH.test(value[key])) fail('diagnostic hash invalid')
  }
}
function validateItem(item) {
  record(item, 'work result')
  if (item.status !== 'success') fail('result is not successful')
  const workId = id(item.workId, 'workId')
  const creator = record(item.creator, 'creator')
  id(creator.uid, 'creator uid')
  id(creator.secUid, 'creator sec_uid')
  const work = record(item.work, 'work')
  if (work.workId !== workId || work.authorId !== creator.uid || work.authorSecId !== creator.secUid) fail('work author binding invalid')
  if (typeof work.description !== 'string' || work.description.length > 4000
    || typeof work.title !== 'string' || work.title.length > 300
    || !['video', 'image'].includes(work.workType)) fail('work metadata invalid')
  const comments = item.comments
  const replies = item.replies
  if (!Array.isArray(comments) || !Array.isArray(replies) || comments.length + replies.length > 20) fail('comment scope invalid')
  const ids = new Set()
  for (const comment of [...comments, ...replies]) {
    const commentId = id(comment.commentId, 'commentId')
    if (ids.has(commentId) || comment.workId !== workId) fail('duplicate or cross-work comment')
    ids.add(commentId)
    id(comment.publicAuthorId, 'comment author')
    if (typeof comment.publicAuthorName !== 'string' || !comment.publicAuthorName.trim()
      || typeof comment.body !== 'string' || !comment.body.trim() || comment.body.length > 4000) fail('comment content invalid')
  }
  for (const comment of comments) if (comment.parentCommentId !== null || comment.rootCommentId !== null) fail('root relationship invalid')
  for (const reply of replies) {
    if (!ids.has(reply.rootCommentId) || !ids.has(reply.parentCommentId)) fail('reply relationship invalid')
  }
  source(item.sources?.detail)
  if (!Array.isArray(item.sources?.comments) || item.sources.comments.length < 1) fail('comment sources missing')
  item.sources.comments.forEach(source)
  if (!Array.isArray(item.sources?.replies)) fail('reply sources missing')
  item.sources.replies.forEach((entry) => {
    id(entry.rootCommentId, 'reply root')
    if (!Array.isArray(entry.sources)) fail('reply pages missing')
    entry.sources.forEach(source)
  })
  return workId
}
function validate(report) {
  scan(report)
  exact(report, ['contract', 'runId', 'stage', 'startedAt', 'finishedAt', 'status', 'failure',
    'failureDiagnostic', 'ownerVerified', 'followingRequestFields', 'requestTrace', 'observerIssueCodes',
    'result', 'shadowComparison', 'safety'], 'report')
  if (report.contract !== 'signaldesk-r8-t2-shadow-report/v1' || report.runId !== runId
    || report.stage !== 'T2-shadow' || !Number.isFinite(Date.parse(report.startedAt))
    || !Number.isFinite(Date.parse(report.finishedAt))
    || !['structured-ready', 'blocked'].includes(report.status)
    || (report.failure !== null && (typeof report.failure !== 'string' || !/^[A-Z0-9_-]{2,160}$/.test(report.failure)))) fail('report header invalid')
  if (typeof report.ownerVerified !== 'boolean') fail('owner verification state invalid')
  const requestFieldNames = new Set(['aid','channel','count','cursor','device_platform',
    'max_cursor','min_cursor','offset','min_time','max_time','sec_user_id'])
  if (!Array.isArray(report.followingRequestFields) || report.followingRequestFields.length > 20
    || report.followingRequestFields.some((field) => !requestFieldNames.has(field))) fail('following request fields invalid')
  diagnostic(report.failureDiagnostic)
  if (!Array.isArray(report.requestTrace) || report.requestTrace.length > 1000) fail('request trace invalid')
  report.requestTrace.forEach(diagnostic)
  if (!Array.isArray(report.observerIssueCodes) || report.observerIssueCodes.length > 20
    || report.observerIssueCodes.some((code) => typeof code !== 'string' || !/^[A-Z0-9_-]{2,100}$/.test(code))) fail('observer issues invalid')
  exact(report.shadowComparison, ['status', 'checkedWorkIds'], 'shadow')
  if (report.shadowComparison.status !== 'pending-review' || !Array.isArray(report.shadowComparison.checkedWorkIds)
    || report.shadowComparison.checkedWorkIds.length !== 0) fail('shadow cannot be pre-approved')
  exact(report.safety, ['formalDatabaseTouched', 'rawResponsesPersisted', 'sensitiveValuesPersisted',
    'writeRequestsIssued', 'mediaProcessingStarted', 'externalProvidersCalled'], 'safety')
  if (Object.values(report.safety).some((value) => value !== false)) fail('safety declaration invalid')
  if (report.result === null) {
    if (report.status !== 'blocked' || !report.failure) fail('empty result must be blocked')
    return report
  }
  const result = record(report.result, 'batch result')
  exact(result, ['contract', 'status', 'seed', 'scope', 'candidateCount', 'followingEvidence', 'creatorSampling',
    'selectedCreatorSources', 'selectedWorkIds', 'results', 'failures', 'creatorFailures',
    'requestTrace', 'performance'], 'batch result')
  if (result.contract !== 'signaldesk-r8-batch-result/v1' || !['complete', 'failed', 'partial'].includes(result.status)
    || typeof result.seed !== 'string' || result.seed.length < 1 || result.seed.length > 200
    || !Number.isSafeInteger(result.candidateCount) || result.candidateCount < 0) fail('batch header invalid')
  if (result.scope?.workLimit !== 6 || result.scope?.worksPerCreator !== 3
    || result.scope?.commentsPerWork !== 20 || result.scope?.followingLimit !== 300
    || result.scope?.concurrency !== 3) fail('T2 scope changed')
  if (!Number.isSafeInteger(result.followingEvidence?.creatorCount)
    || result.followingEvidence.creatorCount < 0 || result.followingEvidence.creatorCount > 1000
    || !['complete', 'scope-limited', 'partial', 'failed'].includes(result.followingEvidence.completeness)
    || !Array.isArray(result.followingEvidence.sources)
    || (result.followingEvidence.completeness === 'complete' && result.followingEvidence.sources.length < 1)
    || (result.followingEvidence.reportedTotal !== null
      && (!Number.isSafeInteger(result.followingEvidence.reportedTotal)
        || result.followingEvidence.reportedTotal < 0))
    || (result.followingEvidence.completeness === 'complete'
      && result.followingEvidence.creatorCount === 0
      && result.followingEvidence.reportedTotal !== 0)
    || !Array.isArray(result.followingEvidence.creators)
    || result.followingEvidence.creators.length !== result.followingEvidence.creatorCount) {
    fail('following evidence invalid')
  }
  for (const creator of result.followingEvidence.creators) {
    id(creator.uid, 'following uid'); id(creator.secUid, 'following sec_uid')
    if (creator.isFollowing !== true || typeof creator.nickname !== 'string' || !creator.nickname.trim()) fail('following creator unverified')
  }
  if (result.followingEvidence.refreshFailure !== null) {
    id(result.followingEvidence.refreshFailure.code, 'refresh failure code')
    diagnostic(result.followingEvidence.refreshFailure.diagnostic)
  }
  result.followingEvidence.sources.forEach(source)
  if (!Array.isArray(result.requestTrace) || result.requestTrace.length > 1000) fail('request trace invalid')
  result.requestTrace.forEach(diagnostic)
  if (!Array.isArray(result.creatorFailures)) fail('creator failures invalid')
  for (const item of result.creatorFailures) {
    id(item.creatorUid, 'failed creator'); id(item.code, 'creator failure code'); diagnostic(item.diagnostic)
  }
  if (!Array.isArray(result.selectedWorkIds) || result.selectedWorkIds.length > 6
    || new Set(result.selectedWorkIds).size !== result.selectedWorkIds.length
    || result.selectedWorkIds.some((value) => !ID.test(value))) fail('selected IDs invalid')
  if (!Array.isArray(result.selectedCreatorSources) || result.selectedCreatorSources.length > 6) fail('selected creator sources invalid')
  for (const entry of result.selectedCreatorSources) {
    id(entry.creator?.uid, 'source creator uid')
    id(entry.creator?.secUid, 'source creator sec_uid')
    if (!Array.isArray(entry.sources) || entry.sources.length < 1) fail('creator work sources missing')
    entry.sources.forEach(source)
  }
  if (!Array.isArray(result.results) || !Array.isArray(result.failures)
    || result.results.length + result.failures.length !== result.selectedWorkIds.length) fail('result count invalid')
  const successes = result.results.map(validateItem)
  const failures = result.failures.map((item) => {
    id(item.workId, 'failed work')
    id(item.creatorUid, 'failed creator')
    if (item.status !== 'failed' || typeof item.code !== 'string' || !/^R8_BATCH_[A-Za-z0-9_-]{2,150}$/.test(item.code)) fail('failure code invalid')
    diagnostic(item.diagnostic)
    return item.workId
  })
  if (new Set([...successes, ...failures]).size !== result.selectedWorkIds.length
    || [...successes, ...failures].some((value) => !result.selectedWorkIds.includes(value))) fail('selected/results mismatch')
  const performance = record(result.performance, 'performance')
  if (!Number.isFinite(performance.durationMs) || performance.durationMs < 0
    || !Number.isSafeInteger(performance.totalRequests) || performance.totalRequests < 0) fail('performance invalid')
  if (report.status === 'structured-ready' && (result.status !== 'complete'
    || result.followingEvidence.completeness !== 'complete' || result.followingEvidence.creatorCount < 1
    || successes.length !== 6
    || failures.length !== 0 || result.creatorFailures.length !== 0 || report.failure !== null || !report.ownerVerified)) {
    fail('structured-ready requires six complete works')
  }
  return report
}
function outcome(report) {
  const ready = report.status === 'structured-ready' && report.result?.results?.length === 6
  return { classification: ready ? 'T2_NEEDS_SHADOW_REVIEW' : 'T2_BLOCKED',
    structuredSuccessCount: report.result?.results?.length ?? 0,
    failedWorkCount: report.result?.failures?.length ?? 0,
    shadowReviewComplete: false }
}
function markdown(report, result) {
  const lines = ['# Signal Desk R8 T2 6 作品 shadow 报告', '',
    `- Run: \`${runId}\``, `- 结果：**${result.classification}**`,
    `- 结构化成功：${result.structuredSuccessCount}/6`,
    `- 耗时：${report.result?.performance?.durationMs?.toFixed(0) ?? '未测得'} ms`,
    '- 页面可见内容对照：待人工复核', '- 正式 SQLite：未触碰', '',
    '| 作品 | 作者 uid | 作者 sec_uid | 评论 / 回复 |', '|---|---|---|---:|']
  for (const entry of report.result?.results ?? []) {
    const kind = entry.work.workType === 'image' ? 'note' : 'video'
    lines.push(`| [${entry.workId}](https://www.douyin.com/${kind}/${entry.workId}) | ${entry.creator.uid} | ${entry.creator.secUid} | ${entry.comments.length} / ${entry.replies.length} |`)
  }
  for (const entry of report.result?.failures ?? []) lines.push(`| ${entry.workId} | ${entry.creatorUid} | - | ${entry.code} |`)
  lines.push('', '结构化详情和评论投影见同目录的 t2-report.json；T3 不自动启动。', '')
  return lines.join('\n')
}
function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}
async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) fail('T2 report exceeds 2 MiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
await mkdir(output, { recursive: true })
const catalog = new VerifiedCreatorCatalog(catalogPath)
let catalogClosed = false
function closeCatalog() { if (!catalogClosed) { catalog.close(); catalogClosed = true } }
if (catalog.ownerSecUid() !== null && catalog.ownerSecUid() !== ownerSecUid) {
  catalog.close()
  throw new Error('catalog owner differs from this T2 run')
}
const server = createServer(async (request, response) => {
  try {
    if (request.headers['x-signaldesk-r8-token'] !== token
      || request.headers['x-signaldesk-r8-client'] !== 'signaldesk-r8-batch-isolated-extension') {
      return json(response, 403, { error: 'controller authentication failed' })
    }
    const path = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname
    if (request.method === 'GET' && path === '/health') return json(response, 200, { ok: true, runId, completed })
    if (request.method === 'GET' && path === '/v1/catalog') {
      return json(response, 200, { ownerSecUid,
        creators: catalog.ownerSecUid() === ownerSecUid ? catalog.syncableCreators(ownerSecUid) : [] })
    }
    if (request.method !== 'POST' || path !== '/v1/report') return json(response, 404, { error: 'not found' })
    if (completed) return json(response, 409, { error: 'run already complete' })
    const report = validate(await readJson(request))
    const result = outcome(report)
    await writeFile(join(output, 't2-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify({ contract: 'signaldesk-r8-t2-manifest/v1',
      runId, stage: 'T2-shadow', ...result, formalDatabaseTouched: false,
      productionCapabilityEnabled: false }, null, 2)}\n`, { flag: 'wx' })
    await writeFile(join(output, 'acceptance-report.md'), markdown(report, result), { flag: 'wx' })
    if (report.ownerVerified) {
      catalog.bindOwner(ownerSecUid, report.finishedAt)
      const followingEvidence = report.result?.followingEvidence
      if (followingEvidence?.completeness !== 'complete') {
        catalog.finishRefresh(ownerSecUid, runId, [], { complete: false, failed: true })
      }
      if (followingEvidence) {
        for (const creator of followingEvidence.creators) {
          catalog.upsertFollowing(ownerSecUid, creator, report.finishedAt)
        }
      }
      if (followingEvidence?.completeness === 'complete' && followingEvidence.refreshFailure === null) {
        catalog.finishRefresh(ownerSecUid, runId,
          followingEvidence.creators.map((creator) => creator.uid), {
            complete: true, failed: false, scopeLimited: false
          })
      }
      for (const entry of report.result?.selectedCreatorSources ?? []) {
        catalog.recordCheckpoint({ ownerSecUid, targetKind: 'creator-works', nativeId: entry.creator.uid,
          secUid: entry.creator.secUid, adapterVersion: 'r8-isolated-v1', status: entry.completeness,
          updatedAt: report.finishedAt })
      }
      for (const entry of report.result?.results ?? []) {
        catalog.recordCheckpoint({ ownerSecUid, targetKind: 'work-comments', nativeId: entry.workId,
          adapterVersion: 'r8-isolated-v1', status: entry.completeness.comments,
          updatedAt: report.finishedAt })
      }
    }
    completed = true
    json(response, 201, { accepted: true, ...result })
    setTimeout(() => server.close(closeCatalog), 1000)
  } catch (error) { json(response, 400, { error: String(error?.message || error) }) }
})
server.listen(port, '127.0.0.1', async () => {
  await writeFile(join(output, 'controller-session.json'), `${JSON.stringify({
    contract: 'signaldesk-r8-t2-controller-session/v1', runId,
    tokenSha256: createHash('sha256').update(token).digest('hex')
  }, null, 2)}\n`, { flag: 'wx' })
  process.stdout.write(`R8 T2 controller ready: ${runId}\n`)
})
process.on('SIGINT', () => server.close(closeCatalog))
