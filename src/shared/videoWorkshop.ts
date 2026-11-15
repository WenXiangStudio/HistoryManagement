import type {VideoClassification} from './videoWorkflow'
import type {WorkshopDeepJob} from './workshopDeep'

export type WorkshopPhase='resolving'|'downloading'|'classifying'|'completed'|'failed'|'cancelled'
export type WorkshopJob={
  id:string;url:string;workId:string|null;title:string|null;authorName:string|null;phase:WorkshopPhase;message:string;
  createdAt:string;clickedAt:number;finishedAt?:string;elapsedMs?:number;stageElapsedMs:Record<string,number>;
  mediaPath?:string;byteLength?:number;sha256?:string;durationMs?:number;classification?:VideoClassification;deep?:WorkshopDeepJob
}
export type WorkshopView={jobs:WorkshopJob[];running:boolean;downloadRoot:string}

export type DouyinWorkshopLink =
  | {state:'empty'}
  | {state:'invalid';message:string}
  | {state:'valid';kind:'video'|'short';canonicalUrl:string;workId:string|null}

/** Read a single public Douyin URL locally. Resolving a short link belongs to download processing. */
export function parseDouyinWorkshopLink(input:string):DouyinWorkshopLink {
  const text=input.trim()
  if(!text)return {state:'empty'}
  const candidates=text.match(/https?:\/\/[^\s<>"'`]+/gi)??[]
  if(candidates.length!==1)return {state:'invalid',message:candidates.length>1?'请每次输入一条抖音视频链接。':'请输入抖音视频链接，或粘贴包含链接的分享文本。'}
  const candidate=candidates[0].replace(/[，。！？；：、）》】」』〉,.;!?)\]}]+$/u,'')
  let url:URL
  try{url=new URL(candidate)}catch{return {state:'invalid',message:'链接格式不完整，请重新复制抖音视频链接。'}}
  if(url.protocol!=='https:'||url.username||url.password||url.port)return {state:'invalid',message:'请使用不含账号信息和自定义端口的 HTTPS 抖音视频链接。'}
  if(url.hostname==='www.douyin.com'||url.hostname==='douyin.com'){
    const match=/^\/video\/(\d+)\/?$/.exec(url.pathname)
    if(match)return {state:'valid',kind:'video',canonicalUrl:`https://www.douyin.com/video/${match[1]}`,workId:match[1]}
  }else if(url.hostname==='v.douyin.com'){
    const match=/^\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)
    if(match)return {state:'valid',kind:'short',canonicalUrl:`https://v.douyin.com/${match[1]}/`,workId:null}
  }else return {state:'invalid',message:'当前仅支持抖音视频链接，请从抖音复制作品链接。'}
  return {state:'invalid',message:'请使用抖音作品链接或分享短链接，暂不支持主页、合集和直播地址。'}
}
