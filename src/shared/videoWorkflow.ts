import {z} from 'zod'

export const VIDEO_CLASS_LABELS={visual:'纯画面主导类',visual_text:'图文结合（无人声/口播）类',speech:'口播主导或口播加图文类',pending:'无法判定 · 请人工审核'} as const
export type VideoClass=keyof typeof VIDEO_CLASS_LABELS
export const WORKFLOW_CONCURRENCY=8
export const WORKFLOW_TEXT_MODEL='zai-org/GLM-5.3-Flash'
export const WORKFLOW_VISION_MODEL='Qwen/Qwen3.5-4B'
export type WorkflowFrame={id:string;timeMs:number;path:string;sha256:string}
export type VideoClassification={code:VideoClass;ruleVersion:string;sourceSha256:string;strength:string;
  basis:{speechPercent:number;speechBinCoverage:number;retainedTextFrames:number;sampledFrames:number};
  frames:WorkflowFrame[];timing:Record<string,number>;manualReview?:{code:VideoClass;note:string;at:string};
  asrInvoked:false;textRecognitionInvoked:false;cloudInvoked:false}
export function effectiveVideoClass(value?:VideoClassification|null):VideoClass{return value?.manualReview?.code??value?.code??'pending'}
export function processingRoute(value?:VideoClassification|null):'manual'|'vision'|'speech'|'review'{
  return ({visual:'manual',visual_text:'vision',speech:'speech',pending:'review'} as const)[effectiveVideoClass(value)]
}
export type MaterialBody={text:string;source:'doubao-flash'|'qwen-vision';sourceSha256:string;classificationHash:string;
  modelVersion:string;generatedAt:string;needsReview:boolean;reviewedAt?:string;originalText?:string;limitations:string[];requestId?:string}
const quotes=z.array(z.string().min(1).max(4000)).min(1).max(6)
export const researchReportSchema=z.object({overview:z.string().min(1).max(5000),
  analysis:z.string().min(1).max(10000),
  keyPoints:z.array(z.object({viewpoint:z.string().min(1).max(2000),explanation:z.string().min(1).max(5000),quotes}).strict()).min(1).max(20),
  domains:z.array(z.object({name:z.string().min(1).max(100),reasoning:z.string().min(1).max(2000),quotes}).strict()).min(1).max(10),
  limitations:z.array(z.string().min(1).max(2000)).max(20)}).strict()
export type ResearchReport=z.infer<typeof researchReportSchema>&{modelVersion:string;generatedAt:string;bodyHash:string;promptVersion:string}
export function validateResearchReport(input:unknown,text:string){
  const result=researchReportSchema.parse(input)
  for(const quote of [...result.keyPoints.flatMap(p=>p.quotes),...result.domains.flatMap(d=>d.quotes)]){
    if(!text.includes(quote))throw Error('研究报告引用与正文不符，请重新生成')
  }
  return result
}
export type MaterialInboxState='unread'|'read'|'later'|'saved'
