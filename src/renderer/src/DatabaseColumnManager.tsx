import {useEffect,useRef,useState,type JSX} from 'react'
import type {CreatorDatabaseAction,CreatorDatabaseColumn} from '../../shared/creatorDatabase'
type Props={columns:CreatorDatabaseColumn[];saving:boolean;addRequest:number;mutate:(action:CreatorDatabaseAction)=>Promise<boolean>}
export default function DatabaseColumnManager({columns,saving,addRequest,mutate}:Props):JSX.Element{
  const [name,setName]=useState(''),[kind,setKind]=useState<'text'|'count'|'date'>('text'),[error,setError]=useState('')
  const nameInput=useRef<HTMLInputElement>(null)
  useEffect(()=>{if(addRequest>0)nameInput.current?.focus()},[addRequest])
  return <div className="database-column-manager" data-testid="database-column-manager">
    <strong>表头与列格式</strong><small>可调整所有列的表头名称、顺序、宽度及对齐。默认五列的数据自动更新，不支持手动修改。</small>
    <form className="database-add-column" onSubmit={event=>{event.preventDefault();if(!name.trim()){setError('请填写新列的表头名称');nameInput.current?.focus();return}
      setError('');void mutate({action:'add-column',name,kind}).then(ok=>{if(ok){setName('');nameInput.current?.focus()}})}}>
      <label>新增表头<input ref={nameInput} aria-label="新增列名称" placeholder="填写表头名称，例如：关注领域" value={name} maxLength={40} disabled={saving} onChange={event=>{setName(event.target.value);setError('')}}/></label>
      <label>列类型<select aria-label="新增列类型" value={kind} disabled={saving} onChange={event=>setKind(event.target.value as typeof kind)}><option value="text">文本</option><option value="count">整数</option><option value="date">日期</option></select></label>
      <button className="button primary compact" disabled={saving}>确认新增</button>
    </form>
    {error&&<p className="database-local-error" role="alert">{error}</p>}
    <div className="database-format-list">{columns.map((column,index)=><ColumnFormat key={column.id} column={column} saving={saving} first={index===0} last={index===columns.length-1} mutate={mutate}/>)}</div>
  </div>
}
function ColumnFormat({column,saving,first,last,mutate}:{column:CreatorDatabaseColumn;saving:boolean;first:boolean;last:boolean;mutate:Props['mutate']}):JSX.Element{
  const [name,setName]=useState(column.name),[width,setWidth]=useState(String(column.width??(column.id==='nickname'?240:190))),[align,setAlign]=useState(column.align??'left')
  useEffect(()=>{setName(column.name);setWidth(String(column.width??(column.id==='nickname'?240:190)));setAlign(column.align??'left')},[column.name,column.width,column.align,column.id])
  return <form className="database-format-row" data-format-column={column.id} onSubmit={event=>{event.preventDefault();void mutate({action:'format-column',columnId:column.id,name,width:Number(width),align})}}>
    <label>表头<input aria-label={`${column.name}表头名称`} value={name} maxLength={40} required disabled={saving} onChange={event=>setName(event.target.value)}/></label>
    <label>宽度（像素）<input aria-label={`${column.name}列宽`} type="number" min={120} max={600} step={1} required disabled={saving} value={width} onChange={event=>setWidth(event.target.value)}/></label>
    <label>对齐<select aria-label={`${column.name}对齐`} value={align} disabled={saving} onChange={event=>setAlign(event.target.value as typeof align)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
    <button type="submit" className="button ghost compact" disabled={saving}>保存格式</button>
    <button type="button" disabled={saving||first} onClick={()=>void mutate({action:'move-column',columnId:column.id,direction:'left'})} aria-label={`${column.name}左移`}>← 左移</button>
    <button type="button" disabled={saving||last} onClick={()=>void mutate({action:'move-column',columnId:column.id,direction:'right'})} aria-label={`${column.name}右移`}>右移 →</button>
    {!column.builtin&&<button type="button" disabled={saving} onClick={()=>void mutate({action:'remove-column',columnId:column.id})}>删除列</button>}
  </form>
}
