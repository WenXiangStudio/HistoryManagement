import {Activity,useCallback,useEffect,useMemo,useRef,useState,type JSX} from 'react'
import {CREATOR_DATABASE_TIERS,formatDatabaseCell,type CreatorDatabaseView,type CreatorDatabaseColumn,type CreatorDatabaseRow,type CreatorDatabaseAction,type DatabaseCellValue} from '../../shared/creatorDatabase'
import {matchesDatabaseFilters,validateDatabaseFilters,type DatabaseFilters} from '../../shared/creatorDatabaseFilters'
import DatabaseColumnManager from './DatabaseColumnManager'
import DatabaseFilterPanel from './DatabaseFilterPanel'
import FeishuConnectionPanel from './FeishuConnectionPanel'
import CreatorIntervalCharts from './CreatorIntervalCharts'
import CreatorName from './CreatorName'
import VirtualTableBody from './VirtualTableBody'
type Edit={secUid:string;columnId:string;initial:DatabaseCellValue;value:string}
const emptyFilters=():DatabaseFilters=>({mode:'all',rules:[]})
export default function CreatorDatabasePage({onEditingChange}:{onEditingChange:(dirty:boolean)=>void}):JSX.Element{
  const [view,setView]=useState<CreatorDatabaseView|null>(null),viewRef=useRef(view)
  const [error,setError]=useState(''),[status,setStatus]=useState(''),[saving,setSaving]=useState(false),savingRef=useRef(false)
  const [edit,setEdit]=useState<Edit|null>(null),[search,setSearch]=useState(''),[tier,setTier]=useState('all')
  const [sort,setSort]=useState<{id:string;descending:boolean}|null>(null),[manage,setManage]=useState(false),[addRequest,setAddRequest]=useState(0)
  const [filters,setFilters]=useState<DatabaseFilters>(emptyFilters),[filterOpen,setFilterOpen]=useState(false)
  const [feishuOpen,setFeishuOpen]=useState(false),[feishuDirty,setFeishuDirty]=useState(false)
  const [display,setDisplay]=useState<'table'|'charts'>('table')
  const [chartsVisited,setChartsVisited]=useState(false)
  const viewSignature=useRef('')
  const request=useRef(0),alive=useRef(true),form=useRef<HTMLFormElement>(null)
  const apply=useCallback((next:CreatorDatabaseView)=>{
    if(!alive.current)return
    const signature=JSON.stringify(next)
    if(signature===viewSignature.current)return
    viewSignature.current=signature
    if(viewRef.current?.ownerSecUid!==next.ownerSecUid){
      setEdit(null);setSearch('');setTier('all');setSort(null);setManage(false);setFilterOpen(false)
      let restored=emptyFilters()
      try{const saved=localStorage.getItem('creator-database-filters:'+next.ownerSecUid);if(saved){const candidate=JSON.parse(saved);if(!validateDatabaseFilters(candidate,next.columns))restored=candidate}}catch{/* invalid preferences do not affect source data */}
      setFilters(restored)
    }
    viewRef.current=next;setView(next)
  },[])
  const load=useCallback(async()=>{
    const sequence=++request.current
    try{const next=await window.signalDesk.getCreatorDatabase();if(alive.current&&sequence===request.current&&!savingRef.current)apply(next)}
    catch(e){if(alive.current&&sequence===request.current)setError(e instanceof Error?e.message:String(e))}
  },[apply])
  useEffect(()=>{alive.current=true;void load();const timer=setInterval(()=>void load(),5000),remove=window.signalDesk.onDataChanged(()=>void load())
    return()=>{alive.current=false;request.current++;clearInterval(timer);remove()}
  },[load])
  useEffect(()=>{onEditingChange(!!edit||saving||feishuDirty);return()=>onEditingChange(false)},[edit,saving,feishuDirty,onEditingChange])
  const mutate=async(action:CreatorDatabaseAction):Promise<boolean>=>{
    const current=viewRef.current;if(!current?.ownerSecUid||savingRef.current)return false
    savingRef.current=true;setSaving(true);setError('');setStatus('正在保存…');request.current++
    try{const next=await window.signalDesk.updateCreatorDatabase({...action,ownerSecUid:current.ownerSecUid,revision:current.revision})
      request.current++;apply(next);setStatus('已保存到本机');return true
    }catch(e){if(alive.current){setError(e instanceof Error?e.message:String(e));setStatus('尚未保存，输入已保留')}return false}
    finally{savingRef.current=false;if(alive.current){setSaving(false);void load()}}
  }
  const applyFilters=(next:DatabaseFilters):void=>{
    setFilters(next)
    try{localStorage.setItem('creator-database-filters:'+view?.ownerSecUid,JSON.stringify(next))}catch{setStatus('筛选已应用，本次无法保存筛选偏好')}
  }
  const openCell=(row:CreatorDatabaseRow,column:CreatorDatabaseColumn):void=>{
    if(column.builtin||edit||saving)return
    const value=row.values[column.id];setError('');setEdit({secUid:row.secUid,columnId:column.id,initial:value,value:value==null?'':String(value)})
  }
  const saveEdit=async():Promise<void>=>{
    if(!edit||savingRef.current||!view)return
    if(form.current&&!form.current.reportValidity()){setError('请输入有效的自定义列内容');return}
    const column=view.columns.find(column=>column.id===edit.columnId)
    if(!column||column.builtin){setError('该列不可编辑，请取消');return}
    const value=edit.value===''?null:column.kind==='count'?Number(edit.value):edit.value
    if(value===edit.initial){setEdit(null);return}
    if(await mutate({action:'set-cell',secUid:edit.secUid,columnId:edit.columnId,value}))setEdit(null)
  }
  const filterError=view?validateDatabaseFilters(filters,view.columns):null
  const rows=useMemo(()=>{
    if(!view)return []
    const query=search.trim().toLocaleLowerCase()
    const result=view.rows.filter(row=>!filterError&&matchesDatabaseFilters(row,filters,view.columns)&&(tier==='all'||(row.values.tier??'unknown')===tier)&&(!query||view.columns.some(column=>formatDatabaseCell(column,row.values[column.id]).toLocaleLowerCase().includes(query))))
    if(sort)result.sort((a,b)=>{const av=a.values[sort.id],bv=b.values[sort.id]
      if(av==null)return bv==null?0:1;if(bv==null)return -1
      const comparison=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'zh-CN',{numeric:true})
      return sort.descending?-comparison:comparison})
    return result
  },[view,search,tier,sort,filters,filterError])
  const renderEditor=(column:CreatorDatabaseColumn):JSX.Element=><form ref={form} className="database-cell-editor" data-testid="database-cell-editor" onSubmit={event=>{event.preventDefault();void saveEdit()}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))void saveEdit()}} onKeyDown={event=>{if(event.key==='Escape'&&!saving){event.preventDefault();setEdit(null);setError('')}}}>
    <fieldset disabled={saving}><input autoFocus aria-label={`编辑${column.name}`} type={column.kind==='date'?'date':column.kind==='count'?'number':'text'} min={column.kind==='count'?0:undefined} step={column.kind==='count'?1:undefined}
      maxLength={2000} value={edit!.value} onChange={event=>setEdit({...edit!,value:event.target.value})}/><div className="database-editor-actions"><button type="submit">保存</button><button type="button" onClick={()=>{setEdit(null);setError('')}}>取消</button></div></fieldset>
  </form>
  return <section className="page-section creator-database-page" data-testid="creator-database-page">
    <div className="database-view-switch" aria-label="数据库视图"><button aria-pressed={display==='table'} disabled={!!edit||saving||feishuDirty} onClick={()=>setDisplay('table')}>数据表</button><button data-testid="database-charts-tab" aria-pressed={display==='charts'} disabled={!!edit||saving||feishuDirty} onClick={()=>{setChartsVisited(true);setDisplay('charts');setManage(false);setFeishuOpen(false)}}>数据图表</button><span>同一份博主资料，随数据自动更新</span></div>
    <div className="database-toolbar"><label className="search-box"><span>搜索</span><input aria-label="搜索博主数据库" placeholder="搜索昵称、日期或任意列内容" value={search} disabled={!!edit||saving} onChange={event=>setSearch(event.target.value)}/></label>
      <select aria-label="筛选活跃情况" value={tier} disabled={!!edit||saving} onChange={event=>setTier(event.target.value)}><option value="all">全部活跃情况</option>{Object.entries(CREATOR_DATABASE_TIERS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <button className="button ghost" disabled={!view||!!edit||saving} onClick={()=>setFilterOpen(!filterOpen)}>自定义筛选{filters.rules.length?`（${filters.rules.length}）`:''}</button>
      {display==='table'&&<><button className="button ghost" disabled={!view?.ownerSecUid||!!edit||saving} onClick={()=>setManage(!manage)}>{manage?'收起格式':'表格格式'}</button>
      <button className="button primary" data-testid="database-add-column" disabled={!view?.ownerSecUid||!!edit||saving} onClick={()=>{setManage(true);setAddRequest(n=>n+1)}}>新增列</button>
      <button className="button ghost" disabled={!view?.ownerSecUid||!!edit||saving||feishuDirty} onClick={()=>setFeishuOpen(!feishuOpen)}>{feishuOpen?'收起飞书连接':'连接飞书'}</button></>}
    </div>
    <div className="database-caption"><span>{view?`${rows.length} / ${view.rows.length} 位博主`:'正在读取…'}{display==='table'?' · 默认五项数据只读 · 点击表头排序':' · 当前搜索与筛选结果'}</span><span role="status">{status}</span></div>
    {display==='table'&&<p className="database-help">表头名称、列顺序、列宽和对齐方式可在“表格格式”中调整。自定义列可通过“编辑”按钮填写内容。</p>}
    {feishuOpen&&view?.ownerSecUid&&<FeishuConnectionPanel key={`feishu:${view.ownerSecUid}`} view={view} onDirtyChange={setFeishuDirty}/>}
    {error&&<div className="database-error" role="alert">{error}<button className="button ghost compact" disabled={saving} onClick={()=>{if(edit)void saveEdit();else{setError('');void load()}}}>{edit?'重试保存':'重新读取'}</button></div>}
    {filterError&&<div className="database-error" role="alert">{filterError}，请修改或清空筛选。<button onClick={()=>applyFilters(emptyFilters())}>清空筛选</button></div>}
    {filterOpen&&view&&<DatabaseFilterPanel key={`filters:${view.ownerSecUid}`} columns={view.columns} initial={filters} onApply={applyFilters} onClear={()=>applyFilters(emptyFilters())}/>}
    {manage&&view&&<DatabaseColumnManager columns={view.columns} saving={saving||!!edit} addRequest={addRequest} mutate={mutate}/>}
    {!view?<div className="database-empty">正在读取本地博主资料…</div>:!view.ownerSecUid?<div className="database-empty">请先在设置中绑定资料账号。</div>:<>
      {chartsVisited&&<Activity mode={display==='charts'?'visible':'hidden'}><CreatorIntervalCharts key={`charts:${view.ownerSecUid}`} rows={rows} allRows={view.rows}/></Activity>}
      <Activity mode={display==='table'?'visible':'hidden'}><div className="database-table-scroll">
      <table className="creator-database-table" aria-rowcount={rows.length+1} style={{minWidth:view.columns.reduce((sum,column)=>sum+(column.width??(column.id==='nickname'?240:190)),0)}} data-testid="creator-database-table"><caption className="sr-only">当前账号博主数据库，默认五项只读，表格格式可调整</caption>
        <colgroup>{view.columns.map(column=><col key={column.id} style={{width:column.width??(column.id==='nickname'?240:190)}}/>)}</colgroup><thead><tr>{view.columns.map(column=><th key={column.id} scope="col" style={{textAlign:column.align??'left'}} aria-sort={sort?.id===column.id?(sort.descending?'descending':'ascending'):'none'}>
          <button disabled={!!edit||saving} onClick={()=>setSort({id:column.id,descending:sort?.id===column.id?!sort.descending:false})}>{column.name}<span aria-hidden="true">{sort?.id===column.id?(sort.descending?' ↓':' ↑'):' ↕'}</span></button>
        </th>)}</tr></thead><VirtualTableBody rows={rows} rowKey={row=>row.secUid} columnCount={view.columns.length} estimatedHeight={54}
          layoutKey={JSON.stringify(view.columns)} pinnedKey={edit?.secUid} renderRow={row=><tr key={row.secUid} data-sec-uid={row.secUid}>{view.columns.map(column=><td key={column.id} data-column-id={column.id} style={{textAlign:column.align??'left'}}>
          {!column.builtin&&edit?.secUid===row.secUid&&edit.columnId===column.id?renderEditor(column):<div className={`database-cell ${column.builtin?'database-readonly-cell':''}`} style={{justifyContent:column.align==='center'?'center':column.align==='right'?'flex-end':'flex-start'}}>
            {column.id==='nickname'?<CreatorName name={formatDatabaseCell(column,row.values[column.id])} profileUrl={row.profileUrl} priority={row.refreshPriority}/>:<span className={column.kind==='tier'?`database-tier tier-${row.values[column.id]??'unknown'}`:undefined}>{formatDatabaseCell(column,row.values[column.id])}</span>}
            {!column.builtin&&<button className="database-custom-edit" disabled={saving||!!edit} aria-label={`编辑 ${row.nickname} 的${column.name}`} onClick={()=>openCell(row,column)}>编辑</button>}
          </div>}
        </td>)}</tr>}/></table>
      {!rows.length&&<div className="database-empty">{view.rows.length?'没有符合条件的博主，请调整搜索或筛选。':'当前账号还没有博主，完成关注清单同步后会自动显示。'}</div>}
    </div></Activity></>}
  </section>
}
