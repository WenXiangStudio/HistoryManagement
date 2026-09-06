import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DISCOVERY_CONTRACT,
  MAX_CANDIDATE_WORKS_PER_CREATOR,
  MAX_DISCOVERY_CREATORS,
  MAX_SELECTED_WORKS_PER_CREATOR,
  canonicalSampleUrl,
  selectFollowingSamples,
  validateCreatorWorksSnapshot,
  validateFollowingSnapshot,
  validateSamplingSeed,
  validateTargetSampleCount
} from './extension/core.js'

const here = dirname(fileURLToPath(import.meta.url))
const runtimeRoot = join(here, 'runtime')
const runsRoot = join(here, 'runs')
const minimumSamples = 20
const maximumSamples = 30
const maximumBodyBytes = 4 * 1024 * 1024
const sensitiveKeyPattern = /(?:authorization|bearer|cookie|password|secret|apikey|accesstoken|refreshtoken|x[-_]?bogus|signature(?:value|input|header)?|session(?:id|token|key)|device(?:id|fingerprint)|browserprofile)/i

function assertLegacyPhaseBDisabled() {
  throw new Error('LEGACY_ROUTE_DISABLED:0.2.4:LEGACY_ROUTE_PERMANENTLY_DISABLED')
}

function parseArgs(values) {
  const command = values[0] || 'start'
  const args = { command, port: 43827, token: null }
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === '--port') args.port = Number(values[++index])
    else if (values[index] === '--token') args.token = String(values[++index] || '')
    else throw new Error(`未知参数：${values[index]}`)
  }
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) throw new Error('port 必须是 1024～65535 的整数')
  return args
}

function jsonResponse(response, status, value, allowOrigin = '*') {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-headers': 'content-type, x-phase-b-token, x-phase-b-client',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store'
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > maximumBodyBytes) throw new Error('请求体超过阶段 B 上限')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function safeName(value, label) {
  const text = String(value || '')
  if (!/^[A-Za-z0-9._-]{1,240}$/.test(text)) throw new Error(`${label} 格式无效`)
  return text
}

function canonicalSample(value, expectedIndex) {
  if (!value || typeof value !== 'object') throw new Error(`样本 ${expectedIndex} 不是对象`)
  const url = new URL(String(value.url || ''))
  if (url.origin !== 'https://www.douyin.com' || url.search || url.hash || url.username || url.password) throw new Error(`样本 ${expectedIndex} URL 不符合隔离规则`)
  const match = url.pathname.replace(/\/+$/, '').match(/^\/(video|note)\/([A-Za-z0-9._-]{1,240})$/)
  if (!match || match[2] !== value.workId || Number(value.index) !== expectedIndex) throw new Error(`样本 ${expectedIndex} URL、workId 或顺序不一致`)
  if (value.workType !== (match[1] === 'note' ? 'image' : 'video')) throw new Error(`样本 ${expectedIndex} 类型不一致`)
  const creatorId = safeName(value.creatorId, `样本 ${expectedIndex} creatorId`)
  const creatorProfileUrl = new URL(String(value.creatorProfileUrl || ''))
  if (creatorProfileUrl.origin !== 'https://www.douyin.com' || creatorProfileUrl.search || creatorProfileUrl.hash || creatorProfileUrl.username || creatorProfileUrl.password) {
    throw new Error(`样本 ${expectedIndex} 博主主页 URL 无效`)
  }
  let profileCreatorId = null
  try { profileCreatorId = decodeURIComponent(creatorProfileUrl.pathname.replace(/\/+$/, '').match(/^\/user\/([^/]+)$/)?.[1] || '') } catch { /* invalid */ }
  if (profileCreatorId !== creatorId) throw new Error(`样本 ${expectedIndex} 博主主页与 creatorId 不一致`)
  return {
    index: expectedIndex,
    url: `${url.origin}/${match[1]}/${match[2]}`,
    workId: match[2],
    workType: value.workType,
    creatorId,
    creatorProfileUrl: `https://www.douyin.com/user/${encodeURIComponent(creatorId)}`
  }
}

