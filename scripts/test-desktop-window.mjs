// Native Windows regression: Electron's isVisible alone missed a SW_HIDE launch.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,relative} from 'node:path'
import {build} from 'esbuild'
if(process.platform!=='win32')throw Error('Run the native window regression on Windows')
const directory=mkdtempSync(join(tmpdir(),'signal-desk-window-check-'))
const executable=resolve('node_modules/electron/dist/electron.exe')
await build({entryPoints:['src/main/desktopWindow.ts'],outfile:join(directory,'controller.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']})
writeFileSync(join(directory,'audit.ps1'),String.raw`param([long]$WindowHandle)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowCheck {
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int index);
}
'@
$handle=[IntPtr]$WindowHandle
[pscustomobject]@{visible=[WindowCheck]::IsWindowVisible($handle);minimized=[WindowCheck]::IsIconic($handle);toolWindow=([WindowCheck]::GetWindowLongPtr($handle,-20).ToInt64() -band 128) -ne 0} | ConvertTo-Json -Compress
`)
writeFileSync(join(directory,'main.cjs'),String.raw`
const assert=require('node:assert/strict'),{app,BrowserWindow,screen}=require('electron'),{execFileSync,spawn}=require('node:child_process'),{join}=require('node:path'),{writeFileSync}=require('node:fs')
const {DesktopWindowController}=require('./controller.cjs'),mode=process.env.WINDOW_CHECK_MODE
app.setName('Signal Desk Window Check');app.disableHardwareAcceleration()
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let window,controller,finishing=false,created=0,second=0
const native=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(__dirname,'audit.ps1'),'-WindowHandle',window.getNativeWindowHandle().readBigUInt64LE().toString()],{encoding:'utf8',windowsHide:true}))
const wait=async predicate=>{for(let i=0;i<60;i++){if(predicate())return;await pause(100)}throw Error('Window state timeout')}
const create=()=>{created++;window=new BrowserWindow({title:'Signal Desk Window Check',width:560,height:240,show:true,webPreferences:{sandbox:true}});window.loadURL('data:text/html,<h2>Signal Desk window recovery check</h2>');return window}
app.on('second-instance',()=>{second++;controller?.open()})
app.on('window-all-closed',()=>{if(finishing)app.quit()})
app.on('before-quit',()=>controller?.stop())
if(!app.requestSingleInstanceLock())app.quit()
else app.whenReady().then(async()=>{
 const result={mode}
 if(mode==='before'){
  create();await new Promise(resolve=>window.once('ready-to-show',resolve));await pause(150);result.startup=native()
 }else{
  controller=new DesktopWindowController({create,workAreas:()=>screen.getAllDisplays().map(d=>d.workArea),log:()=>{}})
  controller.open();controller.start();await wait(()=>window.isVisible());await pause(150)
  result.startup=native();assert.equal(result.startup.visible,true);assert.equal(result.startup.toolWindow,false)
  window.minimize();await wait(()=>window.isMinimized());await pause(200);result.minimized=native();assert.equal(result.minimized.minimized,true)
  const helper=spawn(process.execPath,[__filename,'--user-data-dir='+app.getPath('userData')],{windowsHide:true,stdio:'ignore'})
  await new Promise((resolve,reject)=>{helper.once('error',reject);helper.once('exit',code=>code===0?resolve():reject(Error('Second launch failed')))})
  await wait(()=>second===1&&!window.isMinimized());result.reopened=native();assert.equal(result.reopened.visible,true);assert.equal(result.reopened.minimized,false);assert.equal(created,1)
  window.hide();await pause(150);result.hiddenRecovered=native();assert.equal(result.hiddenRecovered.visible,true)
  window.setBounds({x:30000,y:30000,width:560,height:240});controller.open();assert.ok(window.getBounds().x<30000);result.offscreenRecovered=true
  window.destroy();await pause(100);controller.open();await wait(()=>created===2&&window.isVisible());result.recreated=native();assert.equal(result.recreated.visible,true)
  result.singleInstance=true;result.closedWindowRecreated=true
 }
 writeFileSync(join(__dirname,mode+'.json'),JSON.stringify(result));finishing=true;window.close()
}).catch(error=>{writeFileSync(join(__dirname,'error.txt'),String(error.stack));app.exit(1)})
`)
try{
 for(const mode of ['before','after']){
  const child=spawn(executable,[join(directory,'main.cjs'),'--user-data-dir='+join(directory,'profile-'+mode)],{env:{...process.env,WINDOW_CHECK_MODE:mode},windowsHide:true,stdio:['ignore','ignore','pipe']})
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk.toString())
  await new Promise((resolveDone,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(Error('Window check timeout: '+stderr))},30000)
   child.once('error',error=>{clearTimeout(timer);reject(error)})
   child.once('exit',code=>{clearTimeout(timer);code===0?resolveDone():reject(Error('Window check failed: '+stderr+' '+(existsSync(join(directory,'error.txt'))?readFileSync(join(directory,'error.txt'),'utf8'):'No diagnostic file')))})
  })
 }
 const before=JSON.parse(readFileSync(join(directory,'before.json'),'utf8')),after=JSON.parse(readFileSync(join(directory,'after.json'),'utf8'))
 assert.equal(before.startup.visible,false,'The old hidden-start regression must be reproduced')
 console.log(JSON.stringify({oldHiddenStartupReproduced:true,...after,normalCloseExited:true},null,2))
}finally{
 // This is the exact temporary directory created above, never a computed user profile.
 assert.ok(relative(tmpdir(),directory).startsWith('signal-desk-window-check-'))
 rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200})
}
