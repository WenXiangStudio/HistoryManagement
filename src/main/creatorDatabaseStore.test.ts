import {describe,it,expect} from 'vitest'
import {DatabaseSync} from 'node:sqlite'
import {CreatorDatabaseStore} from './creatorDatabaseStore'
import {DEFAULT_CREATOR_DATABASE_COLUMNS,type CreatorDatabaseAction} from '../shared/creatorDatabase'
import type {CreatorListItem} from '../shared/contracts'
const creator={id:-1,nickname:'原昵称',profileUrl:'https://www.douyin.com/user/sec',isDemo:false,
  activity:{workCount:20,latestPublishedAt:null,refreshSchedule:{latestKnownPublishedAt:'2026-10-01T17:00:00.000Z',tier:'regular'},publicationInterval:{meanHours:49.5}}} as CreatorListItem
function fixture(){const db=new DatabaseSync(':memory:'),store=new CreatorDatabaseStore(db)
  const edit=(action:CreatorDatabaseAction,owner='owner',rows=[creator])=>store.update(owner,rows,{...action,ownerSecUid:owner,revision:store.view(owner,rows).revision})
  return {db,store,edit}}
describe('creator database structure and read-only source fields',()=>{
  it('rejects writes to all five source fields including reset and retains original automatic values',()=>{
    const f=fixture();try{
      for(const column of DEFAULT_CREATOR_DATABASE_COLUMNS){
        expect(()=>f.edit({action:'set-cell',secUid:'sec',columnId:column.id,value:null})).toThrow('不支持手动修改')
        expect(()=>f.edit({action:'reset-cell',secUid:'sec',columnId:column.id})).toThrow('不支持手动修改')
      }
      expect(f.store.view('owner',[creator]).revision).toBe(0)
      expect(f.store.view('owner',[creator]).rows[0].values).toEqual({nickname:'原昵称',lastPublishedDate:'2026-10-02',workCount:20,intervalHours:49.5,tier:'regular'})
    }finally{f.db.close()}
  })
  it('preserves historical built-in overrides in storage but reads current source data',()=>{
    const f=fixture();try{
      const saved={columns:DEFAULT_CREATOR_DATABASE_COLUMNS,cells:{sec:{nickname:'旧手动名',workCount:999}}},json=JSON.stringify(saved)
      f.db.prepare('INSERT INTO creator_database_tables VALUES(?,?,?)').run('owner',1,json)
      const view=f.store.view('owner',[creator]);expect(view.rows[0].values.nickname).toBe('原昵称');expect(view.rows[0].values.workCount).toBe(20);expect(view.rows[0].manualColumns).toEqual([])
      expect(f.db.prepare('SELECT table_json FROM creator_database_tables').get()!.table_json).toBe(json)
    }finally{f.db.close()}
  })
  it('atomically renames and formats built-in headers, reorders columns and preserves settings across reopen',()=>{
    const f=fixture();try{
      f.edit({action:'format-column',columnId:'workCount',name:'公开作品数',width:260,align:'right'})
      f.edit({action:'move-column',columnId:'workCount',direction:'left'})
      const reopened=new CreatorDatabaseStore(f.db).view('owner',[creator])
      expect(reopened.columns[1]).toMatchObject({id:'workCount',name:'公开作品数',width:260,align:'right'})
      expect(reopened.rows[0].values.workCount).toBe(20)
      expect(()=>f.edit({action:'format-column',columnId:'nickname',name:'公开作品数',width:190,align:'left'})).toThrow('已存在')
      expect(()=>f.edit({action:'remove-column',columnId:'workCount'})).toThrow('默认五列')
      expect(()=>f.edit({action:'move-column',columnId:'nickname',direction:'left'})).toThrow('边界')
      expect(reopened.revision).toBe(2)
    }finally{f.db.close()}
  })
  it('adds typed custom columns, preserves contents after source updates and archives removed columns',()=>{
    const f=fixture();try{
      const c=f.edit({action:'add-column',name:'优先级',kind:'count'}).columns.at(-1)!
      f.edit({action:'set-cell',columnId:c.id,secUid:'sec',value:2})
      expect(()=>f.edit({action:'set-cell',columnId:c.id,secUid:'sec',value:2.5})).toThrow('整数')
      expect(f.store.view('owner',[{...creator,id:-99,nickname:'新昵称'}]).rows[0].values[c.id]).toBe(2)
      f.edit({action:'rename-column',columnId:c.id,name:'跟进顺序'})
      f.edit({action:'remove-column',columnId:c.id})
      const json=JSON.parse(String(f.db.prepare('SELECT table_json FROM creator_database_tables').get()!.table_json))
      expect(json.cells.sec[c.id]).toBe(2);expect(json.columns.at(-1).archived).toBe(true)
      expect(f.store.view('owner',[creator]).columns).toHaveLength(5)
    }finally{f.db.close()}
  })
  it('isolates accounts and rejects stale revisions and foreign authors without partial writes',()=>{
    const f=fixture();try{
      const c=f.edit({action:'add-column',name:'备注'}).columns.at(-1)!
      expect(f.store.view('other',[creator]).columns).toHaveLength(5)
      expect(()=>f.store.update('other',[creator],{action:'rename-column',ownerSecUid:'owner',revision:1,columnId:c.id,name:'新名'})).toThrow('账号已切换')
      expect(()=>f.store.update('owner',[creator],{action:'rename-column',ownerSecUid:'owner',revision:0,columnId:c.id,name:'新名'})).toThrow('表格已发生变更')
      expect(()=>f.edit({action:'set-cell',secUid:'alien',columnId:c.id,value:'x'})).toThrow('不属于')
      expect(f.store.view('owner',[creator]).revision).toBe(1)
    }finally{f.db.close()}
  })
})
