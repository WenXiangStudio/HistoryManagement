import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect,vi,afterEach} from 'vitest'
import {analyzeVideoFrames} from './videoVision'
afterEach(()=>vi.unstubAllGlobals())
it('uploads only selected local frames and rejects invented frame references',async()=>{
  const root=mkdtempSync(join(tmpdir(),'vision-test-')),frames=Array.from({length:20},(_,i)=>({id:'frame-'+i,timeMs:i*1000,path:join(root,i+'.jpg'),sha256:'test'}))
  for(const f of frames)writeFileSync(f.path,'test-jpeg')
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({observations:[{text:'可见图表',frameIds:['invented']}],limitations:[]})}}]})))
  vi.stubGlobal('fetch',fetch)
  try{
    await expect(analyzeVideoFrames({kind:'cloud',baseUrl:'https://provider.invalid/v1',model:'test',apiKey:'test-key'},frames,root,new AbortController().signal)).rejects.toThrow('VISION_EVIDENCE_REFERENCE_INVALID')
    const body=JSON.parse((fetch.mock.calls[0] as any)[1].body)
    expect(body.messages[0].content.filter((x:any)=>x.type==='image_url')).toHaveLength(12)
    expect(JSON.stringify(body)).not.toContain(root)
  }finally{rmSync(root,{recursive:true,force:true})}
})
it('refuses a frame outside the work evidence directory before calling the provider',async()=>{
  const root=mkdtempSync(join(tmpdir(),'vision-root-'));mkdirSync(join(root,'work'));writeFileSync(join(root,'outside.jpg'),'test')
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  try{await expect(analyzeVideoFrames({kind:'cloud',baseUrl:'https://provider.invalid/v1',model:'test'},[{id:'f',timeMs:0,path:join(root,'outside.jpg'),sha256:'test'}],join(root,'work'),new AbortController().signal)).rejects.toThrow('VIDEO_FRAME_PATH_REJECTED');expect(fetch).not.toHaveBeenCalled()}
  finally{rmSync(root,{recursive:true,force:true})}
})
