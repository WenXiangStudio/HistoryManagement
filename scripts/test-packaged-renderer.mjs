import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

const executable = resolve(process.argv[2] || 'release/win-unpacked/Signal Desk.exe')
if (!existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`)
const packagedConnectorRoot = join(dirname(executable), 'resources', 'browser-connector')
const packagedNativeManifest = join(packagedConnectorRoot, 'native-host', 'bin', 'com.signaldesk.bridge.json')
if (existsSync(packagedNativeManifest)) {
  throw new Error(`Packaged resources contain a user-specific Native Messaging manifest: ${packagedNativeManifest}`)
}
const packagedConnectorIdentity = JSON.parse(readFileSync(join(packagedConnectorRoot, 'connector-identity.json'), 'utf8'))
const packagedExtensionManifest = JSON.parse(readFileSync(join(packagedConnectorRoot, 'extension', 'manifest.json'), 'utf8'))
if (packagedConnectorIdentity.extensionId !== 'fejndacdabkgahmfpfjaghhedbdehonh'
  || packagedConnectorIdentity.connectorVersion !== packagedExtensionManifest.version
  || !packagedExtensionManifest.key
  || !existsSync(join(packagedConnectorRoot, 'install.ps1'))) {
  throw new Error(`Packaged stable connector identity is incomplete: ${JSON.stringify({
    identity: packagedConnectorIdentity,
    extensionVersion: packagedExtensionManifest.version,
    hasKey: Boolean(packagedExtensionManifest.key)
  })}`)
}

const testData = mkdtempSync(resolve(tmpdir(), 'signal-desk-renderer-smoke-'))
const isolatedRoot = join(testData, 'isolated-r8')
mkdirSync(isolatedRoot)
const isolatedCatalog = new DatabaseSync(join(isolatedRoot, 'verified-catalog.sqlite'))
isolatedCatalog.exec(`PRAGMA application_id=1396986424;
  CREATE TABLE owners(sec_uid TEXT PRIMARY KEY,verified_at TEXT NOT NULL,source TEXT NOT NULL);
  CREATE TABLE creators(id INTEGER PRIMARY KEY,owner_sec_uid TEXT,uid TEXT,sec_uid TEXT,
    nickname TEXT,profile_url TEXT,following_state TEXT,identity_source TEXT);`)
isolatedCatalog.prepare("INSERT INTO owners VALUES('smoke-owner','2026-09-29T00:00:00.000Z','browser-following-route')").run()
isolatedCatalog.prepare(`INSERT INTO creators VALUES(1,'smoke-owner','smoke-uid','smoke-sec',
  '合成试跑作者','https://www.douyin.com/user/smoke-sec','active','following-list-structured-response')`).run()
isolatedCatalog.close()
const sourceDatabasePath = process.env.SIGNAL_DESK_SMOKE_SOURCE_DB
let expectedSnapshot = null
if (sourceDatabasePath) {
  if (!existsSync(sourceDatabasePath)) throw new Error(`Smoke source database not found: ${sourceDatabasePath}`)
  const sourceDatabase = new DatabaseSync(sourceDatabasePath, { readOnly: true })
  expectedSnapshot = {
    creators: Number(sourceDatabase.prepare('SELECT COUNT(*) AS count FROM creators').get().count),
    works: Number(sourceDatabase.prepare('SELECT COUNT(*) AS count FROM works').get().count),
    starred: Number(sourceDatabase.prepare('SELECT COUNT(*) AS count FROM creators WHERE is_starred=1').get().count),
    notes: Number(sourceDatabase.prepare(`SELECT COUNT(*) AS count FROM creators WHERE user_note<>''`).get().count)
  }
  await backup(sourceDatabase, join(testData, 'signal-desk.sqlite'))
  sourceDatabase.close()
}
const port = await new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const selectedPort = typeof address === 'object' && address ? address.port : 0
    server.close(() => resolvePort(selectedPort))
  })
})

const child = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${testData}`,
  '--disable-gpu',
  '--enable-logging=stderr'
], {
  env: { ...process.env, SIGNAL_DESK_SMOKE_TEST: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true
})