function validateDiscovery(value) {
  scanSensitive(value)
  if (!value || value.contract !== DISCOVERY_CONTRACT) throw new Error('自动发现合同无效')
  const targetSampleCount = validateTargetSampleCount(value.targetSampleCount)
  const samplingSeed = validateSamplingSeed(value.samplingSeed)
  const expectedHash = createHash('sha256').update(JSON.stringify(samplingSeed)).digest('hex')
  if (value.samplingSeedSha256 !== expectedHash) throw new Error('samplingSeedSha256 与本次随机种子不一致')
  if (
    value.limits?.maxCreators !== MAX_DISCOVERY_CREATORS ||
    value.limits?.maxCandidateWorksPerCreator !== MAX_CANDIDATE_WORKS_PER_CREATOR ||
    value.limits?.maxSelectedWorksPerCreator !== MAX_SELECTED_WORKS_PER_CREATOR
  ) throw new Error('自动发现硬上限被修改')
  return {
    contract: DISCOVERY_CONTRACT,
    targetSampleCount,
    samplingSeed,
    samplingSeedSha256: expectedHash,
    limits: { ...value.limits },
    startedAt: String(value.startedAt || '')
  }
}

function validateManifest(value, discovery = null) {
  scanSensitive(value)
  if (!value || value.contract !== 'signaldesk-phase-b-run/v1') throw new Error('运行清单合同无效')
  if (!discovery) throw new Error('尚未固化自动发现合同')
  if (value.discoveryId !== value.runId && value.runId !== undefined) throw new Error('运行清单不得自行指定不同 runId')
  if (!Array.isArray(value.samples) || value.samples.length < minimumSamples || value.samples.length > maximumSamples) {
    throw new Error(`运行清单必须包含 ${minimumSamples}～${maximumSamples} 个样本`)
  }
  if (value.sampleCount !== value.samples.length) throw new Error('sampleCount 与清单不一致')
  if (value.limits?.maxApiPages !== 2 || value.limits?.pageSize !== 20) throw new Error('阶段 B 硬上限被修改')
  const samples = value.samples.map((sample, index) => canonicalSample(sample, index + 1))
  if (new Set(samples.map((sample) => sample.workId)).size !== samples.length) throw new Error('样本清单含重复 workId')
  if (
    value.sampling?.targetSampleCount !== discovery.targetSampleCount ||
    value.sampling?.samplingSeed !== discovery.samplingSeed ||
    value.sampling?.samplingSeedSha256 !== discovery.samplingSeedSha256 ||
    value.sampling?.policy !== 'seeded-random-creator-round-robin/v1' ||
    value.sampling?.maxSelectedWorksPerCreator !== MAX_SELECTED_WORKS_PER_CREATOR ||
    value.sampling?.workTypeCoverageWhenAvailable !== true
  ) throw new Error('运行清单的随机抽样合同与已固化发现合同不一致')
  const followingProof = validateFollowingSnapshot(value.followingProof)
  if (!Array.isArray(value.creatorWorksProofs)) throw new Error('运行清单缺少博主作品来源证明')
  const creatorWorksProofs = value.creatorWorksProofs.map((proof) => validateCreatorWorksSnapshot(proof))
  const followingIds = new Set(followingProof.creatorIds)
  if (creatorWorksProofs.some((proof) => !followingIds.has(proof.creatorId))) throw new Error('博主作品证明包含未验证关注的博主')
  const candidateCount = creatorWorksProofs.reduce((sum, proof) => sum + proof.works.length, 0)
  if (value.candidateCount !== candidateCount) throw new Error('候选作品计数与来源证明不一致')
  const expectedSamples = selectFollowingSamples(followingProof, creatorWorksProofs, discovery.targetSampleCount, discovery.samplingSeed)
  if (JSON.stringify(samples) !== JSON.stringify(expectedSamples)) throw new Error('最终样本不是由已固化种子和来源证明确定性选出')
  const selectedPerCreator = new Map()
  for (const sample of samples) selectedPerCreator.set(sample.creatorId, (selectedPerCreator.get(sample.creatorId) || 0) + 1)
  if ([...selectedPerCreator.values()].some((count) => count > MAX_SELECTED_WORKS_PER_CREATOR)) throw new Error('单一博主样本份额超过硬上限')
  if (!Array.isArray(value.excludedCreators) || value.excludedCreators.length > MAX_DISCOVERY_CREATORS) throw new Error('排除博主记录无效')
  for (const excluded of value.excludedCreators) {
    if (!followingIds.has(safeName(excluded?.creatorId, '排除博主 creatorId')) || typeof excluded?.code !== 'string') throw new Error('排除博主未绑定已验证关注来源')
  }
  return { ...value, samples, followingProof, creatorWorksProofs }
}

