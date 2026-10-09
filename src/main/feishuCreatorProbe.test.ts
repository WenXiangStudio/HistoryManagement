import {afterEach,describe,it,expect,vi} from 'vitest'
import {DEFAULT_CREATOR_DATABASE_COLUMNS,type CreatorDatabaseView} from '../shared/creatorDatabase'
import type {CreatorListItem} from '../shared/contracts'
import {parseFeishuTableUrl} from '../shared/feishu'
import {FeishuClient,type FeishuField,type FeishuRecord} from './feishuClient'
import {FeishuCreatorProbe,FEISHU_KEY_FIELD,equalFeishuValue} from './feishuCreatorProbe'

const tableUrl='https://example.feishu.cn/base/BaseTest?table=tblTest&view=vewTest'
const services:FeishuCreatorProbe[]=[]
afterEach(()=>{services.splice(0).forEach(service=>service.stop());vi.useRealTimers()})
function fixture() {
  const view:CreatorDatabaseView={ownerSecUid:'owner',revision:0,columns:[...DEFAULT_CREATOR_DATABASE_COLUMNS],rows:[{
    secUid:'creator',nickname:'样本博主',profileUrl:'https://www.douyin.com/user/creator',automatic:{},manualColumns:[],
    values:{nickname:'样本博主',lastPublishedDate:'2026-10-08',workCount:0,intervalHours:49,tier:'active'}
  }]}
  const creators=[{isDemo:false,profileUrl:view.rows[0].profileUrl,isStarred:true,note:'保留批注'}] as CreatorListItem[]
  let fields:FeishuField[]=[
    [FEISHU_KEY_FIELD,1],['APP · 资料账号',1],['APP · 博主标识',1],['APP · 主页链接',15],
    ['APP · 博主昵称',1],['APP · 上次更新日期',5],['APP · 作品数',2],['APP · 间隔天数',1],['APP · 活跃情况',1],['APP · 星标',7],['APP · 批注',1]
  ].map(([field_name,type],i)=>({field_id:`fld${i}`,field_name:String(field_name),type:Number(type)}))
  const records:FeishuRecord[]=[], writes:{method:string;path:string;body:any}[]=[], saved=new Map<string,string>()
  let failReadBack=false,failList=false,failAfterWrite=false,onList=()=>{},readPages=0,failBatchAt=0,batches=0
  const fetcher=vi.fn(async (input:URL|string|Request,init?:RequestInit):Promise<Response>=>{
    const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined
    expect(url.origin).toBe('https://open.feishu.cn');expect(init?.redirect).toBe('error')
    let data:any
    if(url.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'private-access-token'})
    if(url.pathname.endsWith('/fields')){
      if(method==='GET')expect(url.searchParams.get('page_size')).toBe('100')
      if(method==='GET')data={items:fields,has_more:false}
      else {writes.push({method,path:url.pathname,body});const field={...body,field_id:'fld'+fields.length};fields.push(field);data={field}}
    }else if(url.pathname.endsWith('/records')&&method==='GET'){
      expect(url.searchParams.get('page_size')).toBe('500')
      readPages++;onList()
      if(failList)return Response.json({code:0,data:{items:records,has_more:true}})
      data={items:records,has_more:false}
    }else if(url.pathname.endsWith('/batch_create')){
      writes.push({method,path:url.pathname,body});const created=body.records.map((item:any)=>{const record={record_id:'rec'+(records.length+1),fields:item.fields};records.push(record);return record})
      batches++
      if(failAfterWrite||batches===failBatchAt){failAfterWrite=false;throw Error('response lost')}
      data={records:created}
    }else if(url.pathname.endsWith('/batch_update')){
      writes.push({method,path:url.pathname,body})
      const updated=body.records.map((item:any)=>{const record=records.find(row=>row.record_id===item.record_id)!;Object.assign(record.fields,item.fields);return record})
      data={records:updated}
    }else{
      const record=records.find(row=>row.record_id===url.pathname.split('/').at(-1))!
      if(method==='PUT'){writes.push({method,path:url.pathname,body});Object.assign(record.fields,body.fields)}
      data={record:structuredClone(record)}
      if(method==='GET'){
        // The API can return text as rich text and omit null values.
        for(const [name,value] of Object.entries(data.record.fields)){
          if(value===null)delete data.record.fields[name]
          else if(typeof value==='string')data.record.fields[name]=[{type:'text',text:value}]
        }
        if(failReadBack)data.record.fields['APP · 作品数']=123
      }
    }
    return Response.json({code:0,data})
  })
  const service=new FeishuCreatorProbe(()=>({view,creators}),owner=>({getApiKey:()=>saved.get(owner)??null,setApiKey:value=>{saved.set(owner,value)}}),()=>new FeishuClient(fetcher))
  services.push(service)
  const configure=()=>service.save({ownerSecUid:'owner',appId:'cli_test',appSecret:'test-only-secret',tableUrl})
  const probe=()=>service.probe({ownerSecUid:'owner',secUid:'creator'})
  return {view,creators,records,writes,saved,fields,service,configure,probe,fetcher,
    failReadBack:()=>{failReadBack=true},failList:()=>{failList=true},failAfterWrite:()=>{failAfterWrite=true},onList:(fn:()=>void)=>{onList=fn},readPages:()=>readPages,
    failBatchAt:(value:number)=>{failBatchAt=value},addRows:(count:number)=>{
      for(let i=1;i<=count;i++){const secUid='creator-'+i,profileUrl='https://www.douyin.com/user/'+secUid
        view.rows.push({...structuredClone(view.rows[0]),secUid,profileUrl,nickname:'博主'+i,values:{...view.rows[0].values,nickname:'博主'+i}})
        creators.push({...creators[0],profileUrl})}
    }}
}

