import {useEffect,useRef,useState} from 'react'
import type {DoubaoAuthMode,DoubaoSpeechView} from '../../shared/doubaoSpeech'
import CloudConnectionTest from './CloudConnectionTest'

export default function DoubaoSpeechSettings(){
  const [view,setView]=useState<DoubaoSpeechView|null>(null),[authMode,setAuthMode]=useState<DoubaoAuthMode>('api-key')
  const [appId,setAppId]=useState(''),[secret,setSecret]=useState('')
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false)
  const clickedAt=useRef<number|null>(null),displayMarked=useRef<string|null>(null)
  const dirtyRef=useRef(false),editRevision=useRef(0)
  const transcript=useRef<HTMLTextAreaElement|null>(null)
  useEffect(()=>{let active=true
    const receive=(v:DoubaoSpeechView)=>{if(active){setView(v);if(!dirtyRef.current){setAuthMode(v.settings.authMode);setAppId(v.settings.appId)}}}
    void window.signalDesk.getDoubaoSpeech().then(receive).catch(()=>{if(active)setMessage('读取豆包配置失败，请重新打开设置')})
    const refresh=()=>{void window.signalDesk.getDoubaoSpeech().then(receive).catch(()=>{})}
    const timer=setInterval(refresh,1500),off=window.signalDesk.onDataChanged(refresh)
    return()=>{active=false;clearInterval(timer);off()}
  },[])
  useEffect(()=>{
    const trial=view?.trial
    if(trial?.state!=='completed'||!trial.requestId||trial.displayedAt||clickedAt.current===null||displayMarked.current===trial.requestId)return
    let frame2=0
    transcript.current?.scrollIntoView?.({block:'nearest'})
    const frame1=requestAnimationFrame(()=>{frame2=requestAnimationFrame(()=>{
      displayMarked.current=trial.requestId!
      void window.signalDesk.markDoubaoFlashDisplayed({requestId:trial.requestId!,displayedAt:Date.now()}).then(setView).catch(()=>setMessage('原文已保存，展示耗时未记录成功'))
    })})
    return()=>{cancelAnimationFrame(frame1);cancelAnimationFrame(frame2)}
  },[view?.trial.state,view?.trial.requestId,view?.trial.displayedAt])
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await action()}catch(e){setMessage(e instanceof Error?e.message:'操作未完成')}finally{setBusy(false)}}
  const running=view&&['preparing','running'].includes(view.trial.state)
  const blocked=view&&['pending','uncertain','preparing','running','completed'].includes(view.trial.state)
  const edit=(action:()=>void)=>{action();editRevision.current++;dirtyRef.current=true;setDirty(true)}
  const save=async()=>{const v=await window.signalDesk.saveDoubaoSpeech({authMode,appId,secret});setView(v);setSecret('');dirtyRef.current=false;setDirty(false);setMessage('豆包语音凭据已安全保存')}
  return <article className="settings-card doubao-speech" data-testid="doubao-speech-settings">
    <div className="settings-card-head"><div><h3>豆包语音 · 录音文件识别极速版</h3><p>保存语音凭据后，可通过连通测试验证鉴权与服务调用。下方保留已有本地音轨的单条转写入口。</p></div></div>
    <div className="field-grid">
      <label className="field">鉴权方式<select aria-label="豆包鉴权方式" value={authMode} disabled={busy||!!running} onChange={e=>edit(()=>{setAuthMode(e.target.value as DoubaoAuthMode);setSecret('')})}>
        <option value="api-key">新版控制台 · API Key</option><option value="app-token">旧版控制台 · APP ID＋Access Token</option>
      </select></label>
      <label className="field">服务资源<input value="volc.bigasr.auc_turbo" readOnly aria-label="豆包资源ID"/></label>
      {authMode==='app-token'&&<label className="field">APP ID<input aria-label="豆包APP ID" value={appId} disabled={busy||!!running} onChange={e=>edit(()=>setAppId(e.target.value))}/></label>}
      <label className="field">{authMode==='api-key'?'语音服务 API Key':'Access Token'}<input type="password" autoComplete="off" aria-label="豆包语音凭据" value={secret} disabled={busy||!!running} onChange={e=>edit(()=>setSecret(e.target.value))}
        placeholder={view?.settings.hasSecret&&view.settings.authMode===authMode?'留空保留已保存凭据':'仅在此处填写，不要发送到聊天'}/></label>
    </div>
    <div className="doubao-actions"><button className="button primary" disabled={busy||!!running||!view} onClick={()=>void run(save)}>保存豆包语音配置</button>
      <span className="credential-state">{view?.settings.hasSecret?'语音凭据已保存':'尚未保存语音凭据'}</span>
      <a href="https://console.volcengine.com/speech/new/setting/apikeys?projectName=default" target="_blank" rel="noreferrer">打开语音 API Key 管理</a></div>
    <CloudConnectionTest ariaLabel="测试豆包语音连通性" input={view?.settings.revision&&view.settings.hasSecret&&!dirty&&!(view.settings.authMode==='app-token'&&!view.settings.appId)?{kind:'doubao',expectedRevision:view.settings.revision}:null}
      disabled={busy||!!running||dirty} resetKey={JSON.stringify([view?.settings.revision,editRevision.current])}
      hint={dirty?'请先保存配置再测试':!view?.settings.hasSecret?'请先保存语音凭据':view.settings.authMode==='app-token'&&!view.settings.appId?'请先填写 APP ID 并保存':'点击发送 1 秒合成音频，验证语音服务；可能产生少量用量'}/>
    <div className="doubao-test"><h3>本地音轨 · 单条转写</h3>
      <p>{view?.audioReady?'本地测试音轨已找到：math-openai-77s.mp3。':'开始时将从已保存的本地原片准备测试音轨。'}程序自动校验视频归属和文件内容，再直接提交给豆包语音服务。</p>
      <p>关闭语义顺滑和数字规整，开启标点和分句。仅提交音频；原始返回文本与回执单独保存，历史转写保留。</p>
      <div className="doubao-actions"><button className="button primary" disabled={busy||!!blocked||!view?.settings.hasSecret||dirty} onClick={()=>{
        clickedAt.current=Date.now();displayMarked.current=null
        void run(async()=>setView(await window.signalDesk.startDoubaoFlash({clickedAt:clickedAt.current!})))
      }}>{view?.trial.state==='completed'?'本条转写已完成':'仅转写这条视频'}</button>
        <button className="button ghost" disabled={busy||!!running} onClick={()=>void run(async()=>{await window.signalDesk.prepareDoubaoAudio();setView(await window.signalDesk.getDoubaoSpeech());setMessage('已打开本地音轨所在文件夹')})}>查看本地音轨</button>
        {running&&<button className="button ghost" disabled={busy} onClick={()=>void run(async()=>{await window.signalDesk.stopDoubaoSpeech();setView(await window.signalDesk.getDoubaoSpeech())})}>停止等待</button>}
      </div>
      {dirty&&<p>请先保存本页豆包配置，再开始测试。</p>}
      <div role="status" aria-live="polite"><p>{message||view?.trial.message}</p>{view?.trial.requestId&&<small>Request ID：{view.trial.requestId} {view.trial.statusCode&&`· 业务码 ${view.trial.statusCode}`}</small>}</div>
      {view?.trial.apiMessage&&view.trial.state!=='completed'&&<p>服务返回：{view.trial.apiMessage}</p>}
      {view?.trial.logId&&<p className="doubao-request-id">Log ID：{view.trial.logId}</p>}
      {view?.trial.displayedTotalMs!==undefined&&<p>点击开始至原文显示：<strong>{(view.trial.displayedTotalMs/1000).toFixed(3)}秒</strong></p>}
      {view?.trial.preparationMs!==undefined&&<p>本地准备 {(view.trial.preparationMs/1000).toFixed(3)}秒 · 请求与完整响应 {view.trial.requestMs===undefined?'等待中':(view.trial.requestMs/1000).toFixed(3)+'秒'}{view.trial.saveMs!==undefined&&` · 结果文件保存 ${(view.trial.saveMs/1000).toFixed(3)}秒`}</p>}
      {view?.trial.returnedDurationMs!==undefined&&<p>服务返回音频时长：{(view.trial.returnedDurationMs/1000).toFixed(3)}秒</p>}
      {view?.trial.text&&<><h3>转写原文</h3><textarea ref={transcript} readOnly aria-label="豆包转写原文" value={view.trial.text} rows={12}/></>}
      {view?.standardTrial&&<details><summary>标准版2.0历史记录</summary><p>{view.standardTrial.message}</p><p>Request ID：{view.standardTrial.requestId}</p>{view.standardTrial.text&&<textarea readOnly aria-label="豆包标准版历史原文" value={view.standardTrial.text} rows={8}/>}</details>}
    </div>
    <p><a href="https://www.volcengine.com/docs/6561/1631584" target="_blank" rel="noreferrer">录音文件识别极速版官方文档</a> · 用量与费用以语音服务控制台实际记录为准。</p>
  </article>
}
