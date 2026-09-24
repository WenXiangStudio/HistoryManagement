import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])

const outputDirectory = resolve(String(args.get('--output') || ''))
const port = Number(args.get('--port'))
const token = String(args.get('--token') || '')
if (!isAbsolute(outputDirectory) || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || token.length < 40) {
  throw new Error('Usage: node controller.mjs --output <absolute-isolated-directory> --port <port> --token <random-token>')
}
const relativeToTemp = relative(resolve(tmpdir()), outputDirectory)
if (!relativeToTemp || relativeToTemp.startsWith('..') || isAbsolute(relativeToTemp)) {
  throw new Error('R8 output directory must be a new child of the system temporary directory')
}

const runId = outputDirectory.split(/[\\/]/).at(-1)
const startedAt = new Date().toISOString()
const expectedEntries = ['following', 'creator-works', 'work-detail-comments']
const forbiddenKey = /(?:cookie|authorization|signature|raw(?:body|response)?|headers?|requesttemplate|sessiontoken|password|credential|mediaurl)/i

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

function authenticate(request) {
  return request.headers['x-signaldesk-r8-token'] === token
    && request.headers['x-signaldesk-r8-client'] === 'signaldesk-r8-isolated-extension'
}

async function readJson(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 2 * 1024 * 1024) throw new Error('R8 report exceeds the 2 MiB safety limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function scanSensitive(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((entry, index) => scanSensitive(entry, `${path}[${index}]`))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /(?:[?&](?:msToken|a_bogus|verifyFp|fp|token|signature)=|\bBearer\s+)/i.test(value)) {
      throw new Error(`sensitive value rejected at ${path}`)
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key) && child !== false) throw new Error(`forbidden persisted field at ${path}.${key}`)
    scanSensitive(child, `${path}.${key}`)
  }
}

function validateId(value, label, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,240}$/.test(value)) throw new Error(`${label} is not a safe public platform ID`)
  return value
}

function validateObservation(value, entryId, index) {
  if (!value || value.contract !== 'signaldesk-r8-observation-summary/v1') throw new Error(`${entryId} observation ${index} contract invalid`)
  if (typeof value.routeId !== 'string' || typeof value.endpointKind !== 'string') throw new Error(`${entryId} observation identity invalid`)
  if (!/^[a-f0-9]{64}$/.test(value.schemaFingerprint) || !/^[a-f0-9]{64}$/.test(value.projectionSha256)) {
    throw new Error(`${entryId} observation hashes invalid`)
  }
  if (!Array.isArray(value.requestParameterNames) || value.requestParameterNames.some((name) => typeof name !== 'string' || !/^[a-z0-9_]{1,80}$/.test(name))) {
    throw new Error(`${entryId} request parameter names invalid`)
  }
  if (!Number.isSafeInteger(value.itemCount) || value.itemCount < 0 || !Number.isSafeInteger(value.returnedIdCount) || value.returnedIdCount < 0) {
    throw new Error(`${entryId} observation counts invalid`)
  }
  if (value.discoveryPaginationOutline !== null && value.discoveryPaginationOutline !== undefined) {
    const outline = value.discoveryPaginationOutline
    const keys = ['cursor', 'maxCursor', 'minCursor', 'nextCursor', 'offset', 'minTime', 'maxTime', 'hasMore', 'total', 'totalCount']
    const types = new Set(['missing', 'null', 'array', 'integer', 'number', 'string', 'boolean', 'object'])
    if (!outline || typeof outline !== 'object' || Array.isArray(outline)
      || Object.keys(outline).length !== keys.length
      || keys.some((key) => !types.has(outline[key]))) {
      throw new Error(`${entryId} observation ${index} pagination outline invalid`)
    }
  }
  return value
}

