import {useState,type JSX} from 'react'
import {CREATOR_DATABASE_TIERS,type CreatorDatabaseColumn} from '../../shared/creatorDatabase'
import {DATABASE_FILTER_LABELS,databaseFilterOperators,validateDatabaseFilters,type DatabaseFilters,type DatabaseFilterRule} from '../../shared/creatorDatabaseFilters'
export default function DatabaseFilterPanel({columns,initial,onApply,onClear}:{columns:CreatorDatabaseColumn[];initial:DatabaseFilters;onApply:(filters:DatabaseFilters)=>void;onClear:()=>void}):JSX.Element{
  const [draft,setDraft]=useState<DatabaseFilters>(structuredClone(initial)),[error,setError]=useState('')
  const change=(id:string,patch:Partial<DatabaseFilterRule>):void=>{setError('');setDraft(current=>({...current,rules:current.rules.map(rule=>rule.id===id?{...rule,...patch}:rule)}))}
  const add=():void=>{const column=columns[0];if(!column)return;setDraft(current=>({...current,rules:[...current.rules,{id:crypto.randomUUID(),columnId:column.id,operator:databaseFilterOperators(column.kind)[0],value:'',upper:''}]}))}
  return <form className="database-filter-panel" data-testid="database-filter-panel" onSubmit={event=>{event.preventDefault();const invalid=validateDatabaseFilters(draft,columns);if(invalid){setError(invalid);return}setError('');onApply(draft)}}>
    <div className="database-filter-heading"><strong>自定义筛选</strong><select aria-label="条件组合方式" value={draft.mode} onChange={event=>setDraft({...draft,mode:event.target.value as 'all'|'any'})}><option value="all">全部满足（并且）</option><option value="any">任一满足（或者）</option></select></div>
    <small>可组合多条条件。间隔以天为单位，可输入小数；范围包含两端，空值需使用“为空”条件。</small>
    {!draft.rules.length&&<p>点击“添加条件”开始设置，完成后点击“应用筛选”。</p>}
    {draft.rules.map((rule,index)=>{
      const column=columns.find(column=>column.id===rule.columnId),noValue=['empty','not-empty'].includes(rule.operator)
      const valueInput=(upper=false):JSX.Element=>column?.kind==='tier'?<select aria-label={`条件${index+1}值`} value={rule.value} onChange={event=>change(rule.id,{value:event.target.value})}>
        <option value="">选择活跃情况</option>{Object.entries(CREATOR_DATABASE_TIERS).map(([value,label])=><option value={value} key={value}>{label}</option>)}
      </select>:<input aria-label={`条件${index+1}${upper?'上限':'值'}`} type={column?.kind==='date'?'date':column?.kind==='count'||column?.kind==='interval'?'number':'text'} step="any"
        placeholder={column?.kind==='interval'?'天数，如 10.5':'条件值'} value={upper?rule.upper:rule.value} onChange={event=>change(rule.id,upper?{upper:event.target.value}:{value:event.target.value})}/>
      return <div className="database-filter-rule" key={rule.id}>
        <span>{index+1}</span><select aria-label={`条件${index+1}字段`} value={rule.columnId} onChange={event=>{const next=columns.find(c=>c.id===event.target.value)!;change(rule.id,{columnId:next.id,operator:databaseFilterOperators(next.kind)[0],value:'',upper:''})}}>
          {!column&&<option value={rule.columnId}>此列已移除</option>}{columns.map(column=><option key={column.id} value={column.id}>{column.name}{column.kind==='interval'?'（天）':''}</option>)}
        </select><select aria-label={`条件${index+1}比较`} value={rule.operator} onChange={event=>change(rule.id,{operator:event.target.value as DatabaseFilterRule['operator']})}>
          {(column?databaseFilterOperators(column.kind):[]).map(operator=><option key={operator} value={operator}>{DATABASE_FILTER_LABELS[operator]}</option>)}
        </select>{!noValue&&<>{valueInput()}{rule.operator==='between'&&<><span>至</span>{valueInput(true)}</>}</>}
        <button type="button" aria-label={`删除条件${index+1}`} onClick={()=>setDraft({...draft,rules:draft.rules.filter(item=>item.id!==rule.id)})}>移除</button>
      </div>
    })}
    {error&&<p role="alert" className="database-local-error">{error}</p>}
    <div className="database-filter-actions"><button type="button" className="button ghost compact" disabled={draft.rules.length>=20} onClick={add}>添加条件</button><button className="button primary compact">应用筛选</button><button type="button" className="button ghost compact" onClick={()=>{setDraft({mode:'all',rules:[]});setError('');onClear()}}>清空条件</button></div>
  </form>
}
