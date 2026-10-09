// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import VirtualTableBody from './VirtualTableBody'
let container:HTMLDivElement,root:Root
const rows=Array.from({length:300},(_,id)=>({id:String(id),name:`博主${id}`}))
const render=async(items=rows,pinnedKey?:string)=>act(async()=>root.render(createElement('div',{className:'scroll'},createElement('table',null,
  createElement('thead',null,createElement('tr',null,createElement('th',null,'昵称'))),
  createElement(VirtualTableBody<typeof rows[number]>,{rows:items,rowKey:row=>row.id,columnCount:1,estimatedHeight:50,pinnedKey,
    renderRow:row=>createElement('tr',{'data-id':row.id},createElement('td',null,row.name))})))))
const scroll=async(top:number)=>act(async()=>{
  const element=container.querySelector<HTMLElement>('.scroll')!
  Object.defineProperty(element,'clientHeight',{configurable:true,value:400})
  element.scrollTop=top;element.dispatchEvent(new Event('scroll'));await vi.advanceTimersByTimeAsync(20)
})
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()})
describe('scrollable table rendering',()=>{
  it('renders a bounded range and reaches the final creator without changing the full table height',async()=>{
    await render()
    expect(container.querySelectorAll('[data-id]').length).toBeLessThan(25)
    expect(container.querySelector('[data-id="0"]')).not.toBeNull()
    expect(container.querySelector('[data-id="299"]')).toBeNull()
    expect(container.querySelector('[data-id="0"]')?.getAttribute('aria-rowindex')).toBe('2')
    await scroll(14600)
    expect(container.querySelector('[data-id="299"]')).not.toBeNull()
    expect(container.querySelector('[data-id="0"]')).toBeNull()
    expect(container.querySelectorAll('[data-id]').length).toBeLessThan(25)
    const spacers=[...container.querySelectorAll<HTMLElement>('.virtual-table-spacer td')].reduce((sum,cell)=>sum+parseFloat(cell.style.height),0)
    expect(spacers+container.querySelectorAll('[data-id]').length*50).toBe(15000)
    await scroll(0)
    expect(container.querySelector('[data-id="0"]')).not.toBeNull()
  })
  it('keeps an editing row mounted offscreen and updates membership after filtering and sorting',async()=>{
    await render(rows,'0');await scroll(14600)
    expect(container.querySelector('[data-id="0"]')).not.toBeNull()
    expect(container.querySelector('[data-id="299"]')).not.toBeNull()
    await render(rows.slice(-3).reverse());await scroll(0)
    expect([...container.querySelectorAll('[data-id]')].map(row=>row.getAttribute('data-id'))).toEqual(['299','298','297'])
    expect(container.querySelectorAll('.virtual-table-spacer')).toHaveLength(0)
    await render([])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
  })
  it('uses observed row heights for wrapped text instead of assuming fixed-height content',async()=>{
    const observers:{callback:ResizeObserverCallback;targets:Element[]}[]=[]
    vi.stubGlobal('ResizeObserver',class {entry:{callback:ResizeObserverCallback;targets:Element[]};constructor(callback:ResizeObserverCallback){this.entry={callback,targets:[]};observers.push(this.entry)}observe(target:Element){this.entry.targets.push(target)}disconnect(){}})
    await render()
    const observer=observers.find(item=>item.targets.some(target=>target.hasAttribute('data-id')))!
    const first=container.querySelector('[data-id="0"]')!
    await act(async()=>observer.callback([{target:first,borderBoxSize:[{blockSize:150,inlineSize:200}],contentRect:{height:150}} as unknown as ResizeObserverEntry],{} as ResizeObserver))
    await scroll(14600)
    const spacer=container.querySelector<HTMLElement>('.virtual-table-spacer td')!
    const firstVisible=Number(container.querySelector('[data-id]')!.getAttribute('data-id'))
    expect(parseFloat(spacer.style.height)).toBe(firstVisible*50+100)
  })
})
