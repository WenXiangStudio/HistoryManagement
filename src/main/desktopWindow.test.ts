import {EventEmitter} from 'node:events'
import type {BrowserWindow} from 'electron'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {DesktopWindowController} from './desktopWindow'
class WindowFixture extends EventEmitter {
  webContents=new EventEmitter()
  visible=false;minimized=false;destroyed=false
  bounds={x:100,y:100,width:1200,height:800}
  isDestroyed=()=>this.destroyed
  isVisible=()=>this.visible
  isMinimized=()=>this.minimized
  getBounds=()=>this.bounds
  center=vi.fn()
  setSkipTaskbar=vi.fn()
  restore=vi.fn(()=>{this.minimized=false})
  show=vi.fn(()=>{this.visible=true})
  showInactive=vi.fn(()=>{this.visible=true})
  focus=vi.fn()
}
const setup=()=>{
  const windows:WindowFixture[]=[],log=vi.fn()
  const create=vi.fn(()=>{const window=new WindowFixture();windows.push(window);return window as unknown as BrowserWindow})
  return {windows,log,create,controller:new DesktopWindowController({create,log,workAreas:()=>[{x:0,y:0,width:1920,height:1080}]})}
}
afterEach(()=>vi.useRealTimers())
describe('desktop window reachability',()=>{
  it('shows a hidden-launch window when ready and keeps a taskbar entry',()=>{
    const {controller,windows}=setup();controller.start();const window=windows[0]
    expect(window.visible).toBe(false);window.emit('ready-to-show')
    expect(window.visible).toBe(true);expect(window.focus).toHaveBeenCalled();expect(window.setSkipTaskbar).toHaveBeenCalledWith(false)
  })
  it('handles reopening before initialization without creating a second window',()=>{
    const {controller,windows,create}=setup();controller.open();expect(create).not.toHaveBeenCalled()
    controller.start();windows[0].emit('ready-to-show');controller.open()
    expect(create).toHaveBeenCalledTimes(1);expect(windows[0].visible).toBe(true)
  })
  it('restores minimized and offscreen windows when reopened',()=>{
    const {controller,windows}=setup();controller.start();const window=windows[0]
    window.minimized=true;window.bounds.x=5000;controller.open()
    expect(window.restore).toHaveBeenCalled();expect(window.center).toHaveBeenCalled();expect(window.visible).toBe(true)
  })
  it('recreates a destroyed window rather than using its old reference',()=>{
    const {controller,windows,create}=setup();controller.start();windows[0].destroyed=true;windows[0].emit('closed')
    controller.open();expect(create).toHaveBeenCalledTimes(2);windows[1].emit('ready-to-show');expect(windows[1].visible).toBe(true)
  })
  it('recovers unintended hiding without stealing focus',()=>{
    vi.useFakeTimers();const {controller,windows}=setup();controller.start();windows[0].emit('hide');vi.runAllTimers()
    expect(windows[0].showInactive).toHaveBeenCalled();expect(windows[0].focus).not.toHaveBeenCalled()
  })
  it('does not undo ordinary minimization or reopen while quitting',()=>{
    vi.useFakeTimers();const {controller,windows,create}=setup();controller.start();windows[0].minimized=true;windows[0].emit('hide');vi.runAllTimers()
    expect(windows[0].showInactive).not.toHaveBeenCalled()
    windows[0].minimized=false;windows[0].emit('hide');controller.stop();windows[0].emit('ready-to-show');controller.open();vi.runAllTimers()
    expect(windows[0].show).not.toHaveBeenCalled();expect(windows[0].showInactive).not.toHaveBeenCalled();expect(create).toHaveBeenCalledTimes(1)
  })
  it('records renderer failure reasons',()=>{
    const {controller,windows,log}=setup();controller.start();windows[0].webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:1})
    expect(log).toHaveBeenCalledWith('renderer-exited',{reason:'crashed',exitCode:1})
  })
})
