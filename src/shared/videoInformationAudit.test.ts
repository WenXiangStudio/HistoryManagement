import {expect,it} from 'vitest'
import {acceptVideoInformation} from './videoInformation'
import {videoInformationFixture} from './fixtures/videoInformationFixture'

it('accepts a verified controlled GET when the browser meter observed no list request',()=>{
  const {capture,command,time}=videoInformationFixture()
  capture.sourceProof.kind='active-get'
  capture.audit.activeWorkGets=1
  capture.audit.listGetsObserved=0
  expect(acceptVideoInformation(capture,command,time)).toEqual(capture)
})

it('still requires an observed list request for native network evidence',()=>{
  const {capture,command,time}=videoInformationFixture()
  capture.sourceProof.kind='native-network'
  capture.audit.activeWorkGets=0
  capture.audit.listGetsObserved=0
  expect(()=>acceptVideoInformation(capture,command,time)).toThrow('VIDEO_REQUEST_AUDIT_INVALID')
})

it('zero observed list requests cannot authorize additional GETs or mismatched ownership',()=>{
  const {capture,command,time}=videoInformationFixture()
  capture.sourceProof.kind='active-get';capture.audit.activeWorkGets=1;capture.audit.listGetsObserved=0
  capture.audit.activeWorkGets=2
  expect(()=>acceptVideoInformation(capture,command,time)).toThrow('VIDEO_REQUEST_AUDIT_INVALID')
  capture.audit.activeWorkGets=1;capture.work.authorUid='wrong-author'
  expect(()=>acceptVideoInformation(capture,command,time)).toThrow('VIDEO_AUTHOR_OR_WORK_MISMATCH')
  capture.work.authorUid=command.authorUid;capture.ownerVerification.uid='wrong-owner'
  expect(()=>acceptVideoInformation(capture,command,time)).toThrow('VIDEO_OWNER_MISMATCH')
})
