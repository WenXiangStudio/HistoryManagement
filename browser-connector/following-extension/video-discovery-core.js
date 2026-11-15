import {projectVideoInformation} from './video-information-core.js'
import {classifyActivityVisibility} from './creator-activity-network.js'

export function projectDiscoveryPage(input,scope,classify=classifyActivityVisibility,project=projectVideoInformation){
  const root=input?.data||input
  if(root?.status_code!==0||!Array.isArray(root.aweme_list)||root.aweme_list.length>200||![0,1,true,false].includes(root.has_more))throw Error('VIDEO_LIST_SCHEMA_INVALID')
  if(!Number.isSafeInteger(root.max_cursor)||root.max_cursor<0)throw Error('VIDEO_CURSOR_INVALID')
  const records=[],works=[]
  for(const row of root.aweme_list){
    if(row.author?.uid!==scope.authorUid||row.author?.sec_uid!==scope.authorSecUid)throw Error('VIDEO_AUTHOR_MISMATCH')
    if(!/^\d{8,30}$/.test(row.aweme_id)||!Number.isSafeInteger(row.create_time)||row.create_time<=0)throw Error('VIDEO_TIME_INVALID')
    const publishedAt=new Date(row.create_time*1000).toISOString()
    const visibility={privateStatus:row.status?.private_status??null,isDelete:row.status?.is_delete??null,isProhibited:row.status?.is_prohibited??null,
      allowShare:row.status?.allow_share??null,isStory:row.is_story??null,is24Story:row.is_24_story??null,awemeType:row.aweme_type??null}
    const verdict=classify(visibility)
    const pinned=row.is_top===1||row.is_top===true?true:row.is_top===0||row.is_top===false?false:null
    records.push({workId:row.aweme_id,publishedAt,pinned,visibility:verdict,awemeType:row.aweme_type??null})
    if(verdict!=='public'||row.aweme_type!==0||publishedAt<scope.start||publishedAt>=scope.endExclusive)continue
    works.push(project({status_code:0,has_more:root.has_more,aweme_list:[row]},
      {workId:row.aweme_id,authorUid:scope.authorUid,authorSecUid:scope.authorSecUid,publishedAt},classify).aweme_list[0])
  }
  return {status_code:0,has_more:root.has_more,max_cursor:root.max_cursor,records,works}
}
