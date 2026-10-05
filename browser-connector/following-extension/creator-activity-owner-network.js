// One run, one newly created author tab. Follow committed same-author main
// documents in that tab; never treat a document request as a commit or reuse cache.
export function projectCreatorActivityOwner(input,expected){
  const root=input?.data||input,user=root?.user||root?.user_info
  if(root?.status_code!==0||!user?.sec_uid)throw Error('LOGIN_REQUIRED')
  const uid=String(user.uid||''),secUid=user.sec_uid,id=/^[A-Za-z0-9._-]{1,240}$/
  if(!id.test(uid)||!id.test(secUid))throw Error('ACCOUNT_IDENTITY_UNAVAILABLE')
  if(secUid!==expected.ownerSecUid||(expected.ownerUid&&uid!==expected.ownerUid))throw Error('OWNER_IDENTITY_MISMATCH')
  return {uid,secUid}
}

export function observeCreatorActivityOwner(chrome,target,scope){
  const endpoint='/aweme/v1/web/user/profile/self/',entries=new Map(),documents=[],transitions=[]
  let stopped=false,armed=false,startedAt=null,navigation=null,observed=0,failure=null,currentDocument=null,latestMainRequest=null
  const matches=raw=>{try{const url=new URL(raw);return url.origin==='https://www.douyin.com'&&url.pathname===endpoint}catch{return false}}
  const documentKind=raw=>{try{const url=new URL(raw);return url.origin==='https://www.douyin.com'?(url.pathname==='/user/'+scope.firstAuthorSecUid?'first-author':'other-platform'):'other-origin'}catch{return 'missing'}}
  const relation=(expected,actual,missing='navigation-missing')=>!expected?missing:!actual?'request-missing':actual===expected?'match':'different'
  const settle=(entry,value)=>{if(!entry.finished){entry.finished=true;entry.value=value;entry.resolve(value)}}
  const listener=(source,method,params)=>{
    if(stopped||!armed||source.tabId!==target.tabId)return
    if(method==='Page.frameNavigated'&&params.frame){
      const frame=params.frame
      // Only committed top-level documents can establish the current source.
      // Child frames may have their own loaders but cannot prove the account page.
      if(!source.sessionId&&!frame.parentId&&frame.id&&frame.loaderId){
        currentDocument={loaderId:frame.loaderId,frameId:frame.id,document:documentKind(frame.url),committed:true}
        if(transitions.length<8)transitions.push({...currentDocument})
        if((navigation?.frameId&&frame.id!==navigation.frameId)||documentKind(frame.url)!=='first-author'){
          failure='ACCOUNT_NATIVE_DOCUMENT_CHANGED';return
        }
      }
    }
    if(!source.sessionId&&method==='Page.navigatedWithinDocument'&&params.frameId===navigation?.frameId&&documentKind(params.url)!=='first-author')failure='ACCOUNT_NATIVE_DOCUMENT_CHANGED'
    if(!source.sessionId&&method==='Page.frameDetached'&&params.frameId===navigation?.frameId)failure='ACCOUNT_NATIVE_DOCUMENT_CHANGED'
    if(!source.sessionId&&method==='Network.requestWillBeSent'&&params.type==='Document'){
      const document={loaderId:params.loaderId,frameId:params.frameId,document:documentKind(params.request?.url),redirect:!!params.redirectResponse}
      if(documents.length<8)documents.push(document)
      // The evidence array is bounded. The live source guard must keep tracking
      // the latest main document even after that evidence array fills up.
      if(params.frameId===navigation?.frameId)latestMainRequest=document
    }
    if(method==='Network.requestWillBeSent'&&params.request?.method==='GET'&&matches(params.request.url)){
      observed++
      if(entries.has(params.requestId)){failure='ACCOUNT_NATIVE_REDIRECT';settle(entries.get(params.requestId),{errorCode:failure});return}
      if(entries.size>=4){failure='ACCOUNT_NATIVE_REQUEST_LIMIT';return}
      const entry={finished:false,response:false,observedAt:new Date().toISOString(),loaderId:params.loaderId,frameId:params.frameId,
        childSession:!!source.sessionId,document:documentKind(params.documentURL),requestType:['XHR','Fetch'].includes(params.type)?params.type:'other',
        stage:'request',json:'pending',identity:'pending'}
      entry.promise=new Promise(resolve=>{entry.resolve=resolve});entries.set(params.requestId,entry)
    }
    const entry=entries.get(params.requestId)
    if(!entry||entry.finished)return
    if(method==='Network.responseReceived'){
      entry.stage='response';entry.httpStatus=Number.isInteger(params.response?.status)?params.response.status:undefined
      entry.responseSource=params.response?.fromServiceWorker?'service-worker':params.response?.fromDiskCache?'disk-cache':'network'
      if(!matches(params.response?.url)){settle(entry,{errorCode:'ACCOUNT_NATIVE_RESPONSE_MISMATCH'});return}
      entry.response=true
      if(params.response.status!==200)settle(entry,{errorCode:'ACTIVITY_HTTP_'+params.response.status})
    }else if(method==='Network.loadingFailed'){entry.stage='load-failed';settle(entry,{errorCode:'ACCOUNT_NATIVE_LOAD_FAILED'})}
    else if(method==='Network.loadingFinished'){
      entry.stage='body'
      if(!entry.response||params.encodedDataLength>1024*1024){settle(entry,{errorCode:'ACCOUNT_NATIVE_BODY_UNAVAILABLE'});return}
      void chrome.debugger.sendCommand(target,'Network.getResponseBody',{requestId:params.requestId}).then(body=>{
        const text=body.base64Encoded?new TextDecoder().decode(Uint8Array.from(atob(body.body),c=>c.charCodeAt(0))):body.body
        if(text.length>1024*1024)throw Error('ACCOUNT_NATIVE_BODY_TOO_LARGE')
        let root;try{root=JSON.parse(text);entry.json='valid'}catch{entry.json='invalid';throw Error('ACTIVITY_JSON_UNAVAILABLE')}
        entry.stage='identity'
        let owner;try{owner=projectCreatorActivityOwner(root,scope);entry.identity='matched'}catch(error){entry.identity=error.message==='OWNER_IDENTITY_MISMATCH'?'mismatch':'missing';throw error}
        entry.stage='identity-checked'
        settle(entry,{proof:{contract:'signaldesk-activity-owner/v1',kind:'native-network',runId:scope.runId,
          uid:owner.uid,secUid:owner.secUid,endpoint,method:'GET',httpStatus:200,observedAt:entry.observedAt,
          navigationStartedAt:startedAt,firstAuthorSecUid:scope.firstAuthorSecUid,tabId:target.tabId}})
      }).catch(error=>settle(entry,{errorCode:/^[A-Z0-9_-]{1,100}$/.test(error.message)?error.message:'ACCOUNT_NATIVE_BODY_UNAVAILABLE'}))
    }
  }
  chrome.debugger.onEvent.addListener(listener)
  return {
    get observedRequests(){return observed},
    // Whitelist relations and processing stages only. Raw CDP IDs, URLs,
    // credentials and response fields never enter the persisted diagnostics.
    diagnostics(){return {contract:'signaldesk-activity-owner-diagnostics/v1',navigationBound:!!navigation,navigationFailed:!!navigation?.errorText,
      navigationLoaderPresent:!!navigation?.loaderId,navigationFramePresent:!!navigation?.frameId,observedRequests:observed,
      documents:documents.map(entry=>({document:entry.document,redirect:entry.redirect,loader:relation(navigation?.loaderId,entry.loaderId),frame:relation(navigation?.frameId,entry.frameId)})),
      currentDocument:currentDocument?{document:currentDocument.document,committed:currentDocument.committed,
        loader:relation(navigation?.loaderId,currentDocument.loaderId),frame:relation(navigation?.frameId,currentDocument.frameId)}:null,
      transitions:transitions.map(entry=>({document:entry.document,loader:relation(navigation?.loaderId,entry.loaderId),frame:relation(navigation?.frameId,entry.frameId)})),
      requests:[...entries.values()].map(entry=>({loader:relation(navigation?.loaderId,entry.loaderId),frame:relation(navigation?.frameId,entry.frameId),
        currentLoader:relation(currentDocument?.loaderId,entry.loaderId,'document-missing'),currentFrame:relation(currentDocument?.frameId,entry.frameId,'document-missing'),
        document:entry.document,childSession:entry.childSession,requestType:entry.requestType,stage:entry.stage,json:entry.json,identity:entry.identity,
        ...(entry.httpStatus===undefined?{}:{httpStatus:entry.httpStatus}),...(entry.responseSource?{responseSource:entry.responseSource}:{}),
        ...(entry.value?.errorCode?{errorCode:entry.value.errorCode}:{})})),...(failure?{errorCode:failure}:{})}},
    beginNavigation(){if(armed)throw Error('ACCOUNT_NAVIGATION_REUSED');startedAt=new Date().toISOString();armed=true;return startedAt},
    bindNavigation(value){
      navigation=value
      // A navigate result alone is not a commit. Preserve a commit event that
      // arrived before the command returned, then bind it to the same main frame.
      if(currentDocument?.committed&&currentDocument.frameId!==value?.frameId)failure='ACCOUNT_NATIVE_NAVIGATION_MISMATCH'
      if((value?.loaderId||value?.frameId)&&!currentDocument?.committed)currentDocument={loaderId:value.loaderId,frameId:value.frameId,document:'first-author',committed:false}
      latestMainRequest=[...documents].reverse().find(entry=>entry.frameId===value?.frameId)||null
      if(value?.errorText)failure='AUTHOR_CONTEXT_NAVIGATION_FAILED'
    },
    async result({active=async()=>{},waitMs=8000,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
      await active()
      if(!armed||stopped)throw Error('ACCOUNT_NATIVE_SESSION_ENDED')
      if(failure)return {errorCode:failure}
      const deadline=Date.now()+waitMs
      do{
        await active()
        if(failure)return {errorCode:failure}
        if(!navigation?.frameId||!navigation?.loaderId||!currentDocument?.committed){failure='ACCOUNT_NATIVE_DOCUMENT_UNCOMMITTED';return {errorCode:failure}}
        if(currentDocument.frameId!==navigation.frameId||currentDocument.document!=='first-author'){failure='ACCOUNT_NATIVE_DOCUMENT_CHANGED';return {errorCode:failure}}
        if(latestMainRequest&&latestMainRequest.loaderId!==currentDocument.loaderId){failure='ACCOUNT_NATIVE_DOCUMENT_UNCOMMITTED';return {errorCode:failure}}
        // The required count/page read has completed. Only an absent native self
        // request permits one explicit GET; an observed rejection never does.
        if(!entries.size){this.stop();return null}
        for(const entry of entries.values()){
          // Errors remain terminal even if another native response is available.
          if(entry.value?.errorCode)return entry.value
          if(entry.childSession||entry.document!=='first-author'||entry.frameId!==currentDocument.frameId||entry.loaderId!==currentDocument.loaderId){failure='ACCOUNT_NATIVE_NAVIGATION_MISMATCH';return {errorCode:failure}}
        }
        if([...entries.values()].every(entry=>entry.finished))return [...entries.values()][0].value
        if(Date.now()>=deadline)return {errorCode:'ACCOUNT_NATIVE_BODY_UNAVAILABLE'}
        await pause(50)
      }while(true)
    },
    stop(){if(stopped)return;stopped=true;chrome.debugger.onEvent.removeListener(listener);for(const entry of entries.values())settle(entry,{errorCode:'ACCOUNT_NATIVE_SESSION_ENDED'});entries.clear()}
  }
}
