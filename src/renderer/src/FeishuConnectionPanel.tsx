import {useEffect,useLayoutEffect,useRef,useState,type JSX,type ReactNode} from 'react'
import type {CreatorDatabaseView} from '../../shared/creatorDatabase'
import type {FeishuState} from '../../shared/feishu'
import CreatorName,{CreatorNameOption,useCreatorNameAppearance,creatorNameClass} from './CreatorName'

export default function FeishuConnectionPanel({view,onDirtyChange}:{view:CreatorDatabaseView;onDirtyChange:(dirty:boolean)=>void}):JSX.Element {
  const [state,setState]=useState<FeishuState|null>(null),[appId,setAppId]=useState(''),[appSecret,setAppSecret]=useState(''),[tableUrl,setTableUrl]=useState('')
  const [selected,setSelected]=useState(view.rows[0]?.secUid??''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState<ReactNode>('')
  const [operationMs,setOperationMs]=useState<number|null>(null),started=useRef<number|null>(null)
  const working=busy||!!state?.busy
  const selectedCreator=view.rows.find(row=>row.secUid===selected)
  const selectedAppearance=useCreatorNameAppearance({profileUrl:selectedCreator?.profileUrl,priority:selectedCreator?.refreshPriority,ownerSecUid:view.ownerSecUid})
  useEffect(()=>{
    let alive=true
    void window.signalDesk.getFeishuState().then(next=>{if(alive){setState(next);setAppId(next.appId);setTableUrl(next.tableUrl)}})
      .catch(e=>{if(alive)setError(e instanceof Error?e.message:String(e))})
    const timer=setInterval(()=>void window.signalDesk.getFeishuState().then(next=>{if(alive)setState(next)}).catch(()=>{}),2000)
    return()=>{alive=false;clearInterval(timer)}
  },[])
  useEffect(()=>{onDirtyChange(dirty||busy);return()=>onDirtyChange(false)},[dirty,busy,onDirtyChange])
  useLayoutEffect(()=>{if(!busy&&started.current!==null){setOperationMs(Math.round(performance.now()-started.current));started.current=null}},[busy])
  const save=async():Promise<void>=>{
    if(!view.ownerSecUid||busy)return
    setBusy(true);setError('');setMessage('正在保存连接配置…')
    try{
      const next=await window.signalDesk.saveFeishuConfiguration({ownerSecUid:view.ownerSecUid,appId,appSecret,tableUrl})
      setState(next);setAppId(next.appId);setTableUrl(next.tableUrl);setAppSecret('');setDirty(false)
      setMessage('配置已加密保存。请选择一位博主，写入并核验连接。')
    }catch(e){setError(e instanceof Error?e.message:String(e));setMessage('配置尚未保存')}
    finally{setBusy(false)}
  }
  const probe=async():Promise<void>=>{
    if(!view.ownerSecUid||busy||dirty||!selected)return
    started.current=performance.now();setOperationMs(null);setBusy(true);setError('');setMessage('正在连接飞书、写入所选博主并读回核验…');setState(previous=>previous?{...previous,receipt:null}:previous)
    try{
      const receipt=await window.signalDesk.probeFeishuCreator({ownerSecUid:view.ownerSecUid,secUid:selected})
      setState(previous=>previous?{...previous,receipt}:previous)
      setMessage(<>已{receipt.action==='created'?'新增':'更新'} <CreatorName name={receipt.nickname} profileUrl={`https://www.douyin.com/user/${receipt.secUid}`}/>，{receipt.verifiedFields} 个字段读回一致。</>)
    }catch(e){setError(e instanceof Error?e.message:String(e));setMessage('验证未完成，请按提示处理后重试')}
    finally{setBusy(false)}
  }
  const syncAll=async():Promise<void>=>{
    if(!view.ownerSecUid||working||dirty)return
    started.current=performance.now();setOperationMs(null);setBusy(true);setError('');setMessage('正在同步当前账号全部博主…')
    try{
      const sync=await window.signalDesk.syncFeishuCreators({ownerSecUid:view.ownerSecUid})
      setState(previous=>previous?{...previous,busy:false,sync}:previous)
      setMessage(`已核验 ${sync.verified} 位博主，新增 ${sync.created} 位，更新 ${sync.updated} 位，无变化 ${sync.unchanged} 位。`)
    }catch(e){setError(e instanceof Error?e.message:String(e));setMessage('本轮未完成，已写入记录保留；可点击重试')}
    finally{setBusy(false);void window.signalDesk.getFeishuState().then(setState).catch(()=>{})}
  }
  const automatic=async(enabled:boolean):Promise<void>=>{
    if(!view.ownerSecUid||working||dirty)return
    setBusy(true);setError('')
    try{setState(await window.signalDesk.setFeishuAutomatic({ownerSecUid:view.ownerSecUid,enabled}));setMessage(enabled?'已开启自动同步，本机数据保存后会自动更新到飞书。':'已暂停自动同步。')}
    catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  const discard=():void=>{if(state){setAppId(state.appId);setTableUrl(state.tableUrl);setAppSecret('');setDirty(false);setError('');setMessage('已恢复保存的配置')}}
  return <aside className="feishu-panel" aria-label="飞书多维表格连接" data-testid="feishu-panel">
    <div className="feishu-panel-heading"><strong>连接飞书多维表格</strong><span>{state?.automatic?'自动同步已开启':state?.receipt?'连接已验证':'先验证一位博主'}</span></div>
    <p>将博主的五项默认数据、自定义列、主页、星标和批注同步到飞书。同步列以“APP ·”开头，内容以本机为准；在飞书编辑这些列不会回传 APP。</p>
    <details><summary>首次连接需要准备什么？</summary><ol>
      <li>在飞书开放平台创建企业自建应用，开通“查看、评论、编辑和管理多维表格”（bitable:app）权限并发布版本。</li>
      <li>在飞书创建独立多维表格，将应用添加为可编辑的文档应用／协作者。打开其中一张空白数据表，复制含 /base/ 和 table= 的完整链接。</li>
      <li>在下方填写 App ID、App Secret 和数据表链接。Secret 只在本机加密保存，不会显示在日志或表格中。</li>
    </ol><button className="button ghost compact" onClick={()=>void window.signalDesk.openExternal('https://open.feishu.cn/app')}>打开飞书开放平台</button></details>
    <form onSubmit={event=>{event.preventDefault();void save()}}>
      <fieldset disabled={working||!state}><div className="feishu-credentials">
        <label>App ID<input aria-label="飞书 App ID" placeholder="cli_…" autoComplete="off" value={appId} onChange={e=>{setAppId(e.target.value);setDirty(true)}} required/></label>
        <label>App Secret<input aria-label="飞书 App Secret" type="password" autoComplete="new-password" placeholder={state?.hasSecret?'已保存；不修改请留空':'填写自建应用 Secret'} value={appSecret} onChange={e=>{setAppSecret(e.target.value);setDirty(true)}}/></label>
        <label className="feishu-url">多维表格数据表链接<input aria-label="飞书数据表链接" type="url" placeholder="https://你的组织.feishu.cn/base/…?table=tbl…" value={tableUrl} onChange={e=>{setTableUrl(e.target.value);setDirty(true)}} required/></label>
      </div><div className="feishu-actions"><button className="button primary" type="submit">保存连接配置</button>{dirty&&<button className="button ghost" type="button" onClick={discard}>放弃配置修改</button>}</div></fieldset>
    </form>
    <div className="feishu-actions"><label>验证博主<select className={creatorNameClass(selectedAppearance,true)} aria-label="飞书验证博主" value={selected} disabled={working} onChange={e=>setSelected(e.target.value)}>{view.rows.map(row=><CreatorNameOption key={row.secUid} value={row.secUid} name={row.nickname} profileUrl={row.profileUrl} priority={row.refreshPriority}/>)}</select></label>
      <button className="button ghost" disabled={working||dirty||!state?.hasSecret||!selected||!view.rows.some(row=>row.secUid===selected)} onClick={()=>void probe()}>写入一位并核验</button>
      <button className="button primary" disabled={working||dirty||!state?.receipt} onClick={()=>void syncAll()}>{state?.sync?.phase==='error'?'重试同步全部博主':'同步全部博主'}</button>
      {state?.tableUrl&&<button className="button ghost" onClick={()=>void window.signalDesk.openExternal(state.tableUrl)}>打开飞书表格</button>}
    </div>
    <label className="feishu-automatic"><input type="checkbox" aria-label="自动同步到飞书" checked={!!state?.automatic} disabled={working||dirty||!state?.receipt} onChange={e=>void automatic(e.target.checked)}/>自动同步：采集入库、星标、批注和自定义列保存后更新飞书</label>
    {state?.sync&&<div className="feishu-sync-state" role="status">
      <strong>{state.sync.phase==='running'?({reading:'正在读取飞书现有记录',writing:'正在分批写入',verifying:'正在读回核验',done:'已完成'}[state.sync.stage]):state.sync.phase==='success'?'全库同步已完成':'本轮同步未完成'}</strong>
      <span>本轮 {state.sync.total} 位 · 已写入 {state.sync.written} 位 · 已核验 {state.sync.verified} 位</span>
      {state.sync.phase==='success'&&<span>新增 {state.sync.created} · 更新 {state.sync.updated} · 无变化 {state.sync.unchanged}</span>}
      <span>{state.sync.trigger==='automatic'?'自动同步':'手动同步'} · {new Date(state.sync.finishedAt??state.sync.startedAt).toLocaleString('zh-CN')} · 同步处理耗时 {(state.sync.elapsedMs/1000).toFixed(2)} 秒</span>
      {state.sync.error&&<span className="database-error">{state.sync.error}{state.automatic?'；自动同步会稍后重试，也可手动重试。':''}</span>}
    </div>}
    {dirty&&<p>连接配置有未保存修改，请先保存。</p>}
    <p role="status">{message||(!state?'正在读取连接配置…':state.hasSecret?'已保存连接配置，可以验证一位博主。':'尚未配置飞书连接。')}</p>
    {state?.receipt&&<p className="feishu-success">最近核验：<CreatorName name={state.receipt.nickname} profileUrl={`https://www.douyin.com/user/${state.receipt.secUid}`} priority={view.rows.find(row=>row.secUid===state.receipt!.secUid)?.refreshPriority}/> · {state.receipt.verifiedFields} 项一致 · {new Date(state.receipt.verifiedAt).toLocaleString('zh-CN')} · 写入与核验耗时 {(state.receipt.elapsedMs/1000).toFixed(2)} 秒</p>}
    {operationMs!==null&&<p>本次点击到结果可用：{(operationMs/1000).toFixed(2)} 秒</p>}
    {error&&<div className="database-error" role="alert">{error}</div>}
    <p className="feishu-boundary">全库同步包含当前账号全部博主，不受本页筛选影响。相同账号和主页更新同一记录，未变化的数据不重复写入。自动同步在 APP 运行时生效，关闭期间的变化会在下次启动后补同步。</p>
  </aside>
}
