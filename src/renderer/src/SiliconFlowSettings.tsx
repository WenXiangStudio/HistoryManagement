import {useEffect,useRef,useState} from 'react'
import {SILICON_FLOW_BASE_URL,type SiliconFlowModel,type SiliconFlowView} from '../../shared/siliconFlow'
import CloudConnectionTest from './CloudConnectionTest'

type DraftModel=SiliconFlowModel&{slot:number}
export default function SiliconFlowSettings({activeProfileId,onActivate,disabled=false}:{activeProfileId?:string;onActivate:(id:string)=>void;disabled?:boolean}){
  const [view,setView]=useState<SiliconFlowView|null>(null),[models,setModels]=useState<DraftModel[]>([]),[removed,setRemoved]=useState<DraftModel[]>([]),[secret,setSecret]=useState('')
  const [revision,setRevision]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const dirtyRef=useRef(false),savingRef=useRef(false),editRevision=useRef(0)
  const apply=(v:SiliconFlowView)=>{setView(v);setModels(v.slots.map(s=>({slot:s.slot,model:s.model,visionEnabled:s.visionEnabled})));setRemoved([]);setRevision(v.revision);setDirty(false);dirtyRef.current=false}
  useEffect(()=>{let active=true
    const refresh=()=>{void window.signalDesk.getSiliconFlow().then(v=>{if(!active||savingRef.current)return;setView(v);if(!dirtyRef.current)apply(v)}).catch(()=>{if(active)setMessage('读取硅基流动配置失败，请重新打开设置')})}
    refresh();const timer=setInterval(refresh,5000),off=window.signalDesk.onDataChanged(refresh)
    return()=>{active=false;clearInterval(timer);off()}
  },[])
  const changed=()=>{editRevision.current++;setDirty(true);dirtyRef.current=true;setMessage('')}
  const editModel=(slot:number,patch:Partial<SiliconFlowModel>)=>{changed();setModels(current=>current.map(m=>m.slot===slot?{...m,...patch}:m))}
  const addModel=()=>{
    const slot=Math.max(0,...(view?.slots.map(s=>s.slot)??[]),...models.map(m=>m.slot),...removed.map(m=>m.slot))+1
    changed();setModels(current=>[...current,{slot,model:'',visionEnabled:false}])
  }
  const removeModel=(model:DraftModel)=>{
    changed();setModels(current=>current.filter(m=>m.slot!==model.slot))
    if(view?.slots.some(s=>s.slot===model.slot))setRemoved(current=>[...current,model])
  }
  const undoRemoval=()=>{changed();setModels(current=>[...current,...removed].sort((a,b)=>a.slot-b.slot));setRemoved([])}
  const stale=!!view&&revision!==view.revision
  const save=async()=>{
    if(!view||savingRef.current||stale)return
    savingRef.current=true;setBusy(true);setMessage('')
    try{const saved=await window.signalDesk.saveSiliconFlow({expectedRevision:revision,secret,models,deletedSlots:removed.map(m=>m.slot)});apply(saved);setSecret('');setMessage('硅基流动配置已保存。已填写模型 ID 和 API Key 的模型可选择使用。')}
    catch(error){setMessage(error instanceof Error?error.message:'保存未完成，输入内容已保留')}
    finally{savingRef.current=false;setBusy(false)}
  }
  return <article className="settings-card siliconflow-settings" data-testid="siliconflow-settings">
    <div className="settings-card-head"><div><h3>硅基流动 · 模型接入</h3><p>共用一个 API Key，可自由添加和删除模型。修改后点击保存配置，模型 ID 也可稍后填写。</p></div></div>
    <fieldset disabled={disabled||busy||!view} className="cloud-profile-fields">
      <div className="field-grid">
        <label className="field"><span>服务地址</span><input aria-label="硅基流动服务地址" readOnly value={SILICON_FLOW_BASE_URL}/></label>
        <label className="field"><span>接口协议</span><input aria-label="硅基流动接口协议" readOnly value="Chat Completions"/></label>
        <label className="field siliconflow-key"><span>硅基流动 API Key</span><input type="password" autoComplete="off" aria-label="硅基流动API Key" value={secret}
          onChange={event=>{changed();setSecret(event.target.value)}} placeholder={view?.hasSecret?'留空保留已保存密钥；填写新 Key 将用于所有硅基流动模型':'在此填写硅基流动 API Key'}/></label>
      </div>
      <div className="siliconflow-model-list-head"><span>模型列表 · {models.length} 个</span><button className="button ghost" onClick={addModel}>新增模型</button></div>
      {view&&models.length===0&&<p className="siliconflow-empty">暂无模型，点击“新增模型”添加。已保存的 API Key 会保留。</p>}
      <div className="siliconflow-models">
        {models.map(model=>{const slot=view?.slots.find(s=>s.slot===model.slot),active=!!slot?.profileId&&activeProfileId===slot.profileId
          return <div className="siliconflow-model" key={model.slot}>
            <div className="siliconflow-model-head"><h4>模型 {model.slot}{active&&<span className="credential-state saved">当前云端方案</span>}</h4>
              <button className="button ghost" aria-label={`删除硅基流动模型${model.slot}`} onClick={()=>removeModel(model)}>删除</button></div>
            <label className="field"><span>完整模型 ID</span><input aria-label={`硅基流动模型${model.slot}`} value={model.model} maxLength={200}
              onChange={event=>editModel(model.slot,{model:event.target.value})} placeholder="从硅基流动控制台复制模型 ID"/></label>
            <label className="siliconflow-vision"><input type="checkbox" aria-label={`硅基流动模型${model.slot}图片输入`} checked={model.visionEnabled}
              onChange={event=>editModel(model.slot,{visionEnabled:event.target.checked})}/>此模型支持图片输入，用于画面理解</label>
            <div className="siliconflow-model-actions"><small>{slot?.hasSecret?'API Key 已保存':'尚未保存 API Key'}{!slot?.model?' · 模型待填写':''}</small>
              <button className="button ghost" disabled={disabled||busy||dirty||stale||!slot?.profileId||!slot.hasSecret||!slot.model||active}
                onClick={()=>onActivate(slot!.profileId!)}>{active?'正在使用':`使用模型 ${model.slot}`}</button></div>
            <CloudConnectionTest ariaLabel={`测试硅基流动模型${model.slot}连通性`}
              input={slot?.profileId&&slot.hasSecret&&slot.model&&!dirty&&!stale?{kind:'siliconflow',profileId:slot.profileId,expectedRevision:revision}:null}
              disabled={disabled||busy||dirty||stale} resetKey={JSON.stringify([view?.revision,revision,editRevision.current])}
              hint={dirty||stale?'请先保存配置再测试':!slot?.model?'请先填写模型 ID 并保存':!slot.hasSecret?'请先保存 API Key':model.visionEnabled?'点击发送合成图片，验证图片输入能力':'点击发起最小文本请求'}/>
          </div>
        })}
      </div>
      {removed.length>0&&<div className="siliconflow-removals"><p>已移除 {removed.length} 个模型，保存后生效。{removed.some(m=>view?.slots.some(s=>s.slot===m.slot&&s.profileId===activeProfileId))&&'包含当前云端方案，保存时会自动切换云端方案。'}</p><button className="button ghost" onClick={undoRemoval}>撤销删除</button></div>}
      <p className="setting-hint">模型 ID 按控制台原样填写。仅为支持视觉的模型开启图片输入；保存配置不会发起模型调用。连通测试会发起最小请求，可能产生少量用量。</p>
      <div className="cloud-profile-actions"><button className="button primary" disabled={disabled||busy||!view||stale} onClick={()=>void save()}>保存硅基流动配置</button>
        <a href="https://cloud.siliconflow.cn/account/ak" target="_blank" rel="noreferrer">打开硅基流动控制台</a>
        <a href="https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions" target="_blank" rel="noreferrer">接口说明</a></div>
    </fieldset>
    {stale&&<div className="cloud-profile-pending"><p>已保存的硅基流动配置发生变化，当前草稿已保留。</p><button className="button ghost" disabled={busy} onClick={()=>{if(view){apply(view);setSecret('');setMessage('')}}}>放弃草稿并重新载入硅基流动配置</button></div>}
    <p role="status" aria-live="polite">{message||(dirty?'有未保存修改，请保存后使用模型。':'保存后的模型会分别出现在下方“云端方案”中。')}</p>
  </article>
}
