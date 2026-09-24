import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pilotSummary, pilotTabDisposition } from '../../../browser-connector/extension/r8-homepage-pilot-presentation.js'

test('verified pilot keeps work tab for human comparison and shows one work ID', () => {
  const result = { status: 'verified', verifiedWork: { workId: '1234567890123' }, candidates: [{}, {}] }
  assert.deepEqual(pilotTabDisposition(result, 42), { keep: true, tabId: 42 })
  assert.deepEqual(pilotSummary(result, 42, 'C:\Temp\pilot'), {
    status: 'verified', verifiedWorkId: '1234567890123', candidateCount: 2,
    reason: null, retainedTabId: 42, reportDirectory: 'C:\Temp\pilot'
  })
})

test('blocked pilot closes its test tab and never presents a verified work', () => {
  const result = { status: 'blocked', reason: 'PAGE_SECURITY_OR_LOGIN_PROMPT',
    verifiedWork: null, candidates: [] }
  assert.deepEqual(pilotTabDisposition(result, 42), { keep: false, tabId: null })
  assert.equal(pilotSummary(result, 42, '').retainedTabId, null)
})
