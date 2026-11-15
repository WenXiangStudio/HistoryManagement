import type {VideoInformationCapture,VideoInformationCommand} from '../videoInformation'
export function videoInformationFixture(){
  const time='2026-10-01T00:00:00.000Z'
  const command:VideoInformationCommand={action:'video-information',runId:'video-test',ownerSecUid:'owner-sec',ownerUid:'owner-uid',
    creatorId:-1,nickname:'测试博主',authorUid:'author-uid',authorSecUid:'author-sec',workId:'7000000000000000001',publishedAt:'2026-09-30T00:00:00.000Z'}
  const capture:VideoInformationCapture={contract:'signaldesk-video-information/v1',ownerVerification:{contract:'signaldesk-activity-owner/v1',kind:'active-get',
    runId:command.runId,uid:command.ownerUid,secUid:command.ownerSecUid,endpoint:'/aweme/v1/web/user/profile/self/',method:'GET',httpStatus:200,
    observedAt:time,navigationStartedAt:time,firstAuthorSecUid:command.authorSecUid,tabId:1},
    work:{workId:command.workId,authorUid:command.authorUid,authorSecUid:command.authorSecUid,publishedAt:command.publishedAt,
      description:'完整发布文案\n保留第二行',title:'完整发布文案',titleSource:'description-derived',durationMs:76934,awemeType:0,
      visibility:{privateStatus:0,isDelete:false,isProhibited:false,allowShare:true,isStory:0,is24Story:0,awemeType:0},
      statistics:{likeCount:12345,commentCount:0,collectCount:null,shareCount:12}},
    sourceProof:{kind:'native-network',endpoint:'/aweme/v1/web/aweme/post/',method:'GET',httpStatus:200,secUid:command.authorSecUid,requestCursor:0,observedAt:time},
    checkedAt:time,acquisitionMs:1000,audit:{authorHomepageNavigations:1,ownerVerificationGets:1,activeWorkGets:0,networkRequestsObserved:10,platformApiGetsObserved:2,selfGetsObserved:1,listGetsObserved:1}}
  return {command,capture,time}
}
