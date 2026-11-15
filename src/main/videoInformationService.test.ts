import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {it,expect,vi,afterEach} from 'vitest'
import {VideoInformationService} from './videoInformationService'
import {videoInformationFixture} from '../shared/fixtures/videoInformationFixture'
import type {CreatorListItem} from '../shared/contracts'

const cleanups:(()=>void)[]=[]
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();vi.useRealTimers()})
function setup(){
  vi.useFakeTimers();const fixture=videoInformationFixture();vi.setSystemTime(fixture.time)
  const directory=mkdtempSync(join(tmpdir(),'video-info-')),db=new DatabaseSync(':memory:'),service=new VideoInformationService(db,directory,()=>{})
  cleanups.push(()=>{service.cancel();db.close();rmSync(directory,{recursive:true,force:true})})
  const target={...fixture.command};vi.spyOn(service,'target').mockReturnValue(target)
  const creator={id:-1,nickname:'测试博主'} as CreatorListItem
  const command=service.begin(target.ownerSecUid,target.ownerUid,creator)
  fixture.capture.ownerVerification.runId=command.runId
  return {...fixture,command,service,db,creator}
}
it('persists a successful read and render receipt while other accounts cannot see its state',async()=>{
  const {command,capture,service}=setup()
  const result=await service.receive({runId:command.runId,capture})
  expect(result.phase).toBe('completed');expect(service.store.list(command.ownerSecUid,command.authorSecUid)).toHaveLength(1)
  expect(service.status('other').phase).toBe('idle');expect(service.status('other').capture).toBeUndefined()
  expect(service.rendered('other',command.runId).displayedTotalMs).toBeUndefined()
  expect(service.rendered(command.ownerSecUid,command.runId).displayedTotalMs).toBeGreaterThanOrEqual(0)
})
it('cancellation and timeout prevent late results from being saved',async()=>{
  const {command,capture,service,creator}=setup()
  service.cancel();await expect(service.receive({runId:command.runId,capture})).rejects.toThrow('会话已结束')
  expect(service.store.list(command.ownerSecUid,command.authorSecUid)).toEqual([])
  service.begin(command.ownerSecUid,command.ownerUid,creator);vi.advanceTimersByTime(60000)
  expect(service.status(command.ownerSecUid)).toMatchObject({phase:'blocked',errorCode:'VIDEO_READ_TIMEOUT'})
})
it('invalid account proof blocks the run and creates no video row',async()=>{
  const {command,capture,service}=setup();capture.ownerVerification.uid='wrong'
  await expect(service.receive({runId:command.runId,capture})).rejects.toThrow('VIDEO_OWNER_MISMATCH')
  expect(service.status(command.ownerSecUid)).toMatchObject({phase:'blocked',errorCode:'VIDEO_OWNER_MISMATCH'})
  expect(service.store.list(command.ownerSecUid,command.authorSecUid)).toEqual([])
})