let stderr = ''
child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

async function getPage() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited early (${child.exitCode}).\n${stderr}`)
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      const page = pages.find((entry) => entry.type === 'page')
      if (page) return page
    } catch {
      // The DevTools endpoint is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`Timed out waiting for packaged renderer.\n${stderr}`)
}

const page = await getPage()
const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
const errors = []
let requestId = 0

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params)
})

await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

const bridgeDiscovery = JSON.parse(readFileSync(join(testData, 'bridge.json'), 'utf8'))
const bridgePresenceResponse = await fetch(`${bridgeDiscovery.url}/v1/commands`, {
  headers: { 'x-signaldesk-secret': bridgeDiscovery.secret }
})
if (!bridgePresenceResponse.ok) throw new Error(`Unable to simulate browser connector presence: HTTP ${bridgePresenceResponse.status}`)

function send(method, params = {}) {
  const id = ++requestId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveMessage) => pending.set(id, resolveMessage))
}

try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.reload', { ignoreCache: true })
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500))

  const stateResponse = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      signalDeskType: typeof window.signalDesk,
      rootChildCount: document.getElementById('root')?.childElementCount ?? -1,
      rootText: document.getElementById('root')?.innerText ?? ''
    })`,
    returnByValue: true
  })
  const state = JSON.parse(stateResponse.result.result.value)

  const ipcResponse = await send('Runtime.evaluate', {
    expression: `window.signalDesk.getDashboard().then((summary) => JSON.stringify({ ok: true, summary })).catch((error) => JSON.stringify({ ok: false, error: String(error) }))`,
    awaitPromise: true,
    returnByValue: true
  })
  const ipc = JSON.parse(ipcResponse.result.result.value)

  const isolatedPilotResponse = await send('Runtime.evaluate', {
    expression: `(async () => {
      const catalog = await window.signalDesk.getIsolatedPilotCatalog()
      const state = await window.signalDesk.prepareIsolatedPilot('smoke-uid')
      const jobs = [...document.querySelectorAll('nav button')].find((button) => button.textContent?.includes('任务中心'))
      jobs?.click()
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
      return JSON.stringify({ catalog, state, panelText: document.querySelector('.isolated-pilot-panel')?.innerText || '' })
    })()`, awaitPromise: true, returnByValue: true
  })
  if (isolatedPilotResponse.result.exceptionDetails) throw new Error(`Isolated pilot IPC failed: ${JSON.stringify(isolatedPilotResponse.result.exceptionDetails)}`)
  const isolatedPilot = JSON.parse(isolatedPilotResponse.result.result.value)
  if (!isolatedPilot.catalog.available || isolatedPilot.catalog.creators.length !== 1
    || isolatedPilot.state.phase !== 'prepared'
    || !isolatedPilot.panelText.includes('从已保存作者验证一个作品')
    || !isolatedPilot.panelText.includes('不会刷新当前账号关注')
    || isolatedPilot.state.tasks.length !== 1
    || isolatedPilot.state.tasks[0].kind !== 'collection.creator_works') {
    throw new Error(`Isolated client entry is incomplete: ${JSON.stringify(isolatedPilot)}`)
  }
  const pilotConfigSource = readFileSync(join(isolatedPilot.state.extensionDirectory, 'session-config.js'), 'utf8')
  const pilotConfig = JSON.parse(pilotConfigSource.match(/Object\.freeze\((.*)\)/)[1])
  const pilotTime = new Date().toISOString()
  const syntheticPilotReport = {
    contract: 'signaldesk-homepage-pilot-report/v1', runId: isolatedPilot.state.runId,
    startedAt: pilotTime, finishedAt: pilotTime, observerIssueCodes: [],
    safety: { formalDatabaseTouched: false, activeApiRequests: 0, mediaProcessingStarted: false, externalProvidersCalled: false },
    result: {
      contract: 'signaldesk-homepage-pilot/v1', status: 'verified', stage: 'work-detail',
      creator: { uid: 'smoke-uid', secUid: 'smoke-sec', profileUrl: 'https://www.douyin.com/user/smoke-sec' },
      navigationCount: 2, activeApiRequests: 0,
      candidates: [{ workId: '1234567890123456789', url: 'https://www.douyin.com/video/1234567890123456789', status: 'page-visible-candidate' }],
      verifiedWork: { workId: '1234567890123456789', workIdKind: 'native-aweme-id',
        workIdSourcePath: 'aweme_detail.aweme_id', authorId: 'smoke-uid', authorSecId: 'smoke-sec',
        nickname: '合成试跑作者', authorIdSourcePath: 'aweme_detail.author.uid', workType: 'video',
        title: '离线合成报告 · 不代表真实平台验收', description: '打包客户端闭环检查',
        publishedAt: null, durationMs: null,
        statistics: { likeCount: 1, commentCount: null, collectCount: null, shareCount: null, playCount: null } },
      workProof: { routeId: 'DY-WORKS-NETWORK', endpointKind: 'creator-work-list', schemaFingerprint: 'a'.repeat(64), projectionSha256: 'b'.repeat(64), observedAt: pilotTime },
      detailProof: { routeId: 'DY-DETAIL-NETWORK', endpointKind: 'work-detail', schemaFingerprint: 'c'.repeat(64), projectionSha256: 'd'.repeat(64), observedAt: pilotTime },
      comments: 'not-requested', replies: 'not-requested', reason: null
    }
  }
  const reportResponse = await fetch(`${pilotConfig.controllerOrigin}/v1/report`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-signaldesk-r8-token': pilotConfig.token,
      'x-signaldesk-r8-client': 'signaldesk-homepage-pilot-extension' }, body: JSON.stringify(syntheticPilotReport)
  })
  if (reportResponse.status !== 201) throw new Error(`Synthetic pilot report rejected: ${await reportResponse.text()}`)
  const finishedPilotResponse = await send('Runtime.evaluate', {
    expression: `(async () => {
      const state = await window.signalDesk.getIsolatedPilotStatus()
      await new Promise((resolveWait) => setTimeout(resolveWait, 2200))
      return JSON.stringify({ state, panelText: document.querySelector('.isolated-pilot-panel')?.innerText || '' })
    })()`, awaitPromise: true, returnByValue: true
  })
  if (finishedPilotResponse.result.exceptionDetails) throw new Error(`Isolated report import failed: ${JSON.stringify(finishedPilotResponse.result.exceptionDetails)}`)
  const finishedPilot = JSON.parse(finishedPilotResponse.result.result.value)
  if (finishedPilot.state.phase !== 'finished' || finishedPilot.state.result.status !== 'verified'
    || !finishedPilot.panelText.includes('作品已验证') || !finishedPilot.panelText.includes('评论未请求')) {
    throw new Error(`Isolated client result UI is incomplete: ${JSON.stringify(finishedPilot)}`)
  }
  const pilotDatabase = new DatabaseSync(join(isolatedPilot.state.reportDirectory, 'isolated-sync.sqlite'), { readOnly: true })
  try {
    if (Number(pilotDatabase.prepare('PRAGMA user_version').get().user_version) !== 6
      || Number(pilotDatabase.prepare('SELECT COUNT(*) AS n FROM works').get().n) !== 1
      || Number(pilotDatabase.prepare('SELECT COUNT(*) AS n FROM isolated_pilot_sources').get().n) !== 1
      || Number(pilotDatabase.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='collection.following'").get().n) !== 0) {
      throw new Error('Packaged isolated work, proof or temporary schema was not persisted')
    }
  } finally { pilotDatabase.close() }
  if (process.env.SIGNAL_DESK_SMOKE_PILOT_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(resolve(process.env.SIGNAL_DESK_SMOKE_PILOT_SCREENSHOT), Buffer.from(screenshot.result.data, 'base64'))
  }
  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('nav button')].find((button) => button.textContent?.includes('今日收件箱'))?.click()`
  })

  const boundedSyncResponse = await send('Runtime.evaluate', {
    expression: `window.signalDesk.refreshFollowing().then(() => JSON.stringify({ rejected: false })).catch((error) => JSON.stringify({ rejected: true, error: String(error) }))`,
    awaitPromise: true,
    returnByValue: true
  })
  const boundedSync = JSON.parse(boundedSyncResponse.result.result.value)

  const productionSyncResponse = await send('Runtime.evaluate', {
    expression: `window.signalDesk.completeFollowingBasics().then(() => JSON.stringify({ rejected: false })).catch((error) => JSON.stringify({ rejected: true, error: String(error) }))`,
    awaitPromise: true,
    returnByValue: true
  })
  const productionSync = JSON.parse(productionSyncResponse.result.result.value)

  const worksSyncResponse = await send('Runtime.evaluate', {
    expression: `window.signalDesk.startCreatorWorksSync('smoke-uid', 1).then(() => JSON.stringify({ rejected: false })).catch((error) => JSON.stringify({ rejected: true, error: String(error) }))`,
    awaitPromise: true,
    returnByValue: true
  })
  const worksSync = JSON.parse(worksSyncResponse.result.result.value)

  const sampleSyncUiResponse = await send('Runtime.evaluate', {
    expression: `(async () => {
      const trigger = document.querySelector('[data-testid="start-following-sync"]')
      const triggerFound = trigger instanceof HTMLButtonElement
      const triggerInitiallyDisabled = triggerFound ? trigger.disabled : null
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
      const modal = document.querySelector('.confirm-modal')
      const inputs = [...(modal?.querySelectorAll('input[type="number"]') || [])].map((input) => Number(input.value))
      const confirm = [...(modal?.querySelectorAll('button') || [])].find((button) => button.textContent?.includes('确认刷新关注目录'))
      return JSON.stringify({ triggerFound, triggerInitiallyDisabled, buttonTexts: [...document.querySelectorAll('button')].map((button) => button.textContent?.trim()), text: modal?.textContent || '', inputs, confirmDisabled: confirm instanceof HTMLButtonElement ? confirm.disabled : null })
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const sampleSyncUi = JSON.parse(sampleSyncUiResponse.result.result.value)
  if (process.env.SIGNAL_DESK_SMOKE_SYNC_SCREENSHOT) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 720, deviceScaleFactor: 1, mobile: false })
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(resolve(process.env.SIGNAL_DESK_SMOKE_SYNC_SCREENSHOT), Buffer.from(screenshot.result.data, 'base64'))
  }
  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('.confirm-modal button')].find((button) => button.textContent?.trim() === '取消')?.click()`
  })

  const cloudSettingsResponse = await send('Runtime.evaluate', {
    expression: `(async () => {
      await window.signalDesk.saveSettings({
        textBaseUrl: 'https://smoke-text.example.com/v1',
        textApiKey: 'smoke-text-secret',
        textModel: 'smoke-text-model',
        visionBaseUrl: 'https://smoke-vision.example.com/v1',
        visionApiKey: 'smoke-vision-secret',
        visionModel: 'smoke-vision-model'
      })
      const settings = await window.signalDesk.getSettings()
      const settingsButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '设置')
      settingsButton?.click()
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
      return JSON.stringify({
        settings,
        pageText: document.getElementById('root')?.innerText ?? ''
      })
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const cloudSettings = JSON.parse(cloudSettingsResponse.result.result.value)

  const demoResponse = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        await window.signalDesk.seedDemo()
        const aiWorks = await window.signalDesk.listInbox({ state: 'all', search: 'AI', limit: 100 })
        const financeWorks = await window.signalDesk.listInbox({ state: 'all', search: '金融', limit: 100 })
        const technologyCreators = await window.signalDesk.listCreators('科技')
        const namedCreators = await window.signalDesk.listCreators('量子茶馆')
        const allCreators = await window.signalDesk.listCreators('')
        const allWorks = await window.signalDesk.listInbox({ state: 'all', limit: 100 })
        const demo = allWorks.find((work) => work.platformWorkId === 'c-tech-w1')
        const nullableMetric = allWorks.find((work) => work.platformWorkId === 'c-tech-w2')
        const detail = demo ? await window.signalDesk.getWork(demo.id) : null
        return JSON.stringify({ ok: true, aiWorks, financeWorks, technologyCreators, namedCreators, allCreators, allWorksCount: allWorks.length, nullableMetric, detail })
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error) })
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const demo = JSON.parse(demoResponse.result.result.value)

  if (state.signalDeskType !== 'object') throw new Error(`Preload bridge is ${state.signalDeskType}`)
  if (state.rootChildCount < 1 || !state.rootText.includes('今日内容收件箱')) {
    throw new Error(`Renderer did not mount the application: ${JSON.stringify(state)}`)
  }
  if (!state.rootText.includes('等待扩展连接')) throw new Error('Independent following connector entry did not render')
  if (!ipc.ok) throw new Error(`IPC dashboard call failed: ${ipc.error}`)
  if (!boundedSync.rejected || !boundedSync.error.includes('请先连接关注扩展')) throw new Error(`Main process did not enforce connector readiness: ${JSON.stringify(boundedSync)}`)
  if (!productionSync.rejected || !productionSync.error.includes('请先连接关注扩展')) {
    throw new Error(`Basic-profile connector readiness was not enforced: ${JSON.stringify(productionSync)}`)
  }
  if (!worksSync.rejected || !worksSync.error.includes('尚未接入正式连接器')) {
    throw new Error(`Production works sync was not fail-closed: ${JSON.stringify(worksSync)}`)
  }
  if (sampleSyncUi.triggerFound !== true
    || sampleSyncUi.triggerInitiallyDisabled !== true
    || sampleSyncUi.text !== ''
    || sampleSyncUi.inputs.length !== 0
    || sampleSyncUi.confirmDisabled !== null) {
    throw new Error(`Independent following entry is incomplete: ${JSON.stringify(sampleSyncUi)}`)
  }
  if (!('textBaseUrl' in cloudSettings.settings) || !('visionBaseUrl' in cloudSettings.settings)) {
    throw new Error(`Independent cloud provider settings are missing: ${JSON.stringify(cloudSettings.settings)}`)
  }
  if (cloudSettings.settings.textBaseUrl !== 'https://smoke-text.example.com/v1'
    || cloudSettings.settings.visionBaseUrl !== 'https://smoke-vision.example.com/v1'
    || !cloudSettings.settings.hasTextApiKey
    || !cloudSettings.settings.hasVisionApiKey) {
    throw new Error(`Independent provider persistence or secure credentials failed: ${JSON.stringify(cloudSettings.settings)}`)
  }
  if (!cloudSettings.pageText.includes('文本分析服务') || !cloudSettings.pageText.includes('视觉分析服务')) {
    throw new Error('Independent text and vision provider controls did not render')
  }
  if (!cloudSettings.pageText.includes('演示资料管理') || !cloudSettings.pageText.includes('查看并清除')) {
    throw new Error('Demo cleanup controls did not render')
  }
  if (!demo.ok) throw new Error(`Demo/search IPC checks failed: ${demo.error}`)
  if (!expectedSnapshot) {
    if (!demo.aiWorks.length || !demo.financeWorks.length) throw new Error('Short-term work search returned no results')
    if (!demo.technologyCreators.length || demo.namedCreators.length !== 1) throw new Error('Creator domain/name search returned no results')
    if (!demo.detail?.is_demo || !demo.detail.workDomains?.includes('科技') || !demo.detail.creatorDomains?.includes('科技')) {
      throw new Error(`Demo detail classification is incomplete: ${JSON.stringify(demo.detail)}`)
    }
    if (demo.nullableMetric?.collectCount !== null) throw new Error('Demo nullable metric example is missing')
  }
  await send('Page.reload', { ignoreCache: true })
  await new Promise((resolveWait) => setTimeout(resolveWait, 800))
  const commentAuditUiResponse = await send('Runtime.evaluate', {
    expression: `(async () => {
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('今日收件箱'))?.click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      [...document.querySelectorAll('.segmented button')].find((button) => button.textContent?.trim() === '全部')?.click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      document.querySelector('.work-card .detail-button')?.click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      return JSON.stringify({ text: document.querySelector('.work-drawer')?.textContent || '', cards: document.querySelectorAll('.comment-audit-card').length })
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const commentAuditUiValue = commentAuditUiResponse.result?.result?.value
  if (typeof commentAuditUiValue !== 'string') throw new Error(`Comment audit UI evaluation failed: ${JSON.stringify(commentAuditUiResponse)}`)
  const commentAuditUi = JSON.parse(commentAuditUiValue)
  if (!commentAuditUi.cards
    || !commentAuditUi.text.includes('采集评论')
    || !commentAuditUi.text.includes('公开作者')
    || !commentAuditUi.text.includes('评论 ID')
    || !commentAuditUi.text.includes('ID 来源')
    || !commentAuditUi.text.includes('采集时间')
    || !commentAuditUi.text.includes('所属作品')
    || (!commentAuditUi.text.includes('来源已验证') && !commentAuditUi.text.includes('来源未验证'))
    || !commentAuditUi.text.includes('打开所属作品原页')) {
    throw new Error(`Auditable comment detail UI is incomplete: ${JSON.stringify(commentAuditUi)}`)
  }
  await send('Runtime.evaluate', { expression: `document.querySelector('.work-drawer .drawer-head button')?.click(); [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '设置')?.click()` })
  await new Promise((resolveWait) => setTimeout(resolveWait, 300))
  if (expectedSnapshot) {
    const actualSnapshot = {
      creators: demo.allCreators.length,
      works: demo.allWorksCount,
      starred: demo.allCreators.filter((creator) => creator.isStarred).length,
      notes: demo.allCreators.filter((creator) => creator.note).length
    }
    if (JSON.stringify(actualSnapshot) !== JSON.stringify(expectedSnapshot)) {
      throw new Error(`Existing library changed during upgrade smoke test: expected ${JSON.stringify(expectedSnapshot)}, got ${JSON.stringify(actualSnapshot)}`)
    }
  }

  let demoCleanup = 'not-requested'
  if (!expectedSnapshot) {
    if (process.env.SIGNAL_DESK_SMOKE_CLEANUP_CARD_SCREENSHOT || process.env.SIGNAL_DESK_SMOKE_CONFIRM_SCREENSHOT) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 720, deviceScaleFactor: 1, mobile: false })
    }
    if (process.env.SIGNAL_DESK_SMOKE_CLEANUP_CARD_SCREENSHOT) {
      await send('Runtime.evaluate', {
        expression: `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('查看并清除'))?.scrollIntoView({ block: 'center' })`
      })
      await new Promise((resolveWait) => setTimeout(resolveWait, 150))
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(resolve(process.env.SIGNAL_DESK_SMOKE_CLEANUP_CARD_SCREENSHOT), Buffer.from(screenshot.result.data, 'base64'))
    }
    const cleanupConfirmResponse = await send('Runtime.evaluate', {
      expression: `(async () => {
        const trigger = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('查看并清除'))
        trigger?.click()
        await new Promise((resolveWait) => setTimeout(resolveWait, 150))
        const modal = document.querySelector('.danger-modal')
        const checkbox = modal?.querySelector('input[type="checkbox"]')
        const clearButton = [...(modal?.querySelectorAll('button') || [])].find((button) => button.textContent?.includes('清除演示资料'))
        return JSON.stringify({
          modalText: modal?.textContent || '',
          checkboxChecked: checkbox instanceof HTMLInputElement ? checkbox.checked : null,
          clearButtonDisabled: clearButton instanceof HTMLButtonElement ? clearButton.disabled : null
        })
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    const cleanupConfirm = JSON.parse(cleanupConfirmResponse.result.result.value)
    if (!cleanupConfirm.modalText.includes('确认清除演示资料')
      || !cleanupConfirm.modalText.includes('演示博主6')
      || !cleanupConfirm.modalText.includes('演示作品24')
      || !cleanupConfirm.modalText.includes('演示评论120')
      || cleanupConfirm.checkboxChecked !== false
      || cleanupConfirm.clearButtonDisabled !== true) {
      throw new Error(`Demo cleanup confirmation is incomplete or unsafe: ${JSON.stringify(cleanupConfirm)}`)
    }
    if (process.env.SIGNAL_DESK_SMOKE_CONFIRM_SCREENSHOT) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 150))
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(resolve(process.env.SIGNAL_DESK_SMOKE_CONFIRM_SCREENSHOT), Buffer.from(screenshot.result.data, 'base64'))
    }
    await send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('.danger-modal button')].find((button) => button.textContent?.trim() === '取消')?.click()`
    })

    const cleanupResponse = await send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const before = await window.signalDesk.getDemoSummary()
          const removed = await window.signalDesk.clearDemo()
          const after = await window.signalDesk.getDemoSummary()
          const dashboard = await window.signalDesk.getDashboard()
          return JSON.stringify({ ok: true, before, removed, after, dashboard })
        } catch (error) {
          return JSON.stringify({ ok: false, error: String(error) })
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    const cleanup = JSON.parse(cleanupResponse.result.result.value)
    if (!cleanup.ok) throw new Error(`Demo cleanup IPC check failed: ${cleanup.error}`)
    if (cleanup.before.creatorCount !== 6 || cleanup.before.workCount !== 24 || cleanup.before.commentCount !== 120) {
      throw new Error(`Demo cleanup scope is incorrect: ${JSON.stringify(cleanup.before)}`)
    }
    if (JSON.stringify(cleanup.removed) !== JSON.stringify(cleanup.before)) throw new Error('Demo cleanup returned a different scope than the confirmed scope')
    if (cleanup.after.creatorCount || cleanup.after.workCount || cleanup.after.commentCount
      || cleanup.dashboard.followingCount || cleanup.dashboard.workCount || cleanup.dashboard.commentCount) {
      throw new Error(`Demo cleanup left records behind: ${JSON.stringify(cleanup)}`)
    }
    demoCleanup = 'ok'
  }
  if (errors.length) throw new Error(`Renderer emitted errors: ${JSON.stringify(errors)}`)

  if (process.env.SIGNAL_DESK_SMOKE_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(resolve(process.env.SIGNAL_DESK_SMOKE_SCREENSHOT), Buffer.from(screenshot.result.data, 'base64'))
  }

  console.log(JSON.stringify({ executable, preloadBridge: 'ok', renderer: 'ok', dashboardIpc: 'ok', isolatedPilotEntry: 'ok', structuredSyncGate: 'ok', cloudProviders: 'ok', demoSearch: 'ok', demoDetail: 'ok', commentAuditUi: 'ok', demoCleanup, upgradeSnapshot: expectedSnapshot ? 'ok' : 'not-requested' }, null, 2))
  await send('Runtime.evaluate', { expression: 'window.close()' })
} finally {
  socket.close()
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) return resolveExit()
    const timer = setTimeout(() => {
      child.kill()
      resolveExit()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
  await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  try {
    rmSync(testData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.warn(`Unable to remove temporary smoke-test profile ${testData}: ${String(error)}`)
  }
}