function scanSensitive(value) {
  const seen = new WeakSet()
  const visit = (current, path = '$') => {
    if (typeof current === 'string') {
      if (/\bBearer\s+[A-Za-z0-9._~+\/-]+/i.test(current)) throw new Error(`报告含 Bearer 值：${path}`)
      if (/[?&](?:X-Bogus|msToken|access_token|refresh_token)=[^&\s\[]+/i.test(current)) throw new Error(`报告含敏感 URL 参数：${path}`)
      if (/^(?:https?:\/\/)?[^\s/:]+:[^\s/@]+@/i.test(current)) throw new Error(`报告含 URL 凭据：${path}`)
      return
    }
    if (current === null || typeof current !== 'object') return
    if (seen.has(current)) throw new Error(`报告含循环结构：${path}`)
    seen.add(current)
    for (const [key, entry] of Object.entries(current)) {
      if (sensitiveKeyPattern.test(key) && !['signatureProvider', 'sessionUsed'].includes(key)) throw new Error(`报告含禁止字段：${path}.${key}`)
      visit(entry, `${path}.${key}`)
    }
  }
  visit(value)
}

function validatePage(page, sourceKind, workId) {
  if (!page || page.contract !== 'phase-b-comment-page/v1' || page.sourceKind !== sourceKind || page.workId !== workId) throw new Error(`${sourceKind} 分页合同无效`)
  if (!Array.isArray(page.comments) || !Array.isArray(page.returnedIds) || page.returnedCount !== page.comments.length) throw new Error(`${sourceKind} 分页计数不一致`)
  if (page.comments.length > 40 || page.returnedIds.length !== page.comments.length) throw new Error(`${sourceKind} 分页超过硬上限或 ID 不一致`)
  if (!/^[a-f0-9]{64}$/.test(page.responseBodySha256 || '')) throw new Error(`${sourceKind} 缺少白名单响应哈希`)
  if (page.completion === 'verified-empty' && (page.comments.length !== 0 || page.hasMore || page.reportedTotal !== 0)) throw new Error(`${sourceKind} 的 verified-empty 无效`)
  if (page.comments.length === 0 && page.hasMore) throw new Error(`${sourceKind} 空页仍声明 hasMore`)
  for (const comment of page.comments) {
    safeName(comment.commentId, 'commentId')
    if (typeof comment.body !== 'string' || !comment.body.trim() || comment.body.length > 5_000) throw new Error(`${sourceKind} 评论正文无效`)
    if (typeof comment.publicAuthorName !== 'string' || !comment.publicAuthorName.trim() || comment.publicAuthorName.length > 200) throw new Error(`${sourceKind} 评论作者无效`)
  }
}

function validateEndpointProbe(entries, label) {
  if (!Array.isArray(entries) || entries.length > 100) throw new Error(`${label} endpoint probe 数量无效`)
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !/^(?:www\.)?[A-Za-z0-9.-]*douyin\.com$/.test(String(entry.host || ''))) throw new Error(`${label} endpoint probe host 无效`)
    if (typeof entry.path !== 'string' || entry.path.length < 1 || entry.path.length > 300 || !entry.path.startsWith('/') || /[?#\r\n]/.test(entry.path)) throw new Error(`${label} endpoint probe path 无效`)
    if (!['Fetch', 'XHR', 'fetch', 'xmlhttprequest', 'other'].includes(entry.kind)) throw new Error(`${label} endpoint probe kind 无效`)
    if (entry.status !== null && (!Number.isSafeInteger(entry.status) || entry.status < 100 || entry.status > 599)) throw new Error(`${label} endpoint probe status 无效`)
    if (!Number.isSafeInteger(entry.count) || entry.count < 1 || entry.count > 10_000) throw new Error(`${label} endpoint probe count 无效`)
  }
}

function validateReport(value, manifest, runId) {
  scanSensitive(value)
  if (!value || value.contract !== 'signaldesk-phase-b-sample-report/v1' || value.runId !== runId) throw new Error('样本报告合同或 runId 无效')
  const index = Number(value.sampleIndex)
  if (!Number.isInteger(index) || index < 1 || index > manifest.samples.length) throw new Error('sampleIndex 超出清单')
  const expected = manifest.samples[index - 1]
  if (value.workId !== expected.workId || value.sourceUrl !== expected.url || value.workType !== expected.workType) throw new Error('报告目标与固化清单不一致')
  if (!Array.isArray(value.network?.pages) || value.network.pages.length > 4) throw new Error('Network 页数无效')
  if (!Array.isArray(value.pageContextApi?.pages) || value.pageContextApi.pages.length > 2) throw new Error('页面 API 页数无效')
  for (const page of value.network.pages) validatePage(page, 'network-response', expected.workId)
  for (const page of value.pageContextApi.pages) validatePage(page, 'page-context-fetch', expected.workId)
  if (!Array.isArray(value.issues) || value.issues.length > 30) throw new Error('issues 数量无效')
  if (!value.eligibility || typeof value.eligibility.eligible !== 'boolean') throw new Error('eligibility 无效')
  if (!value.domShadow || !Array.isArray(value.domShadow.comments) || value.domShadow.comments.length > 40) throw new Error('DOM shadow 结果无效')
  if (!['success', 'empty-unverified', 'schema-mismatch', 'not-ready', 'error'].includes(value.domShadow.status)) throw new Error('DOM shadow 状态无效')
  if (value.domShadow.status === 'error' && (!value.domShadow.issue || typeof value.domShadow.issue.code !== 'string' || typeof value.domShadow.issue.message !== 'string')) throw new Error('DOM shadow 错误缺少结构化 issue')
  for (const comment of value.domShadow.comments) {
    if (comment.commentId !== null && comment.commentId !== undefined) safeName(comment.commentId, 'DOM commentId')
    if (typeof comment.publicAuthorName !== 'string' || !comment.publicAuthorName.trim() || comment.publicAuthorName.length > 200) throw new Error('DOM 评论作者无效')
    if (typeof comment.body !== 'string' || !comment.body.trim() || comment.body.length > 5_000) throw new Error('DOM 评论正文无效')
  }
  for (const issue of value.issues) {
    if (issue?.contract !== 'phase-b-issue/v1' || typeof issue.code !== 'string' || typeof issue.phase !== 'string') throw new Error('issue 合同无效')
    if (typeof issue.message !== 'string' || issue.message.length > 1_000) throw new Error('issue message 无效')
  }
  if (!value.endpointProbe || typeof value.endpointProbe !== 'object') throw new Error('缺少 query-free endpoint probe')
  validateEndpointProbe(value.endpointProbe.network, 'Network')
  validateEndpointProbe(value.endpointProbe.performance, 'Performance')
  return value
}

function reportFileName(report) {
  return `${String(report.sampleIndex).padStart(2, '0')}-${safeName(report.workId, 'workId')}.json`
}

async function atomicJson(path, value) {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  await rename(temporary, path)
}

async function existingReports(runDirectory, manifest) {
  const reports = []
  for (const sample of manifest.samples) {
    const path = join(runDirectory, 'samples', `${String(sample.index).padStart(2, '0')}-${sample.workId}.json`)
    if (!existsSync(path)) continue
    reports.push(JSON.parse(await readFile(path, 'utf8')))
  }
  return reports
}

function summarize(reports, manifest, stopped) {
  const eligible = reports.filter((report) => report.eligibility.eligible)
  const issueCounts = {}
  for (const report of reports) {
    for (const issue of report.issues) issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1
  }
  const countStatus = (path, status) => reports.filter((report) => path(report) === status).length
  const mismatchCount = eligible.filter((report) => {
    const comparison = report.comparison
    return comparison.apiCount > 0 && comparison.networkCount > 0 && comparison.networkApiIdOverlap === 0
  }).length
  const verifiedEmptyConflictCount = eligible.filter((report) => {
    const comparison = report.comparison
    return comparison.apiVerifiedEmpty && (comparison.networkCount > 0 || comparison.domCount > 0)
  }).length
  const selectedCreatorCounts = {}
  const selectedTypeCounts = { video: 0, image: 0 }
  for (const sample of manifest.samples) {
    selectedCreatorCounts[sample.creatorId] = (selectedCreatorCounts[sample.creatorId] || 0) + 1
    selectedTypeCounts[sample.workType] = (selectedTypeCounts[sample.workType] || 0) + 1
  }
  const aggregateEndpoints = (channel) => {
    const values = new Map()
    for (const report of reports) {
      for (const entry of report.endpointProbe?.[channel] || []) {
        const key = `${entry.host}|${entry.path}|${entry.kind}|${entry.status ?? 'none'}`
        const existing = values.get(key)
        values.set(key, { ...entry, count: (existing?.count || 0) + entry.count })
      }
    }
    return [...values.values()].sort((left, right) => right.count - left.count || left.path.localeCompare(right.path)).slice(0, 100)
  }
  return {
    contract: 'signaldesk-phase-b-summary/v1',
    runId: reports[0]?.runId || null,
    plannedSamples: manifest.samples.length,
    completedSamples: reports.length,
    stopped,
    eligibleSamples: eligible.length,
    ineligibleSamples: reports.length - eligible.length,
    sampling: {
      policy: manifest.sampling.policy,
      targetSampleCount: manifest.sampling.targetSampleCount,
      samplingSeedSha256: manifest.sampling.samplingSeedSha256,
      verifiedFollowingCreators: manifest.followingProof.creatorIds.length,
      inspectedCreatorProfiles: manifest.creatorWorksProofs.length + manifest.excludedCreators.length,
      candidateWorks: manifest.candidateCount,
      selectedCreators: Object.keys(selectedCreatorCounts).length,
      maximumSelectedFromOneCreator: Math.max(0, ...Object.values(selectedCreatorCounts)),
      selectedTypeCounts
    },
    network: {
      success: countStatus((report) => report.network.status, 'success'),
      notObserved: countStatus((report) => report.network.status, 'not-observed'),
      error: countStatus((report) => report.network.status, 'error')
    },
    pageContextApi: {
      success: countStatus((report) => report.pageContextApi.status, 'success'),
      notReady: countStatus((report) => report.pageContextApi.status, 'not-ready'),
      error: countStatus((report) => report.pageContextApi.status, 'error')
    },
    domShadow: {
      success: countStatus((report) => report.domShadow.status, 'success'),
      emptyUnverified: countStatus((report) => report.domShadow.status, 'empty-unverified'),
      schemaMismatch: countStatus((report) => report.domShadow.status, 'schema-mismatch'),
      notReady: countStatus((report) => report.domShadow.status, 'not-ready'),
      error: countStatus((report) => report.domShadow.status, 'error')
    },
    endpointProbe: {
      network: aggregateEndpoints('network'),
      performance: aggregateEndpoints('performance')
    },
    issueCounts,
    networkApiZeroOverlapCount: mismatchCount,
    erroneousVerifiedEmptyConflictCount: verifiedEmptyConflictCount,
    generatedAt: new Date().toISOString(),
    benchmarkClaimAllowed: false
  }
}

function markdownReport(summary) {
  const issues = Object.entries(summary.issueCounts).sort(([left], [right]) => left.localeCompare(right))
  return `# Signal Desk 阶段 B 隔离 PoC 报告

运行 ID：\`${summary.runId || 'unknown'}\`  
生成时间：${summary.generatedAt}

## 执行范围

- 计划样本：${summary.plannedSamples}
- 完成样本：${summary.completedSamples}
- Eligible：${summary.eligibleSamples}
- Ineligible：${summary.ineligibleSamples}
- 是否提前停止：${summary.stopped ? '是' : '否'}

## 自动发现与抽样证明

- 抽样策略：\`${summary.sampling.policy}\`
- 随机种子 SHA-256：\`${summary.sampling.samplingSeedSha256}\`
- 已验证关注博主：${summary.sampling.verifiedFollowingCreators}
- 已检查博主主页：${summary.sampling.inspectedCreatorProfiles}
- 合格候选作品：${summary.sampling.candidateWorks}
- 最终覆盖博主：${summary.sampling.selectedCreators}
- 单一博主最大样本数：${summary.sampling.maximumSelectedFromOneCreator}
- 视频 / 图文：${summary.sampling.selectedTypeCounts.video} / ${summary.sampling.selectedTypeCounts.image}

## 三通道结果

| 通道 | 成功 | 未观察/未就绪 | 错误 |
|---|---:|---:|---:|
| Network response | ${summary.network.success} | ${summary.network.notObserved} | ${summary.network.error} |
| Page-context API | ${summary.pageContextApi.success} | ${summary.pageContextApi.notReady} | ${summary.pageContextApi.error} |
| DOM shadow | ${summary.domShadow.success} | ${summary.domShadow.emptyUnverified + summary.domShadow.notReady} | ${summary.domShadow.schemaMismatch + summary.domShadow.error} |

## 一致性安全检查

- Network/API 均有数据但原生 cid 交集为 0：${summary.networkApiZeroOverlapCount}
- API 判定 verified-empty 但其他通道存在评论：${summary.erroneousVerifiedEmptyConflictCount}

## 错误分类

${issues.length ? issues.map(([code, count]) => `- \`${code}\`: ${count}`).join('\n') : '- 无'}

