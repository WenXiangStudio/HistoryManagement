import {z} from 'zod'
import type {CreatorListItem} from './contracts'
import {shanghaiDateKey} from './creatorActivitySections'
import {formatPublicationInterval} from './creatorPublicationInterval'

export type DatabaseCellValue=string|number|null
export type CreatorDatabaseColumn={id:string;name:string;kind:'text'|'date'|'count'|'interval'|'tier';builtin:boolean;archived?:boolean;width?:number;align?:'left'|'center'|'right'}
export type CreatorDatabaseRow={secUid:string;nickname:string;profileUrl:string;values:Record<string,DatabaseCellValue>;
  automatic:Record<string,DatabaseCellValue>;manualColumns:string[];refreshPriority?:import('./creatorPriority').CreatorPriorityState}
export type CreatorDatabaseView={ownerSecUid:string|null;revision:number;columns:CreatorDatabaseColumn[];rows:CreatorDatabaseRow[]}
export const DEFAULT_CREATOR_DATABASE_COLUMNS:CreatorDatabaseColumn[]=[
  {id:'nickname',name:'博主昵称',kind:'text',builtin:true},
  {id:'lastPublishedDate',name:'上次更新日期',kind:'date',builtin:true},
  {id:'workCount',name:'作品数',kind:'count',builtin:true},
  {id:'intervalHours',name:'间隔天数',kind:'interval',builtin:true},
  {id:'tier',name:'活跃情况',kind:'tier',builtin:true}
]
export const CREATOR_DATABASE_TIERS={active:'高频',regular:'中频',inactive:'低频',dormant:'极低频',unknown:'待确认'}
const databaseIdentity=z.string().regex(/^[A-Za-z0-9._-]{1,240}$/)
const columnId=z.string().regex(/^(nickname|lastPublishedDate|workCount|intervalHours|tier|custom_[a-f0-9]{24})$/)
const databaseMutationBase={ownerSecUid:databaseIdentity,revision:z.number().int().nonnegative()}
export const creatorDatabaseMutationSchema=z.discriminatedUnion('action',[
  z.object({...databaseMutationBase,action:z.literal('set-cell'),secUid:databaseIdentity,columnId,value:z.union([z.string().max(2000),z.number().finite(),z.null()])}).strict(),
  z.object({...databaseMutationBase,action:z.literal('reset-cell'),secUid:databaseIdentity,columnId}).strict(),
  z.object({...databaseMutationBase,action:z.literal('add-column'),name:z.string().trim().min(1).max(40),kind:z.enum(['text','count','date']).optional()}).strict(),
  z.object({...databaseMutationBase,action:z.literal('rename-column'),columnId,name:z.string().trim().min(1).max(40)}).strict(),
  z.object({...databaseMutationBase,action:z.literal('remove-column'),columnId}).strict(),
  z.object({...databaseMutationBase,action:z.literal('format-column'),columnId,name:z.string().trim().min(1).max(40).optional(),width:z.number().int().min(120).max(600),align:z.enum(['left','center','right'])}).strict(),
  z.object({...databaseMutationBase,action:z.literal('move-column'),columnId,direction:z.enum(['left','right'])}).strict()
])
export type CreatorDatabaseMutation=z.infer<typeof creatorDatabaseMutationSchema>
export type CreatorDatabaseAction=CreatorDatabaseMutation extends infer M?M extends CreatorDatabaseMutation?Omit<M,'ownerSecUid'|'revision'>:never:never

export function creatorDatabaseAutomaticValues(creator:CreatorListItem):Record<string,DatabaseCellValue>{
  const date=creator.activity?.refreshSchedule?.latestKnownPublishedAt??creator.activity?.latestPublishedAt
  return {nickname:creator.nickname,lastPublishedDate:date?shanghaiDateKey(date):null,workCount:creator.activity?.workCount??null,
    intervalHours:creator.activity?.publicationInterval?.meanHours??null,tier:creator.activity?.refreshSchedule?.tier??'unknown'}
}
export function validateDatabaseCell(column:CreatorDatabaseColumn,value:DatabaseCellValue):DatabaseCellValue{
  if(value===null){if(column.id==='nickname')throw Error('博主昵称不能为空');return null}
  if(column.kind==='text'){
    if(typeof value!=='string'||value.length>2000||(column.id==='nickname'&&(!value.trim()||value.length>100)))throw Error('请输入有效文本，昵称最多100字')
    return column.id==='nickname'?value.trim():value
  }
  if(column.kind==='date'){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('请输入有效日期')
    return value
  }
  if(column.kind==='tier'){
    if(typeof value!=='string'||!['active','regular','inactive','dormant','unknown'].includes(value))throw Error('请选择有效的活跃情况')
    return value
  }
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER||(column.kind==='count'&&!Number.isSafeInteger(value)))throw Error('作品数须为非负整数，间隔须为非负数')
  return value
}
export function formatDatabaseCell(column:CreatorDatabaseColumn,value:DatabaseCellValue):string{
  if(value===null||value===undefined||value==='')return column.kind==='interval'?'记录不足':column.kind==='date'?'暂无日期':'—'
  if(column.kind==='interval')return formatPublicationInterval(Number(value))
  if(column.kind==='tier')return CREATOR_DATABASE_TIERS[value as keyof typeof CREATOR_DATABASE_TIERS]??'待确认'
  if(column.kind==='date'){const [y,m,d]=String(value).split('-');return `${y}年${Number(m)}月${Number(d)}日`}
  return String(value)
}
