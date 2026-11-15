import {classifyActivityCommandError} from './creator-activity-diagnostics.js'

export const RECOVERABLE_ACTIVITY_ERRORS=new Set(['DEBUGGER_NOT_ATTACHED','TARGET_NAVIGATED_OR_CLOSED','EXECUTION_CONTEXT_UNAVAILABLE'])
export function activityRecoveryCode(error){return /^[A-Z0-9_-]{1,100}$/.test(error?.message)?error.message:classifyActivityCommandError(error)}

/** One shared, bounded recovery per author. Waits poll only the local APP. */
export function createCreatorActivityRecovery({policy,enabled=()=>true,active,inspect,reconnect,verify,progress,identity,preservedPages=()=>0,
  delay=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,random=Math.random}={}){
  let attempts=0,flight=null
  const recover=async error=>{
    const reason=activityRecoveryCode(error)
    if(!policy||!enabled()||!RECOVERABLE_ACTIVITY_ERRORS.has(reason))throw error
    if(attempts>=policy.maxAttempts)throw Error('ACTIVITY_RECOVERY_EXHAUSTED')
    if(policy.maxAttempts!==2||policy.delayMinMs!==5000||policy.delayMaxMs!==10000)throw Error('ACTIVITY_RECOVERY_POLICY_INVALID')
    await active();await inspect()
    const attempt=++attempts,startedAt=new Date(now()).toISOString(),durationMs=policy.delayMinMs+Math.floor(random()*(policy.delayMaxMs-policy.delayMinMs+1))
    const waitUntil=new Date(now()+durationMs).toISOString(),base={...identity(),attempt,reason,startedAt,waitUntil,preservedPages:preservedPages()}
    await progress({...base,phase:'waiting'})
    try{
      while(now()<Date.parse(waitUntil)){await active();await delay(Math.min(500,Date.parse(waitUntil)-now()))}
      await active();await inspect();await progress({...base,phase:'reconnecting'})
      await reconnect();await inspect();await verify();await active()
      await progress({...base,phase:'recovered',completedAt:new Date(now()).toISOString()})
    }catch(failure){
      await progress({...base,phase:'failed',completedAt:new Date(now()).toISOString(),failureCode:activityRecoveryCode(failure)}).catch(()=>{})
      throw failure
    }
  }
  return {get attempts(){return attempts},async run(operation){
    while(true){
      if(flight)await flight
      try{return await operation()}catch(error){
        if(!policy||!enabled()||!RECOVERABLE_ACTIVITY_ERRORS.has(activityRecoveryCode(error)))throw error
        if(!flight){flight=recover(error).finally(()=>{flight=null})}
        try{await flight}catch(failure){
          if(!RECOVERABLE_ACTIVITY_ERRORS.has(activityRecoveryCode(failure))||attempts>=policy.maxAttempts)throw failure
        }
      }
    }
  }}
}

// Page inspection is read-only and independent of the debugger connection.
export function readCreatorRecoveryPage(scope){
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'
  const panels=[...document.querySelectorAll('[role="dialog"],iframe[src*="verify"],iframe[src*="captcha"],.captcha_verify_container')].filter(visible)
  const text=(document.body?.innerText||'').slice(0,20000),tab=document.querySelector('#semiTabpost')
  if(panels.some(e=>e.tagName==='IFRAME'||/安全验证|验证码|完成验证|访问过于频繁/.test(e.textContent||''))||!tab&&/安全验证|验证码|完成验证|访问过于频繁/.test(text))return {errorCode:'CAPTCHA_OR_SECURITY_CHALLENGE'}
  if(!tab&&/登录后查看|请登录|扫码登录/.test(text))return {errorCode:'LOGIN_REQUIRED'}
  if(location.origin!=='https://www.douyin.com'||decodeURIComponent(location.pathname)!=='/user/'+scope.secUid)return {errorCode:'ACTIVITY_RECOVERY_PAGE_CHANGED'}
  return {ready:document.readyState==='complete'||document.readyState==='interactive',secUid:scope.secUid}
}

/** Retrieve a projected response from the same document; never start a second GET. */
export function readCreatorActivityPendingResult(scope){
  const entry=globalThis.__signalDeskCreatorActivityReads?.[scope.readToken]
  if(!entry||entry.runId!==scope.runId||entry.secUid!==scope.secUid||entry.cursor!==scope.cursor)return {phase:'missing'}
  return entry.value?{phase:'settled',value:entry.value}:{phase:'pending'}
}
