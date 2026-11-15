import {z} from 'zod'
import type {TextApiProtocol} from './contracts'

export const videoInterestSchema=z.enum(['unmarked','interested','not-interested'])
export type VideoInterest=z.infer<typeof videoInterestSchema>
export const evidenceSegmentSchema=z.object({id:z.string().min(1).max(120),kind:z.enum(['speech','frame-text','visual']),
  startMs:z.number().int().nonnegative(),endMs:z.number().int().nonnegative(),text:z.string().min(1).max(12000),frameRef:z.string().optional()}).strict()
export type ContentEvidence=z.infer<typeof evidenceSegmentSchema>
const refs=z.array(z.string().min(1).max(120)).min(1).max(20)
export const contentSummarySchema=z.object({overview:z.string().min(1).max(1600),overviewEvidenceIds:refs,
  topics:z.array(z.string().min(1).max(60)).min(1).max(8),
  keyPoints:z.array(z.object({text:z.string().min(1).max(1200),evidenceIds:refs}).strict()).min(1).max(12),
  sections:z.array(z.object({title:z.string().min(1).max(120),evidenceIds:refs}).strict()).max(20),
  limitations:z.array(z.string().min(1).max(600)).max(20)}).strict()
export type ContentSummary=z.infer<typeof contentSummarySchema>
export type SavedContentSummary=ContentSummary & {inputHash:string;modelVersion:string;promptVersion:string;generatedAt:string;
  provider:'local'|'cloud';protocol?:TextApiProtocol;evidence:ContentEvidence[];processedChunks:number;usage:{inputTokens:number;outputTokens:number}}
export type ContentStage='media'|'transcript'|'visual'|'summary'|'classification'|'body'|'research'
export type ContentTaskState='queued'|'running'|'completed'|'partial'|'failed'|'cancelled'|'interrupted'
export type ContentStageResult={stage:ContentStage;state:ContentTaskState;inputHash:string;updatedAt:string;result:unknown;error?:string}
export type VideoContentBatch={id:string;ownerSecUid:string;kind:'process'|'discover';state:ContentTaskState;createdAt:string;updatedAt:string;
  workIds:string[];attemptWorkIds?:string[];completedWorkIds:string[];failedWorkIds:string[];pendingSummaryWorkIds?:string[];currentWorkId?:string;currentStage?:ContentStage;message:string;
  provider?:'local'|'cloud'|'cloud-omni'|'cloud-frames'|'triage'|'workflow';concurrency?:number;stageElapsedMs?:Partial<Record<ContentStage,number>>;cloudIdentity?:string;modelVersion?:string;includeVision?:boolean;startedAt?:string;attemptStartedAt?:string;finishedAt?:string;elapsedMs?:number;firstAvailableMs?:number;firstDisplayedMs?:number;displayedTotalMs?:number;displayedWorkIds?:string[];
  discovery?:{creatorIds:number[];startDate:string;endDate:string;authorIndex:number;cursor:number;pageCount:number;coverage:'partial'|'complete';seenIds:string[];previousTime?:number;ordered?:boolean}}
export type VideoContentInfo={interest:VideoInterest;stages:Partial<Record<ContentStage,{state:ContentTaskState;error?:string;updatedAt:string}>>;
  classification?:import('./videoWorkflow').VideoClassification;body?:import('./videoWorkflow').MaterialBody;research?:import('./videoWorkflow').ResearchReport;inboxState?:import('./videoWorkflow').MaterialInboxState;
  overview?:string;topics?:string[];limitations?:string[]}
export type VideoContentDetail={ownerSecUid:string;workId:string;interest:VideoInterest;stages:ContentStageResult[];summary:SavedContentSummary|null}
export type VideoContentRuntime={ready:boolean;pythonAvailable:boolean;asrAvailable:boolean;ocrAvailable:boolean;summaryAvailable:boolean;localSummaryValidated:boolean;triageAvailable?:boolean;message:string}
export type CloudFrameResult={mode:'cloud-frames-only';provider:'siliconflow';modelVersion:string;promptVersion:string;generatedAt:string;
  frames:{id:string;timeMs:number;path:string;sha256:string}[];
  readings:{frameId:string;timeMs:number;text:string;description:string;uncertainties:string[]}[];
  blocks:{id:string;frameId:string;timeMs:number;text:string;needsReview:boolean}[];
  vision:{observations:{text:string;frameIds:string[]}[];limitations:string[]};
  usage:{inputTokens:number;outputTokens:number;reasoningTokens:number};
  requests:{responseId:string;frameIds:string[];elapsedMs:number;cached:boolean;usage:unknown}[];
  timing:{preparationMs:number;requestMs:number};framesReused:boolean;sourceSha256:string;localModelsUsed:false;audioSubmitted:false;summaryGenerated:false}
export const summaryJsonSchema=z.toJSONSchema(contentSummarySchema)


export function validateSummary(input:unknown,evidence:ContentEvidence[]):ContentSummary{
  const result=contentSummarySchema.parse(input),ids=new Set(evidence.map(e=>e.id))
  for(const ref of [...result.overviewEvidenceIds,...result.keyPoints.flatMap(p=>p.evidenceIds),...result.sections.flatMap(p=>p.evidenceIds)]){
    if(!ids.has(ref))throw Error('SUMMARY_EVIDENCE_REFERENCE_INVALID')
  }
  return result
}

export function publicationRange(startDate:string,endDate:string):{start:string;endExclusive:string}{
  const valid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
  if(!valid(startDate)||!valid(endDate)||startDate>endDate)throw Error('请选择有效的起止日期')
  return {start:new Date(startDate+'T00:00:00+08:00').toISOString(),endExclusive:new Date(Date.parse(endDate+'T00:00:00+08:00')+86400000).toISOString()}
}
