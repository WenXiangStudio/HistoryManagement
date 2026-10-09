import {randomBytes} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {CreatorListItem} from '../shared/contracts'
import {creatorDatabaseAutomaticValues,creatorDatabaseMutationSchema,DEFAULT_CREATOR_DATABASE_COLUMNS,validateDatabaseCell,
  type CreatorDatabaseColumn,type CreatorDatabaseView,type DatabaseCellValue} from '../shared/creatorDatabase'

type SavedTable={columns:CreatorDatabaseColumn[];cells:Record<string,Record<string,DatabaseCellValue>>}
export class CreatorDatabaseStore{
  constructor(private readonly db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS creator_database_tables(owner_sec_uid TEXT PRIMARY KEY,revision INTEGER NOT NULL,table_json TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS creator_database_edits(id INTEGER PRIMARY KEY,owner_sec_uid TEXT NOT NULL,revision INTEGER NOT NULL,changed_at TEXT NOT NULL,change_json TEXT NOT NULL,UNIQUE(owner_sec_uid,revision)) STRICT;`)
  }
  private load(owner:string|null):{revision:number;table:SavedTable}{
    const row=owner?this.db.prepare('SELECT revision,table_json FROM creator_database_tables WHERE owner_sec_uid=?').get(owner):undefined
    return row?{revision:Number(row.revision),table:JSON.parse(String(row.table_json))}:{revision:0,table:{columns:DEFAULT_CREATOR_DATABASE_COLUMNS.map(column=>({...column})),cells:{}}}
  }
  view(owner:string|null,creators:CreatorListItem[]):CreatorDatabaseView{
    const {revision,table}=this.load(owner)
    return {ownerSecUid:owner,revision,columns:table.columns.filter(column=>!column.archived),rows:owner?creators.filter(creator=>!creator.isDemo).map(creator=>{
      const secUid=new URL(creator.profileUrl).pathname.split('/').at(-1)!,automatic=creatorDatabaseAutomaticValues(creator)
      const manual=Object.hasOwn(table.cells,secUid)?table.cells[secUid]:{}
      const values=Object.fromEntries(table.columns.filter(column=>!column.archived).map(column=>[column.id,!column.builtin&&Object.hasOwn(manual,column.id)?manual[column.id]:automatic[column.id]??null]))
      const manualColumns=table.columns.filter(column=>!column.builtin&&!column.archived&&Object.hasOwn(manual,column.id)).map(column=>column.id)
      return {secUid,nickname:creator.nickname,profileUrl:creator.profileUrl,automatic,values,manualColumns,refreshPriority:creator.refreshPriority}
    }):[]}
  }
  update(owner:string|null,creators:CreatorListItem[],input:unknown):CreatorDatabaseView{
    const mutation=creatorDatabaseMutationSchema.parse(input)
    if(!owner||owner!==mutation.ownerSecUid)throw Error('账号已切换，请重新打开表格后编辑')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const {revision,table}=this.load(owner)
      if(mutation.revision!==revision)throw Error('表格已发生变更，已为你保留输入，请重新保存')
      const column='columnId' in mutation?table.columns.find(column=>column.id===mutation.columnId&&!column.archived):undefined
      if('columnId' in mutation&&!column)throw Error('该列已移除，请重新选择')
      if(mutation.action==='set-cell'||mutation.action==='reset-cell'){
        if(column!.builtin)throw Error('默认五项数据由采集和计算提供，不支持手动修改')
        if(!creators.some(creator=>!creator.isDemo&&new URL(creator.profileUrl).pathname.split('/').at(-1)===mutation.secUid))throw Error('博主不属于当前账号')
        const cells=Object.hasOwn(table.cells,mutation.secUid)?table.cells[mutation.secUid]:{}
        if(mutation.action==='set-cell')cells[column!.id]=validateDatabaseCell(column!,mutation.value)
        else delete cells[column!.id]
        Object.defineProperty(table.cells,mutation.secUid,{value:cells,writable:true,enumerable:true,configurable:true})
      }else if(mutation.action==='add-column'){
        if(table.columns.filter(column=>!column.archived).length>=35)throw Error('最多可显示30个自定义列')
        if(table.columns.some(column=>!column.archived&&column.name===mutation.name))throw Error('列名称已存在')
        table.columns.push({id:'custom_'+randomBytes(12).toString('hex'),name:mutation.name,kind:mutation.kind??'text',builtin:false})
      }else if(mutation.action==='format-column'){
        if(mutation.name){
          if(table.columns.some(other=>!other.archived&&other.id!==column!.id&&other.name===mutation.name))throw Error('列名称已存在')
          column!.name=mutation.name
        }
        column!.width=mutation.width;column!.align=mutation.align
      }else if(mutation.action==='move-column'){
        const visible=table.columns.filter(item=>!item.archived),index=visible.findIndex(item=>item.id===column!.id)
        const target=visible[index+(mutation.direction==='left'?-1:1)]
        if(!target)throw Error('该列已在边界位置')
        const a=table.columns.indexOf(column!),b=table.columns.indexOf(target)
        ;[table.columns[a],table.columns[b]]=[table.columns[b],table.columns[a]]
      }else{
        if(mutation.action==='rename-column'){
          if(table.columns.some(other=>!other.archived&&other.id!==column!.id&&other.name===mutation.name))throw Error('列名称已存在')
          column!.name=mutation.name
        }else{if(column!.builtin)throw Error('默认五列保留，可修改表头和格式');column!.archived=true}
      }
      this.db.prepare('INSERT INTO creator_database_tables VALUES(?,?,?) ON CONFLICT(owner_sec_uid) DO UPDATE SET revision=excluded.revision,table_json=excluded.table_json').run(owner,revision+1,JSON.stringify(table))
      this.db.prepare('INSERT INTO creator_database_edits(owner_sec_uid,revision,changed_at,change_json) VALUES(?,?,?,?)').run(owner,revision+1,new Date().toISOString(),JSON.stringify(mutation))
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return this.view(owner,creators)
  }
}
