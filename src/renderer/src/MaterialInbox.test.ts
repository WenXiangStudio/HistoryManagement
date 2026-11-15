// @vitest-environment jsdom
import {createElement,act} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi} from 'vitest'
import MaterialInbox from './MaterialInbox'
import {videoInformationFixture} from '../../shared/fixtures/videoInformationFixture'
import type {VideoLibraryView} from '../../shared/videoInformation'
it('retries a failed report through explicit processing without re-marking interest',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const {command,capture,time}=videoInformationFixture(),owner=command.ownerSecUid
  const content={interest:'interested' as const,classification:{code:'speech' as const,ruleVersion:'test',sourceSha256:'source',strength:'较强',basis:{speechPercent:80,speechBinCoverage:1,retainedTextFrames:0,sampledFrames:8},frames:[],timing:{},asrInvoked:false as const,textRecognitionInvoked:false as const,cloudInvoked:false as const},
    body:{text:'已有完整文案',source:'doubao-flash' as const,sourceSha256:'source',classificationHash:'route',modelVersion:'test',generatedAt:time,needsReview:false,limitations:[]},stages:{research:{state:'failed' as const,updatedAt:time,error:'保存的失败记录'}}}
  const library:VideoLibraryView={ownerSecUid:owner,records:[{...capture.work,checkedAt:time,firstCollectedAt:time,runId:command.runId,sourceKind:'native-network',content}],contentBatches:[],state:{phase:'idle',runId:null,ownerSecUid:owner,creatorId:null,message:''}}
  const start=vi.fn(async()=>[]),interest=vi.fn(),node=document.createElement('div');document.body.append(node);const root=createRoot(node)
  Object.defineProperty(window,'signalDesk',{configurable:true,value:{getVideoLibrary:async()=>library,onDataChanged:()=>()=>{},setMaterialInboxState:async()=>{},startVideoWorkflow:start,setVideoInterest:interest}})
  try{
    await act(async()=>root.render(createElement(MaterialInbox,{owner,creators:[],search:'',filter:'all',onCount:vi.fn(),onOpenVideos:vi.fn()})))
    expect(node.textContent).toContain('研究报告未完成')
    await act(async()=>node.querySelector<HTMLButtonElement>('.detail-button')!.click())
    await act(async()=>[...node.querySelectorAll<HTMLButtonElement>('.drawer-footer button')].find(button=>button.textContent==='继续生成研究报告')!.click())
    expect(start).toHaveBeenCalledWith({ownerSecUid:owner,workIds:[command.workId]});expect(interest).not.toHaveBeenCalled()
  }finally{await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals()}
})
