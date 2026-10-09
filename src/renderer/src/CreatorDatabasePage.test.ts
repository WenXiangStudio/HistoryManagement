// @vitest-environment jsdom
import {Activity,act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import CreatorDatabasePage from './CreatorDatabasePage'
import {DEFAULT_CREATOR_DATABASE_COLUMNS,type CreatorDatabaseView} from '../../shared/creatorDatabase'
let root:Root,container:HTMLDivElement,view:CreatorDatabaseView,changed:()=>void
const update=vi.fn(),get=vi.fn(),dirty=vi.fn()
const row=(secUid:string,nickname:string,count:number,tier:string)=>({secUid,nickname,profileUrl:`https://www.douyin.com/user/${secUid}`,
  values:{nickname,lastPublishedDate:'2026-10-02',workCount:count,intervalHours:49,tier},automatic:{nickname,lastPublishedDate:'2026-10-02',workCount:count,intervalHours:49,tier},manualColumns:[] as string[]})
const mount=async()=>act(async()=>root.render(createElement(CreatorDatabasePage,{onEditingChange:dirty})))
const click=async(selector:string)=>act(async()=>container.querySelector<HTMLButtonElement>(selector)!.click())
async function button(text:string){await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent===text)!.click())}
async function input(selector:string,value:string){await act(async()=>{const element=container.querySelector<HTMLInputElement|HTMLSelectElement>(selector)!
  Object.getOwnPropertyDescriptor(element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(element,value)
  element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}))})}
