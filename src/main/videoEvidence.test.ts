import {describe,it,expect} from 'vitest'
import {isVideoMediaUrl} from './videoEvidence'
import {acceptVideoInformation} from '../shared/videoInformation'
import {videoInformationFixture} from '../shared/fixtures/videoInformationFixture'
describe('transient media source validation',()=>{
  it('permits verified platform CDN HTTPS URLs and rejects local, credential and suffix tricks',()=>{
    expect(isVideoMediaUrl('https://v3-web.douyinvod.com/video/test?signature=temporary')).toBe(true)
    for(const url of ['http://v3-web.douyinvod.com/x','https://127.0.0.1/x','https://douyinvod.com.evil.example/x',
      'https://user:password@v3-web.douyinvod.com/x','https://v3-web.douyinvod.com:8443/x','file:///tmp/video'])expect(isVideoMediaUrl(url)).toBe(false)
  })
  it('permits the bounded historical-detail read only for the explicit evidence task',()=>{
    const f=videoInformationFixture();f.capture.sourceProof.kind='active-get';f.capture.sourceProof.endpoint='/aweme/v1/web/aweme/detail/';f.capture.audit.activeWorkGets=2
    expect(()=>acceptVideoInformation(f.capture,f.command,f.time)).toThrow('VIDEO_SOURCE_SCOPE_INVALID')
    expect(acceptVideoInformation(f.capture,{...f.command,captureEvidence:true},f.time).work.workId).toBe(f.command.workId)
    f.capture.audit.activeWorkGets=3
    expect(()=>acceptVideoInformation(f.capture,{...f.command,captureEvidence:true},f.time)).toThrow()
  })
})
