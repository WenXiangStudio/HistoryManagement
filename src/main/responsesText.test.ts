import {it,expect,vi,afterEach} from 'vitest'
import {requestResponsesText} from './responsesText'
const provider={baseUrl:'https://provider.example/v1/',model:'chosen-model',apiKey:'private-key'}
const terminal=(text:string,status='completed')=>({type:'response.completed',response:{status,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:12,output_tokens:5}}})
const line=(event:unknown)=>'data: '+JSON.stringify(event)+'\n\n'
const call=(signal=new AbortController().signal)=>requestResponsesText(provider,'保留数字和条件，输出JSON。','合成原文',signal)
afterEach(()=>vi.unstubAllGlobals())

it('uses Responses input/developer contract and parses fragmented UTF-8, CRLF and a terminal event without a final newline',async()=>{
  const text='{"结论":"中文原文"}'
  const stream=(': heartbeat\r\n\r\n'+line({type:'response.output_text.delta',delta:text})+line(terminal(text)).trimEnd()).replace(/(?<!\r)\n/g,'\r\n')
  const bytes=new TextEncoder().encode(stream)
  const fetch=vi.fn(async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close()}})))
  vi.stubGlobal('fetch',fetch)
  expect(await call()).toEqual({text,usage:{inputTokens:12,outputTokens:5}})
  const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit]
  expect(url).toBe('https://provider.example/v1/responses')
  expect(options.redirect).toBe('error')
  const body=JSON.parse(String(options.body))
  expect(body).toMatchObject({model:'chosen-model',store:false,stream:true,text:{format:{type:'json_object'}},input:[
    {role:'developer',content:[{type:'input_text',text:'保留数字和条件，输出JSON。'}]},
    {role:'user',content:[{type:'input_text',text:'合成原文'}]}
  ]})
  expect(body.messages).toBeUndefined();expect(body.response_format).toBeUndefined();expect(body.previous_response_id).toBeUndefined()
  expect(JSON.stringify(body)).not.toContain('private-key')
})

it('accepts a completed JSON response and extracts assistant text from output items',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(terminal('{"ok":true}').response),{headers:{'content-type':'application/json'}})))
  expect((await call()).text).toBe('{"ok":true}')
})

it('rejects a disconnected stream even when the partial text is valid JSON',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(line({type:'response.output_text.delta',delta:'{"ok":true}'})+'data: [DONE]\n\n')))
  await expect(call()).rejects.toThrow('RESPONSES_OUTPUT_INCOMPLETE')
})

it.each([
  [{type:'response.incomplete'},'RESPONSES_OUTPUT_INCOMPLETE'],
  [{type:'response.failed',response:{error:{message:'private-key'}}},'RESPONSES_PROVIDER_FAILED'],
  [{type:'error',message:'private-key'},'RESPONSES_PROVIDER_FAILED'],
  [{type:'response.refusal.delta',delta:'拒绝'},'RESPONSES_OUTPUT_REFUSED'],
  [terminal('{"ok":true}','incomplete'),'RESPONSES_OUTPUT_INCOMPLETE'],
] as const)('rejects terminal failures and refusals without exposing provider diagnostics (%j)',async(event,code)=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(line(event))))
  await expect(call()).rejects.toThrow(code)
})

it('does not fall back to another protocol or expose a provider body after an HTTP error',async()=>{
  const fetch=vi.fn(async()=>new Response('private-key',{status:401}));vi.stubGlobal('fetch',fetch)
  await expect(call()).rejects.toThrow(/^RESPONSES_PROVIDER_HTTP_401$/)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not send an already cancelled request',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  const abort=new AbortController();abort.abort()
  await expect(call(abort.signal)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled()
})

it('rejects oversized generated text before attempting to save it',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(line({type:'response.output_text.delta',delta:'x'.repeat(100001)}))))
  await expect(call()).rejects.toThrow('RESPONSES_OUTPUT_TOO_LARGE')
})
