export type DoubaoAuthMode='api-key'|'app-token'
export type DoubaoSpeechSettings={authMode:DoubaoAuthMode;appId:string;hasSecret:boolean;resourceId:'volc.bigasr.auc_turbo';revision:string}
export type DoubaoSpeechTrial={state:'idle'|'preparing'|'running'|'pending'|'uncertain'|'completed'|'failed';message:string;requestId?:string;
  startedAt?:string;finishedAt?:string;elapsedMs?:number;audioDurationMs?:number;text?:string;statusCode?:string;logId?:string;
  resourceId?:'volc.seedasr.auc'|'volc.bigasr.auc_turbo';httpStatus?:number;apiMessage?:string;submittedAt?:string;
  preparationMs?:number;requestMs?:number;saveMs?:number;displayedAt?:string;displayedTotalMs?:number;returnedDurationMs?:number}
export type DoubaoSpeechView={settings:DoubaoSpeechSettings;trial:DoubaoSpeechTrial;audioReady:boolean;standardTrial?:DoubaoSpeechTrial}
