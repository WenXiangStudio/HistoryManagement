// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi} from 'vitest'
import {CreatorBaselineTaskPanel} from './CreatorBaselineTaskPanel'
import {baselineBatchSizes} from '../../shared/creatorActivityBaseline'
import type {CreatorActivityState} from '../../shared/creatorActivity'
it('shows eleven batches, countdown, pause/resume and restored progress',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const node=document.createElement('div');document.body.append(node);const root=createRoot(node),start=vi.fn(),cancel=vi.fn()
 const state={phase:'running',total:302,succeeded:28,done:28,failed:0,currentName:null,message:'批间休息',remainingIds:[-29],
  waiting:{kind:'batch',until:new Date(Date.now()+240000).toISOString(),batchNumber:2,totalBatches:11,durationMs:240000},
  baselineTask:{policy:{limit:60,windowDays:180,windowStart:'2026-04-17T04:00:00.000Z'},targetIds:[],batchSizes:baselineBatchSizes(302),results:[]}} as unknown as CreatorActivityState
 try{
  await act(async()=>root.render(createElement(CreatorBaselineTaskPanel,{state,creatorCount:302,canStart:true,onStart:start,onCancel:cancel})))
  expect(node.querySelectorAll('.creator-baseline-batches span')).toHaveLength(11)
  expect(node.textContent).toContain('28/302');expect(node.textContent).toContain('第 2/11 批')
  expect(node.querySelector('[data-testid=creator-baseline-countdown]')?.textContent).toMatch(/批间休息.*分.*秒后继续/)
  await act(async()=>(node.querySelector('[data-testid=pause-creator-baseline]') as HTMLButtonElement).click());expect(cancel).toHaveBeenCalledOnce()
  await act(async()=>root.render(createElement(CreatorBaselineTaskPanel,{state:{...state,phase:'blocked',waiting:null},creatorCount:302,canStart:true,onStart:start,onCancel:cancel})))
  await act(async()=>(node.querySelector('[data-testid=resume-creator-baseline]') as HTMLButtonElement).click());expect(start).toHaveBeenCalledWith(true)
  expect(node.querySelector('progress')?.value).toBe(28)
  await act(async()=>root.render(createElement(CreatorBaselineTaskPanel,{state:{...state,phase:'completed',baselineReadyCount:133,waiting:null},creatorCount:302,canStart:true,onStart:start,onCancel:cancel})))
  expect(node.querySelector('[data-testid=start-creator-baseline]')?.textContent).toBe('补齐剩余 169 位基线')
  expect(node.textContent).toContain('不限制时间跨度');expect(node.textContent).toContain('已有 133/302 位满足新规则')
  await act(async()=>root.render(createElement(CreatorBaselineTaskPanel,{state:{...state,phase:'completed',baselineReadyCount:302,waiting:null},creatorCount:302,canStart:true,onStart:start,onCancel:cancel})))
  expect((node.querySelector('[data-testid=start-creator-baseline]') as HTMLButtonElement).disabled).toBe(true)
  await act(async()=>root.render(createElement(CreatorBaselineTaskPanel,{state:{...state,recoveryAttempts:1,recoverySucceeded:0,waiting:null,recovery:{creatorId:-29,secUid:'sec',attempt:1,
    reason:'DEBUGGER_NOT_ATTACHED',phase:'waiting',startedAt:new Date().toISOString(),waitUntil:new Date(Date.now()+8000).toISOString(),preservedPages:2}},creatorCount:302,canStart:true,onStart:start,onCancel:cancel})))
  expect(node.querySelector('[data-testid=creator-recovery-status]')?.textContent).toContain('本位第 1/2 次 · 保留 2 页')
  expect(node.querySelector('[data-testid=creator-recovery-summary]')?.textContent).toContain('成功 0 次 ／ 尝试 1 次')
 }finally{await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals()}
})
