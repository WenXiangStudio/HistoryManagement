import {DatabaseSync} from 'node:sqlite'
import {it,expect,vi} from 'vitest'
import {VideoInformationStore} from './videoInformationStore'
import {VideoContentStore} from './videoContentStore'
import {VideoDiscoveryService} from './videoDiscoveryService'
import {videoInformationFixture} from '../shared/fixtures/videoInformationFixture'
import type {VideoDiscoveryCommand} from '../shared/videoDiscovery'
import type {CreatorListItem} from '../shared/contracts'

function setup(){
  const db=new DatabaseSync(':memory:'),videos=new VideoInformationStore(db),content=new VideoContentStore(db),f=videoInformationFixture()
  const creator={id:-1,nickname:'作者',nativeUid:f.command.authorUid,profileUrl:'https://www.douyin.com/user/'+f.command.authorSecUid,isDemo:false} as CreatorListItem
  let command:VideoDiscoveryCommand
  const service=new VideoDiscoveryService(content,videos,()=>[creator],c=>{command=c},()=>{})
  const date=f.capture.work.publishedAt.slice(0,10)
  const batch=service.begin(f.command.ownerSecUid,f.command.ownerUid,{ownerSecUid:f.command.ownerSecUid,creatorIds:[-1],startDate:date,endDate:date})
  const page=(hasMore=false)=>{
    const time=new Date().toISOString(),work=f.capture.work
    return {runId:command.runId,batchId:batch.id,creatorId:-1,checkedAt:time,
      ownerVerification:{...f.capture.ownerVerification,runId:command.runId,observedAt:time,navigationStartedAt:command.startedAt},
      sourceProof:{...f.capture.sourceProof,observedAt:time,requestCursor:command.cursor},
      page:{status_code:0 as const,has_more:hasMore,max_cursor:hasMore?100:0,records:[{workId:work.workId,publishedAt:work.publishedAt,pinned:false,visibility:'public',awemeType:0}],works:[work]}}
  }
  return {db,videos,content,f,service,batch,page,command:()=>command!}
}
it('finds date range and preserves interest when the same video is rediscovered',()=>{
  const x=setup();x.service.receive(x.page());x.content.setInterest(x.f.command.ownerSecUid,x.f.command.workId,'interested')
  expect(x.batch.state).toBe('completed');expect(x.videos.list(x.f.command.ownerSecUid)).toHaveLength(1)
  expect(x.content.detail(x.f.command.ownerSecUid,x.f.command.workId).interest).toBe('interested');x.db.close()
})
it('rejects conflicting authors before saving a page',()=>{
  const x=setup(),p=x.page();p.page.works[0]={...p.page.works[0],authorUid:'wrong'}
  expect(()=>x.service.receive(p)).toThrow('VIDEO_DISCOVERY_WORK_MISMATCH');expect(x.videos.list(x.f.command.ownerSecUid)).toHaveLength(0);x.service.cancel();x.db.close()
})
it('an old pinned video does not end the date range',()=>{
  const x=setup(),p=x.page(true);p.page.records.unshift({workId:'7000000000000000009',publishedAt:'2020-01-01T00:00:00.000Z',pinned:true,visibility:'public',awemeType:0})
  expect(x.service.receive(p)).toEqual({stop:false});expect(x.batch.state).toBe('running');expect(x.batch.discovery?.cursor).toBe(100);x.service.cancel();x.db.close()
})
it('migration keeps historical captures and permits multiple works in one run',()=>{
  const db=new DatabaseSync(':memory:'),f=videoInformationFixture()
  db.exec(`CREATE TABLE video_information_snapshots(run_id TEXT PRIMARY KEY,owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,checked_at TEXT NOT NULL,capture_json TEXT NOT NULL) STRICT;
    CREATE TABLE creator_video_information(owner_sec_uid TEXT NOT NULL,work_id TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,author_uid TEXT NOT NULL,checked_at TEXT NOT NULL,first_collected_at TEXT NOT NULL,run_id TEXT NOT NULL,PRIMARY KEY(owner_sec_uid,work_id),FOREIGN KEY(run_id) REFERENCES video_information_snapshots(run_id)) STRICT;`)
  db.prepare('INSERT INTO video_information_snapshots VALUES(?,?,?,?,?,?)').run(f.command.runId,f.command.ownerSecUid,f.command.authorSecUid,f.command.workId,f.time,JSON.stringify(f.capture))
  db.prepare('INSERT INTO creator_video_information VALUES(?,?,?,?,?,?,?)').run(f.command.ownerSecUid,f.command.workId,f.command.authorSecUid,f.command.authorUid,f.time,f.time,f.command.runId)
  const store=new VideoInformationStore(db)
  expect(store.list(f.command.ownerSecUid)[0].firstCollectedAt).toBe(f.time)
  store.saveDiscovered(f.command.ownerSecUid,'batch-run',{...f.capture.work,workId:'7000000000000000002'},f.time,f.capture.sourceProof)
  store.saveDiscovered(f.command.ownerSecUid,'batch-run',{...f.capture.work,workId:'7000000000000000003'},f.time,f.capture.sourceProof)
  expect(store.list(f.command.ownerSecUid)).toHaveLength(3);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);db.close()
})