describe('Feishu one-creator real API adapter',()=>{
  it('accepts real numeric-string responses without coercing blanks, booleans or other field types',()=>{
    expect(equalFeishuValue('79',79,2)).toBe(true);expect(equalFeishuValue('0',0,2)).toBe(true)
    expect(equalFeishuValue('',0,2)).toBe(false);expect(equalFeishuValue(false,0,2)).toBe(false)
    expect(equalFeishuValue('79',79,5)).toBe(false);expect(equalFeishuValue('80',79,2)).toBe(false)
  })
  it('validates direct table URLs without sending credentials to supplied URLs',()=>{
    expect(parseFeishuTableUrl(tableUrl).tableUrl).toBe('https://example.feishu.cn/base/BaseTest?table=tblTest')
    for(const url of ['https://evil.test/base/BaseTest?table=tblTest','https://feishu.cn.evil.test/base/BaseTest?table=tblTest','https://x.feishu.cn/wiki/WikiTest?table=tblTest','https://x.feishu.cn/base/BaseTest'])expect(()=>parseFeishuTableUrl(url)).toThrow()
  })
  it('stores credentials per owner and never returns the secret; app replacement needs a new secret',()=>{
    const f=fixture();f.configure();expect(JSON.stringify(f.service.state())).not.toContain('test-only-secret')
    expect(()=>f.service.save({ownerSecUid:'owner',appId:'cli_other',tableUrl})).toThrow('App Secret')
    f.view.ownerSecUid='other';expect(f.service.state()).toMatchObject({hasSecret:false,appId:'',receipt:null})
    expect(()=>f.configure()).toThrow('账号已切换')
  })
  it('writes and independently reads back all values including zero, Shanghai date, interval, star and note; retry updates one row',async()=>{
    const f=fixture(),before=structuredClone({view:f.view,creators:f.creators});f.configure()
    const receipt=await f.probe();expect(receipt).toMatchObject({action:'created',verifiedFields:11,ownerSecUid:'owner',secUid:'creator'})
    expect(f.records[0].fields).toMatchObject({'APP · 作品数':0,'APP · 上次更新日期':Date.parse('2026-10-08T00:00:00+08:00'),'APP · 间隔天数':'2天1小时','APP · 活跃情况':'高频','APP · 星标':true,'APP · 批注':'保留批注'})
    f.records[0].fields['飞书人工备注']='只在飞书保留'
    f.view.rows[0].values.workCount=10
    const second=await f.probe();expect(second.action).toBe('updated');expect(f.records).toHaveLength(1)
    expect(f.records[0].fields['飞书人工备注']).toBe('只在飞书保留');expect(f.readPages()).toBe(2)
    expect(f.creators).toEqual(before.creators);expect(f.view.rows[0].values.nickname).toBe(before.view.rows[0].values.nickname)
  })
  it('clears unknown source values without treating them as zero, and does not delete other rows',async()=>{
    const f=fixture();f.configure();await f.probe()
    f.records.push({record_id:'recOther',fields:{[FEISHU_KEY_FIELD]:'douyin:other:creator','manual':'保留'}})
    f.view.rows[0].values.workCount=null;f.view.rows[0].values.lastPublishedDate=null;f.view.rows[0].values.intervalHours=null
    await f.probe();expect(f.records).toHaveLength(2);expect(f.records[0].fields['APP · 作品数']).toBeNull()
    expect(f.records[1].fields.manual).toBe('保留')
  })
  it('stops before writing when pagination is incomplete or account switches during reads',async()=>{
    const f=fixture();f.configure();f.failList();await expect(f.probe()).rejects.toThrow('分页不完整');expect(f.writes).toHaveLength(0)
    const g=fixture();g.configure();g.onList(()=>{g.view.ownerSecUid='other'})
    await expect(g.probe()).rejects.toThrow('账号已切换');expect(g.writes).toHaveLength(0)
  })
  it('stops before any mutation on conflicting field types, duplicate identities or mismatched profile ownership',async()=>{
    const f=fixture();f.configure();f.fields.find(field=>field.field_name==='APP · 作品数')!.type=1
    await expect(f.probe()).rejects.toThrow('类型不匹配');expect(f.writes).toHaveLength(0)
    const g=fixture();g.configure();await g.probe();g.writes.length=0
    g.records.push({...structuredClone(g.records[0]),record_id:'recDuplicate'})
    await expect(g.probe()).rejects.toThrow('重复');expect(g.writes).toHaveLength(0)
    g.records.pop();g.records[0].fields['APP · 主页链接']={link:'https://www.douyin.com/user/wrong'}
    await expect(g.probe()).rejects.toThrow('不一致');expect(g.writes).toHaveLength(0)
  })
  it('does not claim success if read-back differs, and does not duplicate when a write response was lost',async()=>{
    const f=fixture();f.configure();f.failReadBack();await expect(f.probe()).rejects.toThrow('读回核验未通过');expect(f.service.state().receipt).toBeNull()
    const g=fixture();g.configure();g.failAfterWrite();await expect(g.probe()).rejects.toThrow('请求超时')
    await expect(g.probe()).resolves.toMatchObject({action:'updated'});expect(g.records).toHaveLength(1)
  })
  it('creates custom columns and retains stable field IDs through renames and removal',async()=>{
    const f=fixture();f.configure();const id='custom_123456789012345678901234'
    f.view.columns.push({id,name:'业务备注',kind:'text',builtin:false});f.view.rows[0].values[id]='一次保存'
    await f.probe();expect(f.records[0].fields['APP · 业务备注']).toBe('一次保存')
    f.fields.find(field=>field.field_name==='APP · 业务备注')!.field_name='飞书改名'
    f.view.columns.at(-1)!.name='本机改名';f.view.rows[0].values[id]='二次保存'
    await f.probe();expect(f.records[0].fields['飞书改名']).toBe('二次保存')
    f.view.columns.pop();await f.probe();expect(f.records[0].fields['飞书改名']).toBe('二次保存')
    expect(f.writes.filter(write=>write.path.endsWith('/fields'))).toHaveLength(1)
  })
  it('redacts error response bodies and rejects redirects and failed authentication',async()=>{
    const fetcher=vi.fn(async()=>Response.json({code:99991663,msg:'echo-secret'}))
    await expect(new FeishuClient(fetcher).authenticate('cli_test','echo-secret')).rejects.toThrow('99991663')
    try{await new FeishuClient(fetcher).authenticate('cli_test','echo-secret')}catch(e){expect(String(e)).not.toContain('echo-secret')}
    expect(fetcher.mock.calls[0]?.length).toBe(2)
  })
  it('finds existing records on later pages instead of appending a duplicate',async()=>{
    const fetcher=vi.fn(async(input:URL|string|Request)=>{
      const url=new URL(String(input))
      return Response.json({code:0,data:url.searchParams.has('page_token')
        ? {items:[{record_id:'rec2',fields:{key:'second'}}],has_more:false}
        : {items:[{record_id:'rec1',fields:{key:'first'}}],has_more:true,page_token:'page-two'}})
    })
    const rows=await new FeishuClient(fetcher).records('BaseTest','tblTest')
    expect(rows.map(row=>row.record_id)).toEqual(['rec1','rec2']);expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('refuses duplicate same-profile records with missing keys and rejects simultaneous probes',async()=>{
    const f=fixture();f.configure()
    f.records.push({record_id:'manual',fields:{'APP · 主页链接':{link:f.view.rows[0].profileUrl}}})
    await expect(f.probe()).rejects.toThrow('同主页');expect(f.writes).toHaveLength(0)
    f.records.length=0
    const pending=f.probe();await expect(f.probe()).rejects.toThrow('正在进行');await pending
  })
  it('syncs 205 creators in bounded batches, verifies all, then writes only a changed annotation',async()=>{
    const f=fixture();f.configure();await f.probe();f.addRows(204);f.writes.length=0
    const result=await f.service.syncAll({ownerSecUid:'owner'})
    expect(result).toMatchObject({phase:'success',total:205,verified:205,created:204,updated:0,unchanged:1})
    expect(f.writes.filter(w=>w.path.endsWith('/batch_create')).map(w=>w.body.records.length)).toEqual([100,100,4])
    const ids=f.records.map(row=>row.record_id);f.writes.length=0
    f.creators[0].note='新的批注';f.records[0].fields['飞书独立列']='保留'
    const updated=await f.service.syncAll({ownerSecUid:'owner'})
    expect(updated).toMatchObject({created:0,updated:1,unchanged:204,verified:205})
    expect(f.writes).toHaveLength(1);expect(f.records.map(row=>row.record_id)).toEqual(ids)
    expect(f.records[0].fields['飞书独立列']).toBe('保留');expect(f.records[0].fields['APP · 批注']).toBe('新的批注')
  })
  it('recovers from a lost second-batch response without duplicating any already written creator',async()=>{
    const f=fixture();f.configure();await f.probe();f.addRows(204);f.failBatchAt(3)
    await expect(f.service.syncAll({ownerSecUid:'owner'})).rejects.toThrow('请求超时')
    expect(f.service.state().sync).toMatchObject({phase:'error',created:100,verified:0});expect(f.records).toHaveLength(201)
    const retried=await f.service.syncAll({ownerSecUid:'owner'})
    expect(retried).toMatchObject({phase:'success',created:4,unchanged:201,verified:205});expect(f.records).toHaveLength(205)
    expect(new Set(f.records.map(record=>record.fields[FEISHU_KEY_FIELD])).size).toBe(205)
  })
  it('keeps all remote rows with partial or empty local results and refuses unverified bulk sync',async()=>{
    const f=fixture();f.configure();await expect(f.service.syncAll({ownerSecUid:'owner'})).rejects.toThrow('请先写入一位')
    await f.probe();f.addRows(3);await f.service.syncAll({ownerSecUid:'owner'});f.writes.length=0
    f.view.rows.splice(1);await f.service.syncAll({ownerSecUid:'owner'});expect(f.records).toHaveLength(4)
    f.view.rows.length=0;const empty=await f.service.syncAll({ownerSecUid:'owner'});expect(empty).toMatchObject({verified:0,created:0,updated:0})
    expect(f.records).toHaveLength(4);expect(f.writes).toHaveLength(0)
  })
  it('automatically syncs saved changes, coalesces events and does not send unchanged snapshots again',async()=>{
    const f=fixture();f.configure();await f.probe();await f.service.syncAll({ownerSecUid:'owner'})
    vi.useFakeTimers();f.service.startAutomatic();f.service.setAutomatic({ownerSecUid:'owner',enabled:true});f.writes.length=0;f.fetcher.mockClear()
    await vi.advanceTimersByTimeAsync(5000);expect(f.fetcher).not.toHaveBeenCalled()
    f.view.rows[0].values.workCount=88;for(let i=0;i<10;i++)f.service.dataChanged()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.service.state().sync).toMatchObject({trigger:'automatic',phase:'success',updated:1,verified:1})
    expect(f.writes).toHaveLength(1);expect(f.records[0].fields['APP · 作品数']).toBe(88)
    f.fetcher.mockClear();await vi.advanceTimersByTimeAsync(65000);expect(f.fetcher).not.toHaveBeenCalled()
    f.service.setAutomatic({ownerSecUid:'owner',enabled:false});f.view.rows[0].values.workCount=99;f.service.dataChanged();await vi.advanceTimersByTimeAsync(65000)
    expect(f.records[0].fields['APP · 作品数']).toBe(88)
  })
  it('persists automatic mode through restart and picks up changes arriving during a sync',async()=>{
    const f=fixture();f.configure();await f.probe();f.service.setAutomatic({ownerSecUid:'owner',enabled:true});f.service.stop()
    const resumed=new FeishuCreatorProbe(()=>({view:f.view,creators:f.creators}),owner=>({getApiKey:()=>f.saved.get(owner)??null,setApiKey:value=>{f.saved.set(owner,value)}}),()=>new FeishuClient(f.fetcher));services.push(resumed)
    vi.useFakeTimers();resumed.startAutomatic();let changed=false
    f.onList(()=>{if(!changed){changed=true;f.creators[0].note='同步中保存的批注';resumed.dataChanged()}})
    await vi.advanceTimersByTimeAsync(15000)
    expect(resumed.state().automatic).toBe(true);expect(f.records[0].fields['APP · 批注']).toBe('同步中保存的批注')
    expect(resumed.state().sync?.phase).toBe('success')
  })
  it('blocks the whole batch before writes on another creator identity conflict or account switch',async()=>{
    const f=fixture();f.configure();await f.probe();f.addRows(2);await f.service.syncAll({ownerSecUid:'owner'});f.writes.length=0
    f.records[2].fields['APP · 博主标识']='wrong';f.creators[0].note='pending'
    await expect(f.service.syncAll({ownerSecUid:'owner'})).rejects.toThrow('不一致');expect(f.writes).toHaveLength(0)
    f.records[2].fields['APP · 博主标识']='creator-2';f.onList(()=>{f.view.ownerSecUid='other'})
    await expect(f.service.syncAll({ownerSecUid:'owner'})).rejects.toThrow('账号已切换');expect(f.writes).toHaveLength(0)
  })
  it('backs off after an automatic network failure and retries without losing saved changes',async()=>{
    const f=fixture();f.configure();await f.probe();await f.service.syncAll({ownerSecUid:'owner'})
    vi.useFakeTimers();f.service.startAutomatic();f.service.setAutomatic({ownerSecUid:'owner',enabled:true})
    f.creators[0].note='网络恢复后同步';f.fetcher.mockRejectedValueOnce(Error('offline'))
    await vi.advanceTimersByTimeAsync(5000);expect(f.service.state().sync?.phase).toBe('error')
    f.fetcher.mockClear();await vi.advanceTimersByTimeAsync(59000);expect(f.fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.service.state().sync).toMatchObject({phase:'success',trigger:'automatic',updated:1})
    expect(f.records[0].fields['APP · 批注']).toBe('网络恢复后同步')
  })
})
