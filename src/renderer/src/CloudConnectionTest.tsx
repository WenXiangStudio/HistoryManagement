import {useEffect,useRef,useState} from 'react'
import type {CloudConnectionInput,CloudConnectionResult} from '../../shared/cloudConnection'

type Props={input:CloudConnectionInput|null;disabled?:boolean;resetKey:string;hint?:string;ariaLabel:string}
type Attempt={scope:string;loading:boolean;result?:CloudConnectionResult;error?:{message:string;elapsedMs:number;testedAt:string}}

export default function CloudConnectionTest({input,disabled=false,resetKey,hint,ariaLabel}:Props){
  const identity=JSON.stringify([resetKey,input])
  const identityRef=useRef({value:identity,generation:0})
  if(identityRef.current.value!==identity)identityRef.current={value:identity,generation:identityRef.current.generation+1}
  const scope=JSON.stringify([identityRef.current.generation,identity])
  const scopeRef=useRef(scope),mounted=useRef(true),latest=useRef<{scope:string;token:symbol}|null>(null)
  const [attempt,setAttempt]=useState<Attempt|null>(null)
  // Update during render so a response arriving before effects cannot attach to a newer draft.
  scopeRef.current=scope
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;latest.current=null}},[])
  const current=attempt?.scope===scope?attempt:null
  const loading=!!current?.loading
  const test=async()=>{
    if(disabled||!input||latest.current?.scope===scope)return
    const token=Symbol('cloud-connection')
    const startedAt=Date.now()
    latest.current={scope,token};setAttempt({scope,loading:true})
    const valid=()=>mounted.current&&scopeRef.current===scope&&latest.current?.token===token
    try{
      const result=await window.signalDesk.testCloudConnection(input)
      if(valid())setAttempt({scope,loading:false,result})
    }catch(error){
      if(valid())setAttempt({scope,loading:false,error:{message:error instanceof Error?error.message:'连通测试未完成，请重试',elapsedMs:Date.now()-startedAt,testedAt:new Date().toISOString()}})
    }finally{if(latest.current?.token===token)latest.current=null}
  }
  const result=current?.result
  const outcome=result??current?.error
  const timestamp=outcome&&new Date(outcome.testedAt)
  return <div className="cloud-connection-test">
    <div className="cloud-connection-controls"><button type="button" className="button ghost" aria-label={ariaLabel} disabled={disabled||!input||loading} onClick={()=>void test()}>{loading?'测试中…':'连通测试'}</button>
      {hint&&<small className="cloud-connection-hint">{hint}</small>}</div>
    <div role="status" aria-live="polite" className={`cloud-connection-result${result?(result.ok?' success':' failure'):current?.error?' failure':''}`}>
      {loading&&<span>正在验证已保存的配置…</span>}
      {result&&<><strong>{result.ok?'连接成功':'连接失败'}</strong><span>{result.message}</span></>}
      {current?.error&&<><strong>连接失败</strong><span>{current.error.message}</span></>}
      {outcome&&<small>测试耗时 {(Math.max(0,outcome.elapsedMs)/1000).toFixed(2)} 秒{timestamp&&!Number.isNaN(timestamp.getTime())&&<> · 上次测试 <time dateTime={outcome.testedAt}>{timestamp.toLocaleString('zh-CN',{hour12:false})}</time></>}</small>}
    </div>
  </div>
}