async function submit(selector:string){await act(async()=>container.querySelector(selector)!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear()
  view={ownerSecUid:'owner',revision:0,columns:DEFAULT_CREATOR_DATABASE_COLUMNS.map(c=>({...c})),rows:[row('one','甲博主',30,'active'),row('two','乙博主',5,'inactive')]}
  get.mockReset().mockImplementation(async()=>structuredClone(view))
  update.mockReset().mockImplementation(async mutation=>{
    if(mutation.action==='add-column'){const c={id:'custom_123456789012345678901234',name:mutation.name,kind:mutation.kind??'text',builtin:false};view.columns.push(c);view.rows.forEach(r=>r.values={...r.values,[c.id]:null})}
    if(mutation.action==='format-column')Object.assign(view.columns.find(c=>c.id===mutation.columnId)!,{name:mutation.name,width:mutation.width,align:mutation.align})
    if(mutation.action==='set-cell'){const r=view.rows.find(r=>r.secUid===mutation.secUid)!;r.values={...r.values,[mutation.columnId]:mutation.value};r.manualColumns.push(mutation.columnId)}
    if(mutation.action==='remove-column')view.columns=view.columns.filter(c=>c.id!==mutation.columnId)
    view={...view,revision:view.revision+1};return structuredClone(view)
  })
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getCreatorDatabase:get,updateCreatorDatabase:update,onDataChanged:(cb:()=>void)=>{changed=cb;return()=>{}}}})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('read-only source table with editable format and custom filters',()=>{
  it('retains table and chart instances, drilldown, and sorting when switching views',async()=>{
    view.rows[0].values.intervalHours=12
    await mount();await click('th:nth-child(3) button')
    const table=container.querySelector('.creator-database-table')
    await click('[data-testid=database-charts-tab]');await button('条形图');await click('[data-stat="0"]')
    const chart=container.querySelector('[data-testid=interval-statistics]')
    expect(container.querySelector('[data-testid=interval-members] tbody')?.textContent).toContain('甲博主')
    await button('数据表')
    expect(container.querySelector('.creator-database-table')).toBe(table)
    expect(container.querySelector('.creator-database-table tbody tr')?.getAttribute('data-sec-uid')).toBe('two')
    expect((chart as HTMLElement).style.display).toBe('none')
    await click('[data-testid=database-charts-tab]')
    expect(container.querySelector('[data-testid=interval-statistics]')).toBe(chart)
    expect(container.querySelector('[data-stat="0"]')?.getAttribute('aria-pressed')).toBe('true')
    expect([...container.querySelectorAll('button')].find(b=>b.textContent==='条形图')?.getAttribute('aria-pressed')).toBe('true')
    expect(get).toHaveBeenCalledTimes(1)
  })
  it('suspends polling while the database page is hidden and revalidates on return',async()=>{
    vi.useFakeTimers()
    const render=(mode:'visible'|'hidden')=>act(async()=>root.render(createElement(Activity,{mode,children:createElement(CreatorDatabasePage,{onEditingChange:dirty})})))
    await render('visible')
    const table=container.querySelector('.creator-database-table')
    expect(get).toHaveBeenCalledTimes(1)
    await render('hidden');await act(async()=>vi.advanceTimersByTimeAsync(15000))
    expect(get).toHaveBeenCalledTimes(1)
    view.rows[0].values.workCount=99
    await render('visible')
    expect(get).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.creator-database-table')).toBe(table)
    expect(container.querySelector('[data-sec-uid=one] [data-column-id=workCount]')?.textContent).toBe('99')
    expect(update).not.toHaveBeenCalled()
  })
  it('shows purple names in both database cells and chart details and clears them after priority removal',async()=>{
    view.rows[0].refreshPriority={mode:'boost',tier:'active',revision:1}
    await mount()
    expect(container.querySelector('[data-sec-uid=one] [data-column-id=nickname] .creator-priority-name')?.textContent).toBe('甲博主')
    expect(container.querySelector('[data-sec-uid=two] .creator-priority-name')).toBeNull()
    await click('[data-testid=database-charts-tab]')
    expect(container.querySelector('[data-testid=interval-members] .creator-priority-name')?.textContent).toBe('甲博主')
    view.rows[0].refreshPriority={mode:null,tier:null,revision:2};await act(async()=>changed())
    expect(container.querySelector('[data-testid=interval-members] .creator-priority-name')).toBeNull()
  })
  it('keeps Add Column clickable with an empty name and explains the missing input',async()=>{
    await mount();expect(container.querySelector<HTMLButtonElement>('[data-testid=database-add-column]')!.disabled).toBe(false)
    await click('[data-testid=database-add-column]')
    expect(container.querySelector<HTMLInputElement>('[aria-label="新增列名称"]')).toBe(document.activeElement)
    expect([...container.querySelectorAll('button')].find(b=>b.textContent==='确认新增')!.disabled).toBe(false)
    await submit('.database-add-column');expect(container.textContent).toContain('请填写新列的表头名称');expect(update).not.toHaveBeenCalled()
    await input('[aria-label="新增列名称"]','备注');await submit('.database-add-column')
    expect(container.querySelectorAll('th')).toHaveLength(6)
  })
  it('renders default cells as noninteractive data, while custom cells use explicit edit buttons',async()=>{
    await mount();expect(container.querySelectorAll('tbody button')).toHaveLength(0)
    await act(async()=>container.querySelector<HTMLElement>('[data-column-id=workCount] .database-cell')!.click())
    expect(container.querySelector('[data-testid=database-cell-editor]')).toBeNull();expect(update).not.toHaveBeenCalled()
    await button('新增列');await input('[aria-label="新增列名称"]','备注');await submit('.database-add-column')
    await click('[data-sec-uid=one] .database-custom-edit');await input('[aria-label="编辑备注"]','内容')
    await submit('[data-testid=database-cell-editor]');expect(container.textContent).toContain('内容')
  })
  it('saves original column header, width and alignment without modifying the source value',async()=>{
    await mount();await button('表格格式');await input('[aria-label="作品数表头名称"]','公开数量');await input('[aria-label="作品数列宽"]','260');await input('[aria-label="作品数对齐"]','right')
    await submit('[data-format-column=workCount]')
    expect(update).toHaveBeenCalledWith({ownerSecUid:'owner',revision:0,action:'format-column',columnId:'workCount',name:'公开数量',width:260,align:'right'})
    expect(container.querySelector('th:nth-child(3)')?.textContent).toContain('公开数量')
    expect(container.querySelector<HTMLElement>('[data-column-id=workCount]')!.style.textAlign).toBe('right')
  })
  it('combines custom numeric and activity conditions using ALL and ANY, and clears or persists them',async()=>{
    await mount();await button('自定义筛选');await button('添加条件')
    await input('[aria-label="条件1字段"]','workCount');await input('[aria-label="条件1比较"]','gt');await input('[aria-label="条件1值"]','20')
    await button('添加条件');await input('[aria-label="条件2字段"]','tier');await input('[aria-label="条件2值"]','inactive')
    await submit('[data-testid=database-filter-panel]');expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
    await input('[aria-label="条件组合方式"]','any');await submit('[data-testid=database-filter-panel]');expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('creator-database-filters:owner')!).mode).toBe('any')
    await button('清空条件');expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })
  it('does not apply incomplete filter drafts and does not lose custom input on save failure',async()=>{
    await mount();await button('自定义筛选');await button('添加条件');await submit('[data-testid=database-filter-panel]')
    expect(container.textContent).toContain('请填写条件值');expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    await button('新增列');await input('[aria-label="新增列名称"]','备注');await submit('.database-add-column');await click('[data-sec-uid=one] .database-custom-edit')
    await input('[aria-label="编辑备注"]','保留');update.mockRejectedValueOnce(Error('保存失败'));await submit('[data-testid=database-cell-editor]')
    expect(container.querySelector<HTMLInputElement>('[aria-label="编辑备注"]')!.value).toBe('保留')
    await submit('[data-testid=database-cell-editor]');expect(container.querySelector('[data-testid=database-cell-editor]')).toBeNull()
  })
  it('keeps original numeric sorting and isolates saved filters on account switch',async()=>{
    await mount();await click('th:nth-child(3) button');expect(container.querySelector('tbody tr')?.getAttribute('data-sec-uid')).toBe('two')
    await input('[aria-label="筛选活跃情况"]','active');expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    view={...view,ownerSecUid:'other',rows:[row('new','新账号博主',1,'unknown')]};await act(async()=>changed())
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);expect(container.textContent).toContain('新账号博主')
  })
  it('shows a column chart with null and zero, supports drilldown and all chart types, and follows filters',async()=>{
    view.rows[0].values.intervalHours=12;view.rows[1].values.intervalHours=null
    await mount();await click('[data-testid=database-charts-tab]')
    expect(container.querySelector('[data-testid=interval-statistics]')).not.toBeNull()
    expect([...container.querySelectorAll('button')].find(b=>b.textContent==='柱状图')!.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('2位')
    expect(container.querySelector('[data-stat="0"] strong')?.textContent).toBe('1位')
    expect(container.querySelector('[data-stat="missing"] strong')?.textContent).toBe('1位')
    await act(async()=>container.querySelector('[aria-label="0天：1位，占50.0%，查看博主"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})))
    expect(container.querySelector('[data-testid=interval-members] tbody')?.textContent).toContain('甲博主0天12小时0天')
    expect(container.querySelectorAll('[data-testid=interval-members] tbody tr')).toHaveLength(1)
    await act(async()=>container.querySelector('[aria-label="null：1位，占50.0%，查看博主"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})))
    expect(container.querySelector('[data-testid=interval-members] tbody')?.textContent).toBe('乙博主nullnull')
    for(const type of ['条形图','折线图','环形图']){await button(type);expect(container.querySelector('[data-testid=interval-statistics]')?.textContent).toContain('null')}
    await input('[aria-label="筛选活跃情况"]','active')
    expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('1位')
    expect(container.querySelector('[data-stat="missing"] strong')?.textContent).toBe('0位')
    await input('[aria-label="图表统计范围"]','all')
    expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('2位')
    expect(update).not.toHaveBeenCalled()
  })
  it('refreshes chart counts from incoming data and resets chart scope and drilldown on owner change',async()=>{
    view.rows[0].values.intervalHours=12
    await mount();await click('[data-testid=database-charts-tab]');await click('[data-stat="0"]')
    view.rows[0].values.intervalHours=13;await act(async()=>changed())
    expect(container.querySelector('[data-stat="0"] strong')?.textContent).toBe('0位')
    expect(container.querySelectorAll('[data-testid=interval-members] tbody tr')).toHaveLength(0)
    await input('[aria-label="图表统计范围"]','all')
    view={...view,ownerSecUid:'different',rows:[row('new','新账号博主',1,'unknown')]};await act(async()=>changed())
    expect(container.querySelector<HTMLSelectElement>('[aria-label="图表统计范围"]')?.value).toBe('filtered')
    expect(container.querySelector('[data-testid=interval-statistics]')?.textContent).not.toContain('甲博主')
    expect(container.querySelector('[data-testid=interval-members] tbody')?.textContent).toContain('新账号博主')
    expect(update).not.toHaveBeenCalled()
  })
  it('shows null-only charts and handles an empty search result without inventing zero-day creators',async()=>{
    view.rows.forEach(row=>row.values.intervalHours=null)
    await mount();await click('[data-testid=database-charts-tab]')
    expect(container.querySelector('[data-stat="missing"] strong')?.textContent).toBe('2位')
    expect(container.querySelector('[data-stat="0"] strong')?.textContent).toBe('0位')
    expect(container.querySelectorAll('svg [role=button]')).toHaveLength(1)
    await input('[aria-label="搜索博主数据库"]','没有这个博主')
    expect(container.textContent).toContain('当前筛选下没有博主')
    expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('0位')
    await input('[aria-label="图表统计范围"]','all')
    expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('2位')
  })
  it('keeps exactly one filter panel and chart while switching filter mode and refreshing data',async()=>{
    await mount();await click('[data-testid=database-charts-tab]');await button('自定义筛选')
    for(let round=0;round<4;round++){
      await input('[aria-label="条件组合方式"]',round%2?'all':'any')
      await act(async()=>changed())
      expect(container.querySelectorAll('[data-testid=database-filter-panel]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-testid=interval-statistics]')).toHaveLength(1)
    }
    await button('自定义筛选')
    expect(container.querySelectorAll('[data-testid=database-filter-panel]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid=interval-statistics]')).toHaveLength(1)
  })
  it('preserves an unapplied filter draft and selected chart through polling, then applies ALL and ANY correctly',async()=>{
    vi.useFakeTimers()
    const consoleError=vi.spyOn(console,'error')
    await mount();await click('[data-testid=database-charts-tab]');await button('自定义筛选');await button('添加条件')
    await input('[aria-label="条件1字段"]','workCount');await input('[aria-label="条件1比较"]','gt');await input('[aria-label="条件1值"]','20')
    await button('添加条件');await input('[aria-label="条件2字段"]','tier');await input('[aria-label="条件2值"]','inactive')
    await button('条形图')
    const panel=container.querySelector('[data-testid=database-filter-panel]'),chart=container.querySelector('[data-testid=interval-statistics]')
    for(let round=0;round<4;round++){
      await input('[aria-label="条件组合方式"]',round%2?'all':'any')
      await act(async()=>vi.advanceTimersByTimeAsync(5000))
      expect(container.querySelectorAll('[data-testid=database-filter-panel]')).toHaveLength(1)
      expect(container.querySelector('[data-testid=database-filter-panel]')).toBe(panel)
      expect(container.querySelector('[data-testid=interval-statistics]')).toBe(chart)
      expect(container.querySelector<HTMLInputElement>('[aria-label="条件1值"]')?.value).toBe('20')
      expect(container.querySelector<HTMLSelectElement>('[aria-label="条件组合方式"]')?.value).toBe(round%2?'all':'any')
      expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('2位')
      expect([...container.querySelectorAll('button')].find(b=>b.textContent==='条形图')!.getAttribute('aria-pressed')).toBe('true')
    }
    await submit('[data-testid=database-filter-panel]');expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('0位')
    await input('[aria-label="条件组合方式"]','any');await submit('[data-testid=database-filter-panel]')
    expect(container.querySelector('[data-stat="all"] strong')?.textContent).toBe('2位')
    await button('数据表');expect(container.querySelectorAll('.creator-database-table tbody tr')).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid=database-filter-panel]')).toHaveLength(1)
    await click('[data-testid=database-charts-tab]')
    await button('自定义筛选（2）');expect(container.querySelectorAll('[data-testid=database-filter-panel]')).toHaveLength(0)
    await button('自定义筛选（2）');expect(container.querySelectorAll('[data-testid=database-filter-panel]')).toHaveLength(1)
    expect(container.querySelector<HTMLSelectElement>('[aria-label="条件组合方式"]')?.value).toBe('any')
    expect(consoleError).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled()
  })
})
