import {classifyActivityCommandError} from './creator-activity-diagnostics.js'

export const NATIVE_LIST_LIMITS={resourceBytes:8*1024*1024,totalBytes:32*1024*1024,requests:24,arrivalWaitMs:600,readyWaitMs:1500,bodyTimeoutMs:2000}
export const recoverableNativeListErrors=new Set(['ACTIVITY_NATIVE_LIST_UNAVAILABLE','ACTIVITY_NATIVE_PENDING','ACTIVITY_NATIVE_BODY_TIMEOUT',
  'ACTIVITY_NATIVE_BODY_UNAVAILABLE','ACTIVITY_NATIVE_BODY_EVICTED','ACTIVITY_NATIVE_BODY_NOT_RETAINED','ACTIVITY_BODY_TOO_LARGE'])
export function creatorWorkBelongsTo(record,uid,secUid){
  return record.profileOwner?record.profileOwner.uid===uid&&record.profileOwner.secUid===secUid:record.authorUid===uid&&record.authorSecUid===secUid
}

// Observe the author's own native list response before navigation. Never read page DOM,
// persist request URLs/headers, or replace a rejected native request with another GET.
export function projectCreatorActivityResponse(input) {
  const root = input?.data || input
  if (!root || root.status_code !== 0) throw new Error('ACTIVITY_RESPONSE_REJECTED')
  if (!Array.isArray(root.aweme_list) || root.aweme_list.length > 200 || ![true, false, 0, 1].includes(root.has_more)) throw new Error('ACTIVITY_LIST_SCHEMA_INVALID')
  const integer = value => Number.isSafeInteger(value) ? value : null
  const boolean = value => typeof value === 'boolean' ? value : null
  return {
    status_code: 0, has_more: root.has_more, max_cursor: integer(root.max_cursor),
    aweme_list: root.aweme_list.map(row => ({
      aweme_id: String(row.aweme_id || ''), author: {uid: String(row.author?.uid || ''), sec_uid: row.author?.sec_uid || ''},
      create_time: integer(row.create_time), is_top: [true, false, 0, 1].includes(row.is_top) ? row.is_top : null,
      status: {private_status: integer(row.status?.private_status), is_delete: boolean(row.status?.is_delete),
        is_prohibited: boolean(row.status?.is_prohibited), allow_share: boolean(row.status?.allow_share)},
      is_story: integer(row.is_story), is_24_story: integer(row.is_24_story), aweme_type: integer(row.aweme_type)
    }))
  }
}

// These are web-response observations, not Open Platform enums. Positive private
// markers are excluded without assigning names to individual numeric values.
export function classifyActivityVisibility(value) {
  if (value.isDelete === true) return 'deleted'
  if (value.isProhibited === true) return 'prohibited'
  if (Number.isSafeInteger(value.privateStatus) && value.privateStatus > 0) return 'restricted'
  if ((Number.isSafeInteger(value.isStory) && value.isStory > 0) || (Number.isSafeInteger(value.is24Story) && value.is24Story > 0)) return 'temporary-marker'
  if (value.privateStatus === 0 && value.isDelete === false && value.isProhibited === false && value.isStory === 0 && value.is24Story === 0 && value.allowShare !== false) return 'public'
  return 'unknown'
}

