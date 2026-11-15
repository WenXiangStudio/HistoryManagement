// Verify only the local review artifact in an isolated, invisible Electron window.
// No media playback, model calls, APP data access, or external requests.
const {app,BrowserWindow,session}=require('electron')
const {join,resolve}=require('node:path')
const {mkdirSync,writeFileSync}=require('node:fs')
const record=resolve('local-data/detection-triage-fourteen-20261013/review-qa')
mkdirSync(record,{recursive:true})
app.setPath('userData',join(record,'isolated-profile'))
app.disableHardwareAcceleration()
app.whenReady().then(async()=>{
  let win
  try{
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}))
    win=new BrowserWindow({show:false,width:1280,height:920,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
    const errors=[]
    win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message)})
    await win.loadFile(resolve('docs/evidence/detection-triage-fourteen-20261013/review.html'))
    const inspect=await win.webContents.executeJavaScript(`(async()=>{
      const images=[...document.querySelectorAll('img')];for(const im of images)im.loading='eager';
      await Promise.all(images.map(im=>im.complete?Promise.resolve():new Promise(r=>{im.onload=r;im.onerror=r})))
      const cards=[...document.querySelectorAll('article')],first=cards[0],manual=first.querySelector('.manual');
      manual.value='口播主导或口播加图文';manual.dispatchEvent(new Event('change'));
      const saved=JSON.parse(localStorage.getItem('signaldesk-triage-fourteen-20261013'));
      return {cards:cards.length,images:images.length,allImagesLoaded:images.every(im=>im.naturalWidth>0),
        videos:document.querySelectorAll('video').length,allVideosPaused:[...document.querySelectorAll('video')].every(v=>v.paused),
        allVideosPreloadNone:[...document.querySelectorAll('video')].every(v=>v.preload==='none'),
        reviewStored:saved[first.dataset.work]?.manualCategory==='口播主导或口播加图文',
        progress:document.querySelector('#progress').textContent,overflow:document.documentElement.scrollWidth>innerWidth}
    })()`)
    if(inspect.cards!==14||inspect.images!==112||!inspect.allImagesLoaded||!inspect.allVideosPaused||!inspect.reviewStored||inspect.overflow||errors.length)
      throw Error('Review artifact failed verification')
    await win.webContents.executeJavaScript(`localStorage.removeItem('signaldesk-triage-fourteen-20261013')`)
    const report={verifiedAt:new Date().toISOString(),inspect,rendererErrors:errors,modelRequests:0,mediaPlayback:false,userAppWrites:0}
    writeFileSync(join(record,'report.json'),JSON.stringify(report,null,2))
    console.log(JSON.stringify(report));win.destroy();app.exit(0)
  }catch(error){console.error(error.message);win?.destroy();app.exit(1)}
})
