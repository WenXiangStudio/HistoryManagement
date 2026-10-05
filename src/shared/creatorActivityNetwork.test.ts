import {describe,it,expect} from 'vitest'
import {acceptCreatorActivity, type CreatorActivityCapture} from './creatorActivity'
const expected={ownerSecUid:'owner',secUid:'sec',uid:'uid',weekStart:'2026-09-27T16:00:00.000Z',weekEndExclusive:'2026-10-04T16:00:00.000Z'}
const record=(id:string,time='2026-10-03T04:00:00.000Z')=>({workId:id,authorUid:'uid',authorSecUid:'sec',publishedAt:time,pinned:false,
  visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:68}})
function capture():CreatorActivityCapture{
 const checkedAt='2026-10-03T12:00:00.000Z'
 return {contract:'signaldesk-creator-activity/v6',requestContext:{versionCode:'170400',publishStrategy:'2',clientType:'1'},
   ownerSecUid:'owner',requestedSecUid:'sec',profile:{uid:'uid',secUid:'sec',workCount:null},checkedAt,
   weekStart:expected.weekStart,weekEndExclusive:expected.weekEndExclusive,frontendCount:{count:18,text:'18',profileUrl:'https://www.douyin.com/user/sec',secUid:'sec',checkedAt,selector:'#semiTabpost [data-e2e="user-tab-count"]'},
   pages:[{requestCursor:0,responseCursor:100,hasMore:true,items:[],excludedAuthors:[],excludedNonPublic:[],
     records:[record('700000001'),record('700000002','2026-09-20T00:00:00.000Z')],
     sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',secUid:'sec',requestCursor:0,httpStatus:200,observedAt:checkedAt}}],
   errorCode:null,activeApiRequests:0,reusedNativePages:1,nativeListRequests:1,acquisitionMs:100}
}
describe('native source and independent visibility verification',()=>{
 it('accepts explicit v7 first pages with unchanged author, cursor, visibility and accounting checks',()=>{
   const value=capture();value.contract='signaldesk-creator-activity/v7';value.pages[0].sourceProof!.kind='active-get'
   value.activeApiRequests=1;value.reusedNativePages=0;value.nativeListRequests=0
   expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:18,weeklyUpdateCount:1,coverage:'week-boundary'})
   for(const mutate of [
     (v:CreatorActivityCapture)=>{v.pages[0].sourceProof!.kind='native-network';v.reusedNativePages=1;v.nativeListRequests=1;v.activeApiRequests=0},
     (v:CreatorActivityCapture)=>{v.pages[0].sourceProof!.secUid='other'},
     (v:CreatorActivityCapture)=>{v.pages[0].sourceProof!.requestCursor=100},
     (v:CreatorActivityCapture)=>{v.pages[0].records![0].authorUid='other'},
     (v:CreatorActivityCapture)=>{v.activeApiRequests=0}
   ]){const changed=structuredClone(value);mutate(changed);expect(()=>acceptCreatorActivity(changed,expected)).toThrow()}
   value.pages=[];value.errorCode='ACTIVITY_REQUEST_TIMEOUT'
   expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:18,weeklyUpdateCount:null,weeklyStatus:'partial'})
 })
 it('confirms one reused page without any explicit list GET, including image posts',()=>{
   expect(acceptCreatorActivity(capture(),expected).snapshot).toMatchObject({workCount:18,weeklyUpdateCount:1,latestPublishedAt:'2026-10-03T04:00:00.000Z',coverage:'week-boundary',errorCode:null})
 })
 it('excludes positive restrictions, deletion, prohibition and temporary markers from both weekly fields',()=>{
   const value=capture();value.pages[0].hasMore=false
   value.pages[0].records=[record('700000001'),...Array.from({length:5},(_,i)=>record(String(700000002+i),'2026-10-03T05:00:00.000Z'))]
   value.pages[0].records[1].visibility.privateStatus=2
   value.pages[0].records[2].visibility.isDelete=true
   value.pages[0].records[3].visibility.isProhibited=true
   value.pages[0].records[4].visibility.isStory=1
   value.pages[0].records[5].visibility.is24Story=1
   expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({weeklyUpdateCount:1,latestPublishedAt:'2026-10-03T04:00:00.000Z',errorCode:null})
 })
 it('preserves frontend count but refuses to report exact zero for unknown visibility inside the range',()=>{
   const value=capture();value.pages[0].hasMore=false;value.pages[0].records![0].visibility.privateStatus=null
   expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:18,weeklyUpdateCount:null,weeklyStatus:'partial',errorCode:'ACTIVITY_WORK_VISIBILITY_UNVERIFIED'})
   value.pages[0].records![0].publishedAt=null
   expect(acceptCreatorActivity(value,expected).snapshot.weeklyUpdateCount).toBeNull()
 })
 it('does not let excluded works hide a time-order inversion and trigger early completion',()=>{
   const value=capture(),hidden=record('700000003','2026-10-02T00:00:00.000Z');hidden.visibility.privateStatus=1
   value.pages[0].records!.push(hidden)
   expect(acceptCreatorActivity(value,expected).snapshot.coverage).toBe('partial')
   value.pages[0].hasMore=false
   expect(acceptCreatorActivity(value,expected).snapshot.weeklyUpdateCount).toBe(1)
 })
 it('checks target identity, source cursor, native first page, timestamp and request accounting',()=>{
   for(const mutate of [
     (v:CreatorActivityCapture)=>{v.pages[0].sourceProof!.secUid='other'},
     (v:CreatorActivityCapture)=>{v.pages[0].sourceProof!.requestCursor=10},
     (v:CreatorActivityCapture)=>{v.pages[0].sourceProof!.kind='active-get';v.activeApiRequests=1;v.reusedNativePages=0},
     (v:CreatorActivityCapture)=>{v.pages[0].records![0].authorUid='other'},
     (v:CreatorActivityCapture)=>{v.pages[0].sourceProof!.observedAt='2026-10-02T00:00:00.000Z'},
     (v:CreatorActivityCapture)=>{v.activeApiRequests=5},
     (v:CreatorActivityCapture)=>{v.reusedNativePages=0}
   ]){const value=capture();mutate(value);expect(()=>acceptCreatorActivity(value,expected)).toThrow()}
 })
 it('continues with one explicit later page, deduplicates records and ignores old pins for ordering',()=>{
   const value=capture(),pin=record('700000003','2026-07-01T00:00:00.000Z');pin.pinned=true
   value.pages[0].records=[pin,record('700000001')]
   value.pages.push({...value.pages[0],requestCursor:100,responseCursor:200,records:[structuredClone(pin),record('700000004','2026-10-02T00:00:00.000Z'),record('700000005','2026-09-20T00:00:00.000Z')],
     sourceProof:{...value.pages[0].sourceProof!,kind:'active-get',requestCursor:100}})
   value.activeApiRequests=1
   expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({weeklyUpdateCount:2,coverage:'week-boundary',errorCode:null})
   value.pages[1].records![0].visibility.privateStatus=1
   expect(()=>acceptCreatorActivity(value,expected)).toThrow('冲突')
 })
 it('accepts a proven ended empty list, but preserves frontend count on a missing native response',()=>{
   const value=capture();value.pages[0].records=[];value.pages[0].hasMore=false
   expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:18,weeklyUpdateCount:0,weeklyStatus:'empty'})
   value.pages=[];value.reusedNativePages=0;value.nativeListRequests=0;value.errorCode='ACTIVITY_NATIVE_LIST_UNAVAILABLE'
   expect(acceptCreatorActivity(value,expected).snapshot).toMatchObject({workCount:18,weeklyUpdateCount:null,weeklyStatus:'partial'})
 })
})
