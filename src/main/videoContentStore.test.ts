import {DatabaseSync} from 'node:sqlite'
import {describe,it,expect} from 'vitest'
import {VideoContentStore} from './videoContentStore'
import {VideoInformationStore} from './videoInformationStore'
import {videoInformationFixture} from '../shared/fixtures/videoInformationFixture'

function store(){
  const db=new DatabaseSync(':memory:'),f=videoInformationFixture();new VideoInformationStore(db);const s=new VideoContentStore(db)
  s['db'].exec(`INSERT INTO video_information_snapshots VALUES('${f.command.runId}','${f.command.runId}','${f.command.ownerSecUid}','${f.command.authorSecUid}','${f.command.workId}','${f.capture.checkedAt}','${JSON.stringify(f.capture).replaceAll("'","''")}')`)
  s['db'].exec(`INSERT INTO creator_video_information VALUES('${f.command.ownerSecUid}','${f.command.workId}','${f.command.authorSecUid}','${f.command.authorUid}', '${f.capture.checkedAt}','${f.capture.checkedAt}','${f.command.runId}')`)
  return {s,db,f}
}
describe('video content personal state',()=>{
  it('stores interest independently and keeps it after a stage result',()=>{const {s,db,f}=store();s.setInterest(f.command.ownerSecUid,f.command.workId,'interested');s.saveStage(f.command.ownerSecUid,f.command.workId,{stage:'transcript',inputHash:'a',state:'completed',result:{segments:[]}});expect(s.info(f.command.ownerSecUid).get(f.command.workId)).toMatchObject({interest:'interested',stages:{transcript:{state:'completed'}}});db.close()})
  it('rejects work from another account',()=>{const {s,db,f}=store();expect(()=>s.setInterest('other',f.command.workId,'interested')).toThrow();db.close()})
  it('keeps successful visual material readable after a later visual task fails',()=>{
    const {s,db,f}=store(),owner=f.command.ownerSecUid,work=f.command.workId
    s.saveStage(owner,work,{stage:'visual',inputHash:'old',state:'completed',result:{frames:[{id:'frame-1'}],blocks:[]}})
    s.saveStage(owner,work,{stage:'visual',inputHash:'new',state:'failed',result:null,error:'VISION_PROVIDER_HTTP_429'})
    expect(s.detail(owner,work).stages.find(s=>s.stage==='visual')).toMatchObject({state:'failed',error:'VISION_PROVIDER_HTTP_429',result:{frames:[{id:'frame-1'}]}});db.close()
  })
  it('interrupts queued and running batches without losing completed IDs',()=>{const {s,db,f}=store();const batch=s.newBatch(f.command.ownerSecUid,'process',[f.command.workId],{state:'running',completedWorkIds:[f.command.workId],message:'processing'});s.interrupt();expect(s.batch(f.command.ownerSecUid,batch.id)).toMatchObject({state:'interrupted',completedWorkIds:[f.command.workId]});db.close()})
})
