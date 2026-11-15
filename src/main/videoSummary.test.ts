import {it,expect,vi,afterEach} from 'vitest'
import {chunkEvidence,summaryInputHash,generateVideoSummary} from './videoSummary'
import {publicationRange,validateSummary,type ContentEvidence} from '../shared/videoContent'
afterEach(()=>vi.unstubAllGlobals())
it('repairs malformed JSON at most once using the same model and retains both replies for review',async()=>{
 const summary={overview:'作者提及“币值”。',overviewEvidenceIds:['speech-1'],topics:['币值'],keyPoints:[{text:'作者提及币值。',evidenceIds:['speech-1']}],sections:[],limitations:[]}
 const invalid=JSON.stringify(summary).replace('“币值”','"币值"')
 const reply=(text:string)=>new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:5}}})+'\n\n')
 const fetch=vi.fn().mockResolvedValueOnce(reply(invalid)).mockResolvedValueOnce(reply(JSON.stringify(summary)));vi.stubGlobal('fetch',fetch)
 const audit=vi.fn(),provider={kind:'cloud' as const,protocol:'responses' as const,model:'qwen3.8-omni-flash',baseUrl:'https://ws-test.cn-beijing.maas.aliyuncs.com/v1'}
 const result=await generateVideoSummary(provider,[{id:'speech-1',kind:'speech',text:'币值',startMs:0,endMs:1000}],[],new AbortController().signal,()=>{},audit)
 expect(result.overview).toBe(summary.overview);expect(fetch).toHaveBeenCalledTimes(2);expect(audit).toHaveBeenCalledTimes(2)
 expect(fetch.mock.calls.map(c=>JSON.parse(c[1].body).model)).toEqual([provider.model,provider.model]);expect(result.usage).toEqual({inputTokens:20,outputTokens:10})
 expect(JSON.parse(JSON.parse(fetch.mock.calls[1][1].body).input[1].content[0].text).malformedJson).toBe(invalid)
})
it('uses the Qwen context for one bounded summary request and records the raw reply before schema validation',async()=>{
 const inputs:ContentEvidence[]=[1,2,3].map(i=>({id:'speech-'+i,kind:'speech',startMs:i*1000,endMs:(i+1)*1000,text:'原文'.repeat(800)}))
 const summary={overview:'作者介绍合成材料。',overviewEvidenceIds:['speech-1','speech-3'],topics:['测试'],keyPoints:[{text:'作者介绍材料。',evidenceIds:['speech-2']}],sections:[],limitations:[]}
 const fetch=vi.fn(async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(summary)}]}]}})+'\n\n'));vi.stubGlobal('fetch',fetch)
 const audit=vi.fn(),result=await generateVideoSummary({kind:'cloud',protocol:'responses',model:'qwen3.8-omni-flash',baseUrl:'https://ws-test.cn-beijing.maas.aliyuncs.com/v1'},inputs,[],new AbortController().signal,()=>{},audit)
 expect(fetch).toHaveBeenCalledTimes(1);expect(result.processedChunks).toBe(1);expect(audit).toHaveBeenCalledTimes(1)
 const request=JSON.parse((fetch.mock.calls[0] as any)[1].body)
 expect(request.reasoning).toEqual({effort:'low'});expect(request.max_output_tokens).toBe(8000)
 expect(JSON.parse(request.input[1].content[0].text).evidence).toEqual(inputs)
})
it('full long input remains represented with traceable segment IDs',()=>{
  const evidence:ContentEvidence[]=[{id:'one',kind:'speech',startMs:0,endMs:10000,text:'a'.repeat(15000)+'末尾重要结论'}]
  const chunks=chunkEvidence(evidence,6000)
  expect(chunks).toHaveLength(3);expect(chunks.flat().map(x=>x.text).join('')).toBe(evidence[0].text)
  expect(chunks.at(-1)![0].id).toBe('one-part-3')
})
it('references must belong to the current evidence set',()=>{
  const summary={overview:'主题',overviewEvidenceIds:['other'],topics:['科技'],keyPoints:[{text:'结论',evidenceIds:['other']}],sections:[],limitations:[]}
  expect(()=>validateSummary(summary,[{id:'ours',kind:'speech',startMs:0,endMs:1,text:'原文'}])).toThrow('SUMMARY_EVIDENCE_REFERENCE_INVALID')
})
it('model, input and limitations invalidate cached analysis; API secrets do not enter cache identity',()=>{
  const a={kind:'local' as const,baseUrl:'http://127.0.0.1:8080/v1',model:'one'}
  expect(summaryInputHash(a,[],[])).not.toBe(summaryInputHash({...a,model:'two'},[],[]))
  expect(summaryInputHash(a,[],[])).not.toBe(summaryInputHash(a,[],['画面未分析']))
  expect(summaryInputHash(a,[],[])).toBe(summaryInputHash({...a,apiKey:'secret'},[],[]))
})
it('Beijing day boundaries include the entire final day and reject invalid calendar dates',()=>{
  expect(publicationRange('2026-10-01','2026-10-07')).toEqual({start:'2026-09-30T16:00:00.000Z',endExclusive:'2026-10-07T16:00:00.000Z'})
  expect(()=>publicationRange('2026-02-30','2026-03-01')).toThrow()
})
it('uses Responses for every long-text chunk and merge while preserving references and usage',async()=>{
  const inputs:ContentEvidence[]=[1,2].map(i=>({id:'speech-'+i,kind:'speech',startMs:i*1000,endMs:(i+1)*1000,text:'原文'.repeat(800)}))
  const fetch=vi.fn(async(_url:string,options:RequestInit)=>{
    const request=JSON.parse(String(options.body)),input=JSON.parse(request.input[1].content[0].text)
    const ids=input.evidence?input.evidence.map((e:ContentEvidence)=>e.id):input.parts.flatMap((p:any)=>p.overviewEvidenceIds)
    const summary={overview:'作者介绍合成材料。',overviewEvidenceIds:ids,topics:['合成测试'],keyPoints:[{text:'作者介绍材料。',evidenceIds:ids}],sections:[],limitations:[]}
    return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(summary)}]}],usage:{input_tokens:10,output_tokens:2}}})+'\n\n')
  });vi.stubGlobal('fetch',fetch)
  const result=await generateVideoSummary({kind:'cloud',protocol:'responses',baseUrl:'https://provider.example/v1',model:'text'},inputs,[],new AbortController().signal)
  expect(result.processedChunks).toBe(2);expect(result.overviewEvidenceIds).toEqual(['speech-1','speech-2'])
  expect(result.usage).toEqual({inputTokens:30,outputTokens:6});expect(result.protocol).toBe('responses')
  expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls.every(([url])=>url.endsWith('/responses'))).toBe(true)
})
it('rejects invented evidence references from Responses and distinguishes protocol cache identities',async()=>{
  const provider={kind:'cloud' as const,protocol:'responses' as const,baseUrl:'https://provider.example/v1',model:'text'}
  expect(summaryInputHash(provider,[],[])).not.toBe(summaryInputHash({...provider,protocol:'chat-completions'},[],[]))
  const summary={overview:'作者介绍材料。',overviewEvidenceIds:['invented'],topics:['测试'],keyPoints:[{text:'内容',evidenceIds:['invented']}],sections:[],limitations:[]}
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(summary)}]}]}})+'\n\n')))
  await expect(generateVideoSummary(provider,[{id:'actual',kind:'speech',text:'原文',startMs:0,endMs:100}],[],new AbortController().signal)).rejects.toThrow('SUMMARY_EVIDENCE_REFERENCE_INVALID')
})
