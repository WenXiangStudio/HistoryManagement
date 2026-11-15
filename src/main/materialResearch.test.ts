import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {bodyHash,researchMaterial,RESEARCH_MAX_OUTPUT_TOKENS,RESEARCH_TIMEOUT_MS} from './materialResearch'
import {WORKFLOW_TEXT_MODEL} from '../shared/videoWorkflow'

const provider={kind:'cloud' as const,baseUrl:'https://api.siliconflow.cn/v1',model:WORKFLOW_TEXT_MODEL,apiKey:'synthetic-secret'}
const body='作者认为应先验证字段归属，再完成展示。'
const report={overview:'作者介绍验证步骤。',analysis:'作者按先后顺序展开。',
  keyPoints:[{viewpoint:'先验证',explanation:'作者强调顺序',quotes:['先验证字段归属']}],
  domains:[{name:'软件工程',reasoning:'提到验证与展示',quotes:['完成展示']}],limitations:[]}
const roots:string[]=[]
const directory=()=>{const path=mkdtempSync(join(tmpdir(),'material-research-test-'));roots.push(path);return path}
const response=(changes:Record<string,unknown>={})=>new Response(JSON.stringify({model:WORKFLOW_TEXT_MODEL,
  choices:[{finish_reason:'stop',message:{content:JSON.stringify(report)}}],...changes}))
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})

it('allows a completed report beyond the previous 12000-token ceiling and retains the full body and answer',async()=>{
  const complete={...report,analysis:'模型分析：'+ '解释作者的论证关系。'.repeat(500)}
  const request=vi.fn().mockResolvedValue(response({choices:[{finish_reason:'stop',message:{
    content:JSON.stringify(complete),reasoning_content:'模型内部思考。'.repeat(2000)}}],usage:{completion_tokens:18000}}))
  vi.stubGlobal('fetch',request)
  const root=directory(),saved=await researchMaterial(provider,body,root,new AbortController().signal)
  expect(saved).toMatchObject({...complete,bodyHash:bodyHash(body),modelVersion:WORKFLOW_TEXT_MODEL})
  const parameters=JSON.parse(request.mock.calls[0][1].body)
  expect(parameters.max_tokens).toBe(128000)
  expect(JSON.parse(parameters.messages[1].content).body).toBe(body)
  const proof=JSON.parse(readFileSync(join(root,readdirSync(root)[0]),'utf8'))
  expect(proof).toMatchObject({httpStatus:200,maxOutputTokens:RESEARCH_MAX_OUTPUT_TOKENS,timeoutMs:RESEARCH_TIMEOUT_MS})
  expect(JSON.parse(proof.body).usage.completion_tokens).toBe(18000)
})

it('reports length truncation accurately even when HTTP and the model ID are correct, saving the original evidence',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({choices:[{finish_reason:'length',message:{
    content:'',reasoning_content:'synthetic-secret thinking only'}}],usage:{completion_tokens:12000}})))
  const root=directory()
  await expect(researchMaterial(provider,body,root,new AbortController().signal)).rejects.toThrow('达到输出或上下文长度上限')
  const raw=readFileSync(join(root,readdirSync(root)[0]),'utf8')
  expect(raw).not.toContain(provider.apiKey)
  expect(JSON.parse(JSON.parse(raw).body).choices[0].finish_reason).toBe('length')
})

it('keeps model identity, nonempty answer and verbatim quote checks after increasing the allowance',async()=>{
  const request=vi.fn().mockResolvedValueOnce(response({model:'different-model'}))
    .mockResolvedValueOnce(response({choices:[{finish_reason:'stop',message:{content:'',reasoning_content:'only reasoning'}}]}))
    .mockResolvedValueOnce(response({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...report,
      domains:[{...report.domains[0],quotes:['不存在的引文']}]})}}]}))
  vi.stubGlobal('fetch',request)
  await expect(researchMaterial(provider,body,directory(),new AbortController().signal)).rejects.toThrow('模型与配置不符')
  await expect(researchMaterial(provider,body,directory(),new AbortController().signal)).rejects.toThrow('未返回完整正文')
  await expect(researchMaterial(provider,body,directory(),new AbortController().signal)).rejects.toThrow('引用与正文不符')
})

it('waits beyond the previous four-minute timeout while preserving immediate user cancellation',async()=>{
  vi.useFakeTimers()
  let requestSignal:AbortSignal|undefined
  vi.stubGlobal('fetch',vi.fn((_url,options)=>{requestSignal=options.signal;return new Promise((_resolve,reject)=>{
    requestSignal!.addEventListener('abort',()=>reject(requestSignal!.reason),{once:true})
  })}))
  const abort=new AbortController(),pending=researchMaterial(provider,body,directory(),abort.signal)
  const rejected=expect(pending).rejects.toThrow('user cancelled')
  await vi.advanceTimersByTimeAsync(240001)
  expect(requestSignal!.aborted).toBe(false)
  abort.abort(Error('user cancelled'))
  await rejected
})
