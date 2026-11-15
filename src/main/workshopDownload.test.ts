import {expect,it} from 'vitest'
import {validateWorkshopDownloadIdentity} from './workshopDownload'
const workId='7684211392850186216',input={url:`https://www.douyin.com/video/${workId}`,expectedWorkId:workId}
it('requires extractor identity and an exact requested video id before accepting download metadata',()=>{
  expect(validateWorkshopDownloadIdentity(input,{id:workId,extractor:'Douyin',title:'作品',uploader:'作者'})).toEqual({workId,title:'作品',authorName:'作者'})
  expect(()=>validateWorkshopDownloadIdentity(input,{id:'7684211392850186217',extractor:'Douyin'})).toThrow('作品编号不一致')
  expect(()=>validateWorkshopDownloadIdentity(input,{id:workId,extractor:'generic'})).toThrow('不是抖音视频')
  expect(()=>validateWorkshopDownloadIdentity(input,{id:'invalid',extractor:'Douyin'})).toThrow('作品编号')
  expect(()=>validateWorkshopDownloadIdentity(input,null)).toThrow('作品信息')
})