export async function observeCreatorActivity(chrome, target, secUid, {lazy=false,project=projectCreatorActivityResponse}={}) {
  const requests = new Map(), pages = new Map()
  const records=[],ignored={childSession:0,method:0,author:0,cursor:0},startedAt=new Date().toISOString()
  let stopped = false, nativeListRequests = 0,dropped=0,fatalError=null,lastAvailability=null
  const at=()=>new Date().toISOString()
  const matches = raw => {
    try {
      const url = new URL(raw)
      if (url.origin !== 'https://www.douyin.com' || url.pathname !== '/aweme/v1/web/aweme/post/' || url.searchParams.get('sec_user_id') !== secUid) return null
      const rawCursor = url.searchParams.get('max_cursor')
      if (rawCursor === null || !/^\d+$/.test(rawCursor)) return null
      const cursor = Number(rawCursor)
      return Number.isSafeInteger(cursor) ? cursor : null
    } catch { return null }
  }
  const settle = (entry, value) => {if (!entry.finished) {
    entry.finished = true;entry.value=value;entry.record.errorCode=value.errorCode??null
    entry.record.stage=value.root?'projected':value.errorCode==='ACTIVITY_SESSION_ENDED'?'ended':'failed'
    entry.record.completedAt=at();if(value.errorCode&&!recoverableNativeListErrors.has(value.errorCode)&&value.errorCode!=='ACTIVITY_SESSION_ENDED')fatalError=value.errorCode
    entry.resolve(value)
  }}
  const loadBody=entry=>{
    if(entry.loadingBody||entry.finished||stopped)return
    entry.loadingBody=true;entry.record.stage='body';entry.record.bodyStartedAt=at();entry.record.failureStage='body-read'
    const timer=entry.timer=setTimeout(()=>settle(entry,{errorCode:'ACTIVITY_NATIVE_BODY_TIMEOUT'}),NATIVE_LIST_LIMITS.bodyTimeoutMs)
    void chrome.debugger.sendCommand(target,'Network.getResponseBody',{requestId:entry.requestId}).then(body=>{
      if(stopped||entry.finished)return
      entry.record.failureStage='decode'
      const text=body.base64Encoded?new TextDecoder().decode(Uint8Array.from(atob(body.body),c=>c.charCodeAt(0))):body.body
      if(typeof text!=='string')throw Error('ACTIVITY_NATIVE_BODY_UNAVAILABLE')
      entry.record.decodedBytes=new TextEncoder().encode(text).byteLength
      entry.record.failureStage='capacity'
      if(entry.record.decodedBytes>NATIVE_LIST_LIMITS.resourceBytes)throw Error('ACTIVITY_BODY_TOO_LARGE')
      entry.record.failureStage='json'
      let root;try{root=JSON.parse(text)}catch{throw Error('ACTIVITY_JSON_UNAVAILABLE')}
      entry.record.failureStage='projection'
      const projected=project(root);entry.record.records=(projected.aweme_list??projected.records??[]).length
      entry.record.failureStage=null
      settle(entry,{root:projected,sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',
        secUid,requestCursor:entry.cursor,httpStatus:200,observedAt:entry.observedAt},activeRequest:false})
    }).catch(error=>{
      if(stopped||entry.finished)return
      const classified=classifyActivityCommandError(error);entry.record.bodyError=entry.record.failureStage==='body-read'&&!/^[A-Z0-9_]+$/.test(error.message)?classified:null
      settle(entry,{errorCode:/^[A-Z0-9_]+$/.test(error.message)?error.message:classified==='BODY_EVICTED'?'ACTIVITY_NATIVE_BODY_EVICTED':
        classified==='BODY_NOT_RETAINED'?'ACTIVITY_NATIVE_BODY_NOT_RETAINED':['DEBUGGER_NOT_ATTACHED','TARGET_UNAVAILABLE','TARGET_NAVIGATED_OR_CLOSED'].includes(classified)?classified:'ACTIVITY_NATIVE_BODY_UNAVAILABLE'})
    }).finally(()=>clearTimeout(timer))
  }
  const listener = (source, method, params) => {
    if (stopped || source.tabId !== target.tabId) return
    if (method === 'Network.requestWillBeSent') {
      let url;try{url=new URL(params.request?.url)}catch{return}
      if(url.origin!=='https://www.douyin.com'||url.pathname!=='/aweme/v1/web/aweme/post/')return
      const reason=source.sessionId?'childSession':params.request.method!=='GET'?'method':url.searchParams.get('sec_user_id')!==secUid?'author':matches(params.request.url)===null?'cursor':null
      if(reason){ignored[reason]=Math.min(100000,ignored[reason]+1);return}
      const cursor = params.request?.method === 'GET' ? matches(params.request.url) : null
      if (cursor === null) return
      if (requests.has(params.requestId)) {settle(requests.get(params.requestId), {errorCode: 'ACTIVITY_NATIVE_REDIRECT'}); return}
      nativeListRequests++
      if(requests.size>=NATIVE_LIST_LIMITS.requests){dropped++;fatalError='ACTIVITY_NATIVE_REQUEST_LIMIT';return}
      const record={sequence:nativeListRequests,cursor,stage:'request',requestedAt:at(),responseAt:null,loadedAt:null,bodyStartedAt:null,completedAt:null,
        httpStatus:null,encodedBytes:null,decodedBytes:null,responseSource:null,records:null,bodyError:null,errorCode:null,failureStage:null}
      records.push(record)
      const entry = {cursor,record,requestId:params.requestId,finished:false,response:false,loaded:false,loadingBody:false,observedAt:record.requestedAt}
      entry.promise = new Promise(resolve => {entry.resolve = resolve})
      requests.set(params.requestId, entry)
      if (!pages.has(cursor)) pages.set(cursor, entry)
    }
    if(source.sessionId)return
    const entry = requests.get(params.requestId)
    if (!entry || entry.finished) return
    if (method === 'Network.responseReceived') {
      if (matches(params.response?.url) !== entry.cursor) {settle(entry, {errorCode: 'ACTIVITY_NATIVE_RESPONSE_MISMATCH'}); return}
      entry.response = true
      Object.assign(entry.record,{stage:'response',responseAt:at(),httpStatus:params.response.status,
        responseSource:params.response.fromServiceWorker?'service-worker':params.response.fromDiskCache?'disk-cache':'network'})
      if (params.response.status !== 200) settle(entry, {errorCode: 'ACTIVITY_HTTP_' + params.response.status})
    } else if (method === 'Network.loadingFailed') {
      settle(entry, {errorCode: 'ACTIVITY_NATIVE_LOAD_FAILED'})
    } else if (method === 'Network.loadingFinished') {
      Object.assign(entry.record,{stage:'loaded',loadedAt:at(),encodedBytes:Number.isFinite(params.encodedDataLength)?Math.max(0,params.encodedDataLength):null})
      if (!entry.response) {settle(entry, {errorCode: 'ACTIVITY_NATIVE_BODY_UNAVAILABLE'}); return}
      if(params.encodedDataLength>NATIVE_LIST_LIMITS.resourceBytes){settle(entry,{errorCode:'ACTIVITY_BODY_TOO_LARGE'});return}
      entry.loaded=true
      // Read the first page as soon as it arrives, keep only the small projection.
      // Later native pages remain lazy; no platform requests are issued here.
      if(!lazy||entry.cursor===0)loadBody(entry)
    }
  }
  chrome.debugger.onEvent.addListener(listener)
  try {await chrome.debugger.sendCommand(target, 'Network.enable', {maxTotalBufferSize:NATIVE_LIST_LIMITS.totalBytes,maxResourceBufferSize:NATIVE_LIST_LIMITS.resourceBytes})}
  catch (error) {chrome.debugger.onEvent.removeListener(listener); throw error}
  return {
    get nativeListRequests() {return nativeListRequests},
    get fatalError(){return fatalError},
    clearTransportFailure(){
      const transient=new Set(['DEBUGGER_NOT_ATTACHED','TARGET_NAVIGATED_OR_CLOSED','EXECUTION_CONTEXT_UNAVAILABLE'])
      if(transient.has(fatalError))fatalError=null
      for(const [cursor,entry] of pages)if(transient.has(entry.value?.errorCode))pages.delete(cursor)
    },
    snapshot(){return {startedAt,limits:{...NATIVE_LIST_LIMITS},matchedRequests:nativeListRequests,
      ignored:{...ignored},requests:records.map(r=>({...r})),availability:lastAvailability?{...lastAvailability}:null,dropped,fatalError}},
    async availablePage(cursor,{active=async()=>{},waitMs=NATIVE_LIST_LIMITS.readyWaitMs,arrivalWaitMs=NATIVE_LIST_LIMITS.arrivalWaitMs,
      now=Date.now,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
      const started=now(),deadline=started+waitMs
      while(true){
        await active()
        if(fatalError)return {errorCode:fatalError}
        const entry=pages.get(cursor)
        if(entry?.loaded)loadBody(entry)
        if(entry?.finished){lastAvailability={at:at(),waitedMs:Math.max(0,now()-started),outcome:entry.value.root?'ready':entry.value.errorCode,errorCode:entry.value.errorCode??null};return entry.value}
        if(stopped||now()>=deadline||(!entry&&now()-started>=arrivalWaitMs)){
          const errorCode=stopped?'ACTIVITY_SESSION_ENDED':!entry?'ACTIVITY_NATIVE_LIST_UNAVAILABLE':entry.loadingBody?'ACTIVITY_NATIVE_BODY_TIMEOUT':'ACTIVITY_NATIVE_PENDING'
          lastAvailability={at:at(),waitedMs:Math.max(0,now()-started),outcome:errorCode,errorCode}
          return {errorCode}
        }
        await delay(Math.min(100,Math.max(0,deadline-now()),!entry?Math.max(0,arrivalWaitMs-(now()-started)):100))
      }
    },
    async page(cursor, {waitMs = 8000, active = async () => {}} = {}) {
      const deadline = Date.now() + waitMs
      do {
        await active()
        const entry = pages.get(cursor)
        if (entry) {
          if(entry.loaded)loadBody(entry)
          const value = await Promise.race([entry.promise, new Promise(resolve => setTimeout(() => resolve(null), 100))])
          if (value) return value
        } else if (cursor !== 0) return null
        if (Date.now() >= deadline) return {errorCode: cursor === 0 && !entry ? 'ACTIVITY_NATIVE_LIST_UNAVAILABLE' : 'ACTIVITY_NATIVE_BODY_UNAVAILABLE'}
        if (!entry) await new Promise(resolve => setTimeout(resolve, 100))
      } while (true)
    },
    async stop({keepNetworkEnabled=false}={}) {
      if (stopped) return
      stopped = true; chrome.debugger.onEvent.removeListener(listener)
      for (const entry of requests.values()){clearTimeout(entry.timer);settle(entry, {errorCode: 'ACTIVITY_SESSION_ENDED'})}
      if(!keepNetworkEnabled)await chrome.debugger.sendCommand(target, 'Network.disable').catch(() => {})
    }
  }
}
