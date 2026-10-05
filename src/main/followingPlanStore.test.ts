import {describe,it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import {FollowingPlanStore} from './followingPlanStore'
import type {PlanCreator,PlanPage} from '../shared/followingPlan'
const owner={uid:'owner-uid',secUid:'owner',nickname:'原账号'}
const creators=(count:number,start=0):PlanCreator[]=>Array.from({length:count},(_,index)=>({uid:'uid-'+(index+start),secUid:'sec-'+(index+start),nickname:'博主'+(index+start),
  avatarUrl:'https://example.com/'+(index+start)+'.jpg',signature:'简介',profileUrl:'https://www.douyin.com/user/sec-'+(index+start)}))
const page=(rows:PlanCreator[],position=1,more=false):PlanPage=>({owner,position,requestCursor:position===1?0:position*100,requestOffset:0,
  nextCursor:more?(position+1)*100:null,nextOffset:0,hasMore:more,creators:rows,collectedAt:'2026-10-04T12:00:00.000Z',activeApiRequests:1})
function setup(){const directory=new FollowingDirectoryStore(':memory:');directory.recordAccount(owner);directory.selectAccount(owner.secUid);return {directory,plan:new FollowingPlanStore(directory)}}
function begin(plan:FollowingPlanStore,id='run'){plan.begin(id,owner.secUid);plan.bindOwner(id,owner,owner.secUid)}
describe('persisted following list and identity based basic queue',()=>{
  it('saves all fifteen pages of 295 creators, with no work/activity storage or automatic tasks',()=>{
    const {directory,plan}=setup()
    try{
      begin(plan)
      for(let index=0;index<15;index++)plan.page('run',page(creators(index===14?15:20,index*20),index+1,index<14))
      expect(directory.list()).toHaveLength(295);expect(plan.plan(owner.secUid)).toMatchObject({complete:true,pageCount:15,count:295})
      expect(plan.basicStatus(owner.secUid).pending).toBe(0)
      expect(directory.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%activity%' OR name LIKE '%works%' OR name LIKE '%comments%'").all()).toEqual([])
      expect(directory.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    }finally{directory.close()}
  })
  it('keeps legacy IDs, stars, notes, history and saved signatures during partial, empty and reordered refreshes',()=>{
    const directory=new FollowingDirectoryStore(':memory:'),old=creators(2).map(row=>({...row,uid:null}))
    try{
      directory.accept({contract:'signaldesk-visible-following/v1',runId:'old',collectedAt:'2026-10-01T00:00:00.000Z',ownerSecUid:null,ownerNickname:owner.nickname,
        sourceUrl:'https://www.douyin.com/user/self',sourceKind:'visible-following-list',activeFollowingTab:true,listStartedAtTop:true,hasMore:true,visibleItemCount:2,
        creators:old,projectionSha256:createHash('sha256').update(JSON.stringify(old)).digest('hex'),activeApiRequests:0,workResponseBodiesRead:0})
      const original=directory.list()[0];directory.update(original.id,{note:'保留',isStarred:true})
      directory.recordAccount(owner,{adoptLegacy:true});directory.selectAccount(owner.secUid)
      const plan=new FollowingPlanStore(directory);begin(plan)
      plan.page('run',page([{...creators(1)[0],signature:null},...creators(1,2)],1,true));plan.stop('run')
      expect(directory.list()).toHaveLength(3);expect(directory.list().find(row=>row.id===original.id)).toMatchObject({note:'保留',isStarred:true,signature:'简介',nativeUid:'uid-0'})
      begin(plan,'empty');plan.page('empty',page([]));expect(directory.list()).toHaveLength(3)
      begin(plan,'reorder');plan.page('reorder',page(creators(3).reverse()))
      expect(directory.list()).toHaveLength(3);expect(directory.list().find(row=>row.id===original.id)).toMatchObject({note:'保留',isStarred:true})
      expect(directory.db.prepare("SELECT nickname FROM visible_directory_creators WHERE run_id='old' ORDER BY id").all()).toEqual(old.map(row=>({nickname:row.nickname})))
    }finally{directory.close()}
  })
  it('distinguishes missing and empty signature, skips done identities and completes only twenty pending profiles',()=>{
    const {directory,plan}=setup()
    try{
      begin(plan)
      plan.page('run',page([...creators(25).map(row=>({...row,signature:null})),{...creators(1,25)[0],signature:''}]))
      expect(plan.basicStatus(owner.secUid).pending).toBe(25)
      const first=plan.beginBasic(owner.secUid);expect(first.targets).toHaveLength(20)
      for(const target of first.targets)plan.receiveBasic(first.runId,target.secUid,{ownerSecUid:owner.secUid,creator:{...target,signature:''},collectedAt:'2026-10-04T12:05:00.000Z',source:'profile-other',activeApiRequests:1})
      plan.basicProgress(first.runId,{finished:true});expect(plan.basicStatus(owner.secUid).pending).toBe(5)
      const second=plan.beginBasic(owner.secUid);expect(second.targets.map(row=>row.uid)).toEqual(creators(5,20).map(row=>row.uid))
      plan.cancelBasic();expect(plan.basicStatus(owner.secUid).pending).toBe(5)
      expect(()=>plan.receiveBasic(second.runId,second.targets[0].secUid,undefined,'FAIL')).toThrow('会话')
    }finally{directory.close()}
  })
  it('preserves page checkpoints and completed profiles across a restart without using row position as identity',()=>{
    const root=mkdtempSync(join(tmpdir(),'following-plan-')),path=join(root,'directory.sqlite')
    try{
      let directory=new FollowingDirectoryStore(path);directory.recordAccount(owner);directory.selectAccount(owner.secUid)
      let plan=new FollowingPlanStore(directory);begin(plan)
      plan.page('run',page(creators(20),1,true));directory.close()
      directory=new FollowingDirectoryStore(path);directory.selectAccount(owner.secUid);plan=new FollowingPlanStore(directory)
      expect(plan.plan(owner.secUid)).toMatchObject({resumable:true,complete:false,count:20,nextCursor:200})
      expect(plan.begin('run',owner.secUid,true)).toEqual({cursor:200,offset:0,pageCount:1})
      plan.bindOwner('run',owner,owner.secUid);plan.page('run',page(creators(5,20).map(row=>({...row,signature:null})),2))
      const basic=plan.beginBasic(owner.secUid);plan.receiveBasic(basic.runId,basic.targets[0].secUid,{ownerSecUid:owner.secUid,creator:{...basic.targets[0],signature:'新简介'},collectedAt:'2026-10-04T12:03:00.000Z',source:'profile-other',activeApiRequests:1});directory.close()
      directory=new FollowingDirectoryStore(path);directory.selectAccount(owner.secUid);plan=new FollowingPlanStore(directory)
      expect(plan.basicStatus(owner.secUid)).toMatchObject({phase:'cancelled',pending:4})
      expect(plan.beginBasic(owner.secUid).targets.map(row=>row.secUid)).not.toContain(basic.targets[0].secUid)
      directory.close()
    }finally{rmSync(root,{recursive:true,force:true})}
  })
  it('rejects wrong owners, discontinuous/repeated cursors, identity conflicts and stale reports before saving',()=>{
    const {directory,plan}=setup()
    try{
      begin(plan)
      expect(()=>plan.page('run',{...page(creators(1)),owner:{...owner,uid:'wrong'}})).toThrow('账号')
      expect(()=>plan.page('run',{...page(creators(1)),requestOffset:20})).toThrow('连续')
      plan.page('run',page(creators(1),1,true))
      expect(()=>plan.page('run',page([{...creators(1)[0],uid:'different'}],2))).toThrow('冲突')
      expect(()=>plan.page('run',{...page(creators(1,1),2,true),nextCursor:0})).toThrow('推进')
      expect(directory.list()).toHaveLength(1)
      plan.stop('run');expect(()=>plan.page('run',page(creators(1,1),2))).toThrow('会话')
    }finally{directory.close()}
  })
})
