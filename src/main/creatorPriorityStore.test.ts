import {describe,it,expect} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CreatorPriorityStore} from './creatorPriorityStore'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import type {CreatorListItem} from '../shared/contracts'
import {effectiveCreatorTier,creatorsForRefreshScope} from '../shared/creatorRefreshPolicy'
const creator=(secUid:string,hours:number|null)=>({id:-1,isDemo:false,nickname:secUid,profileUrl:`https://www.douyin.com/user/${secUid}`,activity:{publicationInterval:{meanHours:hours},recentActivity:{status:'updated',checkedAt:'2026-10-09T04:00:00Z',latestPublishedAt:'2026-10-08T04:00:00Z'}}} as CreatorListItem)
describe('manual creator priority',()=>{
  it('migrates three-tier storage preserving the exact existing manual setting, revision and timestamp',()=>{
    const db=new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE creator_refresh_priorities(owner_sec_uid TEXT NOT NULL,creator_sec_uid TEXT NOT NULL,mode TEXT CHECK(mode IN ('boost','reduce')),tier TEXT CHECK(tier IN ('active','regular','inactive')),revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL,CHECK((mode IS NULL AND tier IS NULL) OR (mode IS NOT NULL AND tier IS NOT NULL)),PRIMARY KEY(owner_sec_uid,creator_sec_uid)) STRICT;
      INSERT INTO creator_refresh_priorities VALUES('owner','sec','reduce','regular',3,'2026-10-09T04:00:00.000Z');`)
    try{const before=db.prepare('SELECT * FROM creator_refresh_priorities').all(),store=new CreatorPriorityStore(db)
      expect(db.prepare('SELECT * FROM creator_refresh_priorities').all()).toEqual(before)
      store.update('owner',[creator('sec',31*24)],{ownerSecUid:'owner',secUid:'sec',mode:null,revision:3})
      const boundary=store.update('owner',[creator('sec',31*24)],{ownerSecUid:'owner',secUid:'sec',mode:'reduce',revision:4})
      expect(boundary).toEqual({mode:null,tier:null,revision:4})
    }finally{db.close()}
  })
  it.each([[24,'reduce','regular'],[14*24,'boost','active'],[14*24,'reduce','inactive'],[30*24,'boost','regular'],[30*24,'reduce','dormant'],[null,'boost','regular'],[null,'reduce','dormant'],[0,'reduce','regular']] as const)('stores one step from %s hours with %s as %s',(hours,mode,tier)=>{
    const db=new DatabaseSync(':memory:'),store=new CreatorPriorityStore(db),rows=[creator('sec',hours)]
    try{expect(store.decorate('owner',rows)[0].refreshPriority).toEqual({mode:null,tier:null,revision:0})
      const saved=store.update('owner',rows,{ownerSecUid:'owner',secUid:'sec',mode,revision:0});expect(saved).toEqual({mode,tier,revision:1})
      expect(effectiveCreatorTier(store.decorate('owner',rows)[0])).toBe(tier)
    }finally{db.close()}
  })
  it('moves members out of the old group, keeps the chosen tier while source changes, and restores the latest automatic tier on disable',()=>{
    const db=new DatabaseSync(':memory:'),store=new CreatorPriorityStore(db)
    try{
      let rows=[creator('A',14*24),{...creator('B',24),id:-2}]
      store.update('owner',rows,{ownerSecUid:'owner',secUid:'A',mode:'boost',revision:0})
      store.update('owner',rows,{ownerSecUid:'owner',secUid:'B',mode:'reduce',revision:0})
      let decorated=store.decorate('owner',rows)
      expect(creatorsForRefreshScope(decorated,'active').map(c=>c.nickname)).toEqual(['A'])
      expect(creatorsForRefreshScope(decorated,'regular').map(c=>c.nickname)).toEqual(['B'])
      expect(creatorsForRefreshScope(decorated,'all')).toHaveLength(2)
      rows=[creator('A',40*24),{...creator('B',null),id:-2}];decorated=store.decorate('owner',rows)
      expect(decorated.map(effectiveCreatorTier)).toEqual(['active','regular'])
      store.update('owner',rows,{ownerSecUid:'owner',secUid:'A',mode:null,revision:1})
      store.update('owner',rows,{ownerSecUid:'owner',secUid:'B',mode:null,revision:1})
      expect(store.decorate('owner',rows).map(effectiveCreatorTier)).toEqual(['dormant','unknown'])
    }finally{db.close()}
  })
  it('isolates account ownership and rejects stale revisions, foreign creators and client-assigned tiers',()=>{
    const db=new DatabaseSync(':memory:'),store=new CreatorPriorityStore(db),rows=[creator('sec',24)],input={ownerSecUid:'owner',secUid:'sec',mode:'reduce',revision:0}
    try{
      expect(()=>store.update('other',rows,input)).toThrow('账号已切换')
      expect(()=>store.update('owner',[],input)).toThrow('不属于当前账号')
      expect(()=>store.update('owner',rows,{...input,tier:'active'})).toThrow()
      store.update('owner',rows,input)
      expect(()=>store.update('owner',rows,{...input,mode:null})).toThrow('已发生变化')
      expect(store.decorate('other',rows)[0].refreshPriority?.mode).toBeNull()
      expect(store.update('owner',rows,{...input,revision:1})).toEqual({mode:'reduce',tier:'inactive',revision:2})
      expect(()=>store.update('owner',rows,{...input,revision:1})).toThrow('已发生变化')
      expect(store.update('owner',rows,{...input,mode:'boost',revision:2})).toEqual({mode:'boost',tier:'regular',revision:3})
    }finally{db.close()}
  })
  it('steps across all four tiers, clamps both boundaries and restores the latest automatic tier explicitly',()=>{
    const db=new DatabaseSync(':memory:'),store=new CreatorPriorityStore(db),rows=[creator('sec',40*24)]
    let revision=0
    const step=(mode:'boost'|'reduce'|null)=>{const saved=store.update('owner',rows,{ownerSecUid:'owner',secUid:'sec',mode,revision});revision=saved.revision;return saved}
    try{
      expect(step('reduce')).toEqual({mode:null,tier:null,revision:0})
      expect(['boost','boost','boost'].map(()=>step('boost').tier)).toEqual(['inactive','regular','active'])
      expect(step('boost')).toEqual({mode:'boost',tier:'active',revision:3})
      expect(['reduce','reduce','reduce'].map(()=>step('reduce').tier)).toEqual(['regular','inactive','dormant'])
      expect(step('reduce')).toEqual({mode:'reduce',tier:'dormant',revision:6})
      expect(step('boost').tier).toBe('inactive')
      rows[0]=creator('sec',24)
      expect(step(null)).toEqual({mode:null,tier:null,revision:8})
      expect(effectiveCreatorTier(store.decorate('owner',rows)[0])).toBe('active')
    }finally{db.close()}
  })
  it('survives app reopen and later partial collection without modifying stars, notes or historical rows',()=>{
    const root=mkdtempSync(join(tmpdir(),'creator-priority-')),path=join(root,'following.sqlite')
    let directory=new FollowingDirectoryStore(path)
    try{
      const owner={uid:'owner-uid',secUid:'owner',nickname:'账号'},row={uid:'uid',secUid:'sec',nickname:'原昵称',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec'}
      directory.recordAccount(owner);directory.selectAccount('owner');directory.savePlanRows('one',owner,new Date().toISOString(),[row])
      directory.update(directory.list()[0].id,{isStarred:true,note:'保留批注'})
      const store=new CreatorPriorityStore(directory.db),old=directory.db.prepare('SELECT * FROM visible_directory_creators').all()
      store.update('owner',[creator('sec',14*24)],{ownerSecUid:'owner',secUid:'sec',mode:'boost',revision:0})
      expect(directory.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(old)
      directory.close();directory=new FollowingDirectoryStore(path);directory.selectAccount('owner')
      directory.savePlanRows('two',owner,new Date().toISOString(),[{...row,nickname:'新昵称'}]);directory.savePlanRows('empty',owner,new Date().toISOString(),[])
      const restored=new CreatorPriorityStore(directory.db).decorate('owner',directory.list())[0]
      expect(restored).toMatchObject({nickname:'新昵称',isStarred:true,note:'保留批注',refreshPriority:{mode:'boost',tier:'active',revision:1}})
      expect(directory.db.prepare('SELECT * FROM visible_directory_creators WHERE run_id=?').all('one')).toEqual(old)
    }finally{directory.close();rmSync(root,{recursive:true,force:true})}
  })
})
