import type {WorkflowFrame} from './videoWorkflow'

export const WORKSHOP_DEEP_MODEL='Qwen/Qwen3.5-122B-A10B'
export const WORKSHOP_DEEP_PROMPT='workshop-aligned-report/v1'
export type WorkshopDeepPhase='preparing'|'transcribing'|'recognizing'|'reporting'|'completed'|'failed'|'cancelled'

/** These are the original ASR intervals on the source-video timeline, in milliseconds. */
export type SpeechSegment={id:string;startMs:number;endMs:number;text:string}
export type WorkshopSpeech={
  state:'transcribed'|'no-audio'|'no-speech';text:string;segments:SpeechSegment[];
  sourceSha256:string;durationMs:number;model:string;requestId?:string;resourceId?:string;
  audioPath?:string;audioSha256?:string;generatedAt?:string
}
export type WorkshopVisionReading={frameId:string;timeMs:number;text:string;description:string;uncertainties:string[]}

/** The program constructs the interval and evidence membership; the model only fills prose. */
export type WorkshopAlignedSection={
  id:string;startMs:number;endMs:number;speechIds:string[];frameIds:string[];
  title:string;summary:string;analysis:string
}
export type WorkshopDeepReport={overview:string;sections:WorkshopAlignedSection[];limitations:string[]}
export type WorkshopDeepRequest={
  stage:'vision'|'report'|'overview';responseId:string;inputHash:string;model:string;
  elapsedMs:number;cached:boolean;inputTokens:number;outputTokens:number
}
export type WorkshopDeepResult={
  sourceSha256:string;durationMs:number;model:string;promptVersion:string;generatedAt:string;
  speech:WorkshopSpeech;frames:WorkflowFrame[];readings:WorkshopVisionReading[];report:WorkshopDeepReport;
  requests:WorkshopDeepRequest[];timing:{preparationMs:number;transcriptionMs:number;recognitionMs:number;reportMs:number;processingMs:number};
  usage:{inputTokens:number;outputTokens:number}
}
export type WorkshopDeepJob={
  phase:WorkshopDeepPhase;message:string;clickedAt:number;startedAt:string;finishedAt?:string;elapsedMs?:number;
  displayedTotalMs?:number;result?:WorkshopDeepResult
}
