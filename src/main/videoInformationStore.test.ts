import {DatabaseSync} from 'node:sqlite'
import {describe,it,expect} from 'vitest'
import {VideoInformationStore} from './videoInformationStore'
import {acceptVideoInformation} from '../shared/videoInformation'
import {videoInformationFixture} from '../shared/fixtures/videoInformationFixture'

describe('video information ownership and persistence',()=>{
  it('lists all saved authors for one account without changing creator-specific reads',()=>{
    const db=new DatabaseSync(':memory:'),store=new VideoInformationStore(db),{command,capture,time}=videoInformationFixture()
    store.save(command,capture,time)
    const nextCommand={...command,runId:'second-author',authorUid:'second-uid',authorSecUid:'second-sec',workId:'7000000000000000002'},next=structuredClone(capture)
    next.ownerVerification.runId=nextCommand.runId;next.ownerVerification.firstAuthorSecUid=nextCommand.authorSecUid
    next.sourceProof.secUid=nextCommand.authorSecUid;next.work.authorUid=nextCommand.authorUid;next.work.authorSecUid=nextCommand.authorSecUid;next.work.workId=nextCommand.workId
    store.save(nextCommand,next,time)
    expect(store.list(command.ownerSecUid)).toHaveLength(2)
    expect(store.list(command.ownerSecUid,command.authorSecUid)).toHaveLength(1)
    expect(store.list('foreign')).toEqual([]);db.close()
  })
  it('retains exact counts, missing values and all original records while updating the same video',()=>{
    const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE authors(id INTEGER PRIMARY KEY,starred INTEGER,note TEXT);INSERT INTO authors VALUES(1,1,'保留批注')")
    const store=new VideoInformationStore(db),{command,capture,time}=videoInformationFixture()
    store.save(command,capture,time);store.save(command,capture,time)
    expect(store.list(command.ownerSecUid,command.authorSecUid)).toMatchObject([{statistics:{likeCount:12345,commentCount:0,collectCount:null}}])
    const next=structuredClone(capture),nextCommand={...command,runId:'next'}
    next.ownerVerification.runId='next';next.checkedAt='2026-10-02T00:00:00.000Z';next.work.statistics.likeCount=13001
    store.save(nextCommand,next,time)
    const rows=store.list(command.ownerSecUid,command.authorSecUid)
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({firstCollectedAt:time,checkedAt:next.checkedAt,statistics:{likeCount:13001}})
    expect(db.prepare('SELECT COUNT(*) AS n FROM video_information_snapshots').get()?.n).toBe(2)
    expect(db.prepare('SELECT * FROM authors').get()).toMatchObject({starred:1,note:'保留批注'});db.close()
  })
  it('isolates identical works by account, rejects foreign author data and never replaces a newer snapshot with an older one',()=>{
    const db=new DatabaseSync(':memory:'),store=new VideoInformationStore(db),{command,capture,time}=videoInformationFixture()
    store.save(command,capture,time)
    expect(store.list(command.ownerSecUid)).toHaveLength(1)
    expect(store.list('other')).toEqual([])
    expect(store.list('other',command.authorSecUid)).toEqual([]);expect(store.list(command.ownerSecUid,'other')).toEqual([])
    const foreign=structuredClone(capture);foreign.work.authorSecUid='other';expect(()=>store.save(command,foreign,time)).toThrow()
    const otherCommand={...command,runId:'owner-two',ownerSecUid:'owner-two'},other=structuredClone(capture)
    other.ownerVerification.runId='owner-two';other.ownerVerification.secUid='owner-two'
    store.save(otherCommand,other,time);expect(store.list('owner-two',command.authorSecUid)).toHaveLength(1)
    expect(store.list(command.ownerSecUid).map(row=>row.runId)).toEqual([command.runId])
    expect(store.list('owner-two').map(row=>row.runId)).toEqual(['owner-two'])
    const oldCommand={...command,runId:'older'},old=structuredClone(capture);old.ownerVerification.runId='older';old.checkedAt='2026-09-30T23:59:59.000Z'
    for(const key of ['observedAt','navigationStartedAt'] as const)old.ownerVerification[key]=old.checkedAt
    old.sourceProof.observedAt=old.checkedAt;old.work.statistics.likeCount=1
    store.save(oldCommand,old,old.checkedAt)
    expect(store.list(command.ownerSecUid,command.authorSecUid)[0].statistics.likeCount).toBe(12345);db.close()
  })
  it('rejects contradictory origin, owner, time, non-public status and fabricated titles',()=>{
    for(const edit of [(x:any)=>x.ownerVerification.uid='foreign',(x:any)=>x.sourceProof.secUid='foreign',
      (x:any)=>x.work.visibility.privateStatus=1,(x:any)=>x.work.title='模型生成的标题',
      (x:any)=>x.sourceProof.kind='active-get',(x:any)=>x.sourceProof.observedAt='2026-09-29T00:00:00.000Z',
      (x:any)=>x.work.statistics.likeCount=-1,(x:any)=>x.cookie='never store']){
      const {command,capture,time}=videoInformationFixture();edit(capture);expect(()=>acceptVideoInformation(capture,command,time)).toThrow()
    }
  })
  it('preserves completed records and marks interrupted runs after restart',()=>{
    const db=new DatabaseSync(':memory:'),store=new VideoInformationStore(db),{command,capture,time}=videoInformationFixture()
    store.save(command,capture,time);store.saveState(command,{phase:'running',runId:command.runId,ownerSecUid:command.ownerSecUid,creatorId:command.creatorId,message:'读取中'})
    store.interruptRuns();expect(store.latestState(command.ownerSecUid)).toMatchObject({phase:'blocked',errorCode:'VIDEO_APP_RESTARTED'})
    expect(store.list(command.ownerSecUid,command.authorSecUid)).toHaveLength(1);db.close()
  })
})
