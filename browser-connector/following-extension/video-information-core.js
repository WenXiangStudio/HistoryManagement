import {classifyActivityVisibility} from './creator-activity-network.js'

// Only a single saved video is projected. No headers, media URLs, other authors,
// recommendations or raw response bodies leave this function.
export function projectVideoInformation(input, scope, classify=classifyActivityVisibility) {
  const root=input?.data||input
  if(root?.status_code!==0)throw Error('VIDEO_RESPONSE_REJECTED')
  if(!Array.isArray(root.aweme_list)||root.aweme_list.length>200||![0,1,true,false].includes(root.has_more))throw Error('VIDEO_LIST_SCHEMA_INVALID')
  const matches=root.aweme_list.filter(row=>row?.aweme_id===scope.workId)
  if(matches.length===0&&scope.captureEvidence)return {aweme_list:[],targetMissing:true}
  if(matches.length!==1)throw Error(matches.length?'VIDEO_DUPLICATE_ID':'VIDEO_NOT_IN_FIRST_PAGE')
  const row=matches[0]
  if(row.author?.uid!==scope.authorUid||row.author?.sec_uid!==scope.authorSecUid)throw Error('VIDEO_AUTHOR_MISMATCH')
  const visibility={privateStatus:row.status?.private_status??null,isDelete:row.status?.is_delete??null,
    isProhibited:row.status?.is_prohibited??null,allowShare:row.status?.allow_share??null,
    isStory:row.is_story??null,is24Story:row.is_24_story??null,awemeType:row.aweme_type??null}
  if(classify(visibility)!=='public')throw Error('VIDEO_PUBLIC_STATUS_UNVERIFIED')
  if(row.aweme_type!==0)throw Error('VIDEO_TYPE_UNSUPPORTED')
  if(!Number.isSafeInteger(row.create_time)||row.create_time<=0||row.create_time*1000>Date.now()+60000)throw Error('VIDEO_TIME_INVALID')
  const publishedAt=new Date(row.create_time*1000).toISOString()
  if(publishedAt!==scope.publishedAt)throw Error('VIDEO_SAVED_RECORD_MISMATCH')
  if(row.desc!==undefined&&row.desc!==null&&(typeof row.desc!=='string'||row.desc.length>20000))throw Error('VIDEO_DESCRIPTION_INVALID')
  const description=row.desc??null
  const count=value=>{
    if(value===undefined||value===null)return null
    if(!Number.isSafeInteger(value)||value<0)throw Error('VIDEO_COUNT_INVALID')
    return value
  }
  if(row.statistics!==undefined&&row.statistics!==null&&(typeof row.statistics!=='object'||Array.isArray(row.statistics)))throw Error('VIDEO_STATISTICS_INVALID')
  const stats=row.statistics||{}
  const work={workId:row.aweme_id,authorUid:row.author.uid,authorSecUid:row.author.sec_uid,publishedAt,description,
    title:description?.split(/\r?\n/).find(line=>line.trim())?.trim().slice(0,120)||null,titleSource:'description-derived',
    durationMs:count(row.video?.duration),awemeType:0,visibility,
    statistics:{likeCount:count(stats.digg_count),commentCount:count(stats.comment_count),collectCount:count(stats.collect_count),shareCount:count(stats.share_count)}}
  let media
  if(scope.captureEvidence){
    const candidates=[row.video?.play_addr,...[...(row.video?.bit_rate||[])].sort((a,b)=>(a.bit_rate||0)-(b.bit_rate||0)).map(x=>x.play_addr)]
    const urls=[...new Set(candidates.flatMap(x=>Array.isArray(x?.url_list)?x.url_list:[]))].filter(x=>typeof x==='string'&&x.startsWith('https://')).slice(0,8)
    if(!urls.length)throw Error('VIDEO_MEDIA_SOURCE_UNAVAILABLE')
    media={urls,vid:typeof row.video?.vid==='string'?row.video.vid:null}
  }
  return {aweme_list:[work],...(media?{media}: {})}
}
