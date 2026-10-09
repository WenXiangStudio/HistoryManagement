import type {CreatorDatabaseColumn,CreatorDatabaseRow,DatabaseCellValue} from './creatorDatabase'
export type DatabaseFilterOperator='contains'|'not-contains'|'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'between'|'empty'|'not-empty'
export type DatabaseFilterRule={id:string;columnId:string;operator:DatabaseFilterOperator;value:string;upper:string}
export type DatabaseFilters={mode:'all'|'any';rules:DatabaseFilterRule[]}
export const DATABASE_FILTER_LABELS:Record<DatabaseFilterOperator,string>={contains:'包含','not-contains':'不包含',eq:'等于',neq:'不等于',gt:'大于',gte:'大于或等于',lt:'小于',lte:'小于或等于',between:'介于（含边界）',empty:'为空','not-empty':'不为空'}
export function databaseFilterOperators(kind:CreatorDatabaseColumn['kind']):DatabaseFilterOperator[]{
  if(kind==='text')return ['contains','not-contains','eq','neq','empty','not-empty']
  if(kind==='tier')return ['eq','neq','empty','not-empty']
  return ['eq','neq','gt','gte','lt','lte','between','empty','not-empty']
}
const validDate=(value:string):boolean=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
export function validateDatabaseFilters(filters:DatabaseFilters,columns:CreatorDatabaseColumn[]):string|null{
  if(!filters||!['all','any'].includes(filters.mode)||!Array.isArray(filters.rules)||filters.rules.length>20)return '最多支持20条筛选条件'
  for(const [index,rule] of filters.rules.entries()){
    if(!rule)return '筛选条件无效'
    const column=columns.find(c=>c.id===rule.columnId),prefix=`第${index+1}条条件：`
    if(!column)return prefix+'列不存在，请移除该条件'
    if(!databaseFilterOperators(column.kind).includes(rule.operator))return prefix+'请选择有效比较方式'
    if(['empty','not-empty'].includes(rule.operator))continue
    const values=rule.operator==='between'?[rule.value,rule.upper]:[rule.value]
    if(values.some(v=>typeof v!=='string'||!v.trim()))return prefix+'请填写条件值'
    if(column.kind==='count'||column.kind==='interval'){
      if(values.some(v=>!Number.isFinite(Number(v))))return prefix+'请输入数字'
      if(rule.operator==='between'&&Number(rule.value)>Number(rule.upper))return prefix+'最小值不能大于最大值'
    }
    if(column.kind==='date'){
      if(values.some(v=>!validDate(v)))return prefix+'请输入有效日期'
      if(rule.operator==='between'&&rule.value>rule.upper)return prefix+'开始日期不能晚于结束日期'
    }
    if(column.kind==='tier'&&!['active','regular','inactive','dormant','unknown'].includes(rule.value))return prefix+'请选择活跃情况'
  }
  return null
}
function matches(value:DatabaseCellValue|undefined,rule:DatabaseFilterRule,column:CreatorDatabaseColumn):boolean{
  const empty=value===null||value===undefined||value===''
  if(rule.operator==='empty')return empty
  if(rule.operator==='not-empty')return !empty
  if(empty)return false
  const numeric=column.kind==='count'||column.kind==='interval'
  const actual=numeric?Number(value)/(column.kind==='interval'?24:1):String(value).toLocaleLowerCase()
  const expected=numeric?Number(rule.value):rule.value.toLocaleLowerCase(),upper=numeric?Number(rule.upper):rule.upper.toLocaleLowerCase()
  switch(rule.operator){
    case 'contains':return String(actual).includes(String(expected))
    case 'not-contains':return !String(actual).includes(String(expected))
    case 'eq':return actual===expected
    case 'neq':return actual!==expected
    case 'gt':return actual>expected
    case 'gte':return actual>=expected
    case 'lt':return actual<expected
    case 'lte':return actual<=expected
    case 'between':return actual>=expected&&actual<=upper
  }
}
export function matchesDatabaseFilters(row:CreatorDatabaseRow,filters:DatabaseFilters,columns:CreatorDatabaseColumn[]):boolean{
  if(!filters.rules.length)return true
  const verdict=(rule:DatabaseFilterRule)=>{const column=columns.find(c=>c.id===rule.columnId);return !!column&&matches(row.values[rule.columnId],rule,column)}
  return filters.mode==='all'?filters.rules.every(verdict):filters.rules.some(verdict)
}

export {publicationIntervalWholeDays} from './creatorPublicationInterval'
