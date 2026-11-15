// Replays the user's already captured response in a database copy; no browser requests or production writes.
import {DatabaseSync} from 'node:sqlite'
import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {CreatorActivityService} from '../src/main/creatorActivityService'
import {creatorPublicationInterval} from '../src/shared/creatorPublicationInterval'
import type {CreatorActivityCapture} from '../src/shared/creatorActivity'

const out=resolve('local-data/creator-profile-attribution-20261013')
mkdirSync(out,{recursive:true})
const replayFile=join(out,'replay.sqlite')
copyFileSync(join(out,'before','following-directory.sqlite'),replayFile)
const db=new DatabaseSync(replayFile)
try{
  const raw=db.prepare('SELECT id,capture_json FROM creator_activity_snapshots WHERE id=997').get()!
  const capture=JSON.parse(String(raw.capture_json)) as CreatorActivityCapture
  const creator=db.prepare('SELECT id,nickname FROM visible_directory_creators WHERE sec_uid=?').get(capture.requestedSecUid)!
  const service=new CreatorActivityService(db,()=>{})
  const sourceBefore=String(raw.capture_json)
  const target={id:-1000000000-Number(creator.id),secUid:capture.profile.secUid,uid:capture.profile.uid,nickname:String(creator.nickname)}
  const run=service.begin(capture.ownerSecUid,[target],target.id)!
  assert.equal(run.targets[0].needsBaseline,true)
  const attributed:CreatorActivityCapture={...capture,contract:'signaldesk-creator-activity/v9',pages:capture.pages.map(page=>({...page,
    records:page.records!.map(record=>({...record,profileOwner:{uid:capture.profile.uid,secUid:capture.profile.secUid}}))}))}
  service.receive(run.runId,target.id,attributed);service.progress(run.runId,{finished:true})
  const state=service.status(capture.ownerSecUid),timeline=service.workTimeline(capture.ownerSecUid,capture.profile.secUid)
  assert.equal(state.succeeded,1);assert.equal(state.failed,0);assert.equal(timeline.works.length,3)
  assert.ok(timeline.works.every(work=>work.sourceAuthor?.uid==='245886753711368'))
  const interval=creatorPublicationInterval([{authorUid:capture.profile.uid,authorSecUid:capture.profile.secUid,observedAt:capture.checkedAt,pages:attributed.pages}],capture.profile.uid,capture.profile.secUid)
  assert.equal(interval.workCount,3);assert.ok(interval.meanHours!==null)
  assert.equal(db.prepare('SELECT capture_json FROM creator_activity_snapshots WHERE id=997').get()!.capture_json,sourceBefore)
  const report={at:new Date().toISOString(),sourceSnapshot:997,nickname:creator.nickname,baselineBuilt:true,successes:1,failures:0,
    profileWorks:3,sourcePrimaryAuthor:'独夫之心',sourcePrimaryAuthorRetained:true,meanHours:interval.meanHours,
    rawSnapshotUnchanged:true,productionWrites:false,newBrowserRequests:0}
  writeFileSync(join(out,'real-response-replay.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{db.close()}
