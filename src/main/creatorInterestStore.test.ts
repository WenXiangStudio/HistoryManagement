import {describe,it,expect} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CreatorInterestStore} from './creatorInterestStore'
import {FollowingDirectoryStore} from './followingDirectoryStore'
import type {CreatorListItem} from '../shared/contracts'

const creator=(secUid:string)=>({id:-1,isDemo:false,profileUrl:`https://www.douyin.com/user/${secUid}`,isStarred:true,note:'原批注',workCount:100} as CreatorListItem)
const input={ownerSecUid:'owner',secUid:'sec',tier:'high',revision:0}
describe('explicit creator interest membership',()=>{
  it('keeps every creator unassigned until explicitly added, regardless of stars, notes or observed works',()=>{
    const db=new DatabaseSync(':memory:'),store=new CreatorInterestStore(db)
    try{expect(store.decorate('owner',[creator('sec'),creator('other')]).map(row=>row.interest)).toEqual([{tier:null,revision:0},{tier:null,revision:0}])
      expect(db.prepare('SELECT * FROM creator_interest_memberships').all()).toEqual([])
      expect(store.update('owner',[creator('sec')],{...input,tier:null})).toEqual({tier:null,revision:0})
      expect(db.prepare('SELECT * FROM creator_interest_memberships').all()).toEqual([])
    }finally{db.close()}
  })
  it('adds only the chosen creator, moves exclusively across tiers and removes without changing source data',()=>{
    const db=new DatabaseSync(':memory:'),store=new CreatorInterestStore(db),rows=[creator('sec'),{...creator('other'),id:-2}]
    const before=structuredClone(rows)
    try{
      expect(store.update('owner',rows,input)).toEqual({tier:'high',revision:1})
      expect(store.decorate('owner',rows).map(row=>row.interest?.tier)).toEqual(['high',null])
      expect(store.update('owner',rows,{...input,tier:'medium',revision:1})).toEqual({tier:'medium',revision:2})
      expect(store.update('owner',rows,{...input,tier:'weak',revision:2})).toEqual({tier:'weak',revision:3})
      expect(store.update('owner',rows,{...input,tier:null,revision:3})).toEqual({tier:null,revision:4})
      expect(store.decorate('owner',rows).map(row=>row.interest?.tier)).toEqual([null,null])
      expect(rows).toEqual(before)
      expect(db.prepare('SELECT COUNT(*) AS n FROM creator_interest_memberships').get()!.n).toBe(1)
    }finally{db.close()}
  })
  it('rejects foreign accounts, foreign creators, demo creators, invalid tiers and duplicate stale deliveries',()=>{
    const db=new DatabaseSync(':memory:'),store=new CreatorInterestStore(db),rows=[creator('sec')]
    try{
      expect(()=>store.update('other',rows,input)).toThrow('账号已切换')
      expect(()=>store.update('owner',[],input)).toThrow('不属于当前账号')
      expect(()=>store.update('owner',[{...rows[0],isDemo:true}],input)).toThrow('不属于当前账号')
      expect(()=>store.update('owner',rows,{...input,tier:'low'})).toThrow()
      store.update('owner',rows,input)
      expect(()=>store.update('owner',rows,input)).toThrow('已发生变化')
      expect(store.update('owner',rows,{...input,revision:1})).toEqual({tier:'high',revision:1})
      expect(store.decorate('other',rows)[0].interest).toEqual({tier:null,revision:0})
      store.update('other',rows,{...input,ownerSecUid:'other',tier:'weak'})
      expect(store.decorate('owner',rows)[0].interest?.tier).toBe('high')
      expect(store.decorate('other',rows)[0].interest?.tier).toBe('weak')
    }finally{db.close()}
  })
  it('survives restart, renaming, later partial and empty syncs; preserves creator rows, stars and notes',()=>{
    const root=mkdtempSync(join(tmpdir(),'creator-interest-')),path=join(root,'following.sqlite')
    let directory=new FollowingDirectoryStore(path)
    try{
      const owner={uid:'owner-uid',secUid:'owner',nickname:'账号'},row={uid:'uid',secUid:'sec',nickname:'原昵称',avatarUrl:null,signature:'简介',profileUrl:'https://www.douyin.com/user/sec'}
      directory.recordAccount(owner);directory.selectAccount('owner');directory.savePlanRows('one',owner,'2026-10-14T00:00:00Z',[row])
      directory.update(directory.list()[0].id,{isStarred:true,note:'保留批注'})
      const before=directory.db.prepare('SELECT * FROM visible_directory_creators').all()
      new CreatorInterestStore(directory.db).update('owner',directory.list(),input)
      expect(directory.db.prepare('SELECT * FROM visible_directory_creators').all()).toEqual(before)
      directory.close();directory=new FollowingDirectoryStore(path);directory.selectAccount('owner')
      directory.savePlanRows('two',owner,'2026-10-15T00:00:00Z',[{...row,nickname:'新昵称'}]);directory.savePlanRows('empty',owner,'2026-10-15T01:00:00Z',[])
      expect(new CreatorInterestStore(directory.db).decorate('owner',directory.list())[0]).toMatchObject({nickname:'新昵称',isStarred:true,note:'保留批注',interest:{tier:'high',revision:1}})
      expect(directory.db.prepare("SELECT * FROM visible_directory_creators WHERE run_id='one'").all()).toEqual(before)
    }finally{directory.close();rmSync(root,{recursive:true,force:true})}
  })
})
