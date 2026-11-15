import {expect,it,vi} from 'vitest'
import {RefreshQueue} from './refreshQueue'

it('serializes snapshot reads and coalesces a burst into one latest followup without dropping its callers',async()=>{
  const queue=new RefreshQueue(),calls:string[]=[]
  let release:()=>void=()=>{}
  const first=queue.request(async()=>{calls.push('first');await new Promise<void>(resolve=>{release=resolve})})
  const obsolete=vi.fn(async()=>{}),latest=vi.fn(async()=>{calls.push('latest')})
  const second=queue.request(obsolete),third=queue.request(latest)
  expect(calls).toEqual(['first']);expect(obsolete).not.toHaveBeenCalled();expect(latest).not.toHaveBeenCalled()
  release();await Promise.all([first,second,third])
  expect(calls).toEqual(['first','latest']);expect(obsolete).not.toHaveBeenCalled()
  await queue.request(async()=>{calls.push('next')});expect(calls.at(-1)).toBe('next')
})
it('rejects failed readers, releases the queue and continues with the latest requested snapshot',async()=>{
  const queue=new RefreshQueue()
  let fail:(error:unknown)=>void=()=>{}
  const first=queue.request(()=>new Promise((_,reject)=>{fail=reject})),next=vi.fn(async()=>{})
  const rejected=expect(first).rejects.toThrow('read failed'),second=queue.request(next)
  fail(Error('read failed'));await rejected;await second
  expect(next).toHaveBeenCalledOnce()
})