## 结论边界

此报告是 20～30 个批准样本的阶段 B PoC，不写正式数据库，不代表阶段 C 已实现，也不构成 30/200/500/1000 级稳定性基准。\`benchmarkClaimAllowed=false\`，不得据此宣称“基本零错误”或达到 99.5%。
`
}

async function stopRemote(port, token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('stop 需要控制器输出的 64 位 session token')
  const response = await fetch(`http://127.0.0.1:${port}/v1/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-phase-b-token': token },
    body: '{}'
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  process.stdout.write(`${JSON.stringify(body)}\n`)
}

async function startController(port) {
  assertLegacyPhaseBDisabled()
  await mkdir(runtimeRoot, { recursive: true })
  await mkdir(runsRoot, { recursive: true })
  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const stopFile = join(runtimeRoot, `STOP-${tokenHash.slice(0, 12)}`)
  let manifest = null
  let discovery = null
  let runId = null
  let runDirectory = null
  let stop = false
  let pairedExtensionOrigin = null

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') return jsonResponse(response, 204, {}, String(request.headers.origin || '*'))
      const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
      if (request.method === 'POST' && url.pathname === '/v1/pair') {
        const origin = String(request.headers.origin || '')
        if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return jsonResponse(response, 403, { error: '只允许已加载的 Chrome 扩展与阶段 B 控制器配对' }, 'null')
        if (request.headers['x-phase-b-client'] !== 'signaldesk-phase-b-poc') return jsonResponse(response, 403, { error: '阶段 B 扩展身份标记无效' }, origin)
        const pairing = await readJson(request)
        if (pairing?.contract !== 'signaldesk-phase-b-pair/v1') return jsonResponse(response, 400, { error: '阶段 B 配对合同无效' }, origin)
        if (pairedExtensionOrigin && pairedExtensionOrigin !== origin) return jsonResponse(response, 409, { error: '此控制器会话已经与另一个扩展实例配对' }, origin)
        pairedExtensionOrigin = origin
        return jsonResponse(response, 200, { paired: true, sessionToken: token }, origin)
      }
      const suppliedToken = String(request.headers['x-phase-b-token'] || '')
      const suppliedHash = createHash('sha256').update(suppliedToken).digest('hex')
      if (suppliedHash !== tokenHash) return jsonResponse(response, 401, { error: '无效的阶段 B session token' })
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        return jsonResponse(response, 200, { ok: true, contract: 'signaldesk-phase-b-controller/v1', runId, discoveryStarted: Boolean(discovery), manifestFrozen: Boolean(manifest), stop })
      }
      if (request.method === 'GET' && url.pathname === '/v1/should-stop') {
        return jsonResponse(response, 200, { stop: stop || existsSync(stopFile) })
      }
      if (request.method === 'POST' && url.pathname === '/v1/discovery-start') {
        if (discovery || manifest) throw new Error('此控制器会话已经开始自动发现')
        discovery = validateDiscovery(await readJson(request))
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
        runId = `phase-b-${stamp}`
        runDirectory = resolve(runsRoot, runId)
        if (!runDirectory.startsWith(resolve(runsRoot))) throw new Error('运行目录越界')
        await mkdir(join(runDirectory, 'samples'), { recursive: true })
        await atomicJson(join(runDirectory, 'discovery.json'), { ...discovery, runId })
        await atomicJson(join(runtimeRoot, 'session.json'), {
          contract: 'signaldesk-phase-b-controller-session/v1', runId, port, tokenSha256: tokenHash,
          runDirectory, startedAt: new Date().toISOString()
        })
        return jsonResponse(response, 201, { accepted: true, runId, targetSampleCount: discovery.targetSampleCount })
      }
      if (request.method === 'POST' && url.pathname === '/v1/start') {
        if (!discovery || !runDirectory || !runId) throw new Error('尚未固化自动发现合同')
        if (manifest) throw new Error('此控制器会话已经固化运行清单')
        manifest = validateManifest(await readJson(request), discovery)
        if (manifest.discoveryId !== runId) throw new Error('运行清单 discoveryId 与控制器会话不一致')
        await atomicJson(join(runDirectory, 'manifest.json'), { ...manifest, runId })
        return jsonResponse(response, 201, { accepted: true, runId, sampleCount: manifest.samples.length })
      }
      if (request.method === 'POST' && url.pathname === '/v1/discovery-fail') {
        if (!discovery || !runDirectory || !runId) throw new Error('尚未开始自动发现')
        if (manifest) throw new Error('运行清单已经固化，不能再写发现失败')
        const failure = await readJson(request)
        scanSensitive(failure)
        if (failure?.contract !== 'signaldesk-phase-b-discovery-failure/v1') throw new Error('发现失败合同无效')
        const allowedCodes = new Set(['INSUFFICIENT_ELIGIBLE_SAMPLES', 'LOGIN_REQUIRED', 'CAPTCHA_OR_SECURITY_CHALLENGE', 'PAGE_NAVIGATION_TIMEOUT', 'PAGE_CONTEXT_NOT_READY', 'SCHEMA_CHANGED', 'BROWSER_OFFLINE'])
        if (!allowedCodes.has(failure.code) || typeof failure.message !== 'string' || failure.message.length > 1_000) throw new Error('发现失败代码或消息无效')
        if (failure.diagnostics !== undefined) {
          const diagnostics = failure.diagnostics
          const countKeys = ['verifiedFollowingCreators', 'inspectedCreatorProfiles', 'acceptedCreatorProfiles', 'candidateWorks']
          if (!diagnostics || typeof diagnostics !== 'object' || countKeys.some((key) => !Number.isSafeInteger(diagnostics[key]) || diagnostics[key] < 0)) throw new Error('发现失败聚合诊断无效')
          if (!diagnostics.excludedCodeCounts || typeof diagnostics.excludedCodeCounts !== 'object' || Object.entries(diagnostics.excludedCodeCounts).some(([code, count]) => !allowedCodes.has(code) || !Number.isSafeInteger(count) || count < 0)) throw new Error('发现失败排除代码计数无效')
        }
        const path = join(runDirectory, 'discovery-failure.json')
        if (existsSync(path)) throw new Error('发现失败记录已存在，拒绝覆盖')
        await atomicJson(path, { ...failure, runId })
        return jsonResponse(response, 201, { accepted: true, runId, status: 'discovery-failed' })
      }
      if (request.method === 'POST' && url.pathname === '/v1/report') {
        if (!manifest || !runDirectory || !runId) throw new Error('尚未提交运行清单')
        if (stop || existsSync(stopFile)) throw new Error('控制器已停止，不再接收报告')
        const report = validateReport(await readJson(request), manifest, runId)
        const path = join(runDirectory, 'samples', reportFileName(report))
        if (existsSync(path)) throw new Error('同一样本报告已存在，拒绝覆盖')
        await atomicJson(path, report)
        return jsonResponse(response, 201, { accepted: true, sampleIndex: report.sampleIndex })
      }
      if (request.method === 'POST' && url.pathname === '/v1/stop') {
        stop = true
        await writeFile(stopFile, `${new Date().toISOString()}\n`, { encoding: 'utf8', flag: 'w' })
        return jsonResponse(response, 200, { stopped: true, runId })
      }
      if (request.method === 'POST' && url.pathname === '/v1/complete') {
        if (!manifest || !runDirectory || !runId) throw new Error('尚未提交运行清单')
        const completion = await readJson(request)
        if (completion.runId !== runId) throw new Error('完成消息 runId 不一致')
        const reports = await existingReports(runDirectory, manifest)
        const summary = summarize(reports, manifest, Boolean(completion.stopped || stop))
        await atomicJson(join(runDirectory, 'summary.json'), summary)
        await writeFile(join(runDirectory, 'report.md'), markdownReport(summary), { encoding: 'utf8', flag: 'w' })
        return jsonResponse(response, 200, { status: summary.stopped ? 'stopped' : 'complete', runId, completed: reports.length })
      }
      return jsonResponse(response, 404, { error: '未知阶段 B 控制器端点' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return jsonResponse(response, 400, { error: message.slice(0, 1_000) })
    }
  })

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolvePromise)
  })
  const address = `http://127.0.0.1:${port}`
  process.stdout.write(`PHASE_B_CONTROLLER=${address}\n`)
  process.stdout.write(`PHASE_B_SESSION_TOKEN=${token}\n`)
  process.stdout.write('Token 仅用于本机隔离 PoC，不是抖音或 Signal Desk 凭据。\n')

  const shutdown = async () => {
    await new Promise((resolvePromise) => server.close(resolvePromise))
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
}

export { assertLegacyPhaseBDisabled, markdownReport, scanSensitive, summarize, validateDiscovery, validateManifest, validateReport }

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'start') await startController(args.port)
  else if (args.command === 'stop') await stopRemote(args.port, args.token)
  else throw new Error(`未知命令：${args.command}`)
}
