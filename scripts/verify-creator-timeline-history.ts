// Local historical replay on an isolated database backup; no browser navigation or model calls.
import {backup,DatabaseSync} from 'node:sqlite'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {CreatorActivityService} from '../src/main/creatorActivityService'

const userData=join(process.env.LOCALAPPDATA!,'SignalDeskFollowingReview'),out=resolve('local-data/creator-time-baseline-20261013')
mkdirSync(out,{recursive:true})
const target=join(out,'history-replay-'+Date.now()+'.sqlite'),source=new DatabaseSync(join(userData,'following-directory.sqlite'),{readOnly:true})
await backup(source,target);source.close()
const db=new DatabaseSync(target),hash=(text:string)=>createHash('sha256').update(text).digest('hex')
const before=hash(JSON.stringify(db.prepare('SELECT * FROM creator_activity_snapshots ORDER BY id').all()))
const owner=JSON.parse(readFileSync(join(userData,'following-settings.json'),'utf8')).activeOwnerSecUid
const started=performance.now(),service=new CreatorActivityService(db,()=>{}),elapsed=performance.now()-started
const records=[]
for(const name of ['曲木古也','foyege','杰森Jason']){
  const creator=db.prepare('SELECT sec_uid,nickname FROM visible_directory_creators WHERE nickname=?').get(name)!
  const state=service.workTimeline(owner,String(creator.sec_uid))
  const review=db.prepare('SELECT snapshot_id FROM creator_activity_reviews WHERE owner_sec_uid=? AND creator_sec_uid=? AND resolved_snapshot_id IS NULL ORDER BY snapshot_id DESC LIMIT 1').get(owner,creator.sec_uid)
  const event=review?db.prepare("SELECT payload_json FROM creator_work_timeline_events WHERE source_kind='snapshot' AND source_id=?").get(review.snapshot_id):null
  const comparison=event?JSON.parse(String(event.payload_json)).comparison:null
  records.push({author:name,comparison,observation:state.observation,totalRetained:state.works.length,invalid:state.works.filter(w=>w.state==='invalid').length,
    latest:state.latest,sorted:state.works.every((w,i)=>!i||w.publishedAt>=state.works[i-1].publishedAt)})
}
assert.equal(records[0].comparison.newPublicWorks,14)
assert.equal(records[1].comparison.newPublicWorks,1)
assert.equal(records[2].comparison.newPublicWorks,15)
assert.ok(records.every(r=>r.sorted))
assert.equal(hash(JSON.stringify(db.prepare('SELECT * FROM creator_activity_snapshots ORDER BY id').all())),before,'Raw history changed')
const result={at:new Date().toISOString(),database:target,migrationMs:elapsed,newModelCalls:0,newBrowserRequests:0,originalSnapshotsUnchanged:true,records}
writeFileSync(join(out,'history-replay.json'),JSON.stringify(result,null,2));db.close()
console.log(JSON.stringify(result,null,2))
