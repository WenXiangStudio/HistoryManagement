import {createServer,type Server} from 'node:http'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {CloudConnectionService,type ConnectionProvider} from './cloudConnection'

const input={kind:'profile' as const,profileId:'saved-provider',service:'text' as const,expectedRevision:'saved-revision'}
const provider:ConnectionProvider={baseUrl:'https://provider.example/v1',model:'saved-model',apiKey:'private-api-key',protocol:'chat-completions',service:'text'}
const chat={choices:[{finish_reason:'stop',message:{content:'OK'}}]}
const responses={status:'completed',output:[{type:'message',status:'completed',content:[{type:'output_text',text:'OK'}]}]}
const mockFetch=(body:unknown=chat,status=200)=>vi.fn<typeof fetch>(async()=>new Response(JSON.stringify(body),{status}))
const servers:Server[]=[]
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())})))})

describe('saved cloud model connectivity',()=>{
  it('sends exactly one authenticated user-only Chat Completions probe without persisting or borrowing configuration',async()=>{
    const request=mockFetch(),resolve=vi.fn(()=>provider),service=new CloudConnectionService(resolve,{fetch:request})
    const result=await service.test(input)
    expect(result).toMatchObject({ok:true,model:'saved-model',service:'text',httpStatus:200});expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(resolve).toHaveBeenCalledExactlyOnceWith(input);expect(request).toHaveBeenCalledTimes(1)
    const [url,options]=request.mock.calls[0];expect(url).toBe('https://provider.example/v1/chat/completions');expect(options?.redirect).toBe('error')
    expect(options?.headers).toEqual({'content-type':'application/json',authorization:'Bearer private-api-key'})
    const body=JSON.parse(String(options?.body));expect(body.messages).toEqual([{role:'user',content:'连通测试，请只回复 OK。'}]);expect(body.model).toBe('saved-model');expect(body.stream).toBe(false)
  })
  it('uses the selected Responses protocol and never retries or falls back to another endpoint',async()=>{
    const request=mockFetch(responses),service=new CloudConnectionService(()=>({...provider,protocol:'responses'}),{fetch:request})
    expect((await service.test(input)).ok).toBe(true)
    expect(request.mock.calls[0][0]).toBe('https://provider.example/v1/responses')
    const body=JSON.parse(String(request.mock.calls[0][1]?.body));expect(body.input.map((item:any)=>item.role)).toEqual(['user']);expect(body.store).toBe(false);expect(body).not.toHaveProperty('instructions')
    request.mockImplementation(async()=>new Response('',{status:404}))
    expect(await service.test(input)).toMatchObject({ok:false,httpStatus:404,code:'endpoint_or_model_not_found'});expect(request).toHaveBeenCalledTimes(2)
  })
  it.each(['chat-completions','responses'] as const)('actually sends a synthetic image when testing vision via %s',async protocol=>{
    const request=mockFetch(protocol==='responses'?responses:chat),service=new CloudConnectionService(()=>({...provider,service:'vision',protocol}),{fetch:request})
    expect(await service.test({...input,service:'vision'})).toMatchObject({ok:true,service:'vision'})
    const body=JSON.parse(String(request.mock.calls[0][1]?.body)),content=protocol==='responses'?body.input[0].content:body.messages[0].content
    expect(content).toHaveLength(2)
    const image=protocol==='responses'?content[1].image_url:content[1].image_url.url
    const png=Buffer.from(image.split(',')[1],'base64');expect(png.readUInt32BE(16)).toBe(32);expect(png.readUInt32BE(20)).toBe(32)
  })
  it.each([[401,'authentication_failed'],[403,'permission_denied'],[404,'endpoint_or_model_not_found'],[429,'rate_limited'],[503,'provider_unavailable'],[400,'request_rejected']])('reports actionable HTTP %i without exposing response bodies',async(status,code)=>{
    const request=mockFetch({error:{message:'private-api-key https://user:password@provider.example/v1?key=private-api-key'}},status as number)
    const result=await new CloudConnectionService(()=>provider,{fetch:request}).test(input)
    expect(result).toMatchObject({ok:false,httpStatus:status,code});expect(JSON.stringify(result)).not.toMatch(/private-api-key|password|provider\.example/);expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([
    [{choices:[{finish_reason:'length',message:{content:''}}]},'empty_output'],
    [{choices:[{finish_reason:'stop',message:{content:'   '}}]},'empty_output'],
    [{choices:[{finish_reason:'stop',message:{content:'',refusal:'blocked'}}]},'refused'],
    [{not:'a completion'},'invalid_response']
  ])('does not call an incomplete or empty Chat Completions response a success',async(body,code)=>{
    expect(await new CloudConnectionService(()=>provider,{fetch:mockFetch(body)}).test(input)).toMatchObject({ok:false,code})
  })
  it.each([
    [{status:'incomplete',output:[]},'incomplete_output'],
    [{status:'completed',output:[{type:'message',status:'in_progress',content:[{type:'output_text',text:'partial'}]}]},'incomplete_output'],
    [{status:'completed',output:[]},'empty_output'],
    [{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'blocked'}]}]},'refused']
  ])('validates Responses completion status and output',async(body,code)=>{
    expect(await new CloudConnectionService(()=>({...provider,protocol:'responses'}),{fetch:mockFetch(body)}).test(input)).toMatchObject({ok:false,code})
  })
  it('accepts visible limited output and benign returned model aliases while identifying truncation',async()=>{
    const request=mockFetch({model:'saved-model-2026-10-16',choices:[{finish_reason:'length',message:{content:'OK'}}]})
    const result=await new CloudConnectionService(()=>provider,{fetch:request}).test(input)
    expect(result.ok).toBe(true);expect(result.message).toContain('测试输出已截断')
    request.mockResolvedValue(new Response(JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'message',status:'incomplete',content:[{type:'output_text',text:'OK'}]}]})))
    expect(await new CloudConnectionService(()=>({...provider,protocol:'responses'}),{fetch:request}).test(input)).toMatchObject({ok:true})
  })
  it.each([
    [{model:42,...chat},'invalid_response'],
    [{error:{message:'private-api-key'}},'provider_error']
  ])('rejects malformed model identities and error envelopes even under HTTP 200',async(body,code)=>{
    expect(await new CloudConnectionService(()=>provider,{fetch:mockFetch(body)}).test(input)).toMatchObject({ok:false,code})
  })
  it('parses a valid Chat Completions event stream returned by the same selected endpoint',async()=>{
    const raw=['data: '+JSON.stringify({model:'saved-model',choices:[{index:0,delta:{content:'O'},finish_reason:null}]}),'data: '+JSON.stringify({model:'saved-model',choices:[{index:0,delta:{content:'K'},finish_reason:'stop'}]}),'data: [DONE]'].join('\n\n')+'\n\n'
    const request=vi.fn<typeof fetch>(async()=>new Response(raw,{headers:{'content-type':'text/event-stream'}}))
    expect(await new CloudConnectionService(()=>provider,{fetch:request}).test(input)).toMatchObject({ok:true});expect(request).toHaveBeenCalledTimes(1)
  })
  it('requires the Responses completion event when a gateway returns an event stream',async()=>{
    const request=vi.fn<typeof fetch>(async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:responses})+'\n\n',{headers:{'content-type':'text/event-stream'}}))
    expect(await new CloudConnectionService(()=>({...provider,protocol:'responses'}),{fetch:request}).test(input)).toMatchObject({ok:true})
    request.mockResolvedValue(new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'OK'})+'\n\n',{headers:{'content-type':'text/event-stream'}}))
    expect(await new CloudConnectionService(()=>({...provider,protocol:'responses'}),{fetch:request}).test(input)).toMatchObject({ok:false,code:'incomplete_output'})
  })
  it('rejects extra renderer credentials and speech requests before resolving or contacting a cloud',async()=>{
    const request=mockFetch(),resolve=vi.fn(()=>provider),service=new CloudConnectionService(resolve,{fetch:request})
    for(const invalid of [{...input,apiKey:'renderer-key'},{...input,baseUrl:'https://another.example'},{kind:'doubao',expectedRevision:'saved'},null])expect(await service.test(invalid)).toMatchObject({ok:false,code:'invalid_input'})
    expect(resolve).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled()
  })
  it('redacts network and redirect failures without returning raw URL credentials or keys',async()=>{
    const request=vi.fn<typeof fetch>(async()=>{throw Error('failed https://user:password@provider.example/v1?key=private-api-key')})
    const result=await new CloudConnectionService(()=>provider,{fetch:request}).test(input)
    expect(result).toMatchObject({ok:false,code:'network_error'});expect(JSON.stringify(result)).not.toMatch(/private-api-key|password|provider\.example/)
    const invalid=await new CloudConnectionService(()=>({...provider,baseUrl:'https://user:password@provider.example/v1?key=private-api-key'}),{fetch:request}).test(input)
    expect(invalid.code).toBe('invalid_config');expect(request).toHaveBeenCalledTimes(1)
  })
  it('blocks a duplicate pending target and permits another target independently',async()=>{
    let finish!:(value:Response)=>void
    const request=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve})),service=new CloudConnectionService(()=>provider,{fetch:request})
    const first=service.test(input)
    expect(await service.test(input)).toMatchObject({ok:false,code:'already_running'});expect(request).toHaveBeenCalledTimes(1)
    finish(new Response(JSON.stringify(chat)));expect((await first).ok).toBe(true)
    request.mockResolvedValue(new Response(JSON.stringify(chat)));expect((await service.test(input)).ok).toBe(true)
  })
  it('bounds a stalled connection even when a transport ignores cancellation and releases the pending target',async()=>{
    const request=vi.fn<typeof fetch>(()=>new Promise(()=>{})),service=new CloudConnectionService(()=>provider,{fetch:request,timeoutMs:15})
    expect(await service.test(input)).toMatchObject({ok:false,code:'timeout'});expect((request.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
    request.mockResolvedValue(new Response(JSON.stringify(chat)));expect((await service.test(input)).ok).toBe(true)
  })
  it('bounds a stalled response body and rejects an oversized body',async()=>{
    const request=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'))}})))
    expect(await new CloudConnectionService(()=>provider,{fetch:request,timeoutMs:15}).test(input)).toMatchObject({ok:false,code:'timeout'})
    expect(await new CloudConnectionService(()=>provider,{fetch:mockFetch(chat),maxResponseBytes:10}).test(input)).toMatchObject({ok:false,code:'response_too_large'})
  })
  it('requires valid JSON and returns only safe request identifiers',async()=>{
    const request=vi.fn<typeof fetch>(async()=>new Response('<html>private-api-key</html>',{headers:{'x-request-id':'private-api-key'}}))
    const result=await new CloudConnectionService(()=>provider,{fetch:request}).test(input)
    expect(result).toMatchObject({ok:false,code:'invalid_response'});expect(result.requestId).toBeUndefined()
    request.mockResolvedValue(new Response(JSON.stringify(chat),{headers:{'x-request-id':'safe-123'}}))
    expect(await new CloudConnectionService(()=>provider,{fetch:request}).test(input)).toMatchObject({ok:true,requestId:'safe-123'})
  })
  it('performs a real local HTTP request and validates its generated authorization and output',async()=>{
    const requests:any[]=[]
    const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;requests.push({url:req.url,key:req.headers.authorization,body:JSON.parse(raw)});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(chat))})
    servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const port=(server.address() as {port:number}).port
    const result=await new CloudConnectionService(()=>({...provider,baseUrl:`http://127.0.0.1:${port}/v1`})).test(input)
    expect(result.ok).toBe(true);expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({url:'/v1/chat/completions',key:'Bearer private-api-key',body:{model:'saved-model'}})
  })
})