function validateReport(value) {
  scanSensitive(value)
  if (!value || value.contract !== 'signaldesk-r8-t1-discovery-report/v1' || value.runId !== runId || value.stage !== 'T1-discovery') {
    throw new Error('R8 T1 report contract/run mismatch')
  }
  if (!Array.isArray(value.entries) || value.entries.length !== 3 || value.entries.map((entry) => entry.entryId).join('|') !== expectedEntries.join('|')) {
    throw new Error('R8 T1 must report the three frozen discovery entries in order')
  }
  for (const entry of value.entries) {
    if (!['observed', 'blocked'].includes(entry.status)) throw new Error(`${entry.entryId} status invalid`)
    if (typeof entry.canonicalSourceUrl !== 'string') throw new Error(`${entry.entryId} source URL missing`)
    const url = new URL(entry.canonicalSourceUrl)
    if (url.origin !== 'https://www.douyin.com' || url.search || url.hash || url.username || url.password) {
      throw new Error(`${entry.entryId} source URL is not canonical and query-free`)
    }
    if (!Array.isArray(entry.observations) || !Array.isArray(entry.issueCodes) || !Array.isArray(entry.issueSummaries)) throw new Error(`${entry.entryId} arrays invalid`)
    entry.observations.forEach((observation, index) => validateObservation(observation, entry.entryId, index))
    if (entry.issueCodes.some((code) => typeof code !== 'string' || !/^[A-Z0-9_-]{1,100}$/.test(code))) throw new Error(`${entry.entryId} issue codes invalid`)
    if (entry.trigger?.uiOutline !== undefined) {
      const outline = entry.trigger.uiOutline
      const keys = ['activeFollowingTabCount', 'followingTabCount', 'fansTabCount', 'visibleFansContainerCount', 'explicitRelationshipMarkerCount']
      if (entry.entryId !== 'following' || !outline || typeof outline !== 'object' || Array.isArray(outline)
        || Object.keys(outline).length !== keys.length
        || keys.some((key) => !Number.isSafeInteger(outline[key]) || outline[key] < 0 || outline[key] > 100)) {
        throw new Error('following UI outline invalid')
      }
    }
    for (const issue of entry.issueSummaries) {
      if (!issue || typeof issue.code !== 'string' || !/^[A-Z0-9_-]{1,100}$/.test(issue.code)) throw new Error(`${entry.entryId} issue summary invalid`)
      if (issue.discoveryPathname !== null && (typeof issue.discoveryPathname !== 'string'
        || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{1,511}$/.test(issue.discoveryPathname))) {
        throw new Error(`${entry.entryId} discovery pathname is unsafe`)
      }
      for (const hash of [issue.schemaFingerprint, issue.pathSha256]) {
        if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${entry.entryId} issue hash invalid`)
      }
      if (issue.discoverySchemaOutline !== null) {
        const outline = issue.discoverySchemaOutline
        const allowedKeys = ['wrapper', 'statusCodeClass', 'comments', 'commentList', 'commentListCamel', 'commentCountClass', 'cursor', 'hasMore', 'total', 'firstComment', 'relationshipClasses']
        const allowedFirst = ['cid', 'awemeId', 'text', 'user', 'userUid', 'userSecUid', 'replyId', 'rootCommentId']
        const allowedTypes = new Set(['missing', 'null', 'array', 'integer', 'number', 'string', 'boolean', 'object'])
        const relationshipKeys = ['replyId', 'replyToCommentId', 'rootCommentId', 'parentCommentId']
        const relationshipValues = new Set(['missing', 'empty-or-zero', 'other-type', 'self-cid', 'other-id'])
        if (issue.code !== 'SCHEMA_CHANGED' || issue.endpointKind !== 'comment-list'
          || !outline || typeof outline !== 'object' || Array.isArray(outline)
          || Object.keys(outline).some((key) => !allowedKeys.includes(key))
          || !['root', 'data'].includes(outline.wrapper)
          || !['zero', 'nonzero', 'missing-or-other'].includes(outline.statusCodeClass)
          || !['not-array', 'empty', 'nonempty'].includes(outline.commentCountClass)
          || !outline.firstComment || typeof outline.firstComment !== 'object' || Array.isArray(outline.firstComment)
          || Object.keys(outline.firstComment).some((key) => !allowedFirst.includes(key))
          || !outline.relationshipClasses || typeof outline.relationshipClasses !== 'object' || Array.isArray(outline.relationshipClasses)
          || Object.keys(outline.relationshipClasses).some((key) => !relationshipKeys.includes(key))
          || relationshipKeys.some((key) => !Array.isArray(outline.relationshipClasses[key])
            || outline.relationshipClasses[key].some((value) => !relationshipValues.has(value)))
          || ['comments', 'commentList', 'commentListCamel', 'cursor', 'hasMore', 'total'].some((key) => !allowedTypes.has(outline[key]))
          || allowedFirst.some((key) => !allowedTypes.has(outline.firstComment[key]))) {
          throw new Error(`${entry.entryId} discovery schema outline invalid`)
        }
      }
    }
  }
  validateId(value.identityBindings?.creatorId, 'creatorId', true)
  validateId(value.identityBindings?.secCreatorId, 'secCreatorId', true)
  validateId(value.identityBindings?.workId, 'workId', true)
  validateId(value.identityBindings?.observedWorkAuthorId, 'observedWorkAuthorId', true)
  if (!value.safety || value.safety.rawResponsesPersisted !== false || value.safety.sensitiveValuesPersisted !== false
    || value.safety.writeRequestsIssued !== false || value.safety.formalDatabaseTouched !== false) {
    throw new Error('R8 T1 safety declaration invalid')
  }
  return value
}

function summarizeStatus(report) {
  const observedKinds = new Set(report.entries.flatMap((entry) => entry.observations.map((item) => item.endpointKind)))
  const required = ['following-list', 'creator-work-list', 'work-detail', 'comment-list']
  const missing = required.filter((kind) => !observedKinds.has(kind))
  const issueCount = report.entries.reduce((sum, entry) => sum + entry.issueCodes.filter((code) => code !== 'UNRECOGNIZED_PATH_WITH_KNOWN_SCHEMA').length, 0)
  const bridgeFailures = report.entries.filter((entry) => entry.bridgePreview?.status === 'rejected')
  const requiredByEntry = {
    following: ['following-list'],
    'creator-works': ['creator-work-list'],
    'work-detail-comments': ['work-detail', 'comment-list']
  }
  const incompleteEntries = report.entries.filter((entry) => entry.trigger?.status !== 'completed'
    || entry.status !== 'observed'
    || requiredByEntry[entry.entryId].some((kind) => !entry.observations.some((observation) => observation.endpointKind === kind)))
  return {
    classification: missing.length === 0 && issueCount === 0 && bridgeFailures.length === 0 && incompleteEntries.length === 0
      ? 'T1_READY_FOR_T2_REVIEW'
      : 'T1_BLOCKED',
    requiredEndpointKinds: required,
    observedEndpointKinds: [...observedKinds].sort(),
    missingEndpointKinds: missing,
    issueCount,
    incompleteEntryIds: incompleteEntries.map((entry) => entry.entryId),
    bridgeFailureEntries: bridgeFailures.map((entry) => ({ entryId: entry.entryId, code: entry.bridgePreview.code }))
  }
}

function markdown(report, result) {
  const lines = [
    '# Signal Desk R8 T1-discovery report', '',
    `- Run: \`${runId}\``,
    `- Started: ${startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Classification: **${result.classification}**`,
    '- Evidence level: endpoint/schema discovery only; this is not sample acceptance.',
    '- Formal SQLite: untouched',
    '- Media / ASR / OCR / cloud: not started', '',
    '## Entries', '',
    '| Entry | Status | Endpoint kinds | Issues | Bridge preview |',
    '|---|---|---|---:|---|'
  ]
  for (const entry of report.entries) {
    const kinds = [...new Set(entry.observations.map((item) => item.endpointKind))].join(', ') || 'none'
    lines.push(`| ${entry.entryId} | ${entry.status} | ${kinds} | ${entry.issueCodes.length} | ${entry.bridgePreview?.status || 'not-run'} |`)
  }
  lines.push('', '## Gate result', '',
    `Observed endpoint kinds: ${result.observedEndpointKinds.join(', ') || 'none'}.`,
    `Missing required kinds: ${result.missingEndpointKinds.join(', ') || 'none'}.`,
    `Bridge failures: ${result.bridgeFailureEntries.map((item) => `${item.entryId}:${item.code}`).join(', ') || 'none'}.`, '',
    'T2 must not start automatically. Review this T1 evidence first; any code/contract correction creates a new independent run.', '')
  return lines.join('\n')
}

await mkdir(outputDirectory, { recursive: true })
let completed = false
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`)
    if (!authenticate(request)) return json(response, 403, { error: 'R8 controller authentication failed' })
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      return json(response, 200, { ok: true, contract: 'signaldesk-r8-controller/v1', runId, stage: 'T1-discovery', completed })
    }
    if (request.method === 'POST' && requestUrl.pathname === '/v1/t1-report') {
      if (completed) return json(response, 409, { error: 'This isolated R8 run is already complete' })
      const report = validateReport(await readJson(request))
      const result = summarizeStatus(report)
      const artifacts = {
        't1-report.json': report,
        'manifest.json': {
          contract: 'signaldesk-r8-run-manifest/v1', runId, stage: 'T1-discovery', startedAt,
          finishedAt: report.finishedAt, status: result.classification, evidenceLevel: 'endpoint-schema-discovery-only',
          formalDatabaseTouched: false, productionCapabilityEnabled: false
        },
        'route-trace.json': report.entries.map((entry) => ({
          entryId: entry.entryId, canonicalSourceUrl: entry.canonicalSourceUrl,
          routes: entry.observations.map((item) => ({ routeId: item.routeId, endpointKind: item.endpointKind, observedAt: item.observedAt })),
          discoveryIssues: entry.issueSummaries.map((item) => ({
            code: item.code, routeId: item.routeId, endpointKind: item.endpointKind,
            discoveryPathname: item.discoveryPathname, pathSha256: item.pathSha256,
            discoverySchemaOutline: item.discoverySchemaOutline
          }))
        })),
        'schema-fingerprints.json': report.entries.flatMap((entry) => [
          ...entry.observations.map((item) => ({
            entryId: entry.entryId, evidenceKind: 'accepted-observation', routeId: item.routeId,
            endpointKind: item.endpointKind, schemaFingerprint: item.schemaFingerprint,
            projectionSha256: item.projectionSha256
          })),
          ...entry.issueSummaries.filter((item) => item.schemaFingerprint).map((item) => ({
            entryId: entry.entryId, evidenceKind: 'quarantined-discovery', routeId: item.routeId,
            endpointKind: item.endpointKind, schemaFingerprint: item.schemaFingerprint,
            discoveryPathname: item.discoveryPathname, pathSha256: item.pathSha256,
            discoverySchemaOutline: item.discoverySchemaOutline
          }))
        ]),
        'source-proof-summary.json': { contract: 'signaldesk-r8-t1-gate-result/v1', runId, ...result, identityBindings: report.identityBindings }
      }
      for (const [name, artifact] of Object.entries(artifacts)) {
        await writeFile(join(outputDirectory, name), `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      }
      await writeFile(join(outputDirectory, 'acceptance-report.md'), markdown(report, result), { encoding: 'utf8', flag: 'wx' })
      await writeFile(join(outputDirectory, 'extension', 'session-config.js'),
        `export const R8_CONFIG = Object.freeze(${JSON.stringify({
          runId, stage: 'T1-discovery', startedAt, controllerOrigin: `http://127.0.0.1:${port}`, token: '[EXPIRED_AFTER_REPORT]'
        })})\n`, 'utf8')
      completed = true
      json(response, 201, { accepted: true, runId, classification: result.classification })
      setTimeout(() => server.close(), 750)
      return
    }
    json(response, 404, { error: 'Not found' })
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, '127.0.0.1', async () => {
  await writeFile(join(outputDirectory, 'controller-session.json'), `${JSON.stringify({
    contract: 'signaldesk-r8-controller-session/v1', runId, stage: 'T1-discovery', startedAt,
    controllerOrigin: `http://127.0.0.1:${port}`, tokenSha256: createHash('sha256').update(token).digest('hex')
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(`R8 T1 controller ready: ${runId}\n`)
})

process.on('SIGINT', () => server.close())
