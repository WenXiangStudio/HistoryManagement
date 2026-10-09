import type {BrowserWindow,Rectangle} from 'electron'

export type WindowLog=(event:string,details?:Record<string,string|number|boolean>)=>void
type Options={create:()=>BrowserWindow;workAreas:()=>Rectangle[];log:WindowLog;inactive?:boolean}

/** This application has no tray-only mode: an opened desktop must remain reachable. */
export class DesktopWindowController {
  private window:BrowserWindow|null=null
  private ready=false
  private quitting=false
  constructor(private readonly options:Options){}
  start():void {this.ready=true;this.open()}
  open():void {
    if(this.quitting||!this.ready)return
    if(this.window&&!this.window.isDestroyed()){this.reveal(this.window);return}
    const window=this.options.create();this.window=window
    this.options.log('window-created')
    // The launcher can pass SW_HIDE; the constructor's show flag is insufficient.
    window.once('ready-to-show',()=>{if(!this.quitting&&!window.isDestroyed())this.reveal(window)})
    window.once('closed',()=>{if(this.window===window)this.window=null;this.options.log('window-closed')})
    window.on('hide',()=>{
      this.options.log('window-hidden')
      setTimeout(()=>{
        if(this.quitting||window.isDestroyed()||window.isMinimized()||window.isVisible())return
        this.options.log('hidden-window-restored');this.reveal(window,true)
      },0)
    })
    window.on('minimize',()=>this.options.log('window-minimized'))
    window.webContents.on('render-process-gone',(_event,details)=>this.options.log('renderer-exited',{reason:details.reason,exitCode:details.exitCode}))
  }
  stop():void {this.quitting=true}
  private reveal(window:BrowserWindow,inactive=this.options.inactive??false):void {
    if(window.isMinimized())window.restore()
    const bounds=window.getBounds()
    const reachable=this.options.workAreas().some(area=>Math.min(bounds.x+bounds.width,area.x+area.width)-Math.max(bounds.x,area.x)>=64
      &&Math.min(bounds.y+bounds.height,area.y+area.height)-Math.max(bounds.y,area.y)>=64)
    if(!reachable)window.center()
    window.setSkipTaskbar(false)
    if(inactive)window.showInactive()
    else {window.show();window.focus()}
    this.options.log('window-shown',{visible:window.isVisible(),minimized:window.isMinimized()})
  }
}
