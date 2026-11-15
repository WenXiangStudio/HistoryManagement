import {describe,it,expect,vi} from 'vitest'
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createWorkshopBrowserDownloader,isWorkshopMediaUrl,resolveWorkshopBrowserInput,validateWorkshopBrowserMedia} from './workshopBrowser'
import type {WorkshopDownloader} from './workshopDownload'

const id='7684211392850186216',other='7684211392850186217',input={url:`https://www.douyin.com/video/${id}`,expectedWorkId:id},signal=()=>new AbortController().signal
const media={workId:id,pageUrl:input.url,mediaUrl:'https://v26-web.douyinvod.com/example/video.mp4',title:'测试作品',authorName:'作者'}
describe('workshop browser fallback',()=>{
  it('resolves the explicitly supplied official share link and verifies its final work identity',async()=>{
    const fetchApi=vi.fn(async()=>new Response(null,{status:302,headers:{location:`https://www.iesdouyin.com/share/video/${id}/?region=CN`}}))
    expect(await resolveWorkshopBrowserInput({url:'https://v.douyin.com/abc123/',expectedWorkId:null},signal(),fetchApi as typeof fetch)).toEqual(input)
    expect(fetchApi).toHaveBeenCalledOnce()
    expect(await resolveWorkshopBrowserInput(input,signal(),fetchApi as typeof fetch)).toEqual(input)
    expect(fetchApi).toHaveBeenCalledOnce()
    await expect(resolveWorkshopBrowserInput({...input,expectedWorkId:other},signal(),fetchApi as typeof fetch)).rejects.toThrow('作品编号不一致')
  })
  it('rejects offsite redirects, credentials, ports and redirect loops before contacting their target',async()=>{
    for(const location of ['https://evil.example/video/'+id,'https://www.douyin.com.evil.example/video/'+id,'https://user@www.douyin.com/video/'+id,'https://www.douyin.com:444/video/'+id]){
      const fetchApi=vi.fn(async()=>new Response(null,{status:302,headers:{location}}))
      await expect(resolveWorkshopBrowserInput({url:'https://v.douyin.com/a/',expectedWorkId:null},signal(),fetchApi as typeof fetch)).rejects.toThrow('非官方地址')
      expect(fetchApi).toHaveBeenCalledOnce()
    }
    const loop=vi.fn(async()=>new Response(null,{status:302,headers:{location:'https://v.douyin.com/a/'}}))
    await expect(resolveWorkshopBrowserInput({url:'https://v.douyin.com/a/',expectedWorkId:null},signal(),loop as typeof fetch)).rejects.toThrow('跳转过多')
    expect(loop).toHaveBeenCalledTimes(5)
  })
  it('requires exact video and page identity and a trusted HTTPS media domain',()=>{
    expect(validateWorkshopBrowserMedia(input,media)).toEqual(media)
    for(const invalid of [{...media,workId:other},{...media,pageUrl:`https://www.douyin.com/video/${other}`},{...media,pageUrl:`https://www.iesdouyin.com/share/video/${id}`},{...media,mediaUrl:'https://douyinvod.com.evil.example/file'}])expect(()=>validateWorkshopBrowserMedia(input,invalid)).toThrow()
    for(const url of ['https://127.0.0.1/x','http://v3.douyinvod.com/x','https://user:secret@v3.douyinvod.com/x','https://v3.douyinvod.com:444/x'])expect(isWorkshopMediaUrl(url)).toBe(false)
  })
  it('keeps a successful public download and does not contact the browser',async()=>{
    const result={workId:id,mediaPath:'E:\\VideoDownload\\source.mp4'},browser={readWorkshopVideo:vi.fn()},primary=vi.fn(async()=>result)
    expect(await createWorkshopBrowserDownloader(browser,primary)(input,'unused',signal(),()=>{})).toBe(result)
    expect(browser.readWorkshopVideo).not.toHaveBeenCalled()
  })
  it('streams the verified browser source with no cookies and persists no signed media URLs',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'workshop-browser-stream-')),browser={readWorkshopVideo:vi.fn(async()=>media)}
    const fetchApi=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response(new Uint8Array([0,1,2,3]),{status:200,headers:{'content-type':'video/mp4'}}))
    const primary:WorkshopDownloader=async()=>{throw Error('抖音限制了该作品的公开下载')}
    try{
      const result=await createWorkshopBrowserDownloader(browser,primary,fetchApi as typeof fetch)(input,directory,signal(),()=>{})
      expect(result).toEqual({workId:id,title:media.title,authorName:media.authorName,mediaPath:join(directory,'source.mp4')})
      expect([...readFileSync(result.mediaPath)]).toEqual([0,1,2,3]);expect(readdirSync(directory)).toEqual(['source.mp4'])
      expect(fetchApi.mock.calls[0]?.[0]).toBe(media.mediaUrl)
      expect(fetchApi.mock.calls[0]?.[1]).not.toHaveProperty('credentials');expect(fetchApi.mock.calls[0]?.[1]).not.toHaveProperty('headers.cookie')
    }finally{rmSync(directory,{recursive:true,force:true})}
  })
  it('does not fall back for identity failures or cancellation',async()=>{
    const browser={readWorkshopVideo:vi.fn()},cancelled=new AbortController();cancelled.abort()
    await expect(createWorkshopBrowserDownloader(browser,async()=>{throw Error('作品编号不一致')})(input,'unused',signal(),()=>{})).rejects.toThrow('作品编号不一致')
    await expect(createWorkshopBrowserDownloader(browser,async()=>{throw Error('下载失败')})(input,'unused',cancelled.signal,()=>{})).rejects.toThrow()
    expect(browser.readWorkshopVideo).not.toHaveBeenCalled()
  })
  it('rejects untrusted media redirects and oversized bodies without leaving temporary files',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'workshop-browser-failure-')),browser={readWorkshopVideo:vi.fn(async()=>media)},primary:WorkshopDownloader=async()=>{throw Error('下载失败')}
    try{
      for(const response of [new Response(null,{status:302,headers:{location:'https://evil.example/file'}}),new Response('bad',{status:200,headers:{'content-length':String(3*1024**3)}})]){
        const fetchApi=vi.fn(async()=>response)
        await expect(createWorkshopBrowserDownloader(browser,primary,fetchApi as typeof fetch)(input,directory,signal(),()=>{})).rejects.toThrow()
        expect(fetchApi).toHaveBeenCalledOnce();expect(readdirSync(directory)).toEqual([])
      }
    }finally{rmSync(directory,{recursive:true,force:true})}
  })
})
